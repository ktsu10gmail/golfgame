#!/usr/bin/env python3
"""Calibrate selected Warrenbrook hole geometry to the annotated aerial routes.

The supplied JSON was built independently from the aerial measurement images.
For holes whose turn direction disagreed with the image, this script bends the
old geometry onto a photograph-derived centerline while preserving each point's
signed offset from the original centerline.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
COURSE_DIR = ROOT / "data" / "warrenbrook"
CALIBRATION_VERSION = "aerial-route-v1"


# Pixel centers of the white measurement-route markers, ordered tee to green.
# These anchors are read from the corresponding images/holeN.png files.
CALIBRATIONS: dict[int, dict[str, Any]] = {
    1: {
        "layout": "Straight to Slight Right Green",
        "pixels": [(71, 40), (270, 447), (361, 727)],
    },
    2: {
        "layout": "Dogleg Left",
        "pixels": [(107, 458), (510, 236), (738, 39)],
    },
    5: {
        "layout": "Double Dogleg Left / Sharp Left Green Finish",
        "pixels": [(117, 780), (329, 486), (471, 205), (390, 51)],
    },
    8: {
        "layout": "Dogleg Right / Boundary Restrained",
        "pixels": [(319, 25), (343, 385), (200, 594), (90, 682)],
        "right_side_features": {
            "bunker_h8_corner_inside_guard": "bunker_h8_mid_right_fairway"
        },
    },
    15: {
        "layout": "Double Dogleg Right / Heavily Wooded Boundaries",
        "pixels": [(949, 16), (705, 403), (345, 540), (132, 515)],
    },
    17: {
        "layout": "Dogleg Right / Water Hazard Intersecting",
        "pixels": [(715, 443), (290, 279), (57, 35)],
    },
    18: {
        "layout": "Dogleg Left / Water Hazard Crossing / Protected Green",
        "pixels": [(60, 61), (410, 359), (516, 408), (610, 424)],
    },
}


Point = tuple[float, float]


def distance(first: Point, second: Point) -> float:
    return math.hypot(second[0] - first[0], second[1] - first[1])


def segment_lengths(points: list[Point]) -> list[float]:
    return [distance(start, end) for start, end in zip(points, points[1:])]


def point_at_distance(points: list[Point], along: float) -> tuple[Point, Point]:
    """Return a point and forward unit vector at a polyline distance."""
    lengths = segment_lengths(points)
    remaining = min(max(0.0, along), sum(lengths))
    for index, length in enumerate(lengths):
        if remaining <= length or index == len(lengths) - 1:
            start, end = points[index], points[index + 1]
            ratio = 0.0 if length == 0 else remaining / length
            point = (
                start[0] + (end[0] - start[0]) * ratio,
                start[1] + (end[1] - start[1]) * ratio,
            )
            forward = ((end[0] - start[0]) / length, (end[1] - start[1]) / length)
            return point, forward
        remaining -= length
    raise RuntimeError("polyline has no usable segment")


def nearest_polyline_position(point: Point, polyline: list[Point]) -> tuple[float, float]:
    """Return normalized along-position and signed right-hand lateral offset."""
    lengths = segment_lengths(polyline)
    total = sum(lengths)
    best_distance = math.inf
    best_along = 0.0
    best_lateral = 0.0
    traversed = 0.0
    for index, length in enumerate(lengths):
        start, end = polyline[index], polyline[index + 1]
        dx, dy = end[0] - start[0], end[1] - start[1]
        projection = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (length**2)
        projection = min(1.0, max(0.0, projection))
        projected = (start[0] + dx * projection, start[1] + dy * projection)
        separation = distance(point, projected)
        if separation < best_distance:
            forward = (dx / length, dy / length)
            right = (forward[1], -forward[0])
            best_distance = separation
            best_along = traversed + length * projection
            best_lateral = (
                (point[0] - projected[0]) * right[0]
                + (point[1] - projected[1]) * right[1]
            )
        traversed += length
    return best_along / total, best_lateral


def canonical_route(pixel_points: list[Point], total_distance: float) -> list[Point]:
    """Rotate the photographed route so its first segment points up-course."""
    start, next_point = pixel_points[0], pixel_points[1]
    dx, dy = next_point[0] - start[0], next_point[1] - start[1]
    initial_length = math.hypot(dx, dy)
    forward = (dx / initial_length, dy / initial_length)
    # In screen coordinates (positive Y downward), this vector is golfer-right.
    right = (-forward[1], forward[0])
    pixel_path_length = sum(segment_lengths(pixel_points))
    scale = total_distance / pixel_path_length
    route: list[Point] = []
    for x, y in pixel_points:
        offset = (x - start[0], y - start[1])
        route.append(
            (
                (offset[0] * right[0] + offset[1] * right[1]) * scale,
                (offset[0] * forward[0] + offset[1] * forward[1]) * scale,
            )
        )
    return route


def warp_point(point: Point, old_route: list[Point], new_route: list[Point]) -> list[float]:
    fraction, lateral = nearest_polyline_position(point, old_route)
    new_total = sum(segment_lengths(new_route))
    center, forward = point_at_distance(new_route, fraction * new_total)
    right = (forward[1], -forward[0])
    return [round(center[0] + right[0] * lateral, 3), round(center[1] + right[1] * lateral, 3)]


def force_polygon_to_right(coordinates: list[list[float]], route: list[Point]) -> list[list[float]]:
    route_total = sum(segment_lengths(route))
    corrected: list[list[float]] = []
    for raw_point in coordinates:
        fraction, lateral = nearest_polyline_position(tuple(raw_point), route)
        center, forward = point_at_distance(route, fraction * route_total)
        right = (forward[1], -forward[0])
        right_offset = abs(lateral)
        corrected.append(
            [
                round(center[0] + right[0] * right_offset, 3),
                round(center[1] + right[1] * right_offset, 3),
            ]
        )
    return corrected


def transform_coordinates(value: Any, old_route: list[Point], new_route: list[Point]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "coordinates" and isinstance(child, list) and child:
                if isinstance(child[0], list) and len(child[0]) == 2:
                    value[key] = [warp_point(tuple(point), old_route, new_route) for point in child]
                    continue
            transform_coordinates(child, old_route, new_route)
    elif isinstance(value, list):
        for child in value:
            transform_coordinates(child, old_route, new_route)


def calibrate_hole(hole_number: int, calibration: dict[str, Any]) -> None:
    path = COURSE_DIR / f"hole{hole_number}.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    old_route = [tuple(waypoint["point"]) for waypoint in payload["centerline_waypoints"]]
    new_route = canonical_route(
        [tuple(point) for point in calibration["pixels"]],
        float(payload["metadata"]["total_distance_meters"]),
    )

    # Transform surface and hazard geometry before replacing the centerline.
    transform_coordinates(payload["spatial_polygons"], old_route, new_route)
    transform_coordinates(payload["hazards_and_features"], old_route, new_route)

    right_side_features = calibration.get("right_side_features", {})
    for feature in payload["hazards_and_features"]:
        replacement_id = right_side_features.get(feature["feature_id"])
        if not replacement_id:
            continue
        feature["coordinates"] = force_polygon_to_right(feature["coordinates"], new_route)
        feature["feature_id"] = replacement_id
        feature["gameplay_impact"] = (
            "The fairway bunker occupies the right side of the primary landing corridor."
        )

    payload["centerline_waypoints"] = [
        {
            "index": index,
            "point": [round(point[0], 3), round(point[1], 3)],
            "desc": (
                "Tee Box Centerline Origin"
                if index == 0
                else "Green Center Pin"
                if index == len(new_route) - 1
                else f"Aerial-calibrated route waypoint {index}"
            ),
        }
        for index, point in enumerate(new_route)
    ]

    payload["metadata"]["layout_type"] = calibration["layout"]
    payload["metadata"]["geometry_calibration"] = {
        "version": CALIBRATION_VERSION,
        "source_image": f"images/hole{hole_number}.png",
        "method": (
            "annotated route centerline warp plus feature-side corrections"
            if right_side_features
            else "annotated route centerline warp"
        ),
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    for hole_number, calibration in CALIBRATIONS.items():
        calibrate_hole(hole_number, calibration)
        print(f"Calibrated Warrenbrook hole {hole_number}: {calibration['layout']}")


if __name__ == "__main__":
    main()
