from pathlib import Path
import unittest

from packages.golf_domain import (
    GreensideContext,
    LieType,
    SurfaceRegion,
    SurfaceType,
    Vec2,
    load_course,
)
from packages.simulation import (
    GREENSIDE_ENGINE_VERSION,
    derive_greenside_seed,
    simulate_greenside_shot,
)


ROOT = Path(__file__).parents[1]


def rectangle(x1: float, y1: float, x2: float, y2: float) -> tuple[Vec2, ...]:
    return (Vec2(x1, y1), Vec2(x2, y1), Vec2(x2, y2), Vec2(x1, y2))


def context(*, water_finish: bool = False) -> GreensideContext:
    surfaces = [
        SurfaceRegion(SurfaceType.FAIRWAY, rectangle(-5, -10, 5, 10), 40, "fairway"),
        SurfaceRegion(
            SurfaceType.GREEN,
            rectangle(5, -10, 10 if water_finish else 30, 10),
            70,
            "green",
        ),
    ]
    if water_finish:
        surfaces.append(
            SurfaceRegion(SurfaceType.WATER, rectangle(10, -10, 30, 10), 90, "water")
        )
    return GreensideContext(
        start=Vec2(0, 0),
        target=Vec2(8, 0),
        pin=Vec2(20, 0),
        club_id="sand_wedge",
        accuracy=0.88,
        lie_type=LieType.FAIRWAY_CLEAN,
        power=0.9,
        roll_slope_factor=1,
        break_direction="right",
        contour_modifier=1,
        surfaces=tuple(surfaces),
        profile_version="test-profile",
        lie_version="test-lie",
    )


class GreensideEngineTests(unittest.TestCase):
    def test_packet_matches_cross_runtime_golden_result(self) -> None:
        packet = simulate_greenside_shot(
            context(), round_seed=90210, hole_number=4, stroke_index=2
        )

        self.assertEqual(packet.audit.engine_version, GREENSIDE_ENGINE_VERSION)
        self.assertEqual(packet.audit.shot_seed, 13337505522666382803)
        self.assertEqual(packet.quality.value, "solid")
        self.assertEqual(packet.carry_yards, 8.64)
        self.assertEqual(packet.roll_yards, 8.64)
        self.assertEqual(packet.landing, Vec2(8.6435, -0.3279))
        self.assertEqual(packet.resolved_ball, Vec2(17.2932, -0.4164))
        self.assertEqual(packet.landing_surface, SurfaceType.GREEN)
        self.assertEqual(packet.resolved_surface, SurfaceType.GREEN)
        self.assertEqual(packet.remaining_distance_yards, 2.74)
        self.assertEqual(packet.assessment.execution_assessment, "on_plan")

    def test_seed_identity_replays_and_changes_by_stroke(self) -> None:
        identity = dict(round_seed=7319, hole_number=12, stroke_index=3)
        first = simulate_greenside_shot(context(), **identity)
        replay = simulate_greenside_shot(context(), **identity)
        next_stroke = simulate_greenside_shot(
            context(), round_seed=7319, hole_number=12, stroke_index=4
        )

        self.assertEqual(first, replay)
        self.assertNotEqual(first, next_stroke)
        self.assertEqual(
            first.audit.shot_seed,
            derive_greenside_seed(7319, 12, 3),
        )

    def test_roll_into_water_uses_authoritative_relief(self) -> None:
        packet = simulate_greenside_shot(
            context(water_finish=True), round_seed=90210, hole_number=4, stroke_index=2
        )

        self.assertEqual(packet.landing_surface, SurfaceType.GREEN)
        self.assertIsNotNone(packet.relief)
        assert packet.relief is not None
        self.assertEqual(packet.relief.reason.value, "water")
        self.assertEqual(packet.relief.penalty_strokes, 1)
        self.assertEqual(packet.resolved_surface, SurfaceType.GREEN)

    def test_overshot_landing_continues_forward_instead_of_reversing(self) -> None:
        overshot = GreensideContext(
            start=Vec2(0, 0),
            target=Vec2(20, 0),
            pin=Vec2(10, 0),
            club_id="sand_wedge",
            accuracy=1,
            lie_type=LieType.FAIRWAY_CLEAN,
            power=0.9,
            roll_slope_factor=1,
            break_direction="right",
            contour_modifier=1,
            surfaces=(
                SurfaceRegion(SurfaceType.FAIRWAY, rectangle(-5, -10, 5, 10), 40, "fairway"),
                SurfaceRegion(SurfaceType.GREEN, rectangle(5, -10, 50, 10), 70, "green"),
            ),
            profile_version="test-profile",
            lie_version="test-lie",
        )
        packet = simulate_greenside_shot(
            overshot, round_seed=972206328, hole_number=10, stroke_index=4
        )

        self.assertGreater(packet.landing.x, 10)
        self.assertGreater(packet.resolved_ball.x, packet.landing.x)
        self.assertEqual(packet.resolved_surface, SurfaceType.GREEN)

    def test_real_course_surfaces_are_consumed_for_all_courses(self) -> None:
        for course_id in ("themeadow", "warrenbrook", "cranbury", "gallopinghills"):
            directory = "cranbury-golf-club" if course_id == "cranbury" else course_id
            hole = load_course(ROOT / "data" / directory)[0]
            previous = hole.centerline[-2]
            dx, dy = previous.x - hole.pin.x, previous.y - hole.pin.y
            length = max((dx * dx + dy * dy) ** 0.5, 1)
            start = Vec2(hole.pin.x + dx / length * 20, hole.pin.y + dy / length * 20)
            target = Vec2(start.x - dx / length * 8, start.y - dy / length * 8)
            real_context = GreensideContext(
                start=start,
                target=target,
                pin=hole.pin,
                club_id="sand_wedge",
                accuracy=0.9,
                lie_type=LieType.ROUGH_LIGHT,
                power=0.9,
                roll_slope_factor=1,
                break_direction="right",
                contour_modifier=0,
                surfaces=hole.surfaces,
                profile_version="real-course-test",
                lie_version="test-lie",
            )

            with self.subTest(course=course_id):
                packet = simulate_greenside_shot(
                    real_context, round_seed=17, hole_number=1, stroke_index=3
                )
                self.assertIn(packet.landing_surface, set(SurfaceType))
                self.assertIn(packet.resolved_surface, set(SurfaceType))
                self.assertEqual(len(packet.path), 3)


if __name__ == "__main__":
    unittest.main()
