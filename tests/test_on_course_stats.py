import unittest

from packages.gps.on_course_stats import build_on_course_club_stats


def fix(*, lie="Tee", accuracy=4.0):
    return {"lat": 40.0, "lng": -74.0, "accuracy_meters": accuracy, "lie": lie}


def shot(total_yards, *, club="Driver", power=100, lie="Tee", accuracy=4.0):
    return {
        "distance_yards": total_yards,
        "strategy": {"club_name": club, "power": power},
        "start": fix(lie=lie, accuracy=accuracy),
        "end": fix(lie="Fairway", accuracy=accuracy),
    }


def gps_round(round_id, shots):
    return {
        "round_id": round_id,
        "holes": [{"shots": shots}],
    }


PROFILE = {
    "clubs": [
        {"name": "Driver", "carry": 200, "accuracy": 56},
        {"name": "7 Iron", "carry": 140, "accuracy": 65},
        {"name": "Putter", "carry": 20, "accuracy": 100},
    ]
}


class OnCourseClubStatsTests(unittest.TestCase):
    def test_carry_uses_successes_but_accuracy_counts_every_eligible_attempt(self):
        result = build_on_course_club_stats([
            gps_round("round-1", [shot(220), shot(228), shot(130)]),
            gps_round("round-2", [shot(224), shot(90)]),
        ], PROFILE)
        driver = result["clubs"][0]

        self.assertEqual(driver["attempts"], 5)
        self.assertEqual(driver["successful_shots"], 3)
        self.assertEqual(driver["missed_shots"], 2)
        self.assertEqual(driver["on_course_accuracy_percent"], 60)
        self.assertEqual(driver["estimated_carry_yards"], 202)
        self.assertEqual(driver["rounds"], 2)
        self.assertTrue(driver["can_apply"])

    def test_partial_recovery_and_poor_gps_shots_are_not_eligible(self):
        result = build_on_course_club_stats([
            gps_round("round-1", [
                shot(220, power=75),
                shot(220, lie="Trees/Recovery"),
                shot(220, accuracy=25),
                shot(220),
            ])
        ], PROFILE)
        driver = result["clubs"][0]

        self.assertEqual(driver["attempts"], 1)
        self.assertEqual(driver["successful_shots"], 1)
        self.assertFalse(driver["can_apply"])

    def test_evidence_accumulates_by_club_across_rounds(self):
        result = build_on_course_club_stats([
            gps_round("round-1", [shot(155, club="7 Iron", lie="Fairway")]),
            gps_round("round-2", [shot(158, club="7 Iron", lie="Rough")]),
        ], PROFILE)
        seven_iron = result["clubs"][1]

        self.assertEqual(seven_iron["attempts"], 2)
        self.assertEqual(seven_iron["successful_shots"], 2)
        self.assertEqual(seven_iron["rounds"], 2)
        self.assertEqual(seven_iron["estimated_carry_yards"], 141)
        self.assertEqual(result["rounds_with_eligible_shots"], 2)


if __name__ == "__main__":
    unittest.main()
