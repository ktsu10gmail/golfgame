"""Python twin of the deterministic browser green contour height field."""

from __future__ import annotations

import math

from packages.golf_domain import Vec2


_ROTATION_STEP_DEGREES = 30
_SAMPLE_EPSILON = 0.0025


def _bounded(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, float(value)))


def _gaussian(x: float, y: float, center_x: float, center_y: float, spread_x: float, spread_y: float, amplitude: float) -> float:
    dx = (x - center_x) / spread_x
    dy = (y - center_y) / spread_y
    return amplitude * math.exp(-(dx * dx + dy * dy))


def _base_height(x: float, y: float) -> float:
    return (
        x * 0.18
        - y * 0.12
        + _gaussian(x, y, -0.48, 0.38, 0.42, 0.34, 0.72)
        - _gaussian(x, y, -0.08, -0.02, 0.5, 0.42, 0.46)
        + _gaussian(x, y, 0.5, -0.38, 0.34, 0.44, 0.58)
        + _gaussian(x, y, 0.48, 0.44, 0.5, 0.28, 0.28)
    )


def _transform(hole_number: int) -> tuple[float, bool]:
    normalized = max(1, int(hole_number or 1))
    return ((normalized - 1) * _ROTATION_STEP_DEGREES) % 360, normalized > 12


def _transformed_height(x: float, y: float, hole_number: int) -> float:
    rotation_degrees, mirrored = _transform(hole_number)
    radians = -rotation_degrees * math.pi / 180
    mirrored_x = -x if mirrored else x
    transformed_x = mirrored_x * math.cos(radians) - y * math.sin(radians)
    transformed_y = mirrored_x * math.sin(radians) + y * math.cos(radians)
    return _base_height(transformed_x, transformed_y)


def sample_green_contour(x: float, y: float, hole_number: int) -> dict[str, float]:
    safe_x = _bounded(x, -1.25, 1.25)
    safe_y = _bounded(y, -1.25, 1.25)
    height = _transformed_height(safe_x, safe_y, hole_number)
    dx = (
        _transformed_height(safe_x + _SAMPLE_EPSILON, safe_y, hole_number)
        - _transformed_height(safe_x - _SAMPLE_EPSILON, safe_y, hole_number)
    ) / (_SAMPLE_EPSILON * 2)
    dy = (
        _transformed_height(safe_x, safe_y + _SAMPLE_EPSILON, hole_number)
        - _transformed_height(safe_x, safe_y - _SAMPLE_EPSILON, hole_number)
    ) / (_SAMPLE_EPSILON * 2)
    gradient = math.hypot(dx, dy)
    slope_degrees = _bounded(0.35 + gradient * 3.9, 0.35, 6.8)
    downhill_x = -dx / gradient if gradient > 1e-8 else 0
    downhill_y = -dy / gradient if gradient > 1e-8 else 1
    return {
        "height": height,
        "slope_degrees": slope_degrees,
        "downhill_x": downhill_x,
        "downhill_y": downhill_y,
    }


def sample_course_green_contour(point: Vec2, polygon: tuple[Vec2, ...], hole_number: int) -> dict[str, float]:
    if len(polygon) < 3:
        raise ValueError("green polygon must contain at least three points")
    min_x = min(item.x for item in polygon)
    max_x = max(item.x for item in polygon)
    min_y = min(item.y for item in polygon)
    max_y = max(item.y for item in polygon)
    width = max(max_x - min_x, 1e-6)
    height = max(max_y - min_y, 1e-6)
    normalized_x = ((point.x - min_x) / width) * 2 - 1
    normalized_y = ((point.y - min_y) / height) * 2 - 1
    sample = sample_green_contour(normalized_x, normalized_y, hole_number)
    course_downhill_x = sample["downhill_x"] * width
    course_downhill_y = sample["downhill_y"] * height
    length = math.hypot(course_downhill_x, course_downhill_y) or 1
    return {
        **sample,
        "downhill_course_x": course_downhill_x / length,
        "downhill_course_y": course_downhill_y / length,
    }
