#!/usr/bin/env python3
"""Generate testing-quality Cranbury Golf Club geometry from the reviewed imagery.

Coordinates are meters. Positive lateral offsets are golfer-right while looking
from the tee toward the next centerline waypoint. The supplied aerial images are
the visual source; user-confirmed dogleg directions override screen orientation.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
COURSE_DIR = ROOT / "data" / "cranbury"
YARDS_PER_METER = 1.09361

SCORECARD = {
    1: (4, 12, 345, 328, 315), 2: (3, 14, 172, 159, 144),
    3: (4, 6, 366, 350, 289), 4: (3, 8, 227, 187, 163),
    5: (4, 18, 350, 326, 313), 6: (5, 2, 478, 468, 390),
    7: (3, 16, 174, 159, 134), 8: (4, 10, 345, 333, 259),
    9: (5, 4, 503, 493, 385), 10: (5, 11, 498, 485, 451),
    11: (4, 13, 320, 301, 290), 12: (3, 15, 144, 130, 106),
    13: (5, 3, 486, 454, 283), 14: (3, 5, 198, 190, 122),
    15: (5, 7, 513, 465, 440), 16: (3, 17, 153, 137, 117),
    17: (4, 1, 397, 377, 365), 18: (4, 9, 388, 365, 309),
}

# Normalized route controls: (golfer-lateral meters, fraction of nominal length).
# Left doglegs use negative late-route offsets.
ROUTES: dict[int, tuple[str, list[tuple[float, float]]]] = {
    1: ("Gentle Dogleg Right", [(0, 0), (-2, .42), (15, .72), (27, 1)]),
    2: ("Straight Par 3", [(0, 0), (1, .52), (0, 1)]),
    3: ("Straight / Water Left", [(0, 0), (-2, .48), (2, .78), (0, 1)]),
    4: ("Straight Par 3 / Water Short Left", [(0, 0), (2, .52), (0, 1)]),
    5: ("Dogleg Left", [(0, 0), (5, .42), (-20, .70), (-46, 1)]),
    6: ("Dogleg Left", [(0, 0), (7, .42), (-24, .72), (-54, 1)]),
    7: ("Straight Par 3", [(0, 0), (1, .50), (0, 1)]),
    8: ("Gentle Dogleg Right", [(0, 0), (-3, .42), (18, .72), (30, 1)]),
    9: ("Dogleg Left", [(0, 0), (10, .43), (-28, .72), (-62, 1)]),
    10: ("Dogleg Right", [(0, 0), (-5, .38), (25, .66), (58, 1)]),
    11: ("Mostly Straight", [(0, 0), (-2, .45), (4, .76), (6, 1)]),
    12: ("Straight Par 3", [(0, 0), (1, .52), (0, 1)]),
    13: ("Mostly Straight / Water Left of Green", [(0, 0), (3, .42), (8, .74), (10, 1)]),
    14: ("Straight Par 3 / Forced Water Carry", [(0, 0), (1, .52), (0, 1)]),
    15: ("Double Bend Right then Left", [(0, 0), (25, .35), (45, .58), (18, .80), (-8, 1)]),
    16: ("Straight Par 3", [(0, 0), (0, .5), (0, 1)]),
    17: ("Dogleg Left / Road Boundary Left", [(0, 0), (8, .42), (-22, .72), (-50, 1)]),
    18: ("Mostly Straight / Slight Dogleg Left", [(0, 0), (2, .45), (-7, .74), (-16, 1)]),
}

# type, route fraction, signed golfer-relative lateral offset, length, width
FEATURES: dict[int, list[tuple[str, float, float, float, float]]] = {
    1: [("bunker", .38, -17, 14, 7), ("bunker", .43, 18, 15, 7), ("bunker", .93, 14, 13, 7)],
    2: [("bunker", .91, -12, 12, 6), ("bunker", .92, 13, 11, 6)],
    3: [("water", .67, -28, 34, 22), ("bunker", .91, -13, 11, 6), ("bunker", .92, 13, 11, 6)],
    4: [("water", .47, -23, 40, 27), ("bunker", .92, 13, 12, 7)],
    5: [("water", .46, -30, 42, 26), ("bunker", .62, 19, 18, 8), ("bunker", .93, 14, 13, 7)],
    6: [("bunker", .46, 19, 16, 8), ("bunker", .67, -18, 15, 7), ("bunker", .93, 13, 12, 7)],
    7: [("bunker", .91, -12, 11, 6), ("bunker", .92, 13, 11, 6)],
    8: [("bunker", .54, -18, 16, 8), ("bunker", .92, 14, 14, 7), ("bunker", .985, -14, 13, 7)],
    9: [("bunker", .46, 20, 17, 8), ("bunker", .62, -19, 16, 8), ("water", .86, 28, 30, 22), ("bunker", .93, -13, 12, 7), ("bunker", .94, 14, 12, 7)],
    10: [
        ("bunker", .42, 20, 17, 8),
        ("bunker", .56, 19, 16, 8),
        ("bunker", .93, 14, 12, 7),
        ("bunker", .965, -14, 12, 7),
        ("bunker", .99, -23, 12, 7),
    ],
    11: [("bunker", .50, -18, 17, 8), ("bunker", .93, 14, 12, 7)],
    12: [],
    13: [("bunker", .38, 19, 16, 8), ("water", .86, -28, 34, 22), ("bunker", .93, -13, 12, 7), ("bunker", .94, 14, 12, 7)],
    14: [("water", .52, 0, 52, 48)],
    15: [("bunker", .35, -20, 16, 8), ("bunker", .40, 21, 17, 8), ("bunker", .53, 20, 17, 8), ("bunker", .64, -19, 16, 8), ("bunker", .74, 18, 15, 7), ("bunker", .93, -13, 12, 7)],
    16: [("bunker", .90, -13, 13, 7), ("bunker", .985, -15, 12, 7), ("bunker", .92, 14, 12, 7)],
    17: [("bunker", .60, 19, 18, 8), ("bunker", .91, -13, 12, 7), ("bunker", .98, -20, 12, 7)],
    18: [("bunker", .46, -18, 17, 8), ("bunker", .63, 19, 17, 8), ("bunker", .93, 14, 13, 7), ("bunker", .98, -15, 13, 7)],
}

OUT_OF_BOUNDS = {1: "left", 3: "left", 5: "left", 9: "right", 10: "left", 13: "left", 17: "left", 18: "right"}
NET_ELEVATION_METERS = {
    1: .6, 2: -1.2, 3: -.6, 4: 0, 5: .3, 6: 0, 7: .3, 8: .9, 9: -2.7,
    10: 1.8, 11: -.9, 12: -2.1, 13: .9, 14: 1.2, 15: .9, 16: .6, 17: 3.0, 18: 1.2,
}

Point = tuple[float, float]


def distance(first: Point, second: Point) -> float:
    return math.hypot(second[0] - first[0], second[1] - first[1])


def scaled_route(hole_number: int) -> list[Point]:
    white_yards = SCORECARD[hole_number][3]
    nominal = white_yards / YARDS_PER_METER
    controls = ROUTES[hole_number][1]
    raw = [(x, fraction * nominal) for x, fraction in controls]
    raw_length = sum(distance(start, end) for start, end in zip(raw, raw[1:]))
    scale = nominal / raw_length
    return [(round(x * scale, 3), round(y * scale, 3)) for x, y in raw]


def route_lengths(route: list[Point]) -> tuple[list[float], float]:
    lengths = [distance(start, end) for start, end in zip(route, route[1:])]
    return lengths, sum(lengths)


def point_on_route(route: list[Point], fraction: float) -> tuple[Point, Point, Point]:
    lengths, total = route_lengths(route)
    remaining = total * fraction
    for index, length in enumerate(lengths):
        if remaining <= length or index == len(lengths) - 1:
            start, end = route[index], route[index + 1]
            ratio = min(1.0, remaining / length)
            forward = ((end[0] - start[0]) / length, (end[1] - start[1]) / length)
            right = (forward[1], -forward[0])
            return (
                (start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio),
                forward,
                right,
            )
        remaining -= length
    raise RuntimeError("route has no usable segment")


def offset(point: Point, right: Point, amount: float) -> Point:
    return point[0] + right[0] * amount, point[1] + right[1] * amount


def rounded(points: list[Point]) -> list[list[float]]:
    return [[round(x, 3), round(y, 3)] for x, y in points]


def ellipse(center: Point, forward: Point, right: Point, length: float, width: float, count: int = 12) -> list[list[float]]:
    points: list[Point] = []
    for index in range(count):
        angle = 2 * math.pi * index / count
        along = math.cos(angle) * length / 2
        lateral = math.sin(angle) * width / 2
        points.append((center[0] + forward[0] * along + right[0] * lateral, center[1] + forward[1] * along + right[1] * lateral))
    return rounded(points)


def corridor(route: list[Point], half_width: float) -> list[list[float]]:
    left: list[Point] = []
    right_side: list[Point] = []
    for index, point in enumerate(route):
        if index == len(route) - 1:
            prior = route[index - 1]
            dx, dy = point[0] - prior[0], point[1] - prior[1]
        else:
            following = route[index + 1]
            dx, dy = following[0] - point[0], following[1] - point[1]
        length = math.hypot(dx, dy)
        right = (dy / length, -dx / length)
        left.append(offset(point, right, -half_width))
        right_side.append(offset(point, right, half_width))
    return rounded(left + list(reversed(right_side)))


def fairway_segments(route: list[Point], par: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    start_fraction = .12 if par == 3 else .10
    controls = [start_fraction, .50, .84] if par != 3 else [.18, .78]
    pairs = list(zip(controls, controls[1:]))
    for index, (start_fraction, end_fraction) in enumerate(pairs, 1):
        start, start_forward, start_right = point_on_route(route, start_fraction)
        end, end_forward, end_right = point_on_route(route, end_fraction)
        half_start = 14 if par == 3 else 18
        half_end = 15 if par == 3 else 20
        polygon = rounded([
            offset(start, start_right, -half_start), offset(start, start_right, half_start),
            offset(end, end_right, half_end), offset(end, end_right, -half_end),
        ])
        items.append({
            "segment_id": f"fairway_h{route_hole}_segment_{index}",
            "lie_catalog_id": "lie_fairway", "polygon": polygon,
            "description": f"Playable fairway corridor segment {index} following the reviewed centerline.",
        })
    return items


route_hole = 0


def build_hole(hole_number: int) -> dict[str, Any]:
    global route_hole
    route_hole = hole_number
    par, handicap, blue, white, gold = SCORECARD[hole_number]
    layout, _ = ROUTES[hole_number]
    route = scaled_route(hole_number)
    total_meters = sum(distance(start, end) for start, end in zip(route, route[1:]))
    start, first_forward, first_right = point_on_route(route, 0)
    finish, final_forward, final_right = point_on_route(route, 1)

    hazards: list[dict[str, Any]] = []
    counters = {"bunker": 0, "water": 0}
    for kind, fraction, lateral, length, width in FEATURES.get(hole_number, []):
        counters[kind] += 1
        center, forward, right = point_on_route(route, fraction)
        center = offset(center, right, lateral)
        side = "right" if lateral > 0 else "left" if lateral < 0 else "crossing"
        near_green = fraction >= .88
        identifier = (
            f"bunker_h{hole_number}_{'greenside' if near_green else 'fairway'}_{side}_{counters[kind]}"
            if kind == "bunker" else f"water_h{hole_number}_{side}_{counters[kind]}"
        )
        hazards.append({
            "id": identifier,
            "lie_catalog_id": "lie_hazard_sand" if kind == "bunker" else "lie_hazard_water",
            "polygon": ellipse(center, forward, right, length, width),
            "description": (
                f"{'Greenside' if near_green else 'Fairway'} bunker on the golfer-{side} side."
                if kind == "bunker" else
                f"Water or wetland hazard on the golfer-{side} portion of the hole."
            ),
        })

    green_polygon = ellipse(finish, final_forward, final_right, 25, 20)
    def tee_polygon(center: Point) -> list[list[float]]:
        return rounded([
            offset((center[0] - first_forward[0] * 5, center[1] - first_forward[1] * 5), first_right, -4),
            offset((center[0] - first_forward[0] * 5, center[1] - first_forward[1] * 5), first_right, 4),
            offset((center[0] + first_forward[0] * 8, center[1] + first_forward[1] * 8), first_right, 4),
            offset((center[0] + first_forward[0] * 8, center[1] + first_forward[1] * 8), first_right, -4),
        ])

    blue_center = (start[0] - first_forward[0] * (blue - white) / YARDS_PER_METER, start[1] - first_forward[1] * (blue - white) / YARDS_PER_METER)
    gold_center = (start[0] + first_forward[0] * (white - gold) / YARDS_PER_METER, start[1] + first_forward[1] * (white - gold) / YARDS_PER_METER)

    out_of_bounds: list[dict[str, Any]] = []
    boundary_side = OUT_OF_BOUNDS.get(hole_number)
    if boundary_side:
        sign = -1 if boundary_side == "left" else 1
        boundary_route = []
        for fraction in (.12, .42, .72, .96):
            center, _, right = point_on_route(route, fraction)
            boundary_route.append(offset(center, right, sign * 43))
        polygon = corridor(boundary_route, 11)
        out_of_bounds.append({
            "id": f"ob_h{hole_number}_{boundary_side}", "lie_catalog_id": "lie_ob_hazard",
            "polygon": polygon,
            "description": f"Course boundary on the golfer-{boundary_side} side.",
        })

    net_elevation = NET_ELEVATION_METERS[hole_number]
    rough_start, _, _ = point_on_route(route, .06)
    rough_route = [rough_start, *route[1:]]
    return {
        "hole_metadata": {
            "course_name": "Cranbury Golf Club", "hole_number": hole_number,
            "par": par, "handicap_rating": handicap,
            "total_distance_meters": round(total_meters, 3), "layout_type": layout,
            "coordinate_system": {
                "origin": "White tee center (0, 0)", "unit": "meters",
                "axes": {"y": "Forward progress", "x": "Golfer-relative lateral displacement"},
            },
            "geometry_calibration": {
                "version": "cranbury-aerial-review-v1", "source_image": f"images/hole{hole_number}.png",
                "method": "reviewed schematic centerline with golfer-relative feature placement",
            },
        },
        "centerline_waypoints": [
            {"index": index, "point": [x, y], "description": "Tee center" if index == 0 else "Green center" if index == len(route) - 1 else f"Route control {index}"}
            for index, (x, y) in enumerate(route)
        ],
        "geometries": {
            "tee_boxes": [
                {"id": f"tee_blue_h{hole_number}", "lie_catalog_id": "lie_tee", "elevation_m": 0, "polygon": tee_polygon(blue_center)},
                {"id": f"tee_white_h{hole_number}", "lie_catalog_id": "lie_tee", "elevation_m": 0, "polygon": tee_polygon(start)},
                {"id": f"tee_gold_h{hole_number}", "lie_catalog_id": "lie_tee", "elevation_m": 0, "polygon": tee_polygon(gold_center)},
            ],
            "fairway_segments": fairway_segments(route, par),
            "rough_zones": [{
                "id": f"rough_primary_h{hole_number}", "lie_catalog_id": "lie_rough_medium",
                "polygon": corridor(rough_route, 38 if par != 3 else 31),
                "description": "Primary rough corridor around the reviewed playing route.",
            }],
            "hazards": hazards,
            "green_complex": {
                "id": f"green_primary_h{hole_number}", "lie_catalog_id": "lie_green", "polygon": green_polygon,
                "pin_zones": [
                    {"zone_id": "front", "center_point": rounded([(finish[0] - final_forward[0] * 5, finish[1] - final_forward[1] * 5)])[0], "radius_meters": 2.5},
                    {"zone_id": "back", "center_point": rounded([(finish[0] + final_forward[0] * 5, finish[1] + final_forward[1] * 5)])[0], "radius_meters": 2.5},
                    {"zone_id": "center_standard", "center_point": [round(finish[0], 3), round(finish[1], 3)], "radius_meters": 3},
                ],
            },
            "out_of_bounds": out_of_bounds,
        },
        "elevation_profile": {
            "sampling_interval_meters": round(total_meters / 4, 2),
            "points": [
                {"y": round(total_meters * fraction, 3), "elevation_m": round(net_elevation * fraction, 3)}
                for fraction in (0, .25, .5, .75, 1)
            ],
            "description": "Approximate net elevation transcribed from the supplied GPS image.",
        },
    }


def main() -> None:
    COURSE_DIR.mkdir(parents=True, exist_ok=True)
    for hole_number in range(1, 19):
        payload = build_hole(hole_number)
        path = COURSE_DIR / f"hole{hole_number}.json"
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"Generated Cranbury hole {hole_number}: {ROUTES[hole_number][0]}")


if __name__ == "__main__":
    main()
