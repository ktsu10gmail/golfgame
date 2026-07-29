import unittest

from packages.golf_domain import DecisionSubscores, StrategicShotType, StrategyAnalysisShot
from packages.simulation import ROUND_STRATEGY_VERSION, analyze_round_strategy


def _shot(
    shot_id: str,
    hole: int,
    stroke: int,
    shot_type: StrategicShotType,
    score: int,
    subscores: tuple[int, int, int, int, int, int] | None,
    reasons: tuple[str, ...] = (),
    execution: int | None = None,
) -> StrategyAnalysisShot:
    return StrategyAnalysisShot(
        shot_id=shot_id,
        hole_number=hole,
        stroke_number=stroke,
        shot_type=shot_type,
        decision_score=score,
        decision_subscores=DecisionSubscores(*subscores) if subscores else None,
        putting_read_discipline=score if shot_type in {
            StrategicShotType.PUTT_LAG,
            StrategicShotType.PUTT_MAKE_ATTEMPT,
        } else None,
        reasons=reasons,
        advice_keys=(),
        execution_score=execution,
    )


def _fixture() -> tuple[StrategyAnalysisShot, ...]:
    return (
        _shot(
            "h1:s1", 1, 1, StrategicShotType.TEE_POSITIONING, 90,
            (95, 90, 85, 90, 80, 85), execution=80,
        ),
        _shot(
            "h1:s2", 1, 2, StrategicShotType.APPROACH_FORCED_CARRY, 60,
            (60, 55, 65, 50, 60, 55),
            ("carry_margin_thin", "hazard_underweighted"), 50,
        ),
        _shot(
            "h1:s3", 1, 3, StrategicShotType.PUTT_MAKE_ATTEMPT, 80,
            None, ("putting_line_respected", "putting_pace_respected"), 95,
        ),
        _shot(
            "h2:s1", 2, 1, StrategicShotType.APPROACH_FORCED_CARRY, 65,
            (65, 60, 70, 55, 65, 60), ("hazard_underweighted",), 60,
        ),
    )


class RoundAnalysisTests(unittest.TestCase):
    def test_weighted_round_and_hole_scores_include_putting(self) -> None:
        analysis = analyze_round_strategy(_fixture())

        self.assertIsNotNone(analysis)
        assert analysis is not None
        self.assertEqual(analysis.version, ROUND_STRATEGY_VERSION)
        self.assertEqual(analysis.strategy_score, 71)
        self.assertEqual(analysis.execution_score, 66)
        self.assertEqual(analysis.scored_shots, 4)
        self.assertEqual(analysis.subscores.putting_read_discipline, 80)
        self.assertEqual([hole.strategy_score for hole in analysis.holes], [74, 65])

    def test_analysis_finds_priority_and_repeated_high_cost_pattern(self) -> None:
        analysis = analyze_round_strategy(_fixture())

        assert analysis is not None
        self.assertEqual(analysis.top_strength, "putting_read_discipline")
        self.assertEqual(analysis.top_priority, "hazard_management")
        self.assertEqual([pattern.key for pattern in analysis.patterns], ["hazard_underweighting"])
        self.assertEqual(analysis.patterns[0].high_cost_count, 2)
        self.assertEqual(analysis.top_costly_decisions[0].shot_id, "h1:s2")
        self.assertEqual(analysis.holes[0].key_decision_moment.shot_id, "h1:s2")

    def test_no_scored_packets_is_a_supported_legacy_round(self) -> None:
        self.assertIsNone(analyze_round_strategy(()))


if __name__ == "__main__":
    unittest.main()
