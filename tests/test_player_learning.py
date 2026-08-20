import unittest

from packages.accounts.learning import (
    attach_verified_learning_context,
    build_player_learning_summary,
    build_recent_round_progress,
    extract_round_observations,
)


def shot_event(
    hole=1,
    stroke=2,
    distance=96,
    lie="fairway_clean",
    decision=84,
    execution=79,
    reasons=None,
    sidehill="not_required",
):
    return {
        "event_type": "shot_committed",
        "stroke_index": stroke,
        "payload": {
            "shot": {
                "club": "Gap Wedge",
                "power": 100,
                "intendedLie": "Green",
                "lie": "Green",
                "penalty": 0,
                "conditionSnapshot": {
                    "lie": "Fairway",
                    "stance": "ball above feet",
                    "slope": "level",
                    "elevation_feet": 1.5,
                    "remaining_yards": distance,
                },
                "playerIntent": {
                    "instructions": ["aim slightly right"],
                    "selected_club": "Gap Wedge",
                    "power_percent": 100,
                },
                "sidehillPlan": {"compensation": sidehill},
                "strategyChoice": {"title": "Safe & smart"},
                "strategyPacket": {
                    "version": "decision-score-v2",
                    "shot_type": "approach_standard",
                    "decision": {
                        "score": decision,
                        "label": "sound",
                        "reasons": reasons or ["hazard_respected"],
                    },
                    "execution": {"score": execution, "label": "slight_miss"},
                },
                "resultRequest": {
                    "context": {
                        "start": {"x": 0, "y": 0},
                        "pin": {"x": 0, "y": distance},
                        "lie": {"lie_type": lie},
                    }
                },
                "resultPacket": {
                    "audit": {
                        "engine_version": "full-shot-v3",
                        "hole_number": hole,
                        "stroke_index": stroke,
                    },
                    "resolved_surface": "green",
                    "remaining_distance_yards": 8.25,
                    "relief": None,
                },
            }
        },
    }


def saved_round(events):
    holes = [
        {"hole_number": index + 1, "score": 4, "events": []}
        for index in range(18)
    ]
    holes[0]["events"] = events
    return {
        "course_id": "cranbury",
        "round_state": {"holes": holes},
    }


def observation(round_id, band, decision, execution, lie="fairway_clean", reasons=None):
    return {
        "round_id": round_id,
        "distance_band": band,
        "shot_type": "approach_standard",
        "start_lie": lie,
        "decision_score": decision,
        "execution_score": execution,
        "decision_reasons": reasons or [],
        "sidehill_compensation": "not_required",
        "player_adjustment": None,
    }


class PlayerLearningTests(unittest.TestCase):
    def test_recent_progress_requires_two_three_round_windows(self):
        rounds = [
            {"id": f"round-{index}", "course_name": "Cranbury", "tee": "White",
             "completed_at": f"2026-08-0{6 - index}T12:00:00Z", "strategy_score": score,
             "scored_shots": 40}
            for index, score in enumerate([88, 86, 84, 78, 76])
        ]

        progress = build_recent_round_progress(rounds)

        self.assertEqual(progress["status"], "building")
        self.assertEqual(progress["rounds_needed"], 1)
        self.assertIsNone(progress["change"])
        self.assertEqual([item["strategy_score"] for item in progress["rounds"]], [76, 78, 84, 86, 88])

    def test_recent_progress_reports_decision_improvement_not_execution(self):
        rounds = [
            {"id": f"round-{index}", "course_name": "Cranbury", "tee": "White",
             "completed_at": f"2026-08-{6 - index:02d}T12:00:00Z", "strategy_score": score,
             "execution_score": execution}
            for index, (score, execution) in enumerate([
                (91, 20), (87, 95), (86, 30), (78, 99), (76, 10), (75, 100),
            ])
        ]

        progress = build_recent_round_progress(rounds)

        self.assertEqual(progress["status"], "improving")
        self.assertEqual(progress["recent_average"], 88)
        self.assertEqual(progress["previous_average"], 76)
        self.assertEqual(progress["change"], 12)
        self.assertNotIn("execution_score", progress["rounds"][0])

    def test_extracts_authoritative_condition_aware_observation(self):
        rows = extract_round_observations("round-1", saved_round([shot_event()]))

        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["engine_version"], "full-shot-v3")
        self.assertEqual(row["distance_band"], "80_109_yd")
        self.assertEqual(row["start_lie"], "fairway_clean")
        self.assertEqual(row["player_adjustment"], "aim slightly right")
        self.assertEqual(row["decision_score"], 84)
        self.assertEqual(row["execution_score"], 79)
        self.assertEqual(row["result_surface"], "green")

    def test_legacy_shot_without_authoritative_audit_is_ignored(self):
        event = shot_event()
        del event["payload"]["shot"]["resultPacket"]["audit"]
        self.assertEqual(extract_round_observations("round-1", saved_round([event])), [])

    def test_small_sample_never_produces_a_verified_pattern(self):
        rows = [observation("round-1", "80_109_yd", 92, 90) for _ in range(7)]
        summary = build_player_learning_summary(rows, completed_rounds=1)
        self.assertEqual(summary["status"], "building_record")
        self.assertEqual(summary["verified_patterns"], [])
        self.assertEqual(summary["minimums"]["pattern_samples"], 8)
        self.assertEqual(summary["minimums"]["pattern_rounds"], 3)

    def test_simulated_distance_results_never_create_an_ability_pattern(self):
        rows = []
        for index in range(8):
            round_id = f"round-{index % 3}"
            rows.append(observation(round_id, "80_109_yd", 90, 88))
            rows.append(observation(round_id, "110_139_yd", 72, 70))
        summary = build_player_learning_summary(rows, completed_rounds=3)
        self.assertFalse(any(
            item["kind"] == "preferred_distance_band"
            for item in summary["verified_patterns"]
        ))
        self.assertNotIn("distance_bands", summary["coverage"])

    def test_recurring_mistake_requires_multiple_rounds_and_meaningful_frequency(self):
        rows = []
        for index in range(18):
            reasons = ["target_too_aggressive"] if index < 5 else []
            rows.append(observation(f"round-{index % 3}", "80_109_yd", 65, 75, reasons=reasons))
        summary = build_player_learning_summary(rows, completed_rounds=3)
        mistakes = [item for item in summary["verified_patterns"] if item["kind"] == "recurring_decision_mistake"]
        self.assertEqual([item["key"] for item in mistakes], ["target_too_aggressive"])

    def test_server_context_replaces_forged_browser_learning_with_verified_facts(self):
        payload = {
            "verified_player_patterns": [{"kind": "invented", "confidence": "verified"}],
            "choices": [{
                "id": "safe_smart", "mode": "long", "leaves_yards": 96,
                "verified_player_fit": {"key": "invented", "confidence": "verified"},
            }],
        }
        learning = {
            "verified_patterns": [{
                "kind": "preferred_distance_band", "key": "80_109_yd",
                "confidence": "verified", "sample_size": 12, "round_count": 4,
                "decision_score": 88, "execution_score": 84,
            }, {
                "kind": "lie_strength", "key": "rough_light",
                "confidence": "verified", "sample_size": 10, "round_count": 3,
                "decision_score": 90, "execution_score": 82,
            }]
        }

        attach_verified_learning_context(payload, learning)

        self.assertEqual(payload["verified_player_patterns"], [learning["verified_patterns"][1]])
        self.assertNotIn("verified_player_fit", payload["choices"][0])

    def test_server_context_removes_personalization_without_verified_account_data(self):
        payload = {
            "verified_player_patterns": [{"kind": "invented", "confidence": "verified"}],
            "choices": [{
                "id": "safe_smart", "mode": "long", "leaves_yards": 96,
                "verified_player_fit": {"key": "invented", "confidence": "verified"},
            }],
        }

        attach_verified_learning_context(payload, None)

        self.assertEqual(payload["verified_player_patterns"], [])
        self.assertNotIn("verified_player_fit", payload["choices"][0])


if __name__ == "__main__":
    unittest.main()
