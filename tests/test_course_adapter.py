from copy import deepcopy
import json
from pathlib import Path
import unittest

from packages.golf_domain import (
    LieType,
    ShotContext,
    SurfaceType,
    Vec2,
    adapt_hole_payload,
    load_course,
    load_lies,
    load_profiles,
    resolve_surface,
)
from packages.simulation import simulate_full_shot


ROOT = Path(__file__).parents[1]
FIXTURES = ROOT / "data" / "fixtures"


class CourseAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.courses = {
            course_id: load_course(ROOT / "data" / directory)
            for course_id, directory in {
                "themeadow": "themeadow",
                "warrenbrook": "warrenbrook",
                "cranbury": "cranbury-golf-club",
                "gallopinghills": "gallopinghills",
            }.items()
        }

    def test_all_courses_load_all_18_holes(self) -> None:
        for course_id, holes in self.courses.items():
            with self.subTest(course=course_id):
                self.assertEqual(tuple(hole.hole_number for hole in holes), tuple(range(1, 19)))
                self.assertTrue(all(hole.source_schema == "native" for hole in holes))

    def test_meter_coordinates_and_declared_distance_convert_to_yards(self) -> None:
        hole = self.courses["themeadow"][0]

        self.assertEqual(hole.tee, Vec2(0, 0))
        self.assertGreater(hole.pin.x, 0)
        self.assertGreater(hole.pin.y, 0)
        self.assertAlmostEqual(hole.declared_distance_yards, 510, places=2)

    def test_every_tee_and_pin_resolves_to_its_playable_surface(self) -> None:
        for course_id, holes in self.courses.items():
            for hole in holes:
                with self.subTest(course=course_id, hole=hole.hole_number):
                    self.assertEqual(resolve_surface(hole.tee, hole.surfaces)[0], SurfaceType.TEE)
                    self.assertEqual(resolve_surface(hole.pin, hole.surfaces)[0], SurfaceType.GREEN)

    def test_all_courses_supply_canonical_surface_coverage(self) -> None:
        required = {
            SurfaceType.TEE,
            SurfaceType.FAIRWAY,
            SurfaceType.ROUGH,
            SurfaceType.GREEN,
            SurfaceType.BUNKER,
            SurfaceType.WATER,
            SurfaceType.OUT_OF_BOUNDS,
        }
        for course_id, holes in self.courses.items():
            with self.subTest(course=course_id):
                available = {region.surface for hole in holes for region in hole.surfaces}
                self.assertTrue(required <= available)
                self.assertTrue(
                    all(region.polygon[0] != region.polygon[-1] for hole in holes for region in hole.surfaces)
                )

    def test_malformed_polygon_has_clear_source_error(self) -> None:
        source_path = ROOT / "data" / "themeadow" / "hole1.json"
        payload = json.loads(source_path.read_text(encoding="utf-8"))
        malformed = deepcopy(payload)
        malformed["geometries"]["green_complex"]["polygon"] = [[0, 0], [1, 1], [2, 2]]

        with self.assertRaisesRegex(ValueError, r"test-hole: green_complex\.polygon has zero area"):
            adapt_hole_payload(malformed, course_id="test", source="test-hole")

    def test_pin_outside_green_has_clear_validation_error(self) -> None:
        source_path = ROOT / "data" / "warrenbrook" / "hole4.json"
        payload = json.loads(source_path.read_text(encoding="utf-8"))
        malformed = deepcopy(payload)
        malformed["centerline_waypoints"][-1]["point"] = [999, 999]

        with self.assertRaisesRegex(ValueError, r"test-hole: centerline finish is outside the green"):
            adapt_hole_payload(malformed, course_id="test", source="test-hole")


class RealHoleShotIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.profile = next(
            profile for profile in load_profiles(FIXTURES / "default_profiles.json") if profile.profile_id == "80_plus"
        )
        cls.lies = load_lies(FIXTURES / "lie_catalog.json")

    def real_context(self, course_id: str, hole_number: int) -> ShotContext:
        directory = "cranbury-golf-club" if course_id == "cranbury" else course_id
        hole = load_course(ROOT / "data" / directory)[hole_number - 1]
        return ShotContext(
            start=hole.tee,
            target=hole.pin,
            pin=hole.pin,
            club=self.profile.club("7_iron"),
            lie=self.lies[LieType.TEE_STANDARD],
            surfaces=hole.surfaces,
            profile_version=self.profile.version,
        )

    def test_seeded_shot_resolves_on_real_meadows_green(self) -> None:
        context = self.real_context("themeadow", 8)

        result = simulate_full_shot(context, round_seed=3, hole_number=8, stroke_index=1)
        replay = simulate_full_shot(context, round_seed=3, hole_number=8, stroke_index=1)

        self.assertEqual(result, replay)
        self.assertEqual(result.landing_surface, SurfaceType.GREEN)
        self.assertEqual(result.landing_region_id, "green_primary_h8")

    def test_seeded_shot_resolves_on_real_warrenbrook_green(self) -> None:
        context = self.real_context("warrenbrook", 4)

        result = simulate_full_shot(context, round_seed=1, hole_number=4, stroke_index=1)
        replay = simulate_full_shot(context, round_seed=1, hole_number=4, stroke_index=1)

        self.assertEqual(result, replay)
        self.assertEqual(result.landing_surface, SurfaceType.GREEN)
        self.assertEqual(result.landing_region_id, "green_primary_h4")

    def test_seeded_shot_resolves_on_real_cranbury_green(self) -> None:
        context = self.real_context("cranbury", 2)

        result = simulate_full_shot(context, round_seed=2, hole_number=2, stroke_index=1)
        replay = simulate_full_shot(context, round_seed=2, hole_number=2, stroke_index=1)

        self.assertEqual(result, replay)
        self.assertEqual(result.landing_surface, SurfaceType.GREEN)
        self.assertEqual(result.landing_region_id, "green_primary_h2")

    def test_seeded_shot_resolves_on_real_galloping_hill_green(self) -> None:
        context = self.real_context("gallopinghills", 11)

        result = simulate_full_shot(context, round_seed=14, hole_number=11, stroke_index=1)
        replay = simulate_full_shot(context, round_seed=14, hole_number=11, stroke_index=1)

        self.assertEqual(result, replay)
        self.assertEqual(result.landing_surface, SurfaceType.GREEN)
        self.assertEqual(result.landing_region_id, "green_primary_h11")


if __name__ == "__main__":
    unittest.main()
