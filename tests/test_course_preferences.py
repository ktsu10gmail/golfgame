import sqlite3
import tempfile
import unittest
from pathlib import Path

from packages.accounts import CoursePreferenceError, CoursePreferenceService, PlayerStore


CSV_HEADER = "Course Name,Country,State,City,Type\n"


class CoursePreferenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.database = root / "players.sqlite3"
        self.directory = root / "courses.csv"
        self.directory.write_text(
            CSV_HEADER
            + "Mercer Oaks West,US,NJ,West Windsor,Public/Municipal\n"
            + "Makefield Highlands Golf Club,US,PA,Yardley,Public\n"
            + "Meadows Golf Club,US,CO,Littleton,Public\n"
            + "Meadows Golf Club,US,CO,Littleton,Private\n",
            encoding="utf-8",
        )
        self.players = PlayerStore(self.database)
        self.player = self.players.create_player("Course Player", "1234")
        self.other = self.players.create_player("Other Player", "5678")
        self.service = CoursePreferenceService(self.database, self.directory)

    def tearDown(self):
        self.temp.cleanup()

    def test_import_deduplicates_identity_and_searches_name_city_and_state(self):
        name = self.service.search("mercer")["items"]
        city = self.service.search("yardley")["items"]
        state = self.service.search("meadows", state="CO")["items"]
        self.assertEqual(name[0]["name"], "Mercer Oaks West")
        self.assertEqual(city[0]["name"], "Makefield Highlands Golf Club")
        self.assertEqual(len(state), 1)
        self.assertEqual(state[0]["type"], "Mixed listing")

    def test_directory_search_uses_trigram_index_and_two_character_fallback(self):
        middle_of_name = self.service.search("field high")["items"]
        two_characters = self.service.search("pa", state="PA")["items"]
        self.assertEqual(middle_of_name[0]["name"], "Makefield Highlands Golf Club")
        self.assertEqual(two_characters[0]["name"], "Makefield Highlands Golf Club")

        with sqlite3.connect(self.database) as database:
            fts_table = database.execute("""
                SELECT 1 FROM sqlite_master
                WHERE type = 'table' AND name = 'course_directory_fts'
            """).fetchone()
            plan = database.execute("""
                EXPLAIN QUERY PLAN
                SELECT d.id
                FROM course_directory_fts
                JOIN course_directory_entries d
                    ON d.rowid = course_directory_fts.rowid
                WHERE course_directory_fts MATCH 'mercer' AND d.active = 1
            """).fetchall()
        self.assertIsNotNone(fts_table)
        self.assertTrue(any("VIRTUAL TABLE INDEX" in row[3] for row in plan))

    def test_preferences_are_player_owned_idempotent_and_removable(self):
        course = self.service.search("makefield")["items"][0]
        first = self.service.add_preference(self.player["id"], course["id"])
        second = self.service.add_preference(self.player["id"], course["id"])
        self.assertEqual(len(first), 1)
        self.assertEqual(len(second), 1)
        self.assertEqual(self.service.preferred_courses(self.other["id"]), [])
        self.assertEqual(
            self.service.remove_preference(self.player["id"], course["id"]), []
        )

    def test_course_requests_keep_player_and_coach_context_and_aggregate(self):
        course = self.service.search("makefield")["items"][0]
        self.service.add_preference(self.player["id"], course["id"], "COACH")
        self.service.add_preference(self.other["id"], course["id"], "PLAYER")

        queue = self.service.production_queue()
        self.assertEqual(len(queue), 1)
        self.assertEqual(queue[0]["coach_request_count"], 1)
        self.assertEqual(queue[0]["player_request_count"], 1)
        self.assertEqual(queue[0]["total_request_count"], 2)

    def test_removal_withdraws_only_the_context_that_created_the_request(self):
        course = self.service.search("makefield")["items"][0]
        self.service.add_preference(self.player["id"], course["id"], "PLAYER")
        self.service.add_preference(self.player["id"], course["id"], "COACH")
        self.service.remove_preference(self.player["id"], course["id"], "PLAYER")
        queue = self.service.production_queue()
        self.assertEqual(queue[0]["player_request_count"], 0)
        self.assertEqual(queue[0]["coach_request_count"], 1)

    def test_production_claim_release_and_verified_completion(self):
        course = self.service.search("makefield")["items"][0]
        self.service.add_preference(self.player["id"], course["id"], "PLAYER")
        item = self.service.production_queue()[0]

        claimed = self.service.claim_production_item(
            item["production_item_id"], self.player["id"]
        )
        self.assertEqual(claimed["status"], "IN_PROGRESS")
        self.assertEqual(
            self.service.validate_install_context(
                item["production_item_id"], course["id"], self.player["id"]
            )["directory_course_id"],
            course["id"],
        )
        with self.assertRaises(CoursePreferenceError):
            self.service.validate_install_context(
                item["production_item_id"], course["id"], self.other["id"]
            )
        with self.assertRaises(CoursePreferenceError):
            self.service.claim_production_item(
                item["production_item_id"], self.other["id"]
            )
        released = self.service.release_production_item(
            item["production_item_id"], self.player["id"]
        )
        self.assertEqual(released["status"], "REQUESTED")
        self.service.claim_production_item(item["production_item_id"], self.player["id"])
        completed = self.service.complete_production_item(
            item["production_item_id"], course["id"],
            [
                {"course_id": "makefield-a-b", "installed_version": "v1"},
                {"course_id": "makefield-b-a", "installed_version": "v1"},
            ],
            self.player["id"],
        )
        self.assertEqual(completed["status"], "READY")
        self.assertEqual(completed["total_request_count"], 1)
        self.assertEqual(
            completed["installed_course_ids"],
            ["makefield-a-b", "makefield-b-a"],
        )
        saved = self.service.preferred_courses(self.player["id"])
        self.assertTrue(saved[0]["available_for_play"])

    def test_withdrawing_last_requested_course_hides_it_but_preserves_history(self):
        course = self.service.search("mercer")["items"][0]
        self.service.add_preference(self.player["id"], course["id"], "PLAYER")
        first_requested = self.service.production_queue()[0]["first_requested_at"]
        self.service.remove_preference(self.player["id"], course["id"])
        self.assertEqual(self.service.production_queue(), [])
        self.service.add_preference(self.player["id"], course["id"], "PLAYER")
        self.assertEqual(
            self.service.production_queue()[0]["first_requested_at"], first_requested
        )

    def test_ready_course_stays_ready_when_another_player_requests_it(self):
        course = self.service.search("makefield")["items"][0]
        self.service.add_preference(self.player["id"], course["id"], "PLAYER")
        item = self.service.production_queue()[0]
        self.service.claim_production_item(item["production_item_id"], self.player["id"])
        self.service.complete_production_item(
            item["production_item_id"], course["id"],
            [{"course_id": "makefield", "installed_version": "v1"}],
            self.player["id"],
        )
        self.service.add_preference(self.other["id"], course["id"], "PLAYER")
        queue = self.service.production_queue()
        self.assertEqual(len(queue), 1)
        self.assertEqual(queue[0]["production_item_id"], item["production_item_id"])
        self.assertEqual(queue[0]["status"], "READY")
        self.assertEqual(queue[0]["player_request_count"], 2)

    def test_directory_update_preserves_preference_but_marks_missing_course_inactive(self):
        course = self.service.search("mercer")["items"][0]
        self.service.add_preference(self.player["id"], course["id"])
        self.directory.write_text(
            CSV_HEADER
            + "Makefield Highlands Golf Club,US,PA,Yardley,Public\n"
            + "New Searchable Links,US,NJ,Princeton,Public\n",
            encoding="utf-8",
        )
        self.service.import_directory()
        saved = self.service.preferred_courses(self.player["id"])
        self.assertEqual(saved[0]["id"], course["id"])
        self.assertFalse(saved[0]["directory_active"])
        self.assertEqual(self.service.search("mercer")["items"], [])
        self.assertEqual(
            self.service.search("searchable links")["items"][0]["city"], "Princeton"
        )

    def test_directory_identity_does_not_change_when_display_name_is_corrected(self):
        course = self.service.search("mercer")["items"][0]
        with sqlite3.connect(self.database) as database:
            database.execute(
                "UPDATE course_directory_entries SET course_name = ? WHERE id = ?",
                ("Mercer Oaks West Course", course["id"]),
            )
            stored = database.execute(
                "SELECT id FROM course_directory_entries WHERE course_name = ?",
                ("Mercer Oaks West Course",),
            ).fetchone()
        self.assertEqual(stored[0], course["id"])

    def test_rejects_unselected_ids_and_short_searches(self):
        with self.assertRaises(CoursePreferenceError):
            self.service.add_preference(self.player["id"], "not-a-directory-id")
        with self.assertRaises(CoursePreferenceError):
            self.service.search("m")


if __name__ == "__main__":
    unittest.main()
