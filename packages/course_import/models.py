"""Provider-neutral models for external course discovery."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class CourseSearchQuery:
    keywords: str
    rows: int = 10
    offset: int = 0
    country: str | None = None
    region: str | None = None


@dataclass(frozen=True, slots=True)
class ExternalCourseSummary:
    provider: str
    external_id: str
    name: str
    facility_name: str
    city: str | None = None
    region: str | None = None
    country: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    available: bool = True
    course_count: int = 0
    tee_count: int = 0
    gps_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class CourseDataProvider(Protocol):
    name: str

    def search_courses(self, query: CourseSearchQuery) -> list[ExternalCourseSummary]: ...

    def get_course_detail(self, external_course_id: str) -> dict[str, Any]: ...
