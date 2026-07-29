"""Adapt course JSON files into canonical yard-based engine geometry."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .enums import SurfaceType
from .geometry import point_in_polygon
from .models import SurfaceRegion, Vec2


METERS_TO_YARDS = 1.09361

SURFACE_PRIORITIES: dict[SurfaceType, int] = {
    SurfaceType.OUT_OF_BOUNDS: 100,
    SurfaceType.WATER: 90,
    SurfaceType.BUNKER: 80,
    SurfaceType.GREEN: 70,
    SurfaceType.TEE: 60,
    SurfaceType.NATIVE: 50,
    SurfaceType.FAIRWAY: 40,
    SurfaceType.ROUGH: 20,
}


@dataclass(frozen=True, slots=True)
class AdaptedHole:
    """One validated hole expressed entirely in canonical yards."""

    course_id: str
    course_name: str
    hole_number: int
    par: int
    handicap: int
    declared_distance_yards: float
    centerline: tuple[Vec2, ...]
    tee: Vec2
    pin: Vec2
    surfaces: tuple[SurfaceRegion, ...]
    source_schema: str

    def regions(self, surface: SurfaceType) -> tuple[SurfaceRegion, ...]:
        return tuple(region for region in self.surfaces if region.surface is surface)


def _fail(source: str, message: str) -> ValueError:
    return ValueError(f"{source}: {message}")


def _number(value: Any, source: str, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _fail(source, f"{field} must be numeric")
    number = float(value)
    if not math.isfinite(number):
        raise _fail(source, f"{field} must be finite")
    return number


def _point(value: Any, source: str, field: str) -> Vec2:
    if not isinstance(value, list) or len(value) != 2:
        raise _fail(source, f"{field} must be a two-number coordinate")
    return Vec2(
        _number(value[0], source, f"{field}[0]") * METERS_TO_YARDS,
        _number(value[1], source, f"{field}[1]") * METERS_TO_YARDS,
    )


def _polygon(value: Any, source: str, field: str) -> tuple[Vec2, ...]:
    if not isinstance(value, list):
        raise _fail(source, f"{field} must be a coordinate array")
    points = tuple(_point(item, source, f"{field}[{index}]") for index, item in enumerate(value))
    if len(points) > 1 and points[0] == points[-1]:
        points = points[:-1]
    if len(set(points)) < 3:
        raise _fail(source, f"{field} must contain at least three distinct points")
    twice_area = abs(
        sum(
            point.x * points[(index + 1) % len(points)].y
            - points[(index + 1) % len(points)].x * point.y
            for index, point in enumerate(points)
        )
    )
    if twice_area <= 1e-8:
        raise _fail(source, f"{field} has zero area")
    return points


def _point_in_or_on_polygon(point: Vec2, polygon: tuple[Vec2, ...]) -> bool:
    """Containment with a small tolerance for rounded source coordinates."""
    if point_in_polygon(point, polygon):
        return True
    tolerance_yards = 0.01
    for start, end in zip(polygon, polygon[1:] + polygon[:1]):
        dx = end.x - start.x
        dy = end.y - start.y
        length_squared = dx * dx + dy * dy
        if length_squared <= 1e-12:
            continue
        projection = max(
            0.0,
            min(1.0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length_squared),
        )
        nearest = Vec2(start.x + projection * dx, start.y + projection * dy)
        if point.distance_to(nearest) <= tolerance_yards:
            return True
    return False


def _region(
    surface: SurfaceType,
    polygon: Any,
    region_id: Any,
    source: str,
    field: str,
) -> SurfaceRegion:
    identifier = str(region_id or "").strip()
    if not identifier:
        raise _fail(source, f"{field} requires a region id")
    return SurfaceRegion(
        surface=surface,
        polygon=_polygon(polygon, source, f"{field}.polygon"),
        priority=SURFACE_PRIORITIES[surface],
        region_id=identifier,
    )


def _native_regions(payload: dict[str, Any], source: str) -> tuple[list[SurfaceRegion], dict[str, Any]]:
    metadata = payload.get("hole_metadata")
    geometry = payload.get("geometries")
    if not isinstance(metadata, dict) or not isinstance(geometry, dict):
        raise _fail(source, "native course JSON requires hole_metadata and geometries objects")
    regions: list[SurfaceRegion] = []
    for index, tee in enumerate(geometry.get("tee_boxes", [])):
        regions.append(
            _region(SurfaceType.TEE, tee.get("polygon"), tee.get("id"), source, f"tee_boxes[{index}]")
        )
    for index, fairway in enumerate(geometry.get("fairway_segments", [])):
        regions.append(
            _region(
                SurfaceType.FAIRWAY,
                fairway.get("polygon"),
                fairway.get("segment_id") or fairway.get("id"),
                source,
                f"fairway_segments[{index}]",
            )
        )
    for index, rough in enumerate(geometry.get("rough_zones", [])):
        regions.append(
            _region(
                SurfaceType.ROUGH,
                rough.get("polygon"),
                rough.get("id") or rough.get("zone_id"),
                source,
                f"rough_zones[{index}]",
            )
        )
    green = geometry.get("green_complex")
    if not isinstance(green, dict):
        raise _fail(source, "geometries.green_complex is required")
    regions.append(
        _region(SurfaceType.GREEN, green.get("polygon"), green.get("id") or "green_primary", source, "green_complex")
    )
    for index, hazard in enumerate(geometry.get("hazards", [])):
        lie_id = str(hazard.get("lie_catalog_id", ""))
        surface = SurfaceType.WATER if "water" in lie_id else SurfaceType.BUNKER
        regions.append(
            _region(surface, hazard.get("polygon"), hazard.get("id"), source, f"hazards[{index}]")
        )
    for index, boundary in enumerate(geometry.get("out_of_bounds", [])):
        regions.append(
            _region(
                SurfaceType.OUT_OF_BOUNDS,
                boundary.get("polygon"),
                boundary.get("id"),
                source,
                f"out_of_bounds[{index}]",
            )
        )
    return regions, metadata


def _warrenbrook_regions(
    payload: dict[str, Any], source: str
) -> tuple[list[SurfaceRegion], dict[str, Any]]:
    metadata = payload.get("metadata")
    spatial = payload.get("spatial_polygons")
    if not isinstance(metadata, dict) or not isinstance(spatial, dict):
        raise _fail(source, "Warrenbrook JSON requires metadata and spatial_polygons objects")
    regions: list[SurfaceRegion] = [
        _region(
            SurfaceType.TEE,
            spatial.get("tee_complex", {}).get("coordinates"),
            "tee_primary",
            source,
            "tee_complex",
        )
    ]
    for index, fairway in enumerate(spatial.get("fairway_segments", [])):
        regions.append(
            _region(
                SurfaceType.FAIRWAY,
                fairway.get("coordinates"),
                fairway.get("segment_id"),
                source,
                f"fairway_segments[{index}]",
            )
        )
    rough_items = spatial.get("rough_zones", spatial.get("rough_patches", []))
    for index, rough in enumerate(rough_items):
        regions.append(
            _region(
                SurfaceType.ROUGH,
                rough.get("coordinates"),
                rough.get("zone_id") or rough.get("patch_id"),
                source,
                f"rough_zones[{index}]",
            )
        )
    green = spatial.get("green_complex")
    if not isinstance(green, dict):
        raise _fail(source, "spatial_polygons.green_complex is required")
    regions.append(
        _region(SurfaceType.GREEN, green.get("coordinates"), "green_primary", source, "green_complex")
    )
    for index, feature in enumerate(payload.get("hazards_and_features", [])):
        feature_type = str(feature.get("type", ""))
        if feature_type == "sand_trap":
            surface = SurfaceType.BUNKER
        elif feature_type in {"water_body", "water_penalty"}:
            surface = SurfaceType.WATER
        elif feature_type == "out_of_bounds":
            surface = SurfaceType.OUT_OF_BOUNDS
        elif feature_type in {"obstruction", "path"}:
            surface = SurfaceType.NATIVE
        else:
            continue
        regions.append(
            _region(
                surface,
                feature.get("coordinates"),
                feature.get("feature_id"),
                source,
                f"hazards_and_features[{index}]",
            )
        )
    return regions, metadata


def adapt_hole_payload(
    payload: dict[str, Any], *, course_id: str, source: str = "course payload"
) -> AdaptedHole:
    """Validate and adapt either supported course schema into canonical yards."""
    if not isinstance(payload, dict):
        raise _fail(source, "top-level JSON value must be an object")
    if "geometries" in payload:
        regions, metadata = _native_regions(payload, source)
        source_schema = "native"
        course_name = metadata.get("course_name")
        hole_number = metadata.get("hole_number")
        handicap = metadata.get("handicap_rating")
        units = metadata.get("coordinate_system", {}).get("unit", "meters")
    elif "spatial_polygons" in payload:
        regions, metadata = _warrenbrook_regions(payload, source)
        source_schema = "warrenbrook"
        course_name = payload.get("course_name")
        hole_number = payload.get("hole_id")
        handicap = metadata.get("handicap")
        units = metadata.get("units")
    else:
        raise _fail(source, "unsupported course JSON schema")

    if units not in {"meter", "meters"}:
        raise _fail(source, f"unsupported coordinate unit: {units!r}")
    if not isinstance(course_name, str) or not course_name.strip():
        raise _fail(source, "course name is required")
    if isinstance(hole_number, bool) or not isinstance(hole_number, int) or not 1 <= hole_number <= 18:
        raise _fail(source, "hole number must be an integer between 1 and 18")
    par = metadata.get("par")
    if isinstance(par, bool) or not isinstance(par, int) or not 3 <= par <= 6:
        raise _fail(source, "par must be an integer between 3 and 6")
    if isinstance(handicap, bool) or not isinstance(handicap, int) or not 1 <= handicap <= 18:
        raise _fail(source, "handicap must be an integer between 1 and 18")
    distance_meters = _number(metadata.get("total_distance_meters"), source, "total_distance_meters")
    if distance_meters <= 0:
        raise _fail(source, "total_distance_meters must be positive")

    waypoints = payload.get("centerline_waypoints")
    if not isinstance(waypoints, list) or len(waypoints) < 2:
        raise _fail(source, "centerline_waypoints requires at least two points")
    centerline = tuple(
        _point(waypoint.get("point") if isinstance(waypoint, dict) else None, source, f"centerline_waypoints[{index}].point")
        for index, waypoint in enumerate(waypoints)
    )
    region_ids = [region.region_id for region in regions]
    if len(region_ids) != len(set(region_ids)):
        raise _fail(source, "surface region ids must be unique within a hole")
    available = {region.surface for region in regions}
    for required in (SurfaceType.TEE, SurfaceType.ROUGH, SurfaceType.GREEN):
        if required not in available:
            raise _fail(source, f"required {required.value} surface is missing")
    tee = centerline[0]
    pin = centerline[-1]
    if not any(_point_in_or_on_polygon(tee, region.polygon) for region in regions if region.surface is SurfaceType.TEE):
        raise _fail(source, "centerline start is outside every tee polygon")
    if not any(_point_in_or_on_polygon(pin, region.polygon) for region in regions if region.surface is SurfaceType.GREEN):
        raise _fail(source, "centerline finish is outside the green polygon")

    return AdaptedHole(
        course_id=course_id,
        course_name=course_name.strip(),
        hole_number=hole_number,
        par=par,
        handicap=handicap,
        declared_distance_yards=round(distance_meters * METERS_TO_YARDS, 4),
        centerline=centerline,
        tee=tee,
        pin=pin,
        surfaces=tuple(regions),
        source_schema=source_schema,
    )


def load_hole(path: Path, *, course_id: str | None = None) -> AdaptedHole:
    """Load one course JSON file and return a validated canonical hole."""
    source = str(path)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise _fail(source, f"cannot load valid JSON: {error}") from error
    return adapt_hole_payload(payload, course_id=course_id or path.parent.name, source=source)


def load_course(course_directory: Path, *, course_id: str | None = None) -> tuple[AdaptedHole, ...]:
    """Load and validate a complete 18-hole course directory."""
    identifier = course_id or course_directory.name
    holes = tuple(load_hole(course_directory / f"hole{number}.json", course_id=identifier) for number in range(1, 19))
    if tuple(hole.hole_number for hole in holes) != tuple(range(1, 19)):
        raise _fail(str(course_directory), "hole files do not contain hole numbers 1 through 18")
    if len({hole.course_name for hole in holes}) != 1:
        raise _fail(str(course_directory), "hole files disagree on course name")
    return holes
