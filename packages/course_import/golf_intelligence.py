"""Server-side Golf Intelligence API adapter and protected import workflow."""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .models import CourseSearchQuery, ExternalCourseSummary
from .normalizer import (
    CourseNormalizationError,
    normalize_golf_intelligence_course,
    normalize_golf_intelligence_gps_with_scorecard,
)
from .store import CourseImportStore

JsonTransport = Callable[[str, str, Mapping[str, str], bytes | None, float], tuple[int, bytes]]


class ProviderError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None):
        super().__init__(message)
        self.status = status


class CourseImportError(RuntimeError):
    def __init__(self, message: str, *, status: int = 400):
        super().__init__(message)
        self.status = status


def _enabled(value: object, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().casefold() in {"1", "true", "yes", "on"}


def _default_transport(
    method: str,
    url: str,
    headers: Mapping[str, str],
    body: bytes | None,
    timeout: float,
) -> tuple[int, bytes]:
    request = Request(url, data=body, headers=dict(headers), method=method)
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except HTTPError as error:
        return error.code, error.read()
    except (URLError, TimeoutError) as error:
        raise ProviderError("Golf Intelligence is unavailable; try again shortly") from error


@dataclass(frozen=True, slots=True)
class GolfIntelligenceConfig:
    base_url: str = "https://api.golfintelligence.com"
    client_id: str = ""
    active_token: str = ""
    enabled: bool = False
    timeout_seconds: float = 20
    cache_ttl_days: int = 365
    full_detail_credit_estimate: int = 3
    gps_only_credit_estimate: int = 2

    @classmethod
    def from_env(cls) -> "GolfIntelligenceConfig":
        return cls(
            base_url=os.getenv("GOLF_INTELLIGENCE_BASE_URL", "https://api.golfintelligence.com").rstrip("/"),
            client_id=os.getenv("GOLF_INTELLIGENCE_CLIENT_ID", "").strip(),
            active_token=os.getenv("GOLF_INTELLIGENCE_ACTIVE_TOKEN", "").strip(),
            enabled=_enabled(os.getenv("GOLF_INTELLIGENCE_ENABLED"), True),
            timeout_seconds=max(1, float(os.getenv("GOLF_INTELLIGENCE_TIMEOUT_SECONDS", "20"))),
            cache_ttl_days=max(1, int(os.getenv("GOLF_INTELLIGENCE_CACHE_TTL_DAYS", "365"))),
            full_detail_credit_estimate=max(0, int(os.getenv("GOLF_INTELLIGENCE_FULL_DETAIL_CREDITS", "3"))),
            gps_only_credit_estimate=max(0, int(os.getenv("GOLF_INTELLIGENCE_GPS_ONLY_CREDITS", "2"))),
        )

    @property
    def credentials_configured(self) -> bool:
        return bool(self.client_id and self.active_token)


class GolfIntelligenceTokenManager:
    def __init__(self, config: GolfIntelligenceConfig, transport: JsonTransport = _default_transport):
        self.config = config
        self.transport = transport
        self._access_token: str | None = None
        self._expires_at = 0.0
        self._lock = threading.Lock()

    def invalidate(self) -> None:
        with self._lock:
            self._access_token = None
            self._expires_at = 0

    def get_access_token(self, *, force_refresh: bool = False) -> str:
        if not self.config.enabled:
            raise ProviderError("Golf Intelligence integration is disabled")
        if not self.config.credentials_configured:
            raise ProviderError("Golf Intelligence credentials are not configured")
        with self._lock:
            if not force_refresh and self._access_token and time.monotonic() < self._expires_at:
                return self._access_token
            body = urlencode({
                "grant_type": "client_credentials",
                "code": self.config.active_token,
                "client_id": self.config.client_id,
            }).encode()
            status, raw = self.transport(
                "POST",
                f"{self.config.base_url}/auth/authenticateToken",
                {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
                body,
                self.config.timeout_seconds,
            )
            payload = self._decode(raw, "authentication")
            if status < 200 or status >= 300:
                raise ProviderError("Golf Intelligence authentication failed; check server API credentials", status=status)
            token = payload.get("access_token") or payload.get("accessToken")
            if not isinstance(token, str) or not token.strip():
                raise ProviderError("Golf Intelligence authentication returned no access token")
            expires_in = payload.get("expires_in", payload.get("expiresIn", 3600))
            try:
                lifetime = max(60, float(expires_in))
            except (TypeError, ValueError):
                lifetime = 3600
            self._access_token = token.strip()
            self._expires_at = time.monotonic() + max(30, lifetime - 60)
            return self._access_token

    @staticmethod
    def _decode(raw: bytes, operation: str) -> dict[str, Any]:
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ProviderError(f"Golf Intelligence {operation} returned invalid JSON") from error
        if not isinstance(payload, dict):
            raise ProviderError(f"Golf Intelligence {operation} returned an invalid response")
        return payload


class GolfIntelligenceProvider:
    name = "golf_intelligence"

    def __init__(
        self,
        config: GolfIntelligenceConfig,
        token_manager: GolfIntelligenceTokenManager | None = None,
        transport: JsonTransport = _default_transport,
    ):
        self.config = config
        self.transport = transport
        self.tokens = token_manager or GolfIntelligenceTokenManager(config, transport)

    def _request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, Any] | None = None,
        retry_transient: bool = False,
    ) -> dict[str, Any]:
        body = json.dumps(payload).encode() if payload is not None else None
        for attempt in range(2):
            token = self.tokens.get_access_token(force_refresh=attempt > 0)
            status, raw = self.transport(
                method,
                f"{self.config.base_url}{path}",
                {
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                    **({"Content-Type": "application/json"} if body is not None else {}),
                },
                body,
                self.config.timeout_seconds,
            )
            if status == 401 and attempt == 0:
                self.tokens.invalidate()
                continue
            if retry_transient and status in {429, 500, 502, 503, 504} and attempt == 0:
                time.sleep(0.15)
                continue
            if status < 200 or status >= 300:
                messages = {
                    400: "The selected Golf Intelligence course request was rejected",
                    401: "Golf Intelligence authentication failed; check server API credentials",
                    404: "The selected Golf Intelligence course was not found",
                    429: "Golf Intelligence rate-limited the request; try again shortly",
                }
                raise ProviderError(messages.get(status, "Golf Intelligence could not complete the request"), status=status)
            return GolfIntelligenceTokenManager._decode(raw, "API request")
        raise ProviderError("Golf Intelligence authentication failed; check server API credentials", status=401)

    def search_courses(self, query: CourseSearchQuery) -> list[ExternalCourseSummary]:
        request_payload: dict[str, Any] = {
            "keywords": query.keywords,
            "rows": query.rows,
            "offset": query.offset,
        }
        if query.country:
            request_payload["countryCode"] = query.country
        if query.region:
            request_payload["regionCode"] = query.region
        response = self._request(
            "POST",
            "/courses/searchCourseGroups",
            payload=request_payload,
            retry_transient=True,
        )
        data = response.get("data")
        if data is None:
            data = response.get("results", [])
        if not isinstance(data, list):
            raise ProviderError("Golf Intelligence search returned an invalid result list")
        results: list[ExternalCourseSummary] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            external_id = item.get("publicId")
            if not isinstance(external_id, str) or not external_id.strip():
                continue
            facility = item.get("facility") if isinstance(item.get("facility"), dict) else {}
            address = facility.get("address") if isinstance(facility.get("address"), dict) else {}
            location = facility.get("gpsCoordinate") if isinstance(facility.get("gpsCoordinate"), dict) else {}
            latitude = location.get("latitude")
            longitude = location.get("longitude")
            results.append(ExternalCourseSummary(
                provider=self.name,
                external_id=external_id.strip(),
                name=str(item.get("name") or facility.get("facilityName") or "Unnamed course").strip(),
                facility_name=str(facility.get("facilityName") or item.get("name") or "Unnamed facility").strip(),
                city=address.get("city"),
                region=address.get("regionCode") or address.get("stateCode") or address.get("region"),
                country=address.get("countryCode") or address.get("country"),
                latitude=float(latitude) if isinstance(latitude, (int, float)) else None,
                longitude=float(longitude) if isinstance(longitude, (int, float)) else None,
                available=bool(item.get("isActive", True) and not facility.get("isPermanantlyClosed", False)),
                course_count=int(item.get("courseCount") or 0),
                tee_count=int(item.get("teeCount") or 0),
                gps_count=int(item.get("gpsCount") or 0),
            ))
        return results

    def get_course_detail(self, external_course_id: str) -> dict[str, Any]:
        public_id = urlencode({"PublicId": external_course_id})
        return self._request("GET", f"/courses/getCourseGroupDetail?{public_id}")

    def get_course_gps(self, external_course_id: str) -> dict[str, Any]:
        public_id = urlencode({"PublicId": external_course_id})
        return self._request("GET", f"/courses/getCourseGroupGPS?{public_id}")


class CourseImportService:
    """Coordinates free search, one protected paid call, normalization, and cache."""

    def __init__(
        self,
        config: GolfIntelligenceConfig,
        store: CourseImportStore,
        provider: GolfIntelligenceProvider | None = None,
    ):
        self.config = config
        self.store = store
        self.provider = provider or GolfIntelligenceProvider(config)
        self._paid_calls_allowed = False
        self._paid_lock = threading.Lock()
        self._hydrate_lock = threading.Lock()

    def status(self) -> dict[str, Any]:
        return {
            "provider": "golf_intelligence",
            "enabled": self.config.enabled,
            "credentials_configured": self.config.credentials_configured,
            "ready_for_search": self.config.enabled and self.config.credentials_configured,
            "paid_calls_allowed": self._paid_calls_allowed,
            "full_detail_credit_estimate": self.config.full_detail_credit_estimate,
            "gps_only_credit_estimate": self.config.gps_only_credit_estimate,
            "cache_ttl_days": self.config.cache_ttl_days,
            "play_mode_uses_provider": False,
        }

    def set_paid_calls_allowed(self, allowed: bool) -> dict[str, Any]:
        if allowed and (not self.config.enabled or not self.config.credentials_configured):
            raise CourseImportError("Add Golf Intelligence credentials before enabling paid calls", status=409)
        with self._paid_lock:
            self._paid_calls_allowed = bool(allowed)
        return self.status()

    def search(self, payload: dict[str, Any]) -> dict[str, Any]:
        keywords = str(payload.get("keywords") or "").strip()
        if len(keywords) < 2 or len(keywords) > 120:
            raise CourseImportError("Enter at least two characters of the course name")
        try:
            rows = max(1, min(20, int(payload.get("rows", 10))))
            offset = max(0, int(payload.get("offset", 0)))
        except (TypeError, ValueError) as error:
            raise CourseImportError("Search rows and offset must be numbers") from error
        try:
            summaries = self.provider.search_courses(CourseSearchQuery(
                keywords=keywords,
                rows=rows,
                offset=offset,
                country=str(payload.get("country") or "").strip() or None,
                region=str(payload.get("region") or "").strip() or None,
            ))
        except ProviderError as error:
            raise CourseImportError(str(error), status=502 if error.status not in {401, 429} else error.status) from error
        results = []
        for summary in summaries:
            item = summary.to_dict()
            item["cache"] = self.store.cache_status(self.provider.name, summary.external_id)
            results.append(item)
        return {
            "results": results,
            "offset": offset,
            "rows": rows,
            "cost": {"credits": 0, "label": "Free search"},
        }

    def preview(self, payload: dict[str, Any], requested_by: str | None) -> dict[str, Any]:
        # Serialize hydration so two editor tabs cannot race past the cache and
        # spend twice for the same selected course.
        with self._hydrate_lock:
            return self._preview_locked(payload, requested_by)

    def preview_gps_only(
        self,
        payload: dict[str, Any],
        requested_by: str | None,
        scorecard_text: str,
    ) -> dict[str, Any]:
        """Run one separately confirmed GPS-only recovery request."""
        with self._hydrate_lock:
            external_id = str(payload.get("public_id") or "").strip()
            if not external_id or len(external_id) > 200:
                raise CourseImportError("Select a valid Golf Intelligence course")
            cached = self.store.cached_course(self.provider.name, external_id)
            cache_hit = cached is not None
            estimated_credits = 0 if cache_hit else self.config.gps_only_credit_estimate
            if not cache_hit:
                if not self._paid_calls_allowed:
                    raise CourseImportError("Paid Golf Intelligence API calls are OFF", status=409)
                if payload.get("confirm_gps_only") is not True:
                    raise CourseImportError("Confirm the GPS-only provider credits before downloading", status=409)
            job_id = f"gi-gps-{secrets.token_urlsafe(12)}"
            self.store.create_job(
                job_id,
                self.provider.name,
                external_id,
                requested_by,
                credit_cost_estimate=estimated_credits,
                cache_hit=cache_hit,
            )
            try:
                if cached:
                    project = cached["project"]
                else:
                    gps_detail = self.provider.get_course_gps(external_id)
                    project = normalize_golf_intelligence_gps_with_scorecard(
                        gps_detail,
                        external_id,
                        scorecard_text,
                    )
                    fetched_at = datetime.now(UTC)
                    self.store.save_cached_course(
                        self.provider.name,
                        external_id,
                        fetched_at=fetched_at,
                        expires_at=fetched_at + timedelta(days=self.config.cache_ttl_days),
                        response_hash=project["external_course_source"]["provider_source_hash"],
                        project=project,
                    )
                self.store.finish_job(job_id, "READY_FOR_REVIEW", project=project)
            except (ProviderError, CourseNormalizationError, ValueError) as error:
                self.store.finish_job(job_id, "FAILED", error_message=str(error))
                if not cache_hit:
                    self._paid_calls_allowed = False
                status = 502 if isinstance(error, ProviderError) else 422
                raise CourseImportError(str(error), status=status) from error
            finally:
                if not cache_hit:
                    # This recovery permission is intentionally single-use.
                    self._paid_calls_allowed = False
            return {
                "job_id": job_id,
                "status": "READY_FOR_REVIEW",
                "cache_hit": cache_hit,
                "recovery_mode": "gps_only_with_local_scorecard",
                "estimated_credits_used": estimated_credits,
                "preview": project["import_preview"],
            }

    def _preview_locked(self, payload: dict[str, Any], requested_by: str | None) -> dict[str, Any]:
        external_id = str(payload.get("public_id") or "").strip()
        if not external_id or len(external_id) > 200:
            raise CourseImportError("Select a valid Golf Intelligence course")
        cached = self.store.cached_course(self.provider.name, external_id)
        cache_hit = cached is not None
        estimated_credits = 0 if cache_hit else self.config.full_detail_credit_estimate
        if not cache_hit:
            if not self._paid_calls_allowed:
                raise CourseImportError("Paid Golf Intelligence API calls are OFF", status=409)
            if payload.get("confirm_paid") is not True:
                raise CourseImportError("Confirm the estimated provider credits before downloading", status=409)
        job_id = f"gi-{secrets.token_urlsafe(12)}"
        self.store.create_job(
            job_id,
            self.provider.name,
            external_id,
            requested_by,
            credit_cost_estimate=estimated_credits,
            cache_hit=cache_hit,
        )
        try:
            if cached:
                project = cached["project"]
            else:
                detail = self.provider.get_course_detail(external_id)
                project = normalize_golf_intelligence_course(detail, external_id)
                fetched_at = datetime.now(UTC)
                self.store.save_cached_course(
                    self.provider.name,
                    external_id,
                    fetched_at=fetched_at,
                    expires_at=fetched_at + timedelta(days=self.config.cache_ttl_days),
                    response_hash=project["external_course_source"]["provider_source_hash"],
                    project=project,
                )
            self.store.finish_job(job_id, "READY_FOR_REVIEW", project=project)
        except (ProviderError, CourseNormalizationError, ValueError) as error:
            self.store.finish_job(job_id, "FAILED", error_message=str(error))
            if not cache_hit:
                # A provider may have charged for the response even when its
                # payload cannot be normalized. Require the developer to
                # deliberately re-enable paid calls before any retry.
                self._paid_calls_allowed = False
            status = 502 if isinstance(error, ProviderError) else 422
            raise CourseImportError(str(error), status=status) from error
        return {
            "job_id": job_id,
            "status": "READY_FOR_REVIEW",
            "cache_hit": cache_hit,
            "estimated_credits_used": estimated_credits,
            "preview": project["import_preview"],
        }

    def commit(self, payload: dict[str, Any], requested_by: str | None) -> dict[str, Any]:
        job_id = str(payload.get("job_id") or "").strip()
        job = self.store.import_job(job_id)
        if not job:
            raise CourseImportError("The course import preview was not found", status=404)
        if requested_by and job.get("requested_by") and requested_by != job["requested_by"]:
            raise CourseImportError("This course import belongs to another developer", status=403)
        if job["status"] not in {"READY_FOR_REVIEW", "IMPORTED"} or not job["project"]:
            raise CourseImportError("The course import is not ready", status=409)
        self.store.finish_job(job_id, "IMPORTED", project=job["project"])
        return {
            "job_id": job_id,
            "status": "IMPORTED",
            "project": job["project"],
        }

    def job(self, job_id: str, requested_by: str | None) -> dict[str, Any]:
        job = self.store.import_job(job_id)
        if not job:
            raise CourseImportError("The course import job was not found", status=404)
        if requested_by and job.get("requested_by") and requested_by != job["requested_by"]:
            raise CourseImportError("This course import belongs to another developer", status=403)
        job.pop("project", None)
        return job
