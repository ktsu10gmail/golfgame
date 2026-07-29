"""Shared sidehill-lie planning rules derived from the advice library."""

from __future__ import annotations

import math
from dataclasses import dataclass


SIDEHILL_MODEL_VERSION = "sidehill-v1"


@dataclass(frozen=True, slots=True)
class SidehillPlan:
    stance: str
    severity: str
    expected_curve_yards: float
    recommended_aim_yards: float
    player_aim_yards: float
    compensation: str


def _clamp(value: float, lower: float, upper: float) -> float:
    return min(upper, max(lower, value))


def _round(value: float, places: int = 2) -> float:
    factor = 10**places
    return math.copysign(math.floor(abs(value) * factor + 0.5) / factor, value)


def analyze_sidehill_shot(
    *,
    stance: str,
    lateral_distance_yards: float,
    shot_distance_yards: float,
    player_aim_yards: float = 0.0,
) -> SidehillPlan:
    """Return golfer-relative curve and aim guidance.

    Positive values are golfer-right. Ball-below-feet shots curve right, while
    ball-above-feet shots curve left; the recommended aim is the opposite sign.
    """

    if stance not in {"level", "ball_below_feet", "ball_above_feet"}:
        raise ValueError("stance must be level, ball_below_feet, or ball_above_feet")
    if not all(math.isfinite(value) for value in (
        lateral_distance_yards, shot_distance_yards, player_aim_yards
    )):
        raise ValueError("sidehill inputs must be finite")
    if lateral_distance_yards < 0 or shot_distance_yards < 0:
        raise ValueError("sidehill distances cannot be negative")
    if stance == "level":
        return SidehillPlan(stance, "level", 0.0, 0.0, _round(player_aim_yards), "not_required")

    if lateral_distance_yards < 12:
        severity, severity_factor = "mild", 0.75
    elif lateral_distance_yards < 22:
        severity, severity_factor = "moderate", 1.0
    else:
        severity, severity_factor = "severe", 1.35

    curve_amount = _clamp(shot_distance_yards * 0.025 * severity_factor, 1.5, 12.0)
    expected_curve = curve_amount if stance == "ball_below_feet" else -curve_amount
    recommended_aim = -expected_curve
    same_direction = player_aim_yards * recommended_aim > 0
    ratio = abs(player_aim_yards) / max(abs(recommended_aim), 0.01)
    if abs(player_aim_yards) < 0.75:
        compensation = "missing"
    elif not same_direction:
        compensation = "wrong_direction"
    elif ratio > 2.25:
        compensation = "overcompensated"
    elif ratio >= 0.35:
        compensation = "correct"
    else:
        compensation = "missing"

    return SidehillPlan(
        stance=stance,
        severity=severity,
        expected_curve_yards=_round(expected_curve),
        recommended_aim_yards=_round(recommended_aim),
        player_aim_yards=_round(player_aim_yards),
        compensation=compensation,
    )
