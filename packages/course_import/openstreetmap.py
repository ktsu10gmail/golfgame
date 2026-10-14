"""Bounded OpenStreetMap/Overpass adapter for Course Mapper Beta drafts."""

from __future__ import annotations

import hashlib
import copy
import json
import math
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from .golf_intelligence import CourseImportError, ProviderError
from .models import ExternalCourseSummary
from .normalizer import MAPPER_PROJECT_VERSION
from .store import CourseImportStore


OSM_PROVIDER = "openstreetmap"
OSM_NORMALIZER_VERSION = "osm-beta-v3-library"
JsonTransport = Callable[[str, bytes, Mapping[str, str], float, int], tuple[int, bytes]]


def _enabled(value: object, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().casefold() in {"1", "true", "yes", "on"}


@dataclass(frozen=True, slots=True)
class OpenStreetMapConfig:
    endpoint: str = ""
    enabled: bool = False
    timeout_seconds: float = 25
    cache_ttl_hours: int = 24
    user_agent: str = "JettaGolfMapper/1.0"
    max_response_bytes: int = 8 * 1024 * 1024
    max_elements: int = 12_000
    max_points_per_feature: int = 2_000
    max_total_points: int = 80_000
    max_relation_depth: int = 2

    @classmethod
    def from_env(cls) -> "OpenStreetMapConfig":
        endpoint = os.getenv("OSM_IMPORT_ENDPOINT", "").strip()
        parsed = urlparse(endpoint) if endpoint else None
        if endpoint and (parsed.scheme != "https" or not parsed.netloc):
            raise ValueError("OSM_IMPORT_ENDPOINT must be an HTTPS URL")
        return cls(
            endpoint=endpoint,
            enabled=_enabled(os.getenv("OSM_IMPORT_ENABLED"), bool(endpoint)),
            timeout_seconds=max(3, min(float(os.getenv("OSM_IMPORT_TIMEOUT_SECONDS", "25")), 60)),
            cache_ttl_hours=max(1, min(int(os.getenv("OSM_IMPORT_CACHE_TTL_HOURS", "24")), 168)),
            user_agent=os.getenv("OSM_IMPORT_USER_AGENT", "JettaGolfMapper/1.0").strip()
            or "JettaGolfMapper/1.0",
            max_response_bytes=max(100_000, min(int(os.getenv(
                "OSM_IMPORT_MAX_RESPONSE_BYTES", str(8 * 1024 * 1024)
            )), 20 * 1024 * 1024)),
            max_elements=max(100, min(int(os.getenv("OSM_IMPORT_MAX_ELEMENTS", "12000")), 50_000)),
            max_points_per_feature=max(50, min(int(os.getenv(
                "OSM_IMPORT_MAX_POINTS_PER_FEATURE", "2000"
            )), 10_000)),
            max_total_points=max(1_000, min(int(os.getenv(
                "OSM_IMPORT_MAX_TOTAL_POINTS", "80000"
            )), 250_000)),
        )

    @property
    def ready(self) -> bool:
        return self.enabled and bool(self.endpoint)


def _default_transport(
    url: str,
    body: bytes,
    headers: Mapping[str, str],
    timeout: float,
    max_bytes: int,
) -> tuple[int, bytes]:
    request = Request(url, data=body, headers=dict(headers), method="POST")
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = response.read(max_bytes + 1)
            if len(payload) > max_bytes:
                raise ProviderError("OpenStreetMap response exceeded the safe size limit", status=413)
            return response.status, payload
    except HTTPError as error:
        return error.code, error.read(min(max_bytes, 64 * 1024))
    except (URLError, TimeoutError) as error:
        raise ProviderError("OpenStreetMap is unavailable; try again shortly") from error


def _number(value: Any, label: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as error:
        raise CourseImportError(f"{label} is invalid") from error
    if not math.isfinite(result):
        raise CourseImportError(f"{label} is invalid")
    return result


def _coordinate(raw: Any) -> dict[str, float] | None:
    if not isinstance(raw, dict):
        return None
    try:
        lat = float(raw.get("lat"))
        lng = float(raw.get("lon", raw.get("lng")))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(lat) or not math.isfinite(lng) or not -90 <= lat <= 90 or not -180 <= lng <= 180:
        return None
    return {"lat": round(lat, 8), "lng": round(lng, 8)}


def _geometry_points(raw: Any, limit: int) -> list[dict[str, float]]:
    if not isinstance(raw, list) or len(raw) > limit:
        return []
    points = [point for point in (_coordinate(item) for item in raw) if point is not None]
    compact: list[dict[str, float]] = []
    for point in points:
        if not compact or point != compact[-1]:
            compact.append(point)
    return compact


def _center(element: dict[str, Any], point_limit: int) -> dict[str, float] | None:
    direct = _coordinate(element)
    if direct:
        return direct
    direct = _coordinate(element.get("center"))
    if direct:
        return direct
    points = _geometry_points(element.get("geometry"), point_limit)
    if not points and isinstance(element.get("members"), list):
        member_points = [
            point
            for member in element["members"]
            if isinstance(member, dict)
            for point in _geometry_points(member.get("geometry"), point_limit)
        ]
        points = member_points[:point_limit]
    if not points:
        return None
    return {
        "lat": round(sum(point["lat"] for point in points) / len(points), 8),
        "lng": round(sum(point["lng"] for point in points) / len(points), 8),
    }


def _tags(element: dict[str, Any]) -> dict[str, str]:
    raw = element.get("tags")
    return {str(key): str(value) for key, value in raw.items()} if isinstance(raw, dict) else {}


def _hole_number(tags: dict[str, str]) -> int | None:
    match = re.fullmatch(r"\s*(\d{1,2})\s*", tags.get("ref", ""))
    if not match:
        return None
    number = int(match.group(1))
    return number if 1 <= number <= 27 else None


def _element_identity(element: dict[str, Any]) -> str:
    return f"{element.get('type')}/{element.get('id')}"


def osm_game_course_id(external_id: str) -> str:
    """Return the safe, stable Jetta game ID for a verified OSM facility."""
    match = re.fullmatch(r"(node|way|relation)/(\d{1,18})", str(external_id or ""))
    if not match:
        raise CourseImportError("select a valid OpenStreetMap golf facility")
    return f"osm-{match.group(1)}-{match.group(2)}"


def _empty_hole(number: int) -> dict[str, Any]:
    return {
        "hole_number": number,
        "par": 4,
        "handicap": number if number <= 18 else (number - 1) % 9 + 1,
        "layout_type": "OpenStreetMap draft — review required",
        "elevation_change_meters": 0,
        "yardages": {"blue": 0, "white": 0, "forward": 0},
        "markers": {"blue_tee": None, "white_tee": None, "forward_tee": None, "pin": None},
        "route_points": [],
        "features": [],
        "geometry_reference": {
            "coordinate_system": "WGS84",
            "georeferenced": True,
            "source": OSM_PROVIDER,
        },
        "import_status": "NEEDS_REVIEW",
        "import_warnings": ["Complete tee identities and scorecard yardages before installation."],
    }


def _distance_meters(first: dict[str, float], second: dict[str, float]) -> float:
    mean_lat = math.radians((first["lat"] + second["lat"]) / 2)
    north = (second["lat"] - first["lat"]) * 111_320
    east = (second["lng"] - first["lng"]) * 111_320 * max(.1, math.cos(mean_lat))
    return math.hypot(east, north)


def _point_in_polygon(point: dict[str, float], polygon: list[dict[str, float]]) -> bool:
    inside = False
    x, y = point["lng"], point["lat"]
    for index in range(len(polygon)):
        first = polygon[index - 1]
        second = polygon[index]
        if ((first["lat"] > y) != (second["lat"] > y)):
            crossing = (
                (second["lng"] - first["lng"])
                * (y - first["lat"])
                / (second["lat"] - first["lat"])
                + first["lng"]
            )
            if x < crossing:
                inside = not inside
    return inside


def _facility_boundaries(
    facility: dict[str, Any], point_limit: int
) -> list[list[dict[str, float]]]:
    if facility.get("type") == "relation":
        members = facility.get("members") if isinstance(facility.get("members"), list) else []
        rings, _ = _assemble_outer_rings(members, point_limit)
        return rings
    points = _geometry_points(facility.get("geometry"), point_limit)
    return [points] if len(points) >= 4 and points[0] == points[-1] else []


def _point_segment_distance(point: dict[str, float], start: dict[str, float], end: dict[str, float]) -> float:
    latitude_scale = 111_320.0
    longitude_scale = latitude_scale * max(.1, math.cos(math.radians(point["lat"])))
    ax = (start["lng"] - point["lng"]) * longitude_scale
    ay = (start["lat"] - point["lat"]) * latitude_scale
    bx = (end["lng"] - point["lng"]) * longitude_scale
    by = (end["lat"] - point["lat"]) * latitude_scale
    dx, dy = bx - ax, by - ay
    denominator = dx * dx + dy * dy
    position = 0 if denominator == 0 else max(0, min(1, -(ax * dx + ay * dy) / denominator))
    return math.hypot(ax + position * dx, ay + position * dy)


def _route_distance(point: dict[str, float], route: list[dict[str, float]]) -> float:
    return min(
        (_point_segment_distance(point, route[index - 1], route[index])
         for index in range(1, len(route))),
        default=math.inf,
    )


def _assemble_outer_rings(
    members: list[Any], point_limit: int
) -> tuple[list[list[dict[str, float]]], int]:
    """Join bounded relation outer-way fragments without recursive expansion."""
    segments = [
        points for points in (
            _geometry_points(member.get("geometry"), point_limit)
            for member in members
            if isinstance(member, dict) and member.get("role") in {"", "outer"}
        ) if len(points) >= 2
    ]
    rings: list[list[dict[str, float]]] = []
    unresolved = 0
    while segments:
        ring = segments.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for index, segment in enumerate(segments):
                if ring[-1] == segment[0]:
                    ring.extend(segment[1:])
                elif ring[-1] == segment[-1]:
                    ring.extend(reversed(segment[:-1]))
                elif ring[0] == segment[-1]:
                    ring = segment[:-1] + ring
                elif ring[0] == segment[0]:
                    ring = list(reversed(segment[1:])) + ring
                else:
                    continue
                segments.pop(index)
                changed = True
                break
        if len(ring) >= 4 and ring[0] == ring[-1] and len(ring) <= point_limit:
            rings.append(ring)
        else:
            unresolved += 1
    return rings, unresolved


class OpenStreetMapProvider:
    name = OSM_PROVIDER

    def __init__(self, config: OpenStreetMapConfig, transport: JsonTransport = _default_transport):
        self.config = config
        self.transport = transport
        self.request_lock = threading.Lock()
        self.retry_at = 0.0
        self.search_cache = {}

    def _request(self, query: str) -> dict[str, Any]:
        remaining = self.retry_at - time.monotonic()
        if remaining > 0:
            raise ProviderError(f"OSM is free, but its shared server limits requests. Wait {math.ceil(remaining)} seconds before retrying.", status=429)
        if not self.request_lock.acquire(blocking=False):
            raise ProviderError("An OSM request is already running locally. Wait for it to finish.", status=409)
        try:
            return self._perform_request(query)
        finally:
            self.request_lock.release()

    def _perform_request(self, query: str) -> dict[str, Any]:
        if not self.config.ready:
            raise ProviderError("OpenStreetMap import is not configured")
        # Overpass otherwise reserves its default 512 MiB allowance even for
        # tiny golf queries, making resource-admission failures more likely.
        if "[maxsize:" not in query:
            query = query.replace("[out:json]", "[out:json][maxsize:67108864]", 1)
        body = urlencode({"data": query}).encode()
        for attempt in range(1):
            status, raw = self.transport(
                self.config.endpoint,
                body,
                {
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": self.config.user_agent,
                },
                self.config.timeout_seconds,
                self.config.max_response_bytes,
            )
            if not 200 <= status < 300:
                if status == 429:
                    self.retry_at = time.monotonic() + 60
                message = "OSM is free, but its shared server limits requests. Wait 60 seconds before retrying." if status == 429 else (
                    "The OSM server timed out while fetching course geometry. No credit was used; try again later."
                    if status == 504 else "OpenStreetMap could not complete the request"
                )
                raise ProviderError(message, status=status)
            try:
                payload = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise ProviderError("OpenStreetMap returned invalid JSON") from error
            elements = payload.get("elements") if isinstance(payload, dict) else None
            if isinstance(payload, dict) and payload.get("remark"):
                raise ProviderError("OSM could not finish the query. Try again later or use a smaller radius.", status=503)
            if not isinstance(elements, list):
                raise ProviderError("OpenStreetMap returned an invalid element list")
            if len(elements) > self.config.max_elements:
                raise ProviderError("OpenStreetMap result exceeded the safe element limit", status=413)
            return payload
        raise ProviderError("OpenStreetMap is temporarily unavailable")

    def search_courses(self, latitude: Any, longitude: Any, radius_meters: Any = 3_000) -> list[ExternalCourseSummary]:
        lat = _number(latitude, "map latitude")
        lng = _number(longitude, "map longitude")
        radius = int(_number(radius_meters, "search radius"))
        if not -90 <= lat <= 90 or not -180 <= lng <= 180:
            raise CourseImportError("map coordinates are outside the valid range")
        if not 250 <= radius <= 5_000:
            raise CourseImportError("OpenStreetMap search radius must be between 250 and 5000 meters")
        key = (round(lat, 7), round(lng, 7), radius)
        now = time.monotonic()
        cached = self.search_cache.get(key)
        if cached and cached[0] > now:
            return copy.deepcopy(cached[1])
        # Bounding-box selection avoids expensive around-distance evaluation for
        # every way/relation. Filter centers back to the requested radius below.
        lat_span = radius / 111320
        lng_span = radius / (111320 * max(.1, math.cos(math.radians(lat))))
        bounds = f"({max(-90, lat-lat_span):.7f},{max(-180, lng-lng_span):.7f},{min(90, lat+lat_span):.7f},{min(180, lng+lng_span):.7f})"
        query = (
            f"[out:json][timeout:{int(self.config.timeout_seconds)}];"
            f"nwr{bounds}[\"leisure\"=\"golf_course\"];"
            "out center tags;"
        )
        payload = self._request(query)
        results = []
        for element in payload["elements"]:
            if not isinstance(element, dict) or element.get("type") not in {"node", "way", "relation"}:
                continue
            center = _center(element, self.config.max_points_per_feature)
            if center is None:
                continue
            if _distance_meters({"lat": lat, "lng": lng}, center) > radius:
                continue
            tags = _tags(element)
            name = tags.get("name") or tags.get("operator") or "Unnamed golf facility"
            results.append(ExternalCourseSummary(
                provider=self.name,
                external_id=_element_identity(element),
                name=name,
                facility_name=name,
                city=tags.get("addr:city"),
                region=tags.get("addr:state"),
                country=tags.get("addr:country"),
                latitude=center["lat"],
                longitude=center["lng"],
            ))
        results.sort(key=lambda item: (
            _distance_meters({"lat": lat, "lng": lng}, {"lat": item.latitude, "lng": item.longitude}),
            item.name.casefold(), item.external_id,
        ))
        results = results[:20]
        self.search_cache = {cache_key: value for cache_key, value in self.search_cache.items() if value[0] > now}
        if len(self.search_cache) >= 100:
            self.search_cache.pop(next(iter(self.search_cache)))
        # Only successful searches are cached; outages never become empty lists.
        self.search_cache[key] = (time.monotonic() + 600, copy.deepcopy(results))
        return results

    def get_course_detail(self, external_id: str, radius_meters: Any = 2_500) -> dict[str, Any]:
        match = re.fullmatch(r"(node|way|relation)/(\d{1,18})", str(external_id or ""))
        if not match:
            raise CourseImportError("select a valid OpenStreetMap golf facility")
        element_type, element_id = match.groups()
        radius = int(_number(radius_meters, "import radius"))
        if not 250 <= radius <= 5_000:
            raise CourseImportError("OpenStreetMap import radius must be between 250 and 5000 meters")
        facility_payload = self._request(
            f"[out:json][timeout:{int(self.config.timeout_seconds)}];"
            f"{element_type}({element_id});out body geom;"
        )
        facility = next((item for item in facility_payload["elements"]
                         if isinstance(item, dict) and _element_identity(item) == external_id), None)
        if facility is None:
            raise CourseImportError("OpenStreetMap did not return the selected golf facility", status=422)
        boundaries = _facility_boundaries(facility, self.config.max_points_per_feature)
        points = [point for boundary in boundaries for point in boundary]
        if points:
            # Query the facility footprint, not a radius around every boundary
            # vertex. That broad radius pulled neighboring towns into previews.
            latitude = sum(point["lat"] for point in points) / len(points)
            lat_pad = 30 / 111320
            lng_pad = 30 / (111320 * max(.1, math.cos(math.radians(latitude))))
            south, north = min(p["lat"] for p in points) - lat_pad, max(p["lat"] for p in points) + lat_pad
            west, east = min(p["lng"] for p in points) - lng_pad, max(p["lng"] for p in points) + lng_pad
            selector = f"({max(-90, south):.7f},{max(-180, west):.7f},{min(90, north):.7f},{min(180, east):.7f})"
        else:
            center = _center(facility, self.config.max_points_per_feature)
            if center is None:
                raise CourseImportError("OpenStreetMap golf facility has no usable location", status=422)
            selector = f"(around:{radius},{center['lat']:.7f},{center['lng']:.7f})"
        query = (
            f"[out:json][timeout:{int(self.config.timeout_seconds)}];"
            "("
            f"nwr{selector}[\"golf\"];"
            f"nwr{selector}[\"natural\"=\"water\"];"
            f"nwr{selector}[\"water\"];"
            ");out body geom;"
        )
        detail = self._request(query)
        detail["elements"] = [facility] + [element for element in detail["elements"]
                                           if isinstance(element, dict) and _element_identity(element) != external_id]
        if len(detail["elements"]) > self.config.max_elements:
            raise CourseImportError("OpenStreetMap result exceeded the safe element limit", status=413)
        return detail


def normalize_openstreetmap_course(
    payload: dict[str, Any],
    external_id: str,
    *,
    requested_name: str = "",
    requested_city: str = "",
    requested_state: str = "",
    production_context: dict[str, str] | None = None,
    max_points_per_feature: int = 2_000,
    max_total_points: int = 80_000,
) -> dict[str, Any]:
    elements = [item for item in payload.get("elements", []) if isinstance(item, dict)]
    facility = next((item for item in elements if _element_identity(item) == external_id), None)
    if facility is None:
        raise CourseImportError("OpenStreetMap did not return the selected golf facility", status=422)
    facility_tags = _tags(facility)
    facility_center = _center(facility, max_points_per_feature)
    if facility_center is None:
        raise CourseImportError("OpenStreetMap golf facility has no usable location", status=422)

    warnings: list[str] = []
    skipped: list[dict[str, str]] = []
    boundaries = _facility_boundaries(facility, max_points_per_feature)
    if boundaries:
        scoped_elements = []
        for element in elements:
            if element is facility:
                scoped_elements.append(element)
                continue
            element_center = _center(element, max_points_per_feature)
            if element_center and any(
                _point_in_polygon(element_center, boundary) for boundary in boundaries
            ):
                scoped_elements.append(element)
            elif _tags(element).get("golf") or _tags(element).get("natural") == "water":
                skipped.append({
                    "id": _element_identity(element),
                    "type": _tags(element).get("golf") or "water",
                    "reason": "outside selected facility boundary",
                })
        elements = scoped_elements
    else:
        warnings.append(
            "The selected OSM facility has no usable boundary; review nearby hole grouping carefully."
        )
    all_routes = [element for element in elements if _tags(element).get('golf') == 'hole']
    refs = [_tags(element).get('ref', '').strip() for element in all_routes]
    unsupported = any(ref.isdigit() and int(ref) > 27 for ref in refs) or (
        str(facility_tags.get('golf:holes', facility_tags.get('holes', ''))).isdigit()
        and int(facility_tags.get('golf:holes', facility_tags.get('holes'))) > 27)
    ambiguous = len([r for r in refs if r]) != len(set(r for r in refs if r))
    layout_assessment = {
        'unsupported': unsupported, 'ambiguous': ambiguous,
        'source_route_count': len(all_routes),
        'declared_hole_count': int(facility_tags.get('golf:holes', facility_tags.get('holes', '')))
            if str(facility_tags.get('golf:holes', facility_tags.get('holes', ''))).isdigit() else None,
        'reason': 'Layout exceeds the current 27-hole editor limit' if unsupported else
                  'Repeated route numbering needs explicit layout grouping' if ambiguous else '',
    }
    if unsupported or ambiguous:
        warnings.append(layout_assessment['reason'] + '; source routes are retained for review, not silently discarded.')
    total_points = 0
    routes: dict[int, dict[str, Any]] = {}
    for element in elements:
        tags = _tags(element)
        if tags.get("golf") != "hole":
            continue
        number = _hole_number(tags)
        points = _geometry_points(element.get("geometry"), max_points_per_feature)
        if number is None:
            skipped.append({"id": _element_identity(element), "type": "hole route", "reason": "missing valid ref"})
            continue
        if len(points) < 2:
            skipped.append({"id": _element_identity(element), "type": "hole route", "reason": "invalid route geometry"})
            continue
        if number in routes:
            warnings.append(f"Hole {number} has multiple OSM routes; used the first and skipped {_element_identity(element)}.")
            continue
        routes[number] = {"element": element, "tags": tags, "points": points}
        total_points += len(points)
    if not routes:
        warnings.append("OSM has no usable numbered hole routes for this course. Open this partial draft and map the holes manually; no hole numbers, tees, or yardages have been inferred.")
    if total_points > max_total_points:
        raise CourseImportError("OpenStreetMap geometry exceeded the safe point limit", status=413)

    hole_count = 27 if max(routes, default=18) > 18 else 18
    structure = "three_nines" if hole_count == 27 else "standard_18"
    holes = {str(number): _empty_hole(number) for number in range(1, hole_count + 1)}
    for number, route in routes.items():
        tags = route["tags"]
        points = route["points"]
        hole = holes[str(number)]
        # Mapper default only: OSM does not establish the tee color.
        hole["markers"]["blue_tee"] = points[0]
        hole["tee_alignment_anchor"] = "blue"
        hole["markers"]["pin"] = points[-1]
        hole["route_points"] = points[1:-1]
        if str(tags.get("par", "")).isdigit() and 3 <= int(tags["par"]) <= 6:
            hole["par"] = int(tags["par"])
        else:
            hole["import_warnings"].append("OSM did not provide a valid par; review the temporary default.")
        if str(tags.get("handicap", "")).isdigit():
            hole["handicap"] = int(tags["handicap"])
        hole["osm_hole_id"] = _element_identity(route["element"])

    counts = {key: 0 for key in ("hole_routes", "greens", "fairways", "tee_polygons", "bunkers", "water", "rough")}
    counts["hole_routes"] = len(routes)
    mapping = {
        "green": "green", "fairway": "fairway", "bunker": "bunker", "rough": "rough",
        "water_hazard": "water", "lateral_water_hazard": "water",
    }
    reference_features = []
    for index, boundary in enumerate(boundaries):
        total_points += len(boundary)
        reference_features.append({"id": f"osm-facility-boundary-{index}", "type": "facility_boundary", "label": "OSM course boundary (reference only)", "points": boundary[:-1]})
    for element in elements:
        tags = _tags(element)
        golf_value = tags.get("golf")
        is_water = tags.get("natural") == "water" or "water" in tags
        if golf_value == "hole" or tags.get("leisure") == "golf_course":
            continue
        if golf_value == "tee":
            points = _geometry_points(element.get("geometry"), max_points_per_feature)
            if len(points) >= 3:
                counts["tee_polygons"] += 1
            skipped.append({
                "id": _element_identity(element), "type": "tee polygon",
                "reason": "tee color/role is not explicit",
            })
            if len(points) >= 4 and points[0] == points[-1]:
                total_points += len(points)
                reference_features.append({"id": f"osm-tee-{element.get('id')}", "type": "tee", "label": "OSM tee (choose its role manually)", "points": points[:-1]})
            continue
        feature_type = mapping.get(golf_value) or ("water" if is_water else None)
        if feature_type is None:
            continue
        polygons: list[list[dict[str, float]]] = []
        if element.get("type") == "relation":
            members = element.get("members") if isinstance(element.get("members"), list) else []
            if any(member.get("role") == "inner" for member in members if isinstance(member, dict)):
                skipped.append({
                    "id": _element_identity(element), "type": feature_type,
                    "reason": "inner ring unsupported in Beta",
                })
            polygons, unresolved_segments = _assemble_outer_rings(
                members, max_points_per_feature
            )
            if unresolved_segments:
                warnings.append(
                    f"Skipped incomplete outer geometry in {_element_identity(element)}."
                )
        else:
            points = _geometry_points(element.get("geometry"), max_points_per_feature)
            if len(points) >= 4 and points[0] == points[-1]:
                polygons = [points]
        if not polygons:
            skipped.append({
                "id": _element_identity(element), "type": feature_type,
                "reason": "unsupported or incomplete polygon geometry",
            })
            continue
        explicit_number = _hole_number(tags)
        for polygon_index, polygon in enumerate(polygons, 1):
            total_points += len(polygon)
            if total_points > max_total_points:
                raise CourseImportError("OpenStreetMap geometry exceeded the safe point limit", status=413)
            center = {
                "lat": sum(point["lat"] for point in polygon[:-1]) / max(1, len(polygon) - 1),
                "lng": sum(point["lng"] for point in polygon[:-1]) / max(1, len(polygon) - 1),
            }
            assigned = explicit_number if str(explicit_number) in holes else None
            if assigned is None:
                distances = sorted(
                    (_route_distance(center, route["points"]), number)
                    for number, route in routes.items()
                )
                if distances and distances[0][0] <= 150 and (
                    len(distances) == 1 or distances[1][0] - distances[0][0] > 20
                ):
                    assigned = distances[0][1]
            if assigned is None:
                skipped.append({
                    "id": _element_identity(element), "type": feature_type,
                    "reason": "ambiguous hole assignment",
                })
                reference_features.append({
                    "id": f"osm-{element.get('type')}-{element.get('id')}-{polygon_index}",
                    "type": feature_type, "label": f"Unassigned OSM {feature_type}",
                    "points": polygon[:-1], "provider_feature_id": _element_identity(element),
                })
                continue
            feature_id = f"osm-{element.get('type')}-{element.get('id')}-{polygon_index}"
            holes[str(assigned)]["features"].append({
                "id": feature_id,
                "type": feature_type,
                "label": f"OSM {feature_type.replace('_', ' ')}",
                "source": OSM_PROVIDER,
                "provider_feature_id": _element_identity(element),
                "provider_version": element.get("version"),
                "manual_override": False,
                "points": polygon[:-1],
            })
            count_key = {
                "green": "greens",
                "fairway": "fairways",
                "bunker": "bunkers",
                "rough": "rough",
                "water": "water",
            }[feature_type]
            counts[count_key] += 1

    if total_points > max_total_points:
        raise CourseImportError("OpenStreetMap geometry exceeded the safe point limit", status=413)
    counts["reference_shapes"] = len(reference_features)
    if not routes and not reference_features and not any(counts.values()):
        warnings.append("OSM provides only the course location. No usable shapes were found; map this course manually.")
    for number, hole in holes.items():
        if int(number) not in routes:
            hole["import_warnings"].append("No numbered OSM route: map and verify this hole manually.")
        if int(number) in routes:
            types = {feature["type"] for feature in hole["features"]}
            if "green" not in types:
                hole["import_warnings"].append("No OSM green was assigned to this hole.")
            if hole["par"] > 3 and "fairway" not in types:
                hole["import_warnings"].append("No OSM fairway was assigned to this hole.")

    imported_at = datetime.now(UTC).isoformat()
    source_hash = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    # OSM's name tag is the authoritative source label for an OSM-derived
    # draft. The directory name is only a fallback when OSM has no name.
    course_name = facility_tags.get("name") or requested_name.strip() or "OpenStreetMap golf course"
    project = {
        "version": MAPPER_PROJECT_VERSION,
        "course_location": {"country": facility_tags.get("addr:country", ""), "state": facility_tags.get("addr:state", "") or requested_state.strip(), "city": facility_tags.get("addr:city", "") or requested_city.strip()},
        "course_name": course_name,
        "course_id": osm_game_course_id(external_id),
        "address": ", ".join(value for value in (requested_city.strip(), requested_state.strip()) if value),
        "updated_at": imported_at,
        "imagery_source": "OpenStreetMap geometry",
        "map_view": {"center": facility_center, "zoom": 16},
        "course_structure": structure,
        "nine_loops": [
            {"id": "central", "name": "Central"},
            {"id": "north", "name": "North"},
            {"id": "south", "name": "South"},
        ],
        "holes": holes,
        "production_context": dict(production_context or {}),
        "external_course_source": {
            "layout_assessment": layout_assessment,
            "unresolved_route_elements": all_routes if unsupported or ambiguous else [],
            "provider_name": OSM_PROVIDER,
            "provider_public_id": external_id,
            "provider_imported_at": imported_at,
            "provider_payload_version": payload.get("osm3s", {}).get("timestamp_osm_base"),
            "provider_source_hash": source_hash,
            "normalizer_version": OSM_NORMALIZER_VERSION,
            "attribution": "© OpenStreetMap contributors · ODbL",
            "reference_features": reference_features,
        },
        "green_contour_defaults": {
            "green_shape_source": OSM_PROVIDER,
            "green_contour_source": "simulated",
            "generator_version": "existing-contour-v1",
        },
    }
    project["import_preview"] = {
        "course": course_name,
        "provider": "OpenStreetMap",
        "counts": counts,
        "warnings": warnings,
        "skipped": skipped,
        "needs_work": [
            "Review the course layout and assign unnumbered reference shapes to the correct holes.",
            "Complete blue, white, and forward tee identities and polygons.",
            "Enter trusted scorecard yardages.",
            f"Review {len(skipped)} skipped or unresolved OSM feature{'s' if len(skipped) != 1 else ''}.",
        ],
        "ready_for_review": bool(counts["hole_routes"] and counts["greens"]),
        "normalizer_version": OSM_NORMALIZER_VERSION,
        "partial_draft": len(routes) < hole_count,
        "reference_feature_count": len(reference_features),
    }
    return project


class OpenStreetMapImportService:
    def __init__(
        self,
        config: OpenStreetMapConfig,
        store: CourseImportStore,
        provider: OpenStreetMapProvider | None = None,
    ):
        self.config = config
        self.store = store
        self.provider = provider or OpenStreetMapProvider(config)

    def status(self) -> dict[str, Any]:
        return {
            "provider": OSM_PROVIDER,
            "enabled": self.config.enabled,
            "endpoint_configured": bool(self.config.endpoint),
            "ready_for_search": self.config.ready,
            "normalizer_version": OSM_NORMALIZER_VERSION,
            "cache_ttl_hours": self.config.cache_ttl_hours,
            "play_mode_uses_provider": False,
        }

    def search(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            results = self.provider.search_courses(
                payload.get("latitude"), payload.get("longitude"), payload.get("radius_meters", 3_000)
            )
        except ProviderError as error:
            raise CourseImportError(str(error), status=error.status or 502) from error
        items = []
        for result in results:
            item = result.to_dict()
            item["cache"] = self.store.cache_status(OSM_PROVIDER, result.external_id)
            items.append(item)
        return {"results": items, "source": "OpenStreetMap", "cost": {"credits": 0}}

    def preview(self, payload: dict[str, Any], requested_by: str | None) -> dict[str, Any]:
        external_id = str(payload.get("external_id") or "").strip()
        refresh = payload.get("refresh") is True
        cached = None if refresh else self.store.cached_course(OSM_PROVIDER, external_id)
        if cached and cached["project"].get("external_course_source", {}).get(
            "normalizer_version"
        ) != OSM_NORMALIZER_VERSION:
            cached = None
        job_id = f"osm-{secrets.token_urlsafe(12)}"
        self.store.create_job(
            job_id, OSM_PROVIDER, external_id, requested_by,
            credit_cost_estimate=0, cache_hit=cached is not None,
        )
        try:
            if cached:
                project = copy.deepcopy(cached["project"])
                requested_name = str(payload.get("course_name") or "").strip()
                if requested_name:
                    project["course_name"] = requested_name
                    project["course_id"] = (
                        re.sub(r"[^a-z0-9]+", "-", requested_name.casefold()).strip("-")
                        or "osm-course"
                    )
                requested_location = ", ".join(
                    value for value in (
                        str(payload.get("city") or "").strip(),
                        str(payload.get("state_code") or "").strip(),
                    ) if value
                )
                if requested_location:
                    project["address"] = requested_location
                if isinstance(payload.get("production_context"), dict):
                    project["production_context"] = {
                        "production_item_id": str(
                            payload["production_context"].get("production_item_id") or ""
                        ),
                        "directory_course_id": str(
                            payload["production_context"].get("directory_course_id") or ""
                        ),
                    }
                else:
                    project["production_context"] = {}
            else:
                detail = self.provider.get_course_detail(
                    external_id, payload.get("radius_meters", 2_500)
                )
                project = normalize_openstreetmap_course(
                    detail,
                    external_id,
                    requested_name=str(payload.get("course_name") or ""),
                    requested_city=str(payload.get("city") or ""),
                    requested_state=str(payload.get("state_code") or ""),
                    production_context=payload.get("production_context")
                    if isinstance(payload.get("production_context"), dict) else None,
                    max_points_per_feature=self.config.max_points_per_feature,
                    max_total_points=self.config.max_total_points,
                )
                fetched_at = datetime.now(UTC)
                cache_project = copy.deepcopy(project)
                cache_project["production_context"] = {}
                self.store.save_cached_course(
                    OSM_PROVIDER,
                    external_id,
                    fetched_at=fetched_at,
                    expires_at=fetched_at + timedelta(hours=self.config.cache_ttl_hours),
                    response_hash=project["external_course_source"]["provider_source_hash"],
                    project=cache_project,
                )
            self.store.finish_job(job_id, "READY_FOR_REVIEW", project=project)
        except (ProviderError, CourseImportError, ValueError) as error:
            self.store.finish_job(job_id, "FAILED", error_message=str(error))
            status = error.status if isinstance(error, (ProviderError, CourseImportError)) else 422
            raise CourseImportError(str(error), status=status or 502) from error
        return {
            "job_id": job_id,
            "status": "READY_FOR_REVIEW",
            "cache_hit": cached is not None,
            "preview": project["import_preview"],
        }

    def commit(self, payload: dict[str, Any], requested_by: str | None) -> dict[str, Any]:
        job_id = str(payload.get("job_id") or "").strip()
        job = self.store.import_job(job_id)
        if not job:
            raise CourseImportError("The OpenStreetMap import preview was not found", status=404)
        if requested_by and job.get("requested_by") and requested_by != job["requested_by"]:
            raise CourseImportError("This OpenStreetMap import belongs to another operator", status=403)
        if job["status"] not in {"READY_FOR_REVIEW", "IMPORTED"} or not job["project"]:
            raise CourseImportError("The OpenStreetMap import is not ready", status=409)
        self.store.finish_job(job_id, "IMPORTED", project=job["project"])
        return {"job_id": job_id, "status": "IMPORTED", "project": job["project"]}
