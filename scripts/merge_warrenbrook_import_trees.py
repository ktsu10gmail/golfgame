#!/usr/bin/env python3
"""Merge reviewed local Warrenbrook trees into its Golf Intelligence cache."""

from __future__ import annotations

import hashlib
import json
import math
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from packages.course_import import CourseImportStore

PUBLIC_ID = "53FZ3QDT"
PROVIDER = "golf_intelligence"
TREE_SOURCE = "reviewed_local_warrenbrook"
EARTH_RADIUS_METERS = 6_371_008.8


def course_point_to_gps(calibration: dict, point: list[float]) -> dict[str, float]:
    origin = calibration["origin"]
    matrix = calibration["matrix"]
    east = (
        float(matrix["east_meters_per_course_x"]) * float(point[0])
        + float(matrix["east_meters_per_course_y"]) * float(point[1])
    )
    north = (
        float(matrix["north_meters_per_course_x"]) * float(point[0])
        + float(matrix["north_meters_per_course_y"]) * float(point[1])
    )
    latitude_radians = math.radians(float(origin["lat"]))
    return {
        "lat": round(float(origin["lat"]) + north / EARTH_RADIUS_METERS * 180 / math.pi, 8),
        "lng": round(
            float(origin["lng"])
            + east / (EARTH_RADIUS_METERS * math.cos(latitude_radians)) * 180 / math.pi,
            8,
        ),
    }


def reviewed_tree_features(source_directory: Path, hole_number: int) -> list[dict]:
    document = json.loads((source_directory / f"hole{hole_number}.json").read_text(encoding="utf-8"))
    calibration = document["hole_metadata"]["gps_calibration"]
    zones = document.get("geometries", {}).get("tree_zones", [])
    features = []
    for index, zone in enumerate(zones, 1):
        polygon = zone.get("polygon") if isinstance(zone, dict) else None
        if not isinstance(polygon, list) or len(polygon) < 3:
            continue
        points = [course_point_to_gps(calibration, point) for point in polygon]
        features.append({
            "id": f"local-warrenbrook-trees-{hole_number}-{index}",
            "type": "trees",
            "label": f"Reviewed Warrenbrook trees {index}",
            "source": TREE_SOURCE,
            "manual_override": False,
            "points": points,
        })
    return features


def main() -> None:
    store = CourseImportStore(ROOT / "data" / "course_imports.sqlite3")
    cached = store.cached_course(PROVIDER, PUBLIC_ID)
    if cached is None:
        raise SystemExit("Warrenbrook Golf Intelligence cache was not found")
    project = cached["project"]
    source_directory = ROOT / "data" / "the-warrenbrook-golf-course"
    total = 0
    for number in range(1, 19):
        hole = project["holes"][str(number)]
        hole["features"] = [
            feature for feature in hole.get("features", [])
            if not (feature.get("type") == "trees" and feature.get("source") == TREE_SOURCE)
        ]
        trees = reviewed_tree_features(source_directory, number)
        hole["features"].extend(trees)
        total += len(trees)
    if total <= 0:
        raise SystemExit("No reviewed Warrenbrook tree zones were found")
    project["external_course_source"]["tree_geometry_source"] = TREE_SOURCE
    project["external_course_source"]["tree_geometry_count"] = total
    composite = {
        "provider_hash": cached["response_hash"],
        "tree_source": TREE_SOURCE,
        "trees": [
            feature
            for hole in project["holes"].values()
            for feature in hole["features"]
            if feature.get("type") == "trees"
        ],
    }
    response_hash = hashlib.sha256(
        json.dumps(composite, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    store.save_cached_course(
        PROVIDER,
        PUBLIC_ID,
        fetched_at=datetime.fromisoformat(cached["fetched_at"]),
        expires_at=datetime.fromisoformat(cached["expires_at"]),
        response_hash=response_hash,
        project=project,
    )
    print(f"Merged {total} reviewed tree zones across 18 Warrenbrook holes")


if __name__ == "__main__":
    main()
