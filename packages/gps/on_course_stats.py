"""Accumulated club evidence from synchronized on-course GPS rounds."""

from __future__ import annotations

import math
from typing import Any, Iterable


ESTIMATED_CARRY_FACTOR = 0.90
SUCCESS_TOLERANCE = 0.20
MAX_GPS_ACCURACY_METERS = 18.0
MIN_SUCCESSFUL_SHOTS_TO_APPLY = 3
ESTABLISHED_BASELINE_MINIMUM = 5

EXCLUDED_START_LIES = {
    "bunker", "green", "water", "out of bounds", "trees", "trees/recovery", "recovery"
}


def _finite_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


def _club_profile(profile: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    clubs: dict[str, dict[str, Any]] = {}
    for club in profile.get("clubs", []) if isinstance(profile, dict) else []:
        name = str(club.get("name") or "").strip()
        carry = _finite_number(club.get("carry"))
        if not name or name.casefold() == "putter" or carry is None or carry <= 0:
            continue
        clubs[name.casefold()] = {"name": name, "carry": carry}
    return clubs


def _eligible_shot(shot: Any, clubs: dict[str, dict[str, Any]]) -> tuple[str, float] | None:
    if not isinstance(shot, dict):
        return None
    strategy = shot.get("strategy")
    if not isinstance(strategy, dict):
        return None
    club_name = str(strategy.get("club_name") or "").strip()
    club_key = club_name.casefold()
    if club_key not in clubs or _finite_number(strategy.get("power")) != 100:
        return None
    distance = _finite_number(shot.get("distance_yards"))
    if distance is None or not 1 <= distance <= 500:
        return None
    start = shot.get("start")
    end = shot.get("end")
    if not isinstance(start, dict) or not isinstance(end, dict):
        return None
    start_accuracy = _finite_number(start.get("accuracy_meters"))
    end_accuracy = _finite_number(end.get("accuracy_meters"))
    if start_accuracy is None or end_accuracy is None:
        return None
    if start_accuracy > MAX_GPS_ACCURACY_METERS or end_accuracy > MAX_GPS_ACCURACY_METERS:
        return None
    if str(start.get("lie") or "").strip().casefold() in EXCLUDED_START_LIES:
        return None
    return club_key, distance * ESTIMATED_CARRY_FACTOR


def _confidence(attempts: int, rounds: int) -> str:
    if attempts >= 15 and rounds >= 3:
        return "Reliable"
    if attempts >= 5 and rounds >= 2:
        return "Building"
    return "Early"


def build_on_course_club_stats(
    gps_rounds: Iterable[dict[str, Any]],
    profile: dict[str, Any] | None,
) -> dict[str, Any]:
    """Build per-club observed carry and success rates across every GPS round."""
    clubs = _club_profile(profile)
    observations: dict[str, list[tuple[str, float]]] = {key: [] for key in clubs}
    round_count = 0
    for round_index, gps_round in enumerate(gps_rounds):
        if not isinstance(gps_round, dict):
            continue
        round_id = str(gps_round.get("round_id") or f"round-{round_index}")
        used_round = False
        for hole in gps_round.get("holes", []):
            if not isinstance(hole, dict):
                continue
            for shot in hole.get("shots", []):
                eligible = _eligible_shot(shot, clubs)
                if eligible is None:
                    continue
                club_key, estimated_carry = eligible
                observations[club_key].append((round_id, estimated_carry))
                used_round = True
        if used_round:
            round_count += 1

    result_clubs: list[dict[str, Any]] = []
    for club_key, club in clubs.items():
        attempts = observations[club_key]
        profile_baseline = club["carry"]
        initial_successes = [
            carry for _, carry in attempts
            if profile_baseline * (1 - SUCCESS_TOLERANCE) <= carry <= profile_baseline * (1 + SUCCESS_TOLERANCE)
        ]
        baseline = (
            sum(initial_successes) / len(initial_successes)
            if len(initial_successes) >= ESTABLISHED_BASELINE_MINIMUM
            else profile_baseline
        )
        successes = [
            carry for _, carry in attempts
            if baseline * (1 - SUCCESS_TOLERANCE) <= carry <= baseline * (1 + SUCCESS_TOLERANCE)
        ]
        attempt_count = len(attempts)
        success_count = len(successes)
        rounds = len({round_id for round_id, _ in attempts})
        result_clubs.append({
            "club_name": club["name"],
            "profile_carry_yards": round(profile_baseline),
            "estimated_carry_yards": round(sum(successes) / success_count) if success_count else None,
            "on_course_accuracy_percent": round(success_count / attempt_count * 100) if attempt_count else None,
            "attempts": attempt_count,
            "successful_shots": success_count,
            "missed_shots": attempt_count - success_count,
            "rounds": rounds,
            "confidence": _confidence(attempt_count, rounds),
            "baseline_yards": round(baseline, 1),
            "can_apply": success_count >= MIN_SUCCESSFUL_SHOTS_TO_APPLY,
        })

    return {
        "version": "on-course-club-stats-v1",
        "rules": {
            "estimated_carry_factor": ESTIMATED_CARRY_FACTOR,
            "success_tolerance_percent": round(SUCCESS_TOLERANCE * 100),
            "maximum_gps_accuracy_meters": MAX_GPS_ACCURACY_METERS,
            "minimum_successful_shots_to_apply": MIN_SUCCESSFUL_SHOTS_TO_APPLY,
        },
        "rounds_with_eligible_shots": round_count,
        "clubs": result_clubs,
    }
