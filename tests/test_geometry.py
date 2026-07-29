import unittest

from packages.golf_domain import (
    SurfaceRegion,
    SurfaceType,
    Vec2,
    point_in_polygon,
    project_landing,
    resolve_surface,
    target_axes,
)


SQUARE = (Vec2(0, 0), Vec2(10, 0), Vec2(10, 10), Vec2(0, 10))


class GeometryTests(unittest.TestCase):
    def test_target_axes_and_projection(self) -> None:
        forward, right = target_axes(Vec2(0, 0), Vec2(100, 0))

        self.assertEqual(forward, Vec2(1, 0))
        self.assertEqual(right, Vec2(0, -1))
        self.assertEqual(project_landing(Vec2(0, 0), Vec2(100, 0), 150, 12), Vec2(150, -12))

    def test_positive_lateral_is_right_in_course_coordinates(self) -> None:
        forward, right = target_axes(Vec2(0, 0), Vec2(0, 100))

        self.assertEqual(forward, Vec2(0, 1))
        self.assertEqual(right, Vec2(1, 0))
        self.assertEqual(project_landing(Vec2(0, 0), Vec2(0, 100), 80, 10), Vec2(10, 80))

    def test_polygon_includes_boundary(self) -> None:
        self.assertTrue(point_in_polygon(Vec2(5, 5), SQUARE))
        self.assertTrue(point_in_polygon(Vec2(10, 5), SQUARE))
        self.assertFalse(point_in_polygon(Vec2(11, 5), SQUARE))

    def test_surface_resolution_uses_explicit_priority(self) -> None:
        regions = (
            SurfaceRegion(SurfaceType.FAIRWAY, SQUARE, priority=10, region_id="fairway"),
            SurfaceRegion(SurfaceType.BUNKER, SQUARE, priority=50, region_id="bunker-1"),
        )

        surface, region_id = resolve_surface(Vec2(5, 5), regions)

        self.assertEqual(surface, SurfaceType.BUNKER)
        self.assertEqual(region_id, "bunker-1")

    def test_surface_resolution_has_default(self) -> None:
        surface, region_id = resolve_surface(Vec2(20, 20), ())

        self.assertEqual(surface, SurfaceType.ROUGH)
        self.assertIsNone(region_id)


if __name__ == "__main__":
    unittest.main()
