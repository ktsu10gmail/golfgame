import unittest

from packages.golf_domain import (
    AuditModifier,
    ClubStat,
    DecisionLabel,
    LieModifier,
    LieType,
    PenaltyReason,
    PenaltyRelief,
    PreferredMiss,
    PuttAudit,
    PuttRead,
    PuttResultPacket,
    ReliefType,
    ResultAssessment,
    ShotAudit,
    ShotQuality,
    ShotResultPacket,
    StrategicShotType,
    StrategyContext,
    SurfaceType,
    Vec2,
)
from packages.simulation import (
    DECISION_SCORE_VERSION,
    analysis_shot_from_packet,
    score_putt_strategy,
    score_strategy,
)


def _club(carry_mean: float = 150.0, lateral_sd: float = 8.0) -> ClubStat:
    return ClubStat(
        club_id="test_club",
        carry_mean=carry_mean,
        carry_sd=10.0,
        roll_mean=8.0,
        lateral_sd=lateral_sd,
        directional_bias=0.0,
        mishit_probability=0.2,
    )


def _result(
    *,
    landing_surface: SurfaceType = SurfaceType.GREEN,
    remaining_distance_yards: float = 8.0,
    lateral_yards: float = 3.0,
    execution_assessment: str = "on_plan",
    with_penalty: bool = False,
) -> ShotResultPacket:
    relief = None
    if with_penalty:
        relief = PenaltyRelief(
            version="penalty-relief-v1",
            reason=PenaltyReason.WATER,
            penalty_strokes=1,
            relief_type=ReliefType.WATER_LAST_CROSSING,
            reference_point=Vec2(0, 0),
            ball_position=Vec2(1, 1),
            resulting_surface=SurfaceType.ROUGH,
            resulting_region_id=None,
        )
    return ShotResultPacket(
        quality=ShotQuality.SOLID,
        carry_yards=145.0,
        roll_yards=7.0,
        total_yards=152.0,
        lateral_yards=lateral_yards,
        landing=Vec2(0, 0),
        path=(Vec2(0, 0), Vec2(1, 1)),
        landing_surface=landing_surface,
        landing_region_id=None,
        remaining_distance_yards=remaining_distance_yards,
        assessment=ResultAssessment(
            decision_assessment="sound",
            execution_assessment=execution_assessment,
            overall_assessment="good" if execution_assessment == "on_plan" else "bad",
        ),
        audit=ShotAudit(
            engine_version="full-shot-v3",
            round_seed=1,
            shot_seed=2,
            hole_number=1,
            stroke_index=1,
            profile_version="test",
            lie_version="test",
            sampled_carry_yards=145.0,
            sampled_lateral_yards=lateral_yards,
            mishit_probability=0.2,
            modifiers=(AuditModifier(name="test", value=1.0),),
        ),
        relief=relief,
    )


def _putt_result(
    *,
    feet: float = 30.0,
    aim_error_inches: float = 2.0,
    power_error_points: float = 3.0,
    remaining_distance_yards: float = 1.0,
    made: bool = False,
) -> PuttResultPacket:
    return PuttResultPacket(
        made=made,
        landing=Vec2(0, 0),
        total_yards=feet / 3,
        remaining_distance_yards=remaining_distance_yards,
        aim_error_inches=aim_error_inches,
        power_error_points=power_error_points,
        make_probability=0.1,
        aim_correct=aim_error_inches <= 4,
        pace_correct=power_error_points <= 8,
        correct_decision=aim_error_inches <= 4 and power_error_points <= 8,
        player_offset_inches=2,
        player_offset_direction="left",
        read=PuttRead(feet=feet, direction="right", start_direction="left", break_inches=4),
        assessment=ResultAssessment(
            decision_assessment="sound",
            execution_assessment="on_plan",
            overall_assessment="good",
        ),
        audit=PuttAudit(
            engine_version="putting-v1",
            round_seed=1,
            shot_seed=2,
            hole_number=7,
            stroke_index=3,
            profile_version="test",
            sampled_power_multiplier=1,
            sampled_lateral_yards=0,
            make_probability=0.1,
        ),
    )


class DecisionScoringTests(unittest.TestCase):
    def test_system_infers_preferred_miss_from_context(self) -> None:
        context = StrategyContext(
            hole_number=1,
            stroke_number=2,
            distance_to_target_yards=140.0,
            lie_type=LieType.FAIRWAY_CLEAN,
            shot_type=StrategicShotType.APPROACH_STANDARD,
            selected_club=_club(carry_mean=145.0),
            water_in_play=True,
            pin_risk_level=1,
            target_aggression=0.20,
        )

        packet = score_strategy(context)

        self.assertEqual(packet.preferred_miss, PreferredMiss.DRY_SIDE)
        self.assertTrue(packet.preferred_miss_inferred)
        self.assertIn("water_in_play", packet.decision.advice_keys)
        self.assertIn("good_miss_plan", packet.decision.reasons)

    def test_declared_preferred_miss_is_not_marked_inferred(self) -> None:
        context = StrategyContext(
            hole_number=1,
            stroke_number=2,
            distance_to_target_yards=140.0,
            lie_type=LieType.FAIRWAY_CLEAN,
            shot_type=StrategicShotType.APPROACH_STANDARD,
            selected_club=_club(carry_mean=145.0),
            pin_risk_level=1,
            target_aggression=0.20,
            preferred_miss=PreferredMiss.CENTER_GREEN,
        )

        packet = score_strategy(context)

        self.assertEqual(packet.preferred_miss, PreferredMiss.CENTER_GREEN)
        self.assertFalse(packet.preferred_miss_inferred)

    def test_safe_target_from_rough_grades_higher_than_pin_attack(self) -> None:
        club = _club()
        safe = StrategyContext(
            hole_number=1,
            stroke_number=2,
            distance_to_target_yards=150.0,
            lie_type=LieType.ROUGH_MEDIUM,
            shot_type=StrategicShotType.APPROACH_STANDARD,
            selected_club=club,
            target_aggression=0.20,
            pin_risk_level=2,
            preferred_miss=PreferredMiss.CENTER_GREEN,
        )
        aggressive = StrategyContext(
            hole_number=1,
            stroke_number=2,
            distance_to_target_yards=150.0,
            lie_type=LieType.ROUGH_MEDIUM,
            shot_type=StrategicShotType.APPROACH_STANDARD,
            selected_club=club,
            target_aggression=0.80,
            pin_risk_level=2,
            preferred_miss=PreferredMiss.RIGHT_SAFE,
        )

        safe_score = score_strategy(safe).decision
        aggressive_score = score_strategy(aggressive).decision

        self.assertGreater(safe_score.score, aggressive_score.score)
        self.assertEqual(safe_score.label, DecisionLabel.SOUND)
        self.assertIn("favor_center_green", safe_score.advice_keys)

    def test_proper_carry_club_grades_higher_than_thin_carry_club(self) -> None:
        safe_margin = StrategyContext(
            hole_number=2,
            stroke_number=2,
            distance_to_target_yards=150.0,
            lie_type=LieType.FAIRWAY_CLEAN,
            shot_type=StrategicShotType.APPROACH_FORCED_CARRY,
            selected_club=_club(carry_mean=160.0),
            forced_carry_yards=148.0,
            water_in_play=True,
            preferred_miss=PreferredMiss.DRY_SIDE,
        )
        thin_margin = StrategyContext(
            hole_number=2,
            stroke_number=2,
            distance_to_target_yards=150.0,
            lie_type=LieType.FAIRWAY_CLEAN,
            shot_type=StrategicShotType.APPROACH_FORCED_CARRY,
            selected_club=_club(carry_mean=150.0),
            forced_carry_yards=148.0,
            water_in_play=True,
            preferred_miss=PreferredMiss.DRY_SIDE,
        )

        safe_score = score_strategy(safe_margin).decision
        thin_score = score_strategy(thin_margin).decision

        self.assertGreater(safe_score.score, thin_score.score)
        self.assertIn("cover_the_carry", safe_score.advice_keys)

    def test_recovery_punch_out_grades_higher_than_hero_shot(self) -> None:
        escape = StrategyContext(
            hole_number=3,
            stroke_number=2,
            distance_to_target_yards=110.0,
            lie_type=LieType.ROUGH_DEEP,
            shot_type=StrategicShotType.RECOVERY_ESCAPE,
            selected_club=_club(carry_mean=120.0),
            recovery_required=True,
            preferred_miss=PreferredMiss.BACK_IN_PLAY,
        )
        hero = StrategyContext(
            hole_number=3,
            stroke_number=2,
            distance_to_target_yards=110.0,
            lie_type=LieType.ROUGH_DEEP,
            shot_type=StrategicShotType.APPROACH_STANDARD,
            selected_club=_club(carry_mean=120.0),
            recovery_required=True,
            target_aggression=0.75,
            preferred_miss=PreferredMiss.CENTER_GREEN,
        )

        escape_score = score_strategy(escape).decision
        hero_score = score_strategy(hero).decision

        self.assertGreater(escape_score.score, hero_score.score)
        self.assertIn("restore_position", escape_score.advice_keys)

    def test_center_green_near_water_grades_higher_than_short_side_attack(self) -> None:
        safe = StrategyContext(
            hole_number=4,
            stroke_number=2,
            distance_to_target_yards=135.0,
            lie_type=LieType.FAIRWAY_CLEAN,
            shot_type=StrategicShotType.APPROACH_STANDARD,
            selected_club=_club(carry_mean=140.0),
            water_in_play=True,
            pin_risk_level=2,
            target_aggression=0.25,
            preferred_miss=PreferredMiss.DRY_SIDE,
        )
        attack = StrategyContext(
            hole_number=4,
            stroke_number=2,
            distance_to_target_yards=135.0,
            lie_type=LieType.FAIRWAY_CLEAN,
            shot_type=StrategicShotType.APPROACH_STANDARD,
            selected_club=_club(carry_mean=140.0),
            water_in_play=True,
            pin_risk_level=2,
            target_aggression=0.78,
            preferred_miss=PreferredMiss.RIGHT_SAFE,
        )

        safe_score = score_strategy(safe).decision
        attack_score = score_strategy(attack).decision

        self.assertGreater(safe_score.score, attack_score.score)
        self.assertIn("water_in_play", safe_score.advice_keys)

    def test_lucky_good_outcome_does_not_improve_poor_decision_score(self) -> None:
        context = StrategyContext(
            hole_number=5,
            stroke_number=2,
            distance_to_target_yards=155.0,
            lie_type=LieType.ROUGH_MEDIUM,
            shot_type=StrategicShotType.APPROACH_STANDARD,
            selected_club=_club(carry_mean=158.0),
            water_in_play=True,
            pin_risk_level=2,
            target_aggression=0.82,
            preferred_miss=PreferredMiss.RIGHT_SAFE,
        )

        good_result = _result(landing_surface=SurfaceType.GREEN, execution_assessment="on_plan")
        bad_result = _result(landing_surface=SurfaceType.WATER, execution_assessment="missed", with_penalty=True)

        good_packet = score_strategy(context, good_result)
        bad_packet = score_strategy(context, bad_result)

        self.assertEqual(good_packet.version, DECISION_SCORE_VERSION)
        self.assertEqual(good_packet.decision.score, bad_packet.decision.score)
        self.assertGreater(good_packet.execution.score, bad_packet.execution.score)

    def test_putt_plan_is_scored_separately_from_execution(self) -> None:
        made = score_putt_strategy(_putt_result(made=True, remaining_distance_yards=0))
        missed = score_putt_strategy(_putt_result(made=False, remaining_distance_yards=4))

        self.assertEqual(made.shot_type, StrategicShotType.PUTT_LAG)
        self.assertEqual(made.decision.score, missed.decision.score)
        self.assertEqual(made.decision.score, 91)
        self.assertGreater(made.execution.score, missed.execution.score)
        normalized = analysis_shot_from_packet(made)
        self.assertEqual(normalized.hole_number, 7)
        self.assertEqual(normalized.stroke_number, 3)
        self.assertEqual(normalized.putting_read_discipline, 91)

    def test_bad_putt_read_and_pace_grade_below_sound_plan(self) -> None:
        sound = score_putt_strategy(_putt_result())
        poor = score_putt_strategy(_putt_result(aim_error_inches=14, power_error_points=20))

        self.assertGreater(sound.decision.score, poor.decision.score)
        self.assertIn("putting_line_missed", poor.decision.reasons)
        self.assertIn("putting_pace_missed", poor.decision.reasons)

    def test_bunker_escape_weights_lie_management_more_than_standard_approach(self) -> None:
        bunker_escape = StrategyContext(
            hole_number=6,
            stroke_number=2,
            distance_to_target_yards=35.0,
            lie_type=LieType.BUNKER_BURIED,
            shot_type=StrategicShotType.BUNKER_ESCAPE,
            selected_club=_club(carry_mean=45.0),
            target_aggression=0.60,
        )
        standard_approach = StrategyContext(
            hole_number=6,
            stroke_number=2,
            distance_to_target_yards=35.0,
            lie_type=LieType.BUNKER_BURIED,
            shot_type=StrategicShotType.APPROACH_STANDARD,
            selected_club=_club(carry_mean=45.0),
            target_aggression=0.60,
        )

        bunker_packet = score_strategy(bunker_escape)
        approach_packet = score_strategy(standard_approach)

        self.assertEqual(
            bunker_packet.decision.subscores,
            approach_packet.decision.subscores,
        )
        self.assertLess(
            bunker_packet.decision.score,
            approach_packet.decision.score,
        )

    def test_poor_strike_does_not_erase_strong_decision_grade(self) -> None:
        context = StrategyContext(
            hole_number=6,
            stroke_number=2,
            distance_to_target_yards=145.0,
            lie_type=LieType.FAIRWAY_CLEAN,
            shot_type=StrategicShotType.APPROACH_FORCED_CARRY,
            selected_club=_club(carry_mean=160.0),
            forced_carry_yards=145.0,
            water_in_play=True,
            pin_risk_level=1,
            target_aggression=0.20,
            preferred_miss=PreferredMiss.DRY_SIDE,
        )

        packet = score_strategy(
            context,
            _result(
                landing_surface=SurfaceType.ROUGH,
                remaining_distance_yards=50.0,
                lateral_yards=20.0,
                execution_assessment="missed",
            ),
        )

        self.assertGreaterEqual(packet.decision.score, 75)
        self.assertLess(packet.execution.score, packet.decision.score)


if __name__ == "__main__":
    unittest.main()
