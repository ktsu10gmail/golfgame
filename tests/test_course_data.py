import json
import math
from pathlib import Path
import unittest

from packages.golf_domain import Vec2, point_in_polygon


ROOT = Path(__file__).parents[1]
CALIBRATED_TURNS = {
    1: 1,
    2: -1,
    5: -1,
    8: 1,
    15: 1,
    17: 1,
    18: -1,
}


def polygon_center(polygon: list[list[float]]) -> tuple[float, float]:
    points = polygon[:-1] if polygon[0] == polygon[-1] else polygon
    return (
        sum(point[0] for point in points) / len(points),
        sum(point[1] for point in points) / len(points),
    )


class CourseAssetTests(unittest.TestCase):
    def test_each_course_is_self_contained(self) -> None:
        for course_id in ("themeadow", "warrenbrook", "cranbury", "gallopinghills"):
            course = ROOT / "data" / course_id
            self.assertTrue((course / "scorecard.csv").is_file())
            for hole_number in range(1, 19):
                self.assertTrue((course / f"hole{hole_number}.json").is_file())
                self.assertTrue((course / "images" / f"hole{hole_number}.png").is_file())


class GallopingHillGeometryTests(unittest.TestCase):
    def hole(self, hole_number: int) -> dict:
        path = ROOT / "data" / "gallopinghills" / f"hole{hole_number}.json"
        return json.loads(path.read_text(encoding="utf-8"))

    def test_routes_match_declared_white_distance_and_mens_par(self) -> None:
        rows = {
            int(values[0]): tuple(map(int, values[1:6]))
            for values in (
                line.split(",")
                for line in (ROOT / "data" / "gallopinghills" / "scorecard.csv").read_text().splitlines()[1:]
            )
            if values[0].isdigit()
        }
        self.assertEqual(sum(values[0] for values in rows.values()), 71)
        for hole_number, (_, _, _, white, _) in rows.items():
            with self.subTest(hole=hole_number):
                hole = self.hole(hole_number)
                route = [item["point"] for item in hole["centerline_waypoints"]]
                route_meters = sum(math.dist(start, end) for start, end in zip(route, route[1:]))
                self.assertAlmostEqual(route_meters * 1.09361, white, places=1)
                self.assertEqual(
                    hole["hole_metadata"]["geometry_calibration"]["version"],
                    "gallopinghills-aerial-review-v1",
                )

    def test_reviewed_right_turns_follow_the_aerials(self) -> None:
        for hole_number in (1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13, 14, 16, 17, 18):
            with self.subTest(hole=hole_number):
                finish = self.hole(hole_number)["centerline_waypoints"][-1]["point"]
                self.assertGreater(finish[0], 0)

    def test_hazard_names_are_golfer_relative(self) -> None:
        for hole_number in range(1, 19):
            route = [item["point"] for item in self.hole(hole_number)["centerline_waypoints"]]
            for hazard in self.hole(hole_number)["geometries"]["hazards"]:
                expected = 1 if "_right_" in hazard["id"] else -1 if "_left_" in hazard["id"] else 0
                if not expected:
                    continue
                center = polygon_center(hazard["polygon"])
                candidates = []
                for start, end in zip(route, route[1:]):
                    dx, dy = end[0] - start[0], end[1] - start[1]
                    length_squared = dx * dx + dy * dy
                    ratio = max(
                        0,
                        min(
                            1,
                            ((center[0] - start[0]) * dx + (center[1] - start[1]) * dy)
                            / length_squared,
                        ),
                    )
                    projection = (start[0] + dx * ratio, start[1] + dy * ratio)
                    candidates.append((math.dist(center, projection), dx, dy, projection))
                _, dx, dy, projection = min(candidates)
                lateral = (center[0] - projection[0]) * dy - (center[1] - projection[1]) * dx
                self.assertEqual(1 if lateral > 0 else -1, expected, hazard["id"])

    def test_blue_white_and_gold_starts_are_inside_tee_surfaces(self) -> None:
        rows = {
            int(values[0]): tuple(map(int, values[3:6]))
            for values in (
                line.split(",")
                for line in (ROOT / "data" / "gallopinghills" / "scorecard.csv").read_text().splitlines()[1:]
            )
            if values[0].isdigit()
        }
        for hole_number, (blue, white, gold) in rows.items():
            with self.subTest(hole=hole_number):
                hole = self.hole(hole_number)
                route = [item["point"] for item in hole["centerline_waypoints"]]
                dx, dy = route[1][0] - route[0][0], route[1][1] - route[0][1]
                length = math.hypot(dx, dy)
                forward = (dx / length, dy / length)
                starts = [
                    (route[0][0] - forward[0] * (blue - white) / 1.09361, route[0][1] - forward[1] * (blue - white) / 1.09361),
                    tuple(route[0]),
                    (route[0][0] + forward[0] * (white - gold) / 1.09361, route[0][1] + forward[1] * (white - gold) / 1.09361),
                ]
                tees = hole["geometries"]["tee_boxes"]
                for start in starts:
                    self.assertTrue(
                        any(
                            point_in_polygon(
                                Vec2(*start),
                                tuple(Vec2(*point) for point in tee["polygon"]),
                            )
                            for tee in tees
                        )
                    )

    def test_water_is_left_on_holes_3_12_and_18(self) -> None:
        for hole_number in (3, 12, 18):
            with self.subTest(hole=hole_number):
                water = [
                    hazard
                    for hazard in self.hole(hole_number)["geometries"]["hazards"]
                    if hazard["lie_catalog_id"] == "lie_hazard_water"
                ]
                self.assertEqual(len(water), 1)
                self.assertIn("_left_", water[0]["id"])


class MeadowGeometryTests(unittest.TestCase):
    def hole(self, hole_number: int) -> dict:
        path = ROOT / "data" / "themeadow" / f"hole{hole_number}.json"
        return json.loads(path.read_text(encoding="utf-8"))

    def test_routes_match_declared_white_distance(self) -> None:
        scorecard = {
            int(values[0]): int(values[4])
            for values in (
                line.split(",")
                for line in (ROOT / "data" / "themeadow" / "scorecard.csv").read_text().splitlines()[1:]
            )
            if values[0].isdigit()
        }
        for hole_number in range(1, 19):
            with self.subTest(hole=hole_number):
                hole = self.hole(hole_number)
                route = [item["point"] for item in hole["centerline_waypoints"]]
                route_meters = sum(math.dist(start, end) for start, end in zip(route, route[1:]))
                self.assertAlmostEqual(route_meters * 1.09361, scorecard[hole_number], places=1)
                self.assertEqual(hole["hole_metadata"]["geometry_calibration"]["version"], "themeadow-aerial-review-v2")

    def test_reviewed_dogleg_directions_match_the_aerials(self) -> None:
        for hole_number in (1, 3, 4, 13, 16, 18):
            with self.subTest(hole=hole_number, direction="right"):
                finish = self.hole(hole_number)["centerline_waypoints"][-1]["point"]
                self.assertGreater(finish[0], 0)
        for hole_number in (5, 7, 9, 12):
            with self.subTest(hole=hole_number, direction="left"):
                finish = self.hole(hole_number)["centerline_waypoints"][-1]["point"]
                self.assertLess(finish[0], 0)

    def test_water_sides_match_the_aerials(self) -> None:
        expected = {2: "left", 10: "right", 11: "right", 17: "left"}
        for hole_number, side in expected.items():
            with self.subTest(hole=hole_number):
                water = [
                    hazard for hazard in self.hole(hole_number)["geometries"]["hazards"]
                    if hazard["lie_catalog_id"] == "lie_hazard_water"
                ]
                self.assertEqual(len(water), 1)
                self.assertIn(f"_{side}_", water[0]["id"])

    def test_blue_white_and_red_starts_are_inside_tee_surfaces(self) -> None:
        rows = {
            int(values[0]): tuple(map(int, values[3:6]))
            for values in (
                line.split(",")
                for line in (ROOT / "data" / "themeadow" / "scorecard.csv").read_text().splitlines()[1:]
            )
            if values[0].isdigit()
        }
        for hole_number in range(1, 19):
            with self.subTest(hole=hole_number):
                hole = self.hole(hole_number)
                route = [item["point"] for item in hole["centerline_waypoints"]]
                dx, dy = route[1][0] - route[0][0], route[1][1] - route[0][1]
                length = math.hypot(dx, dy)
                forward = (dx / length, dy / length)
                blue, white, red = rows[hole_number]
                starts = [
                    (route[0][0] - forward[0] * (blue - white) / 1.09361, route[0][1] - forward[1] * (blue - white) / 1.09361),
                    tuple(route[0]),
                    (route[0][0] + forward[0] * (white - red) / 1.09361, route[0][1] + forward[1] * (white - red) / 1.09361),
                ]
                polygons = hole["geometries"]["tee_boxes"]
                for start in starts:
                    self.assertTrue(any(point_in_polygon(Vec2(*start), tuple(Vec2(*point) for point in tee["polygon"])) for tee in polygons))


class CranburyGeometryTests(unittest.TestCase):
    def hole(self, hole_number: int) -> dict:
        path = ROOT / "data" / "cranbury" / f"hole{hole_number}.json"
        return json.loads(path.read_text(encoding="utf-8"))

    def test_user_confirmed_left_doglegs_bend_left(self) -> None:
        for hole_number in (5, 6, 9, 17, 18):
            with self.subTest(hole=hole_number):
                route = [item["point"] for item in self.hole(hole_number)["centerline_waypoints"]]
                self.assertLess(route[-1][0], 0)
        hole_18 = self.hole(18)
        finish = hole_18["centerline_waypoints"][-1]["point"]
        self.assertLess(abs(finish[0]), hole_18["hole_metadata"]["total_distance_meters"] * .05)
        self.assertIn("Mostly Straight", hole_18["hole_metadata"]["layout_type"])

    def test_routes_match_declared_white_distance(self) -> None:
        scorecard = {
            int(line.split(",")[0]): int(line.split(",")[4])
            for line in (ROOT / "data" / "cranbury" / "scorecard.csv").read_text().splitlines()[1:]
        }
        for hole_number in range(1, 19):
            with self.subTest(hole=hole_number):
                hole = self.hole(hole_number)
                route = [item["point"] for item in hole["centerline_waypoints"]]
                route_meters = sum(math.dist(start, end) for start, end in zip(route, route[1:]))
                self.assertAlmostEqual(route_meters, hole["hole_metadata"]["total_distance_meters"], places=2)
                self.assertAlmostEqual(route_meters * 1.09361, scorecard[hole_number], places=1)

    def test_hazard_names_match_golfer_relative_side(self) -> None:
        for hole_number in range(1, 19):
            hole = self.hole(hole_number)
            route = [item["point"] for item in hole["centerline_waypoints"]]
            for hazard in hole["geometries"]["hazards"]:
                expected = "right" if "_right_" in hazard["id"] else "left" if "_left_" in hazard["id"] else None
                if expected is None:
                    continue
                center = polygon_center(hazard["polygon"])
                best = None
                for start, end in zip(route, route[1:]):
                    dx, dy = end[0] - start[0], end[1] - start[1]
                    length_squared = dx * dx + dy * dy
                    projection = max(0, min(1, ((center[0] - start[0]) * dx + (center[1] - start[1]) * dy) / length_squared))
                    nearest = (start[0] + dx * projection, start[1] + dy * projection)
                    separation = math.dist(center, nearest)
                    if best is None or separation < best[0]:
                        right = (dy / math.sqrt(length_squared), -dx / math.sqrt(length_squared))
                        lateral = (center[0] - nearest[0]) * right[0] + (center[1] - nearest[1]) * right[1]
                        best = (separation, lateral)
                self.assertIsNotNone(best)
                if expected == "right":
                    self.assertGreater(best[1], 0, f"hole {hole_number} {hazard['id']}")
                else:
                    self.assertLess(best[1], 0, f"hole {hole_number} {hazard['id']}")

    def test_blue_white_and_gold_starts_are_inside_tee_surfaces(self) -> None:
        rows = {
            int(values[0]): tuple(map(int, values[3:6]))
            for values in (
                line.split(",")
                for line in (ROOT / "data" / "cranbury" / "scorecard.csv").read_text().splitlines()[1:]
            )
        }
        for hole_number in range(1, 19):
            with self.subTest(hole=hole_number):
                hole = self.hole(hole_number)
                route = [item["point"] for item in hole["centerline_waypoints"]]
                dx, dy = route[1][0] - route[0][0], route[1][1] - route[0][1]
                length = math.hypot(dx, dy)
                forward = (dx / length, dy / length)
                blue, white, gold = rows[hole_number]
                starts = [
                    (route[0][0] - forward[0] * (blue - white) / 1.09361, route[0][1] - forward[1] * (blue - white) / 1.09361),
                    tuple(route[0]),
                    (route[0][0] + forward[0] * (white - gold) / 1.09361, route[0][1] + forward[1] * (white - gold) / 1.09361),
                ]
                polygons = hole["geometries"]["tee_boxes"]
                for start in starts:
                    self.assertTrue(any(point_in_polygon(Vec2(*start), tuple(Vec2(*point) for point in tee["polygon"])) for tee in polygons))

    def test_hole_10_has_two_right_fairway_and_three_greenside_bunkers(self) -> None:
        hazards = self.hole(10)["geometries"]["hazards"]
        fairway_bunkers = [hazard for hazard in hazards if "_fairway_" in hazard["id"]]
        greenside_bunkers = [hazard for hazard in hazards if "_greenside_" in hazard["id"]]

        self.assertEqual(len(fairway_bunkers), 2)
        self.assertTrue(all("_right_" in hazard["id"] for hazard in fairway_bunkers))
        self.assertEqual(len(greenside_bunkers), 3)

    def test_hole_12_has_no_water(self) -> None:
        hazards = self.hole(12)["geometries"]["hazards"]
        water = [hazard for hazard in hazards if hazard["lie_catalog_id"] == "lie_hazard_water"]
        self.assertEqual(water, [])

    def test_hole_16_has_two_left_and_one_right_greenside_bunkers(self) -> None:
        bunkers = self.hole(16)["geometries"]["hazards"]
        self.assertEqual(len(bunkers), 3)
        self.assertTrue(all("_greenside_" in bunker["id"] for bunker in bunkers))
        self.assertEqual(sum("_left_" in bunker["id"] for bunker in bunkers), 2)
        self.assertEqual(sum("_right_" in bunker["id"] for bunker in bunkers), 1)

    def test_hole_17_has_two_left_greenside_bunkers(self) -> None:
        bunkers = self.hole(17)["geometries"]["hazards"]
        greenside = [bunker for bunker in bunkers if "_greenside_" in bunker["id"]]
        self.assertEqual(len(greenside), 2)
        self.assertTrue(all("_left_" in bunker["id"] for bunker in greenside))

    def test_hole_18_has_one_greenside_bunker_on_each_side(self) -> None:
        bunkers = self.hole(18)["geometries"]["hazards"]
        greenside = [bunker for bunker in bunkers if "_greenside_" in bunker["id"]]
        self.assertEqual(len(greenside), 2)
        self.assertEqual(sum("_left_" in bunker["id"] for bunker in greenside), 1)
        self.assertEqual(sum("_right_" in bunker["id"] for bunker in greenside), 1)


class WarrenbrookGeometryTests(unittest.TestCase):
    def hole(self, hole_number: int) -> dict:
        path = ROOT / "data" / "warrenbrook" / f"hole{hole_number}.json"
        return json.loads(path.read_text(encoding="utf-8"))

    def hazards(self, hole_number: int, kind: str = "bunker") -> list[dict]:
        lie = "lie_hazard_sand" if kind == "bunker" else "lie_hazard_water"
        return [
            hazard for hazard in self.hole(hole_number)["geometries"]["hazards"]
            if hazard["lie_catalog_id"] == lie
        ]

    def test_routes_match_scorecard_and_reviewed_directions(self) -> None:
        scorecard = {
            int(values[0]): int(values[4])
            for values in (
                line.split(",")
                for line in (ROOT / "data" / "warrenbrook" / "scorecard.csv").read_text().splitlines()[1:]
            )
            if values[0].isdigit()
        }
        for hole_number in range(1, 19):
            with self.subTest(hole=hole_number):
                hole = self.hole(hole_number)
                route = [item["point"] for item in hole["centerline_waypoints"]]
                route_meters = sum(math.dist(start, end) for start, end in zip(route, route[1:]))
                self.assertAlmostEqual(route_meters * 1.09361, scorecard[hole_number], places=1)
                self.assertEqual(
                    hole["hole_metadata"]["geometry_calibration"]["version"],
                    "warrenbrook-aerial-review-v2",
                )
                if hole_number in CALIBRATED_TURNS:
                    sign = 1 if route[-1][0] > 0 else -1
                    self.assertEqual(sign, CALIBRATED_TURNS[hole_number])

    def test_hazard_names_match_golfer_relative_positions(self) -> None:
        for hole_number in range(1, 19):
            route = [item["point"] for item in self.hole(hole_number)["centerline_waypoints"]]
            for hazard in self.hole(hole_number)["geometries"]["hazards"]:
                expected = 1 if "_right_" in hazard["id"] else -1 if "_left_" in hazard["id"] else 0
                if not expected:
                    continue
                center = polygon_center(hazard["polygon"])
                candidates = []
                for start, end in zip(route, route[1:]):
                    dx, dy = end[0] - start[0], end[1] - start[1]
                    length_squared = dx * dx + dy * dy
                    ratio = max(0, min(1, ((center[0] - start[0]) * dx + (center[1] - start[1]) * dy) / length_squared))
                    projection = (start[0] + dx * ratio, start[1] + dy * ratio)
                    candidates.append((math.dist(center, projection), dx, dy, projection))
                _, dx, dy, projection = min(candidates)
                lateral = (center[0] - projection[0]) * dy - (center[1] - projection[1]) * dx
                self.assertEqual(1 if lateral > 0 else -1, expected, hazard["id"])

    def test_blue_white_and_red_starts_are_inside_tee_surfaces(self) -> None:
        rows = {
            int(values[0]): tuple(map(int, values[3:6]))
            for values in (
                line.split(",")
                for line in (ROOT / "data" / "warrenbrook" / "scorecard.csv").read_text().splitlines()[1:]
            )
            if values[0].isdigit()
        }
        for hole_number in range(1, 19):
            hole = self.hole(hole_number)
            route = [item["point"] for item in hole["centerline_waypoints"]]
            dx, dy = route[1][0] - route[0][0], route[1][1] - route[0][1]
            length = math.hypot(dx, dy)
            forward = (dx / length, dy / length)
            blue, white, red = rows[hole_number]
            starts = [
                (route[0][0] - forward[0] * (blue - white) / 1.09361, route[0][1] - forward[1] * (blue - white) / 1.09361),
                tuple(route[0]),
                (route[0][0] + forward[0] * (white - red) / 1.09361, route[0][1] + forward[1] * (white - red) / 1.09361),
            ]
            tees = hole["geometries"]["tee_boxes"]
            for start in starts:
                self.assertTrue(any(point_in_polygon(Vec2(*start), tuple(Vec2(*point) for point in tee["polygon"])) for tee in tees))

    def test_user_confirmed_bunker_counts_and_sides(self) -> None:
        self.assertEqual(len(self.hazards(1)), 1)
        self.assertNotIn("greenside", self.hazards(1)[0]["id"])
        expected = {
            3: (1, "left"), 4: (1, "right"), 7: (1, "right"),
            10: (1, "right"), 13: (1, "right"), 14: (1, "right"),
        }
        for hole_number, (count, side) in expected.items():
            matching = [hazard for hazard in self.hazards(hole_number) if f"_{side}_" in hazard["id"]]
            self.assertGreaterEqual(len(matching), count)
        hole_8 = self.hazards(8)
        self.assertEqual(sum("_fairway_right_" in h["id"] for h in hole_8), 1)
        self.assertEqual(sum("_greenside_right_" in h["id"] for h in hole_8), 2)
        hole_15 = self.hazards(15)
        self.assertEqual(len(hole_15), 3)
        self.assertTrue(all("_fairway_right_" in h["id"] for h in hole_15))
        hole_17 = self.hazards(17)
        self.assertEqual(len(hole_17), 1)
        self.assertIn("_fairway_left_", hole_17[0]["id"])
        hole_18 = self.hazards(18)
        self.assertEqual(sum("_greenside_right_" in h["id"] for h in hole_18), 2)

    def test_confirmed_water_positions(self) -> None:
        self.assertIn("_right_", self.hazards(6, "water")[0]["id"])
        self.assertIn("_right_", self.hazards(17, "water")[0]["id"])
        self.assertIn("_crossing_", self.hazards(18, "water")[0]["id"])


if __name__ == "__main__":
    unittest.main()
