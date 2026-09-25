"""Normalize Golf Intelligence course detail into the existing Course Mapper format."""

from __future__ import annotations

import base64
import binascii
import csv
import gzip
import hashlib
import io
import json
import math
import re
import zlib
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any, Iterable

MAPPER_PROJECT_VERSION = "golf-course-map-v1"
PROVIDER_NAME = "golf_intelligence"


class CourseNormalizationError(ValueError):
    """Raised when provider data cannot form a reviewable course project."""


def _serialized_json(value: str) -> Any:
    """Decode provider JSON carried as text, base64, or compressed base64."""
    encoded = value.strip().encode("ascii", errors="ignore")
    byte_candidates = [value.encode("utf-8")]
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        decoded = b""
    if decoded and len(decoded) <= 10 * 1024 * 1024:
        byte_candidates.append(decoded)
        for decompress in (gzip.decompress, zlib.decompress):
            try:
                expanded = decompress(decoded)
            except (OSError, EOFError, zlib.error):
                continue
            if len(expanded) <= 10 * 1024 * 1024:
                byte_candidates.append(expanded)

    for candidate in byte_candidates:
        try:
            text = candidate.decode("utf-8")
        except UnicodeDecodeError:
            continue
        parsed: Any = text
        for _ in range(2):
            if not isinstance(parsed, str):
                break
            try:
                parsed = json.loads(parsed)
            except (TypeError, ValueError):
                break
        if not isinstance(parsed, str):
            return parsed
    raise CourseNormalizationError(
        "Golf Intelligence returned serialized GPS data in an unsupported encoding"
    )


def _gps_items_from_payload(detail: dict[str, Any]) -> list[dict[str, Any]]:
    """Read GPS items from either the documented field or serialized fallback.

    Golf Intelligence's Swagger model exposes both ``gpsItems`` and ``data``.
    Live GPS responses can leave ``gpsItems`` null and serialize the same value
    into ``data`` instead, so support both representations without accepting an
    arbitrary payload shape.
    """
    raw_items = detail.get("gpsItems")
    if isinstance(raw_items, list) and raw_items:
        return [item for item in raw_items if isinstance(item, dict)]
    if raw_items is not None and not isinstance(raw_items, list):
        raise CourseNormalizationError("Golf Intelligence returned GPS geometry in an unsupported format")

    serialized = detail.get("data")
    if isinstance(serialized, str) and serialized.strip():
        decoded = _serialized_json(serialized)
        if isinstance(decoded, dict):
            decoded = decoded.get("gpsItems")
        if isinstance(decoded, list):
            items = [item for item in decoded if isinstance(item, dict)]
            if items:
                return items
        raise CourseNormalizationError(
            "Golf Intelligence returned serialized data but it contained no GPS geometry"
        )
    return []


def _clean_id(value: object, fallback: str = "imported-course") -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", str(value or "").casefold()).strip("-")
    return cleaned or fallback


def _number(value: object, default: float = 0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def _integer(value: object, default: int = 0) -> int:
    return int(_number(value, default))


def _coordinate(value: object) -> dict[str, float] | None:
    if not isinstance(value, dict):
        return None
    latitude = _number(value.get("latitude", value.get("lat")), math.nan)
    longitude = _number(value.get("longitude", value.get("lng", value.get("lon"))), math.nan)
    if not math.isfinite(latitude) or not math.isfinite(longitude):
        return None
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        return None
    return {"lat": round(latitude, 8), "lng": round(longitude, 8)}


def _distance_meters(first: dict[str, float], second: dict[str, float]) -> float:
    radius = 6_371_008.8
    first_lat = math.radians(first["lat"])
    second_lat = math.radians(second["lat"])
    lat_delta = second_lat - first_lat
    lng_delta = math.radians(second["lng"] - first["lng"])
    haversine = (
        math.sin(lat_delta / 2) ** 2
        + math.cos(first_lat) * math.cos(second_lat) * math.sin(lng_delta / 2) ** 2
    )
    return radius * 2 * math.atan2(math.sqrt(haversine), math.sqrt(max(0, 1 - haversine)))


def _lateral_anchor_score(
    tee: dict[str, float],
    green: dict[str, float],
    candidate: dict[str, float],
) -> float:
    latitude_scale = 111_320.0
    longitude_scale = latitude_scale * max(0.1, math.cos(math.radians(tee["lat"])))
    green_vector = (
        (green["lng"] - tee["lng"]) * longitude_scale,
        (green["lat"] - tee["lat"]) * latitude_scale,
    )
    candidate_vector = (
        (candidate["lng"] - tee["lng"]) * longitude_scale,
        (candidate["lat"] - tee["lat"]) * latitude_scale,
    )
    vector_scale = math.hypot(*green_vector) * math.hypot(*candidate_vector)
    if vector_scale < 100:
        return 0
    determinant = green_vector[0] * candidate_vector[1] - candidate_vector[0] * green_vector[1]
    return abs(determinant) / vector_scale


def _polygon_center(points: list[dict[str, float]]) -> dict[str, float] | None:
    if not points:
        return None
    return {
        "lat": round(sum(point["lat"] for point in points) / len(points), 8),
        "lng": round(sum(point["lng"] for point in points) / len(points), 8),
    }


def _circle_polygon(center: dict[str, float], radius_meters: float, vertices: int = 12) -> list[dict[str, float]]:
    latitude_scale = 111_320.0
    longitude_scale = latitude_scale * max(0.1, math.cos(math.radians(center["lat"])))
    return [
        {
            "lat": round(center["lat"] + math.sin(angle) * radius_meters / latitude_scale, 8),
            "lng": round(center["lng"] + math.cos(angle) * radius_meters / longitude_scale, 8),
        }
        for angle in (2 * math.pi * index / vertices for index in range(vertices))
    ]


def _polygon(value: object) -> list[dict[str, float]]:
    if not isinstance(value, list):
        return []
    points: list[dict[str, float]] = []
    for raw_point in value:
        point = _coordinate(raw_point)
        if point is None:
            continue
        if not points or point != points[-1]:
            points.append(point)
    if len(points) > 3 and points[0] == points[-1]:
        points.pop()
    if len(points) < 3:
        return []
    if any(_distance_meters(points[index - 1], point) > 5_000 for index, point in enumerate(points)):
        return []
    return points


def _address(facility: dict[str, Any]) -> str:
    address = facility.get("address") if isinstance(facility.get("address"), dict) else {}
    values = [
        address.get("address1") or address.get("street1") or address.get("street"),
        address.get("city"),
        address.get("regionCode") or address.get("stateCode") or address.get("region"),
        address.get("postalCode") or address.get("zipCode"),
        address.get("countryCode") or address.get("country"),
    ]
    return ", ".join(str(value).strip() for value in values if value)


def _empty_hole(hole_number: int) -> dict[str, Any]:
    return {
        "hole_number": hole_number,
        "par": 4,
        "handicap": hole_number if hole_number <= 18 else (hole_number - 1) % 9 + 1,
        "layout_type": "Imported GPS geometry",
        "elevation_change_meters": 0,
        "yardages": {"blue": 0, "white": 0, "forward": 0},
        "markers": {"blue_tee": None, "white_tee": None, "forward_tee": None, "pin": None},
        "route_points": [],
        "features": [],
        "import_status": "NEEDS_REVIEW",
        "import_warnings": ["No provider hole data was mapped."],
    }


def _course_holes(course: dict[str, Any]) -> list[dict[str, Any]]:
    direct_holes = [hole for hole in course.get("holes", []) if isinstance(hole, dict)]
    if direct_holes:
        return direct_holes
    tees = [tee for tee in course.get("tees", []) if isinstance(tee, dict)]
    candidates = [
        [hole for hole in tee.get("holes", []) if isinstance(hole, dict)]
        for tee in tees
    ]
    candidates = [holes for holes in candidates if holes]
    return max(candidates, key=len, default=[])


def _course_size(course: dict[str, Any]) -> int:
    named_type = str(course.get("courseHoleType") or course.get("layoutType") or "").casefold()
    if "nine" in named_type:
        return 9
    if "eighteen" in named_type:
        return 18
    holes = _course_holes(course)
    return min(18, len({(_integer(hole.get("holeId")), _integer(hole.get("holeNumber"))) for hole in holes}))


def _selected_layouts(detail: dict[str, Any]) -> tuple[list[dict[str, Any]], str, int]:
    courses = [course for course in detail.get("courses", []) if isinstance(course, dict)]
    if not courses:
        courses = [layout for layout in detail.get("layouts", []) if isinstance(layout, dict)]
    active = [course for course in courses if course.get("courseStatusType") != "Inactive"] or courses
    nines = [course for course in active if _course_size(course) == 9]
    eighteens = [course for course in active if _course_size(course) >= 18]
    if len(nines) >= 3:
        return nines[:3], "three_nines", 27
    if len(nines) >= 2:
        return nines[:2], "standard_18", 18
    if eighteens:
        return [eighteens[0]], "standard_18", 18
    if nines:
        return [nines[0]], "standard_18", 9
    if active:
        return [active[0]], "standard_18", min(18, max(1, _course_size(active[0])))
    return [], "standard_18", min(18, len(detail.get("holes", [])))


def _tee_hole(tee: dict[str, Any], hole_id: int, hole_number: int) -> dict[str, Any] | None:
    holes = [hole for hole in tee.get("holes", []) if isinstance(hole, dict)]
    return next((hole for hole in holes if _integer(hole.get("holeId")) == hole_id and hole_id), None) or next(
        (hole for hole in holes if _integer(hole.get("holeNumber")) == hole_number),
        None,
    )


def _tee_mapping(course: dict[str, Any]) -> dict[str, dict[str, Any] | None]:
    tees = [tee for tee in course.get("tees", []) if isinstance(tee, dict) and tee.get("isTeeActive", True)]
    tees.sort(key=lambda tee: _number(tee.get("yardage")), reverse=True)
    if not tees:
        return {"blue": None, "white": None, "forward": None}
    return {
        "blue": tees[0],
        "white": tees[len(tees) // 2],
        "forward": tees[-1],
    }


GPS_FEATURE_TYPES = {
    "FairwayTrace": "fairway",
    "GreenTrace": "green",
    "BunkerTrace": "bunker",
    "WaterTrace": "water",
    "HazardPath": "penalty_area_unknown",
    "HoleBoundry": "hole_outline",
    "CartpathTrace": "cart_path",
    "VegetationTrace": "trees",
    "TreesTrace": "trees",
}

GPS_POINT_TREE_RADII_METERS = {
    "LeafyTree": 5.0,
    "PineTree": 4.5,
    "ShrubTree": 2.5,
    "PalmTree": 3.5,
}


def _gps_features(items: Iterable[dict[str, Any]], hole_id: int) -> tuple[list[dict[str, Any]], list[str]]:
    features: list[dict[str, Any]] = []
    warnings: list[str] = []
    for item_index, item in enumerate(items):
        if _integer(item.get("holeId")) != hole_id:
            continue
        gps_type = str(item.get("gpsType") or "")
        feature_type = GPS_FEATURE_TYPES.get(gps_type)
        tree_radius = GPS_POINT_TREE_RADII_METERS.get(gps_type)
        if tree_radius is not None:
            center = _coordinate(item.get("gpsCoordinate"))
            if center is not None:
                features.append({
                    "id": f"gi-{hole_id}-{gps_type.casefold()}-{item_index + 1}",
                    "type": "trees",
                    "label": f"Imported {gps_type.replace('Tree', ' tree').casefold()}",
                    "source": PROVIDER_NAME,
                    "provider_feature_id": f"{hole_id}:{gps_type}:{item_index}",
                    "provider_tree_type": gps_type,
                    "manual_override": False,
                    "points": _circle_polygon(center, tree_radius),
                })
            else:
                warnings.append(f"Ignored invalid {gps_type} coordinate.")
            continue
        if feature_type is None:
            continue
        shapes = item.get("shapes") if isinstance(item.get("shapes"), list) else []
        for shape_index, raw_shape in enumerate(shapes):
            points = _polygon(raw_shape)
            if not points:
                warnings.append(f"Ignored invalid {gps_type or 'GPS'} geometry.")
                continue
            features.append({
                "id": f"gi-{hole_id}-{gps_type.casefold()}-{item_index + 1}-{shape_index + 1}",
                "type": feature_type,
                "label": {
                    "penalty_area_unknown": "Imported penalty area — classify before publishing",
                    "hole_outline": "Imported hole outline",
                }.get(feature_type, f"Imported {feature_type.replace('_', ' ')}"),
                "source": PROVIDER_NAME,
                "provider_feature_id": f"{hole_id}:{gps_type}:{item_index}:{shape_index}",
                "manual_override": False,
                "points": points,
            })
    unique_features: list[dict[str, Any]] = []
    seen_geometry: set[tuple[str, tuple[tuple[float, float], ...]]] = set()
    for feature in features:
        geometry_key = (
            str(feature["type"]),
            tuple((point["lat"], point["lng"]) for point in feature["points"]),
        )
        if geometry_key in seen_geometry:
            continue
        seen_geometry.add(geometry_key)
        unique_features.append(feature)
    features = unique_features
    outlines = [feature for feature in features if feature["type"] == "hole_outline"]
    if outlines and not any(feature["type"] == "rough" for feature in features):
        for index, outline in enumerate(outlines):
            features.append({
                **outline,
                "id": f"{outline['id']}-playing-area-{index + 1}",
                "type": "rough",
                "label": "Playing area derived from imported hole outline",
                "source": "derived_from_provider_polygon",
                "provider_feature_id": outline["provider_feature_id"],
            })
    return features, warnings


def _tee_polygons(items: Iterable[dict[str, Any]], hole_id: int) -> list[list[dict[str, float]]]:
    polygons: list[list[dict[str, float]]] = []
    for item in items:
        if _integer(item.get("holeId")) != hole_id or item.get("gpsType") != "TeeboxTrace":
            continue
        polygons.extend(points for points in (_polygon(shape) for shape in item.get("shapes", [])) if points)
    return polygons


def _mapped_hole(
    base: dict[str, Any],
    course: dict[str, Any],
    output_number: int,
    gps_items: list[dict[str, Any]],
) -> dict[str, Any]:
    source_number = _integer(base.get("holeNumber"), output_number)
    hole_id = _integer(base.get("holeId"))
    tee_mapping = _tee_mapping(course)
    features, warnings = _gps_features(gps_items, hole_id)
    green = next((feature for feature in features if feature["type"] == "green"), None)
    green_center = _coordinate(base.get("greenGPSCoordinate")) or (
        _polygon_center(green["points"]) if green else None
    )
    tee_polygons = _tee_polygons(gps_items, hole_id)
    tee_polygons.sort(
        key=lambda polygon: _distance_meters(_polygon_center(polygon), green_center)
        if green_center and _polygon_center(polygon) else 0,
        reverse=True,
    )
    polygon_mapping: dict[str, list[dict[str, float]] | None] = {
        "blue": tee_polygons[0] if tee_polygons else None,
        "white": tee_polygons[len(tee_polygons) // 2] if tee_polygons else None,
        "forward": tee_polygons[-1] if tee_polygons else None,
    }
    for role, polygon in polygon_mapping.items():
        if polygon:
            features.append({
                "id": f"gi-{hole_id}-tee-{role}",
                "type": f"tee_{role}",
                "label": f"Imported {role} gameplay tee",
                "source": PROVIDER_NAME,
                "provider_feature_id": f"{hole_id}:TeeboxTrace:{role}",
                "manual_override": False,
                "points": polygon,
            })
    provider_tee_coordinate = _coordinate(base.get("teeGPSCoordinate"))
    markers = {
        role + "_tee": _polygon_center(polygon_mapping[role]) or provider_tee_coordinate
        for role in ("blue", "white", "forward")
    }
    markers["pin"] = green_center
    approach = _coordinate(base.get("approachGPSCoordinate"))
    route_points = [approach] if approach and approach not in markers.values() else []
    yardages: dict[str, int] = {}
    tee_metadata: dict[str, Any] = {}
    for role, tee in tee_mapping.items():
        tee_hole = _tee_hole(tee, hole_id, source_number) if tee else None
        yardages[role] = _integer((tee_hole or {}).get("yardage") or base.get("yardage"))
        tee_metadata[role] = {
            "provider_tee_id": tee.get("teeId") if tee else None,
            "provider_name": tee.get("teeName") if tee else None,
            "provider_color": tee.get("teeColorType") if tee else None,
            "source": PROVIDER_NAME if tee else None,
        }
    par_source = next((
        _tee_hole(tee, hole_id, source_number)
        for tee in tee_mapping.values() if tee and _tee_hole(tee, hole_id, source_number)
    ), None) or base
    if not green:
        warnings.append("No green polygon was returned.")
    if not tee_polygons:
        warnings.append("No tee polygon was returned.")
    if not any(feature["type"] == "fairway" for feature in features) and _integer(par_source.get("par"), 4) > 3:
        warnings.append("No fairway polygon was returned.")
    if any(feature["type"] == "penalty_area_unknown" for feature in features):
        warnings.append("Classify the imported penalty area before publishing.")
    hole = {
        "hole_number": output_number,
        "provider_hole_number": source_number,
        "provider_hole_id": hole_id,
        "par": max(3, min(6, _integer(par_source.get("par"), 4))),
        "handicap": max(1, min(18, _integer(par_source.get("allocation"), output_number))),
        "layout_type": "Imported GPS geometry",
        "elevation_change_meters": 0,
        "yardages": yardages,
        "markers": markers,
        "route_points": route_points,
        "features": features,
        "import_status": "NEEDS_REVIEW" if warnings else "IMPORTED",
        "import_warnings": sorted(set(warnings)),
        "tee_mapping": tee_metadata,
        "field_provenance": {
            "par": PROVIDER_NAME,
            "handicap": PROVIDER_NAME,
            "yardages": PROVIDER_NAME,
            "geometry": PROVIDER_NAME,
        },
    }
    bunkers = [feature for feature in features if feature["type"] == "bunker"]
    bunker_candidates = [
        (feature, _polygon_center(feature["points"]))
        for feature in bunkers
    ]
    bunker_candidates = [
        (feature, center, _lateral_anchor_score(markers["white_tee"], green_center, center))
        for feature, center in bunker_candidates
        if markers["white_tee"] and green_center and center
    ]
    bunker, bunker_center, anchor_score = max(
        bunker_candidates,
        key=lambda candidate: candidate[2],
        default=(None, None, 0),
    )
    if bunker and anchor_score >= .025:
        hole["gps_control_points"] = {
            "white_tee": markers["white_tee"],
            "green_center": green_center,
            "bunker_center": bunker_center,
            "bunker_feature_id": bunker["id"],
            "source": "derived_from_provider_polygon",
        }
    return hole


def _preview(project: dict[str, Any], imported_holes: int) -> dict[str, Any]:
    holes = [project["holes"][str(number)] for number in range(1, imported_holes + 1)]
    feature_types = [feature["type"] for hole in holes for feature in hole["features"]]
    expected = ["tee", "fairway", "green", "bunker", "penalty_area", "hole_outline"]
    checks = {
        "scorecard": all(hole["par"] and any(hole["yardages"].values()) for hole in holes),
        "tees": all(any(feature["type"].startswith("tee_") for feature in hole["features"]) for hole in holes),
        "fairways": all(hole["par"] == 3 or any(feature["type"] == "fairway" for feature in hole["features"]) for hole in holes),
        "greens": all(any(feature["type"] == "green" for feature in hole["features"]) for hole in holes),
        "bunkers": "bunker" in feature_types,
        "penalty_areas": any(feature_type in {"water", "penalty_area_unknown"} for feature_type in feature_types),
        "hole_outlines": "hole_outline" in feature_types,
    }
    required_checks = [checks["scorecard"], checks["tees"], checks["fairways"], checks["greens"]]
    optional_checks = [checks["bunkers"], checks["penalty_areas"], checks["hole_outlines"]]
    completeness = round((sum(required_checks) + sum(optional_checks)) / (len(expected) + 1) * 100)
    warnings = [f"Hole {hole['hole_number']}: {warning}" for hole in holes for warning in hole["import_warnings"]]
    return {
        "course": project["course_name"],
        "provider": "Golf Intelligence",
        "holes": imported_holes,
        "checks": checks,
        "geometry_completeness": completeness,
        "warnings": warnings,
        "ready_for_review": bool(imported_holes and checks["greens"]),
    }


def normalize_golf_intelligence_course(detail: dict[str, Any], external_id: str) -> dict[str, Any]:
    if not isinstance(detail, dict):
        raise CourseNormalizationError("Golf Intelligence course detail must be an object")
    gps_items = _gps_items_from_payload(detail)
    if not gps_items:
        raise CourseNormalizationError(
            "Golf Intelligence returned the scorecard but no GPS geometry. "
            "The response was not cached and no automatic paid retry was attempted."
        )
    facility = detail.get("facility") if isinstance(detail.get("facility"), dict) else {}
    course_name = str(detail.get("name") or facility.get("facilityName") or "Imported golf course").strip()
    layouts, structure, imported_hole_count = _selected_layouts(detail)
    group_holes = [hole for hole in (detail.get("holes") or []) if isinstance(hole, dict)]
    if not layouts and not group_holes:
        raise CourseNormalizationError("The provider returned no course or hole records")
    output_holes: list[dict[str, Any]] = []
    if layouts:
        for layout in layouts:
            bases = _course_holes(layout)
            if not bases and len(layouts) == 1:
                bases = group_holes
            bases = sorted(bases, key=lambda hole: (_integer(hole.get("holeNumber")), _integer(hole.get("holeId"))))
            for base in bases:
                if len(output_holes) >= (27 if structure == "three_nines" else imported_hole_count):
                    break
                output_holes.append(_mapped_hole(base, layout, len(output_holes) + 1, gps_items))
    else:
        fallback_course = {"tees": []}
        for base in sorted(group_holes, key=lambda hole: _integer(hole.get("holeNumber"))):
            output_holes.append(_mapped_hole(base, fallback_course, len(output_holes) + 1, gps_items))
    if not output_holes:
        raise CourseNormalizationError("The provider course did not contain mappable holes")
    imported_hole_count = min(27 if structure == "three_nines" else 18, len(output_holes))
    project_hole_count = 27 if structure == "three_nines" else 18
    holes = {str(number): _empty_hole(number) for number in range(1, project_hole_count + 1)}
    for hole in output_holes[:project_hole_count]:
        holes[str(hole["hole_number"])] = hole
    loop_names = [str(
        layout.get("shortName")
        or layout.get("name")
        or layout.get("layoutName")
        or f"Nine {index + 1}"
    ).strip() for index, layout in enumerate(layouts[:3])]
    while len(loop_names) < 3:
        loop_names.append(("Central", "North", "South")[len(loop_names)])
    imported_at = datetime.now(UTC).isoformat()
    source_hash = hashlib.sha256(json.dumps(detail, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    project = {
        "version": MAPPER_PROJECT_VERSION,
        "course_name": course_name,
        "course_id": _clean_id(course_name),
        "address": _address(facility),
        "updated_at": imported_at,
        "imagery_source": "Golf Intelligence GPS geometry",
        "map_view": None,
        "course_structure": structure,
        "nine_loops": [
            {"id": loop_id, "name": loop_names[index]}
            for index, loop_id in enumerate(("central", "north", "south"))
        ],
        "holes": holes,
        "external_course_source": {
            "provider_name": PROVIDER_NAME,
            "provider_public_id": external_id,
            "provider_imported_at": imported_at,
            "provider_payload_version": str(detail.get("updatedOn") or "swagger-v1"),
            "provider_last_refresh_at": imported_at,
            "provider_source_hash": source_hash,
            "imported_hole_count": imported_hole_count,
        },
        "green_contour_defaults": {
            "green_shape_source": PROVIDER_NAME,
            "green_contour_source": "simulated",
            "generator_version": "existing-contour-v1",
        },
    }
    project["import_preview"] = _preview(project, imported_hole_count)
    return project


def normalize_golf_intelligence_gps_with_scorecard(
    gps_detail: dict[str, Any],
    external_id: str,
    scorecard_text: str,
) -> dict[str, Any]:
    """Combine the paid GPS-only payload with an existing trusted scorecard."""
    if not isinstance(gps_detail, dict):
        raise CourseNormalizationError("Golf Intelligence GPS response must be an object")
    gps_items = _gps_items_from_payload(gps_detail)
    if not gps_items:
        raise CourseNormalizationError("Golf Intelligence GPS-only response contained no GPS geometry")

    reader = csv.DictReader(io.StringIO(scorecard_text.lstrip("\ufeff")))
    rows = [row for row in reader if isinstance(row, dict)]
    if len(rows) != 18:
        raise CourseNormalizationError("The local recovery scorecard must contain exactly 18 holes")

    def score_value(row: dict[str, Any], *names: str, default: int = 0) -> int:
        normalized = {str(key).strip().casefold(): value for key, value in row.items() if key is not None}
        for name in names:
            value = normalized.get(name.casefold())
            if value not in (None, ""):
                return _integer(value, default)
        return default

    group_holes = [hole for hole in (gps_detail.get("holes") or []) if isinstance(hole, dict)]
    if not group_holes:
        for layout in (gps_detail.get("layouts") or []):
            if isinstance(layout, dict):
                group_holes.extend(hole for hole in (layout.get("holes") or []) if isinstance(hole, dict))
    holes_by_number = {
        _integer(hole.get("holeNumber")): hole
        for hole in group_holes
        if 1 <= _integer(hole.get("holeNumber")) <= 18
    }
    if len(holes_by_number) < 18:
        raise CourseNormalizationError("Golf Intelligence GPS-only response did not identify all 18 holes")

    scorecard_rows: dict[int, dict[str, Any]] = {}
    for row in rows:
        number = score_value(row, "hole", "hole_number")
        if not 1 <= number <= 18 or number in scorecard_rows:
            raise CourseNormalizationError("The local recovery scorecard has invalid or duplicate hole numbers")
        scorecard_rows[number] = row
    if len(scorecard_rows) != 18:
        raise CourseNormalizationError("The local recovery scorecard must identify holes 1 through 18")

    tee_definitions = (
        ("Blue", "Blue", ("yards_blue", "blue_yards", "blue")),
        ("White", "White", ("yards_white", "white_yards", "white")),
        ("Forward", "Red", ("yards_red", "red_yards", "yards_forward", "forward_yards", "forward")),
    )
    tees = []
    for tee_id, (tee_name, tee_color, yardage_names) in enumerate(tee_definitions, 1):
        tee_holes = []
        for number in range(1, 19):
            row = scorecard_rows[number]
            base = dict(holes_by_number[number])
            base.update({
                "holeNumber": number,
                "par": score_value(row, "par", default=4),
                "yardage": score_value(row, *yardage_names),
                "allocation": score_value(row, "handicap", "hcp", default=number),
            })
            tee_holes.append(base)
        tees.append({
            "teeId": tee_id,
            "teeName": tee_name,
            "teeColorType": tee_color,
            "yardage": sum(hole["yardage"] for hole in tee_holes),
            "isTeeActive": True,
            "holes": tee_holes,
        })

    combined = dict(gps_detail)
    combined["courses"] = [{
        "courseId": _integer(gps_detail.get("courseGroupId")),
        "name": str(gps_detail.get("name") or "Recovered GPS course"),
        "courseHoleType": "EighteenHole",
        "courseStatusType": "Active",
        "tees": tees,
    }]
    combined["holes"] = [holes_by_number[number] for number in range(1, 19)]
    project = normalize_golf_intelligence_course(combined, external_id)
    project["external_course_source"].update({
        "import_mode": "gps_only_with_local_scorecard",
        "scorecard_source": "installed_jettagolf_scorecard",
        "provider_operation": "getCourseGroupGPS",
    })
    project["import_preview"] = _preview(project, 18)
    return project
