import unittest

from packages.simulation import SIDEHILL_MODEL_VERSION, analyze_sidehill_shot


class SidehillPlanTests(unittest.TestCase):
    def test_ball_below_feet_curves_right_and_rewards_left_aim(self) -> None:
        plan = analyze_sidehill_shot(
            stance="ball_below_feet",
            lateral_distance_yards=14,
            shot_distance_yards=160,
            player_aim_yards=-4,
        )

        self.assertEqual(SIDEHILL_MODEL_VERSION, "sidehill-v1")
        self.assertEqual(plan.expected_curve_yards, 4)
        self.assertEqual(plan.recommended_aim_yards, -4)
        self.assertEqual(plan.compensation, "correct")

    def test_ball_above_feet_curves_left_and_wrong_aim_is_detected(self) -> None:
        plan = analyze_sidehill_shot(
            stance="ball_above_feet",
            lateral_distance_yards=24,
            shot_distance_yards=180,
            player_aim_yards=-5,
        )

        self.assertEqual(plan.severity, "severe")
        self.assertEqual(plan.expected_curve_yards, -6.08)
        self.assertEqual(plan.recommended_aim_yards, 6.08)
        self.assertEqual(plan.compensation, "wrong_direction")

    def test_longer_shot_receives_more_sidehill_curve(self) -> None:
        short = analyze_sidehill_shot(
            stance="ball_below_feet",
            lateral_distance_yards=14,
            shot_distance_yards=80,
        )
        long = analyze_sidehill_shot(
            stance="ball_below_feet",
            lateral_distance_yards=14,
            shot_distance_yards=180,
        )

        self.assertGreater(long.expected_curve_yards, short.expected_curve_yards)


if __name__ == "__main__":
    unittest.main()
