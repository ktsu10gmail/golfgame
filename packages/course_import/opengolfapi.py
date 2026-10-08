"""Bounded server-side OpenGolfAPI scorecard enrichment."""
from __future__ import annotations

import json
import math
import os
import re
import threading
from dataclasses import dataclass
from typing import Any, Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen

from .golf_intelligence import ProviderError


JsonTransport = Callable[[str, Mapping[str, str], float, int], tuple[int, bytes]]


def _enabled(value: object, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().casefold() in {"1", "true", "yes", "on"}


@dataclass(frozen=True, slots=True)
class OpenGolfApiConfig:
    base_url: str = "https://api.opengolfapi.org"
    api_key: str = ""
    enabled: bool = False
    timeout_seconds: float = 20
    max_response_bytes: int = 4 * 1024 * 1024

    @classmethod
    def from_env(cls) -> "OpenGolfApiConfig":
        base = os.getenv("OPENGOLFAPI_BASE_URL", "https://api.opengolfapi.org").strip().rstrip("/")
        # Accept the documented /v1 suffix in configuration, but keep one host root internally.
        if base.endswith("/v1"):
            base = base[:-3]
        parsed = urlparse(base)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("OPENGOLFAPI_BASE_URL must be an HTTPS URL")
        key = os.getenv("OPENGOLFAPI_KEY", "").strip()
        return cls(
            base_url=base,
            api_key=key,
            enabled=_enabled(os.getenv("OPENGOLFAPI_ENABLED"), bool(key)),
            timeout_seconds=max(3, min(float(os.getenv("OPENGOLFAPI_TIMEOUT_SECONDS", "20")), 60)),
            max_response_bytes=max(100_000, min(int(os.getenv(
                "OPENGOLFAPI_MAX_RESPONSE_BYTES", str(4 * 1024 * 1024)
            )), 10 * 1024 * 1024)),
        )

    @property
    def ready(self) -> bool:
        return self.enabled and bool(self.base_url)


def _transport(url: str, headers: Mapping[str, str], timeout: float, max_bytes: int) -> tuple[int, bytes]:
    request = Request(url, headers=dict(headers), method="GET")
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read(max_bytes + 1)
            if len(body) > max_bytes:
                raise ProviderError("OpenGolfAPI response exceeded the safe size limit", status=413)
            return response.status, body
    except HTTPError as error:
        return error.code, error.read(min(max_bytes, 64 * 1024))
    except (URLError, TimeoutError) as error:
        raise ProviderError("OpenGolfAPI is unavailable; scorecard enrichment was deferred", status=503) from error


def _key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold()).strip()


def _distance_meters(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    mean = math.radians((a_lat + b_lat) / 2)
    return math.hypot((b_lat-a_lat)*111_320, (b_lng-a_lng)*111_320*max(.1, math.cos(mean)))


class OpenGolfApiClient:
    def __init__(self, config: OpenGolfApiConfig, transport: JsonTransport = _transport):
        self.config = config
        self.transport = transport
        self.lock = threading.Lock()

    def _get(self, path: str, query: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.config.ready:
            raise ProviderError("OpenGolfAPI scorecard enrichment is not configured", status=503)
        url = self.config.base_url + path
        if query:
            url += "?" + urlencode(query)
        headers = {"Accept": "application/json", "User-Agent": "JettaGolfMapper/1.0"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        with self.lock:
            status, body = self.transport(url, headers, self.config.timeout_seconds, self.config.max_response_bytes)
        if status == 429:
            raise ProviderError("OpenGolfAPI rate limit reached; scorecard enrichment was deferred", status=429)
        if status != 200:
            raise ProviderError(f"OpenGolfAPI returned {status}; scorecard enrichment was deferred", status=status)
        try:
            result = json.loads(body)
        except (UnicodeDecodeError, ValueError) as error:
            raise ProviderError("OpenGolfAPI returned invalid JSON", status=502) from error
        if not isinstance(result, dict):
            raise ProviderError("OpenGolfAPI returned an invalid response", status=502)
        return result

    def match(self, *, name: str, city: str, state: str, latitude: float, longitude: float) -> dict[str, Any]:
        payload = self._get("/v1/courses/search", {"q": name, "state": state, "limit": 10})
        candidates = []
        for item in payload.get("courses", []):
            if not isinstance(item, dict) or _key(item.get("course_name") or item.get("name")) != _key(name):
                continue
            if state and _key(item.get("state")) != _key(state):
                continue
            try:
                distance = _distance_meters(latitude, longitude, float(item["latitude"]), float(item["longitude"]))
            except (KeyError, TypeError, ValueError):
                continue
            if distance <= 15_000:
                candidates.append((distance, item))
        candidates.sort(key=lambda value: value[0])
        if len(candidates) != 1:
            raise ValueError(f"{len(candidates)} exact OpenGolfAPI matches; review the scorecard source")
        return candidates[0][1]

    def detail(self, course_id: str) -> dict[str, Any]:
        return self._get(f"/api/v1/courses/{quote(str(course_id), safe='')}")


def enrich_project_scorecard(project: dict[str, Any], detail: dict[str, Any]) -> dict[str, Any]:
    """Merge only official scorecard facts; geographic distances remain separate."""
    holes = detail.get("holes_data")
    if not isinstance(holes, list):
        raise ValueError("OpenGolfAPI course detail has no hole scorecard")
    by_number = {}
    for raw in holes:
        if not isinstance(raw, dict):
            continue
        try:
            number = int(raw.get("number"))
        except (TypeError, ValueError):
            continue
        if number in by_number or not 1 <= number <= len(project.get("holes", {})):
            raise ValueError("OpenGolfAPI scorecard has invalid or duplicate hole numbers")
        by_number[number] = raw
    if not by_number:
        raise ValueError("OpenGolfAPI course detail has no usable holes")

    role_keys = {
        "blue": ("blue", "black", "championship"),
        "white": ("white",),
        "forward": ("red", "forward", "gold", "yellow"),
    }
    imported = {"par": 0, "handicap": 0, "yardages": {role: 0 for role in role_keys}}
    for number, source in by_number.items():
        hole = project["holes"].get(str(number))
        if not hole:
            continue
        par = source.get("par")
        handicap = source.get("handicap_index")
        if isinstance(par, int) and 3 <= par <= 6:
            hole["par"] = par; imported["par"] += 1
        if isinstance(handicap, int) and 1 <= handicap <= 18:
            hole["handicap"] = handicap; imported["handicap"] += 1
        yardages = source.get("yardages") if isinstance(source.get("yardages"), dict) else {}
        provenance = hole.setdefault("field_provenance", {})
        provenance.update({"par": "opengolfapi", "handicap": "opengolfapi"})
        yardage_provenance = provenance.setdefault("yardages", {})
        for role, keys in role_keys.items():
            value = next((yardages.get(key) for key in keys if isinstance(yardages.get(key), (int, float)) and yardages.get(key) > 0), None)
            if value is not None:
                hole.setdefault("yardages", {})[role] = int(round(value))
                yardage_provenance[role] = "opengolfapi"
                imported["yardages"][role] += 1

    source = project.setdefault("external_course_source", {})
    source["opengolfapi"] = {
        "course_id": str(detail.get("id") or ""),
        "course_name": str(detail.get("course_name") or ""),
        "coordinate_system": "WGS84",
        "attribution": "OpenGolfAPI · ODbL-1.0",
        "tees": detail.get("tees") if isinstance(detail.get("tees"), list) else [],
        "fields_imported": imported,
    }
    preview = project.setdefault("import_preview", {})
    preview["scorecard"] = {"provider": "OpenGolfAPI", "course_id": source["opengolfapi"]["course_id"], **imported}
    needs = preview.setdefault("needs_work", [])
    needs[:] = [item for item in needs if item != "Enter trusted scorecard yardages."]
    if any(count < len(by_number) for count in imported["yardages"].values()):
        needs.append("Review tee sets missing from the OpenGolfAPI scorecard.")
    return project
