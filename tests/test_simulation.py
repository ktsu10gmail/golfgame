from dataclasses import replace
from pathlib import Path
import statistics
import unittest

from packages.golf_domain import (
    Dexterity,
    EnvironmentModifiers,
    LieType,
    PenaltyReason,
    ReliefType,
    PuttContext,
    PuttProfile,
    PuttRead,
    ShotContext,
    ShotQuality,
    SurfaceRegion,
    SurfaceType,
    Vec2,
    load_lies,
    load_profiles,
)
from packages.simulation import (
    ENGINE_VERSION,
    PUTTING_ENGINE_VERSION,
    declare_unplayable,
    derive_putt_seed,
    derive_shot_seed,
    simulate_full_shot,
    simulate_putt,
)


FIXTURES = Path(__file__).parents[1] / "data" / "fixtures"
PROFILES = {profile.profile_id: profile for profile in load_profiles(FIXTURES / "default_profiles.json")}
LIES = load_lies(FIXTURES / "lie_catalog.json")


def rectangle(x1: float, y1: float, x2: float, y2: float) -> tuple[Vec2, ...]:
    return (Vec2(x1, y1), Vec2(x2, y1), Vec2(x2, y2), Vec2(x1, y2))


def context(profile_id: str = "90_plus", club_id: str = "7_iron") -> ShotContext:
    profile = PROFILES[profile_id]
    return ShotContext(
        start=Vec2(0, 0),
        target=Vec2(140, 0),
        pin=Vec2(150, 0),
        club=profile.club(club_id),
        lie=LIES[LieType.FAIRWAY_CLEAN],
        dexterity=Dexterity.RIGHT,
        surfaces=(
            SurfaceRegion(
                SurfaceType.FAIRWAY,
                rectangle(75, -25, 145, 25),
                priority=10,
                region_id="test-fairway",
            ),
            SurfaceRegion(
                SurfaceType.GREEN,
                rectangle(145, -15, 165, 15),
                priority=20,
                region_id="test-green",
            ),
        ),
        profile_version=profile.version,
    )


def putt_context() -> PuttContext:
    return PuttContext(
        start=Vec2(0, 0),
        target=Vec2(-1.0, 12),
        pin=Vec2(0, 12),
        profile=PuttProfile(0.9, 0.55, 0.3),
        read=PuttRead(feet=36, direction="right", start_direction="left", break_inches=4),
        pace_scale=0.58,
        profile_version="browser-profile-90",
    )


class SeedAndPacketTests(unittest.TestCase):
    def test_same_inputs_and_seed_replay_exactly(self) -> None:
        first = simulate_full_shot(context(), round_seed=90210, hole_number=4, stroke_index=2)
        replay = simulate_full_shot(context(), round_seed=90210, hole_number=4, stroke_index=2)

        self.assertEqual(first, replay)
        self.assertEqual(first.audit.engine_version, ENGINE_VERSION)
        self.assertEqual(first.audit.shot_seed, derive_shot_seed(90210, 4, 2))
        self.assertEqual(first.audit.shot_seed, 9101625523428572884)
        self.assertEqual(first.total_yards, 133.19)
        self.assertEqual(first.landing, Vec2(133.1899, -16.8409))

    def test_stroke_identity_changes_derived_seed_and_result(self) -> None:
        first = simulate_full_shot(context(), round_seed=77, hole_number=1, stroke_index=1)
        second = simulate_full_shot(context(), round_seed=77, hole_number=1, stroke_index=2)

        self.assertNotEqual(first.audit.shot_seed, second.audit.shot_seed)
        self.assertNotEqual(first, second)

    def test_green_contour_slope_changes_putt_travel(self) -> None:
        downhill_context = replace(
            putt_context(),
            read=replace(putt_context().read, slope="downhill", slope_degrees=5, downhill_strength=5),
        )
        uphill_context = replace(
            putt_context(),
            read=replace(putt_context().read, slope="uphill", slope_degrees=5, downhill_strength=-5),
        )
        average = lambda sample: statistics.mean(
            simulate_putt(sample, round_seed=seed, hole_number=12, stroke_index=3).total_yards
            for seed in range(1, 1001)
        )
        self.assertGreater(average(downhill_context), average(putt_context()))
        self.assertGreater(average(putt_context()), average(uphill_context))

    def test_result_packet_has_trace_surface_and_audit(self) -> None:
        result = simulate_full_shot(context(), round_seed=8, hole_number=1, stroke_index=1)

        self.assertEqual(result.path[0], Vec2(0, 0))
        self.assertEqual(result.path[-1], result.landing)
        self.assertEqual(len(result.path), 13)
        self.assertIn(result.landing_surface, set(SurfaceType))
        self.assertEqual(result.audit.profile_version, "2026.07.1")
        self.assertEqual(result.audit.lie_version, "2026.07.1")
        self.assertGreaterEqual(len(result.audit.modifiers), 10)
        self.assertAlmostEqual(result.total_yards, result.carry_yards + result.roll_yards, places=2)
        self.assertEqual(result.assessment.decision_assessment, "sound")
        self.assertIn(result.assessment.execution_assessment, {"on_plan", "missed"})
        self.assertIn(result.assessment.overall_assessment, {"good", "bad"})
        self.assertIsInstance(result.assessment.decision_risk, int)
        self.assertIsInstance(result.assessment.risk_label, str)

    def test_invalid_seed_coordinates_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            derive_shot_seed(1, 0, 1)
        with self.assertRaises(ValueError):
            replace(context(), target=Vec2(0, 0))
        with self.assertRaises(ValueError):
            derive_putt_seed(1, 19, 1)


class ModifierAndQualityTests(unittest.TestCase):
    def test_rough_reduces_distance_for_same_non_mishit_draw(self) -> None:
        base = context()
        no_mishit_club = replace(base.club, mishit_probability=0)
        fairway = replace(base, club=no_mishit_club)
        rough = replace(fairway, lie=LIES[LieType.ROUGH_DEEP])

        fairway_result = simulate_full_shot(fairway, round_seed=99, hole_number=1, stroke_index=1)
        rough_result = simulate_full_shot(rough, round_seed=99, hole_number=1, stroke_index=1)

        self.assertLess(rough_result.carry_yards, fairway_result.carry_yards)
        self.assertLess(rough_result.roll_yards, fairway_result.roll_yards)

    def test_wind_changes_forward_and_lateral_result_by_configured_amount(self) -> None:
        calm = context()
        windy = replace(
            calm,
            environment=EnvironmentModifiers(wind_forward_yards=-8, wind_lateral_yards=6),
        )

        calm_result = simulate_full_shot(calm, round_seed=15, hole_number=2, stroke_index=1)
        windy_result = simulate_full_shot(windy, round_seed=15, hole_number=2, stroke_index=1)

        self.assertAlmostEqual(windy_result.carry_yards, calm_result.carry_yards - 8, places=2)
        self.assertAlmostEqual(windy_result.lateral_yards, calm_result.lateral_yards + 6, places=2)

    def test_forced_fat_quality_has_correlated_carry_and_roll_loss(self) -> None:
        base = context()
        forced_fat = replace(
            base.club,
            mishit_probability=1,
            quality_weights=((ShotQuality.FAT, 1.0),),
        )
        forced_solid = replace(base.club, mishit_probability=0, carry_sd=0, lateral_sd=0)
        fat_result = simulate_full_shot(
            replace(base, club=forced_fat), round_seed=3, hole_number=3, stroke_index=1
        )
        solid_result = simulate_full_shot(
            replace(base, club=forced_solid), round_seed=3, hole_number=3, stroke_index=1
        )

        self.assertEqual(fat_result.quality, ShotQuality.FAT)
        self.assertLess(fat_result.carry_yards, solid_result.carry_yards * 0.75)
        self.assertLess(fat_result.roll_yards, solid_result.roll_yards)

    def test_full_shots_cap_carry_at_108_percent_and_keep_roll_separate(self) -> None:
        base = context()
        three_wood = replace(
            base.club,
            club_id="3_wood",
            carry_mean=200,
            carry_sd=40,
            roll_mean=12,
            lateral_sd=0,
            directional_bias=0,
            mishit_probability=0,
        )
        sample = replace(
            base,
            club=three_wood,
            target=Vec2(250, 0),
            environment=EnvironmentModifiers(elevation_carry_multiplier=2),
        )

        results = []
        for round_seed in range(1, 101):
            result = simulate_full_shot(
                sample, round_seed=round_seed, hole_number=7, stroke_index=2
            )
            results.append(result)
            self.assertLessEqual(result.carry_yards, 216)
            self.assertAlmostEqual(
                result.total_yards, result.carry_yards + result.roll_yards, places=2
            )
        longest = max(results, key=lambda result: result.carry_yards)
        self.assertEqual(longest.carry_yards, 216)
        self.assertEqual(longest.total_yards, 228)


class PenaltyReliefTests(unittest.TestCase):
    def penalty_context(self, surface: SurfaceType) -> ShotContext:
        base = context()
        club = replace(base.club, carry_mean=90, carry_sd=0, roll_mean=0, lateral_sd=0, directional_bias=0, mishit_probability=0)
        return replace(
            base,
            target=Vec2(100, 0),
            pin=Vec2(150, 0),
            club=club,
            surfaces=(
                SurfaceRegion(SurfaceType.TEE, rectangle(-5, -5, 5, 5), priority=60, region_id="tee"),
                SurfaceRegion(surface, rectangle(80, -20, 120, 20), priority=100, region_id=f"test-{surface.value}"),
            ),
        )

    def test_water_uses_last_crossing_and_one_stroke(self) -> None:
        result = simulate_full_shot(self.penalty_context(SurfaceType.WATER), round_seed=1, hole_number=1, stroke_index=1)

        self.assertEqual(result.landing_surface, SurfaceType.WATER)
        self.assertEqual(result.relief.reason, PenaltyReason.WATER)
        self.assertEqual(result.relief.relief_type, ReliefType.WATER_LAST_CROSSING)
        self.assertEqual(result.relief.penalty_strokes, 1)
        self.assertAlmostEqual(result.relief.reference_point.x, 80, places=2)
        self.assertAlmostEqual(result.relief.ball_position.x, 78, places=2)
        self.assertNotIn(result.relief.resulting_surface, {SurfaceType.WATER, SurfaceType.OUT_OF_BOUNDS})
        self.assertEqual(result.remaining_distance_yards, 72)

    def test_out_of_bounds_is_stroke_and_distance(self) -> None:
        result = simulate_full_shot(self.penalty_context(SurfaceType.OUT_OF_BOUNDS), round_seed=1, hole_number=1, stroke_index=1)

        self.assertEqual(result.relief.reason, PenaltyReason.OUT_OF_BOUNDS)
        self.assertEqual(result.relief.relief_type, ReliefType.STROKE_AND_DISTANCE)
        self.assertEqual(result.relief.ball_position, result.path[0])
        self.assertEqual(result.relief.resulting_surface, SurfaceType.TEE)
        self.assertEqual(result.remaining_distance_yards, 150)

    def test_unplayable_relief_is_deterministic_and_rejects_penalty_areas(self) -> None:
        playable = simulate_full_shot(context(), round_seed=90210, hole_number=4, stroke_index=2)
        first = declare_unplayable(context(), playable)
        replay = declare_unplayable(context(), playable)

        self.assertEqual(first, replay)
        self.assertEqual(first.reason, PenaltyReason.UNPLAYABLE)
        self.assertEqual(first.relief_type, ReliefType.UNPLAYABLE_BACK_ON_LINE)
        self.assertEqual(first.penalty_strokes, 1)
        water_context = self.penalty_context(SurfaceType.WATER)
        water = simulate_full_shot(water_context, round_seed=1, hole_number=1, stroke_index=1)
        with self.assertRaisesRegex(ValueError, "already has automatic penalty relief"):
            declare_unplayable(water_context, water)


class CalibrationSmokeTests(unittest.TestCase):
    def test_90_plus_seven_iron_batch_stays_bounded_and_near_fixture(self) -> None:
        sample_context = context()
        results = [
            simulate_full_shot(sample_context, round_seed=seed, hole_number=1, stroke_index=1)
            for seed in range(1, 2001)
        ]
        carries = [result.carry_yards for result in results]
        mishit_share = sum(
            result.quality not in {ShotQuality.PURE, ShotQuality.SOLID} for result in results
        ) / len(results)

        self.assertGreater(statistics.mean(carries), 124)
        self.assertLess(statistics.mean(carries), 136)
        self.assertGreaterEqual(min(carries), 30)
        self.assertLessEqual(max(carries), 160)
        self.assertGreater(mishit_share, 0.05)
        self.assertLess(mishit_share, 0.11)


class PuttingTests(unittest.TestCase):
    def test_putt_packet_is_deterministic_and_tracks_identity(self) -> None:
        first = simulate_putt(putt_context(), round_seed=90210, hole_number=4, stroke_index=2)
        replay = simulate_putt(putt_context(), round_seed=90210, hole_number=4, stroke_index=2)

        self.assertEqual(first, replay)
        self.assertEqual(first.audit.engine_version, PUTTING_ENGINE_VERSION)
        self.assertEqual(first.audit.shot_seed, derive_putt_seed(90210, 4, 2))
        self.assertEqual(first.landing, Vec2(-0.7965, 11.7134))
        self.assertEqual(first.remaining_distance_yards, 0.85)
        self.assertFalse(first.made)
        self.assertAlmostEqual(first.make_probability, 0.0, places=6)
        self.assertEqual(first.assessment.decision_assessment, "review")
        self.assertEqual(first.assessment.execution_assessment, "missed")
        self.assertEqual(first.assessment.overall_assessment, "bad")

    def test_putt_seed_changes_result(self) -> None:
        first = simulate_putt(putt_context(), round_seed=77, hole_number=1, stroke_index=1)
        second = simulate_putt(putt_context(), round_seed=77, hole_number=1, stroke_index=2)

        self.assertNotEqual(first.audit.shot_seed, second.audit.shot_seed)
        self.assertNotEqual(first, second)

    def test_short_putt_reaching_cup_radius_retains_make_chance(self) -> None:
        sample = replace(
            putt_context(),
            target=Vec2(0, 1.25),
            pin=Vec2(0, 1.25),
            read=PuttRead(feet=3.75, direction="right", start_direction="right", break_inches=0),
            pace_scale=0.06,
        )
        packet = simulate_putt(sample, round_seed=19, hole_number=10, stroke_index=3)
        self.assertGreater(packet.make_probability, 0)
        self.assertTrue(packet.pace_correct)
        self.assertTrue(packet.correct_decision)

    def test_putt_read_is_relative_to_player_to_cup_line_on_rotated_green(self) -> None:
        rotated = PuttContext(
            start=Vec2(0, 0),
            target=Vec2(12, -4 / 36),
            pin=Vec2(12, 0),
            profile=PuttProfile(0.9, 0.55, 0.3),
            read=PuttRead(feet=12, direction="right", start_direction="right", break_inches=4),
            pace_scale=0.2,
            profile_version="rotated-green-test",
        )

        packet = simulate_putt(rotated, round_seed=41, hole_number=3, stroke_index=2)

        self.assertEqual(packet.aim_error_inches, 0)
        self.assertEqual(packet.player_offset_inches, 4)
        self.assertEqual(packet.player_offset_direction, "right")
        self.assertTrue(packet.aim_correct)

    def test_contour_putt_matches_browser_golden_and_records_path(self) -> None:
        contour_context = PuttContext(
            start=Vec2(0, -4),
            target=Vec2(0, 4),
            pin=Vec2(0, 4),
            profile=PuttProfile(0.9, 0.55, 0.3),
            read=PuttRead(
                feet=24,
                direction="right",
                start_direction="left",
                break_inches=0,
            ),
            pace_scale=0.4,
            profile_version="contour-test",
            green_polygon=(Vec2(-8, -8), Vec2(8, -8), Vec2(8, 8), Vec2(-8, 8)),
            contour_hole_number=1,
        )

        packet = simulate_putt(contour_context, round_seed=90210, hole_number=1, stroke_index=1)

        self.assertEqual(packet.landing, Vec2(0.097, 4.4586))
        self.assertEqual(len(packet.path), 23)
        self.assertEqual(packet.path[-1], packet.landing)
        self.assertTrue(packet.audit.contour_physics)
        self.assertEqual(packet.audit.physics_steps, 87)


if __name__ == "__main__":
    unittest.main()
