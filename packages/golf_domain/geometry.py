"""Pure coordinate and polygon helpers used by the shot engine."""

from __future__ import annotations

import math

from .enums import SurfaceType
from .models import SurfaceRegion, Vec2


def target_axes(start: Vec2, target: Vec2) -> tuple[Vec2, Vec2]:
    """Return target-line and right-hand perpendicular unit vectors."""
    dx = target.x - start.x
    dy = target.y - start.y
    length = math.hypot(dx, dy)
    if length <= 1e-9:
        raise ValueError("start and target cannot be identical")
    forward = Vec2(dx / length, dy / length)
    right = Vec2(forward.y, -forward.x)
    return forward, right


def project_landing(start: Vec2, target: Vec2, distance: float, lateral: float) -> Vec2:
    forward, right = target_axes(start, target)
    return Vec2(
        start.x + forward.x * distance + right.x * lateral,
        start.y + forward.y * distance + right.y * lateral,
    )


def _point_on_segment(point: Vec2, start: Vec2, end: Vec2, tolerance: float = 1e-3) -> bool:
    squared_length = (end.x - start.x) ** 2 + (end.y - start.y) ** 2
    if squared_length <= tolerance**2:
        return point.distance_to(start) <= tolerance
    cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (
        end.y - start.y
    )
    if abs(cross) / math.sqrt(squared_length) > tolerance:
        return False
    dot = (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (
        end.y - start.y
    )
    length = math.sqrt(squared_length)
    if dot < -tolerance * length:
        return False
    return dot <= squared_length + tolerance * length


def point_in_polygon(point: Vec2, polygon: tuple[Vec2, ...]) -> bool:
    """Boundary-inclusive ray-casting test."""
    inside = False
    previous = polygon[-1]
    for current in polygon:
        if _point_on_segment(point, previous, current):
            return True
        crosses = (current.y > point.y) != (previous.y > point.y)
        if crosses:
            intersection_x = (previous.x - current.x) * (point.y - current.y) / (
                previous.y - current.y
            ) + current.x
            if point.x < intersection_x:
                inside = not inside
        previous = current
    return inside


def resolve_surface(
    point: Vec2,
    regions: tuple[SurfaceRegion, ...],
    default: SurfaceType = SurfaceType.ROUGH,
) -> tuple[SurfaceType, str | None]:
    """Resolve overlaps by explicit priority, then declaration order."""
    ordered = sorted(enumerate(regions), key=lambda item: (-item[1].priority, item[0]))
    for _, region in ordered:
        if point_in_polygon(point, region.polygon):
            return region.surface, region.region_id
    return default, None
