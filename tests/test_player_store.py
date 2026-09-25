import base64
import tempfile
import unittest
from pathlib import Path

from packages.accounts import AccountError, PlayerStore
from tests.test_player_learning import shot_event


def round_save(course="cranbury", complete=False, hole=4, seed=7):
    holes = [
        {"hole_number": index + 1, "score": 4 if complete else None, "events": []}
        for index in range(18)
    ]
    if not complete:
        holes[0] = {"hole_number": 1, "score": 5, "events": []}
    return {
        "version": "golf-round-save-v1",
        "saved_at": "2026-08-04T00:00:00Z",
        "course_id": course,
        "current_hole_index": hole,
        "pin_index": 2,
        "player_profile": {"id": "90", "name": "90+ player", "clubs": [{"name": "Driver"}]},
        "round_summary": {
            "course_name": "Cranbury Golf Club" if course == "cranbury" else "The Meadows",
            "tee": "White",
            "holes_completed": 18 if complete else 1,
            "total_strokes": 72 if complete else 5,
            "total_par": 72 if complete else 5,
            "score_to_par": 0,
            "strategy_score": 81,
            "execution_score": 74,
            "scored_shots": 43,
        },
        "round_state": {
            "version": "round-state-v1",
            "course_id": course,
            "round_seed": seed,
            "tee": "White",
            "holes": holes,
        },
    }


def gps_round(round_id="gps-round-1234", course="warrenbrook", revision=1, complete=False):
    return {
        "version": "on-course-gps-round-v1",
        "round_id": round_id,
        "revision": revision,
        "course_id": course,
        "started_at": "2026-08-11T12:00:00Z",
        "updated_at": "2026-08-11T12:05:00Z",
        "holes": [
            {
                "hole_number": index + 1,
                "tee": None,
                "shots": [],
                "putts": 0,
                "final_stroke": complete,
                "finished": complete,
                "pending_strategy": None,
            }
            for index in range(18)
        ],
    }


def challenge_save(status="IN_PROGRESS"):
    holes = [
        {
            "challenge_slot": index + 1,
            "course_id": f"course-{index + 1}",
            "course_version_id": f"v{index + 1}",
            "source_hole_number": index + 3,
            "par": par,
            "tee_id": "White",
            "status": "COMPLETE" if status == "COMPLETE" else "IN_PROGRESS" if index == 0 else "READY",
            "player_score": par if status == "COMPLETE" else None,
            "gm_score": par + 1 if status == "COMPLETE" else None,
        }
        for index, par in enumerate((3, 4, 5))
    ]
    participant = {"version": "challenge-participant-v1", "holes": [
        {"hole_number": index + 1, "score": holes[index]["player_score"], "events": []}
        for index in range(3)
    ]}
    return {
        "version": "three-hole-challenge-v1", "id": "challenge-test-123", "type": "RANDOM_3",
        "status": status, "current_slot": 2 if status == "COMPLETE" else 0,
        "created_at": "2026-09-16T00:00:00Z", "updated_at": "2026-09-16T00:05:00Z",
        "completed_at": "2026-09-16T00:05:00Z" if status == "COMPLETE" else None,
        "holes": holes, "human_state": participant,
        "strategist_state": {**participant, "holes": [
            {"hole_number": index + 1, "score": holes[index]["gm_score"], "events": []}
            for index in range(3)
        ]},
        "final_result": {"player": 12, "gm": 15, "leader": "PLAYER", "margin": 3} if status == "COMPLETE" else None,
    }


class PlayerStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = PlayerStore(Path(self.temp.name) / "players.sqlite3")

    def tearDown(self):
        self.temp.cleanup()

    def test_create_authenticate_and_session(self):
        player = self.store.create_player("  Kay   Smith ", "4827")
        self.assertEqual(player["name"], "Kay Smith")
        self.assertIsNone(self.store.authenticate("Kay Smith", "wrong"))
        authenticated = self.store.authenticate("kay smith", "4827")
        token = self.store.create_session(authenticated["id"])
        self.assertEqual(self.store.player_for_session(token), player)
        self.store.delete_session(token)
        self.assertIsNone(self.store.player_for_session(token))

    def test_duplicate_names_are_case_insensitive(self):
        self.store.create_player("Golfer One", "1234")
        with self.assertRaisesRegex(AccountError, "already in use"):
            self.store.create_player("golfer one", "9876")

    def test_latest_unfinished_round_is_resumed(self):
        player = self.store.create_player("Golfer Two", "1234")
        self.store.save_round(player["id"], round_save("cranbury", hole=4))
        self.store.save_round(player["id"], round_save("meadows", hole=7))
        self.assertEqual(self.store.active_round(player["id"])["course_id"], "meadows")
        self.assertEqual(self.store.active_round(player["id"])["current_hole_index"], 7)

    def test_completed_round_is_not_resumed(self):
        player = self.store.create_player("Golfer Three", "1234")
        self.store.save_round(player["id"], round_save(complete=True))
        self.assertIsNone(self.store.active_round(player["id"]))

    def test_completed_round_is_archived_once_with_summary(self):
        player = self.store.create_player("History Golfer", "1234")
        saved = round_save(complete=True)
        first = self.store.save_round(player["id"], saved)
        second = self.store.save_round(player["id"], saved)

        self.assertTrue(first["newly_archived"])
        self.assertFalse(second["newly_archived"])
        self.assertEqual(first["archived_round_id"], second["archived_round_id"])
        history = self.store.completed_round_history(player["id"])
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["course_name"], "Cranbury Golf Club")
        self.assertEqual(history[0]["total_strokes"], 72)
        self.assertEqual(history[0]["score_to_par"], 0)
        self.assertEqual(history[0]["strategy_score"], 81)

    def test_completed_round_history_preserves_multiple_rounds(self):
        player = self.store.create_player("Repeat Golfer", "1234")
        first = round_save(complete=True, seed=11)
        second = round_save(course="meadows", complete=True, seed=12)
        self.store.save_round(player["id"], first)
        self.store.save_round(player["id"], second)

        history = self.store.completed_round_history(player["id"])
        self.assertEqual(len(history), 2)
        self.assertEqual({item["course_id"] for item in history}, {"cranbury", "meadows"})
        self.assertNotEqual(history[0]["id"], history[1]["id"])

    def test_round_replay_is_split_by_hole_and_geometry_is_deduplicated(self):
        player = self.store.create_player("Replay Golfer", "1234")
        saved = round_save()
        saved["course_version_id"] = "course-v12"
        saved["geometry_snapshot"] = {
            "hole_number": 2,
            "simulation_surfaces": [{"surface": "green", "polygon": [[2, 2], [3, 2], [3, 3]]}],
        }
        saved["round_state"]["holes"][0]["events"] = [{
            "event_type": "shot_committed",
            "payload": {"resultRequest": {"context": {
                "lie": {"lie_type": "tee_standard"},
                "surfaces": [{"surface": "fairway", "polygon": [[0, 0], [1, 0], [1, 1]]}],
            }}},
        }]

        result = self.store.save_round(player["id"], saved)
        self.assertEqual(result["geometry_saved"], [1, 2])
        restored = self.store.active_round(player["id"])
        self.assertNotIn("geometry_snapshot", restored)
        request = restored["round_state"]["holes"][0]["events"][0]["payload"]["resultRequest"]
        self.assertNotIn("surfaces", request["context"])
        self.assertEqual(request["geometry_ref"]["course_version_id"], "course-v12")

        index = self.store.round_replay_index(player["id"], result["round_id"])
        self.assertEqual(len(index["holes"]), 18)
        self.assertEqual(index["holes"][0]["shot_count"], 1)
        package = self.store.round_replay_hole(player["id"], result["round_id"], 1)
        self.assertEqual(package["hole"]["hole_number"], 1)
        geometry = self.store.course_hole_geometry("cranbury", "course-v12", 1)
        self.assertEqual(len(geometry["simulation_surfaces"]), 1)
        self.assertEqual(
            self.store.course_hole_geometry("cranbury", "course-v12", 2)["simulation_surfaces"][0]["surface"],
            "green",
        )

        self.store.save_round(player["id"], saved)
        with self.store._connect() as database:
            copies = database.execute(
                "SELECT COUNT(*) AS count FROM course_hole_geometries WHERE course_id = ? AND course_version_id = ?",
                ("cranbury", "course-v12"),
            ).fetchone()["count"]
        self.assertEqual(copies, 2)

    def test_round_replay_is_player_scoped(self):
        owner = self.store.create_player("Replay Owner", "1234")
        stranger = self.store.create_player("Replay Stranger", "1234")
        result = self.store.save_round(owner["id"], round_save())
        self.assertIsNone(self.store.round_replay_index(stranger["id"], result["round_id"]))
        self.assertIsNone(self.store.round_replay_hole(stranger["id"], result["round_id"], 1))

    def test_challenge_history_preserves_cross_course_slots_and_deduplicates_geometry(self):
        player = self.store.create_player("Challenge Golfer", "1234")
        challenge = challenge_save("COMPLETE")
        snapshot = {
            "challenge_slot": 1, "course_id": "course-1", "course_version_id": "v1",
            "source_hole_number": 3,
            "simulation_surfaces": [{"surface": "green", "polygon": [[0, 0], [1, 0], [1, 1]]}],
        }
        result = self.store.save_challenge(player["id"], challenge, snapshot)
        self.assertTrue(result["complete"])
        restored = self.store.challenge(player["id"], challenge["id"])
        self.assertEqual([hole["course_id"] for hole in restored["holes"]], ["course-1", "course-2", "course-3"])
        history = self.store.challenge_history(player["id"])
        self.assertEqual(history[0]["player_score"], 12)
        self.assertEqual(len(history[0]["holes"]), 3)
        geometry = self.store.course_hole_geometry("course-1", "v1", 3)
        self.assertEqual(geometry["simulation_surfaces"][0]["surface"], "green")
        self.store.save_challenge(player["id"], challenge, snapshot)
        with self.store._connect() as database:
            copies = database.execute(
                "SELECT COUNT(*) AS count FROM course_hole_geometries WHERE course_id = 'course-1' AND course_version_id = 'v1' AND hole_number = 3"
            ).fetchone()["count"]
        self.assertEqual(copies, 1)

    def test_challenge_records_are_player_scoped(self):
        owner = self.store.create_player("Challenge Owner", "1234")
        stranger = self.store.create_player("Challenge Stranger", "1234")
        challenge = challenge_save("COMPLETE")
        self.store.save_challenge(owner["id"], challenge)
        self.assertIsNone(self.store.challenge(stranger["id"], challenge["id"]))
        with self.assertRaises(AccountError):
            self.store.save_challenge(stranger["id"], challenge)

    def test_gps_round_sync_is_scoped_to_player_and_course(self):
        player = self.store.create_player("GPS Golfer", "1234")
        another = self.store.create_player("Other GPS Golfer", "1234")
        saved = self.store.save_gps_round(player["id"], gps_round())

        self.assertTrue(saved["saved"])
        self.assertFalse(saved["complete"])
        self.assertEqual(self.store.active_gps_round(player["id"], "warrenbrook")["round_id"], "gps-round-1234")
        self.assertIsNone(self.store.active_gps_round(player["id"], "another-course"))
        self.assertIsNone(self.store.gps_round(another["id"], "gps-round-1234"))

    def test_gps_round_sync_rejects_a_stale_revision(self):
        player = self.store.create_player("Revision Golfer", "1234")
        self.store.save_gps_round(player["id"], gps_round(revision=3))
        conflict = self.store.save_gps_round(player["id"], gps_round(revision=2))

        self.assertFalse(conflict["saved"])
        self.assertTrue(conflict["conflict"])
        self.assertEqual(conflict["server_revision"], 3)
        self.assertEqual(conflict["round"]["revision"], 3)

    def test_completed_gps_round_remains_available_in_gps_history(self):
        player = self.store.create_player("GPS History Golfer", "1234")
        result = self.store.save_gps_round(player["id"], gps_round(complete=True))
        history = self.store.gps_round_history(player["id"])

        self.assertTrue(result["complete"])
        self.assertIsNone(self.store.active_gps_round(player["id"], "warrenbrook"))
        self.assertEqual(history[0]["round_id"], "gps-round-1234")
        self.assertEqual(history[0]["is_complete"], 1)
        self.assertEqual(history[0]["total_strokes"], 18)
        self.assertEqual(history[0]["holes_recorded"], 18)
        self.assertEqual(history[0]["holes_completed"], 18)

    def test_in_progress_gps_round_history_reports_recorded_holes(self):
        player = self.store.create_player("GPS Progress Golfer", "1234")
        saved_round = gps_round()
        saved_round["holes"][0]["tee"] = {"lat": 40.3, "lng": -74.6}
        saved_round["holes"][0]["finished"] = True
        saved_round["holes"][1]["tee"] = {"lat": 40.31, "lng": -74.61}
        self.store.save_gps_round(player["id"], saved_round)

        history = self.store.gps_round_history(player["id"])

        self.assertEqual(history[0]["is_complete"], 0)
        self.assertEqual(history[0]["holes_recorded"], 2)
        self.assertEqual(history[0]["holes_completed"], 1)

    def test_on_course_club_stats_accumulate_saved_gps_rounds(self):
        player = self.store.create_player("Club Evidence Golfer", "1234")
        profile = {
            "id": "custom-evidence",
            "name": "Club Evidence Golfer profile",
            "clubs": [
                {"name": "Driver", "carry": 200, "accuracy": 56},
                {"name": "Putter", "carry": 20, "accuracy": 100},
            ],
        }
        self.store.save_profile(player["id"], profile)

        for index, distance in enumerate((220, 225, 100), start=1):
            saved_round = gps_round(round_id=f"gps-evidence-{index}")
            start = {"lat": 40.0, "lng": -74.0, "accuracy_meters": 4, "lie": "Tee"}
            end = {"lat": 40.001, "lng": -74.0, "accuracy_meters": 5, "lie": "Fairway"}
            saved_round["holes"][0]["tee"] = start
            saved_round["holes"][0]["shots"] = [{
                "start": start,
                "end": end,
                "distance_yards": distance,
                "strategy": {"club_name": "Driver", "power": 100},
            }]
            self.store.save_gps_round(player["id"], saved_round)

        driver = self.store.on_course_club_stats(player["id"])["clubs"][0]
        self.assertEqual(driver["attempts"], 3)
        self.assertEqual(driver["successful_shots"], 2)
        self.assertEqual(driver["on_course_accuracy_percent"], 67)
        self.assertEqual(driver["estimated_carry_yards"], 200)
        self.assertEqual(driver["rounds"], 3)

    def test_invalid_gps_round_is_rejected(self):
        player = self.store.create_player("Invalid GPS Golfer", "1234")
        invalid = gps_round()
        invalid["holes"] = invalid["holes"][:9]
        with self.assertRaisesRegex(AccountError, "18 holes"):
            self.store.save_gps_round(player["id"], invalid)

    def test_leaderboard_uses_each_players_best_management_round_and_stroke_tiebreak(self):
        alice = self.store.create_player("Alice Player", "1234")
        bob = self.store.create_player("Bob Player", "1234")
        carol = self.store.create_player("Carol Player", "1234")

        alice_old = round_save(complete=True, seed=31)
        alice_old["round_summary"]["strategy_score"] = 72
        self.store.save_round(alice["id"], alice_old)
        alice_best = round_save(complete=True, seed=32)
        alice_best["round_summary"]["strategy_score"] = 91
        alice_best["round_state"]["holes"][0]["score"] = 5
        self.store.save_round(alice["id"], alice_best)

        bob_best = round_save(complete=True, seed=33)
        bob_best["round_summary"]["strategy_score"] = 91
        self.store.save_round(bob["id"], bob_best)

        carol_round = round_save(complete=True, seed=34)
        carol_round["round_summary"]["strategy_score"] = 84
        self.store.save_round(carol["id"], carol_round)

        board = self.store.leaderboard()

        self.assertEqual([row["player_name"] for row in board], [
            "Bob Player", "Alice Player", "Carol Player",
        ])
        self.assertEqual([row["strategy_score"] for row in board], [91, 91, 84])
        self.assertEqual([row["total_strokes"] for row in board], [72, 73, 72])
        self.assertEqual(sum(row["player_name"] == "Alice Player" for row in board), 1)

    def test_unfinished_round_is_not_added_to_history(self):
        player = self.store.create_player("Still Playing", "1234")
        result = self.store.save_round(player["id"], round_save())
        self.assertFalse(result["complete"])
        self.assertIsNone(result["archived_round_id"])
        self.assertEqual(self.store.completed_round_history(player["id"]), [])

    def test_completed_round_observations_are_queryable_and_idempotent(self):
        player = self.store.create_player("Learning Golfer", "1234")
        saved = round_save(complete=True)
        saved["round_state"]["holes"][0]["events"] = [shot_event()]

        self.store.save_round(player["id"], saved)
        self.store.save_round(player["id"], saved)

        learning = self.store.player_learning(player["id"])
        self.assertEqual(learning["completed_rounds"], 1)
        self.assertEqual(learning["observation_count"], 1)
        self.assertEqual(learning["rounds_with_observations"], 1)
        self.assertEqual(learning["coverage"]["adjustments_recorded"], 1)
        self.assertEqual(learning["verified_patterns"], [])
        self.assertEqual(learning["recent_progress"]["status"], "building")
        self.assertEqual(learning["recent_progress"]["scored_rounds"], 1)
        self.assertEqual(learning["recent_progress"]["rounds_needed"], 5)
        self.assertEqual(learning["recent_progress"]["rounds"][0]["strategy_score"], 81)

    def test_invalid_round_is_rejected(self):
        player = self.store.create_player("Golfer Four", "1234")
        with self.assertRaises(AccountError):
            self.store.save_round(player["id"], {"version": "wrong"})

    def test_feedback_rating_thread_and_developer_status_are_player_scoped(self):
        player = self.store.create_player("Feedback Golfer", "1234")
        another = self.store.create_player("Another Golfer", "1234")
        rating = self.store.save_game_rating(player["id"], 4, "More GPS replay would make it five stars.")
        created = self.store.create_feedback(
            player["id"],
            "feature",
            "Add GPS replay",
            "Let me replay today's on-course round stroke by stroke.",
            {"course_id": "warrenbrook", "hole": 4, "mode": "live"},
            {
                "name": "map.png",
                "mime_type": "image/png",
                "data": base64.b64encode(b"small-image").decode("ascii"),
            },
        )

        self.assertEqual(rating["rating"]["stars"], 4)
        self.assertEqual(self.store.player_feedback(another["id"])["items"], [])
        self.assertEqual(created["category"], "feature")
        self.assertEqual(created["context"]["course_id"], "warrenbrook")
        self.assertEqual(len(created["attachments"]), 1)

        self.store.update_feedback_as_developer(
            created["id"], "Course Team", "planned", "This is now on the replay roadmap."
        )
        player_view = self.store.player_feedback(player["id"])
        self.assertEqual(player_view["unread_count"], 1)
        self.assertEqual(player_view["items"][0]["status"], "planned")
        self.assertEqual(player_view["items"][0]["messages"][0]["sender_role"], "developer")

        self.store.reply_to_feedback(
            player["id"], created["id"], "Thank you. That is what I need.", player["name"]
        )
        self.assertEqual(self.store.player_feedback(player["id"])["unread_count"], 0)
        developer_view = self.store.developer_feedback()
        self.assertEqual(developer_view["rating_summary"]["count"], 1)
        self.assertEqual(developer_view["items"][0]["player_name"], "Feedback Golfer")
        attachment = self.store.feedback_attachment(created["attachments"][0]["id"], player["id"])
        self.assertEqual(attachment["file_data"], b"small-image")
        self.assertIsNone(self.store.feedback_attachment(created["attachments"][0]["id"], another["id"]))

    def test_feedback_validation_rejects_invalid_category_and_oversized_rating(self):
        player = self.store.create_player("Feedback Validation", "1234")
        with self.assertRaisesRegex(AccountError, "category"):
            self.store.create_feedback(player["id"], "praise", "Nice game", "I like this game.")
        with self.assertRaisesRegex(AccountError, "between 1 and 5"):
            self.store.save_game_rating(player["id"], 6)

    def test_supabase_identity_reuses_the_same_local_player(self):
        first = self.store.upsert_supabase_player("user-123", "first@example.com", "First Golfer")
        second = self.store.upsert_supabase_player("user-123", "new@example.com", "Updated Golfer")
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(second["name"], "Updated Golfer")
        self.assertEqual(second["email"], "new@example.com")

    def test_player_profile_is_saved_independently_of_a_round(self):
        player = self.store.create_player("Profile Golfer", "1234")
        profile = {
            "id": "custom-profile",
            "name": "My actual game",
            "puttingMakeRates": {"3": 88, "6": 51, "10": 24},
            "clubs": [
                {"name": "Driver", "carry": 207, "accuracy": 54},
                {"name": "Putter", "carry": 20, "accuracy": 100},
            ],
        }
        result = self.store.save_profile(player["id"], profile)
        self.assertTrue(result["saved"])
        self.assertEqual(self.store.player_profile(player["id"]), profile)

    def test_invalid_player_profile_is_rejected(self):
        player = self.store.create_player("Invalid Profile", "1234")
        with self.assertRaisesRegex(AccountError, "accuracy"):
            self.store.save_profile(player["id"], {
                "id": "bad",
                "name": "Bad profile",
                "clubs": [
                    {"name": "Driver", "carry": 220, "accuracy": 120},
                    {"name": "Putter", "carry": 20, "accuracy": 100},
                ],
            })


if __name__ == "__main__":
    unittest.main()
