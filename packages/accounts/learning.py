"""Deterministic lifetime-learning facts derived from authoritative round packets."""

from __future__ import annotations

import json
import math
from collections import defaultdict
from typing import Any, Iterable


LEARNING_VERSION = "player-learning-v1"
MIN_PATTERN_SAMPLES = 8
MIN_PATTERN_ROUNDS = 3
MIN_RECURRING_REASON_SAMPLES = 5


def _finite_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _integer_score(value: Any) -> int | None:
    number = _finite_number(value)
    if number is None or not 0 <= number <= 100:
        return None
    return round(number)


def _clean_text(value: Any, maximum: int = 80) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.strip().split())
    return cleaned[:maximum] or None


def _surface(value: Any) -> str | None:
    cleaned = _clean_text(value, 40)
    if cleaned is None:
        return None
    return cleaned.casefold().replace(" ", "_")


def _distance_band(distance_yards: float | None, shot_type: str | None) -> str | None:
    if distance_yards is None:
        return None
    if shot_type in {"putt_lag", "putt_make_attempt"}:
        feet = distance_yards * 3
        if feet <= 6:
            return "putt_0_6_ft"
        if feet <= 15:
            return "putt_7_15_ft"
        if feet <= 30:
            return "putt_16_30_ft"
        return "putt_31_plus_ft"
    if distance_yards < 50:
        return "0_49_yd"
    if distance_yards < 80:
        return "50_79_yd"
    if distance_yards < 110:
        return "80_109_yd"
    if distance_yards < 140:
        return "110_139_yd"
    if distance_yards < 180:
        return "140_179_yd"
    return "180_plus_yd"


def _authoritative_packet(shot: dict[str, Any]) -> dict[str, Any] | None:
    for key in ("resultPacket", "puttPacket"):
        packet = shot.get(key)
        if isinstance(packet, dict) and isinstance(packet.get("audit"), dict):
            return packet
    return None


def _starting_distance(shot: dict[str, Any], request: dict[str, Any]) -> float | None:
    snapshot = shot.get("conditionSnapshot")
    if isinstance(snapshot, dict):
        distance = _finite_number(snapshot.get("remaining_yards"))
        if distance is not None and distance >= 0:
            return distance
    context = request.get("context") if isinstance(request.get("context"), dict) else {}
    start = context.get("start")
    pin = context.get("pin")
    if all(isinstance(point, dict) for point in (start, pin)):
        values = tuple(_finite_number(point.get(axis)) for point in (start, pin) for axis in ("x", "y"))
        if all(value is not None for value in values):
            start_x, start_y, pin_x, pin_y = values
            return math.hypot(pin_x - start_x, pin_y - start_y)
    return None


def _starting_lie(shot: dict[str, Any], request: dict[str, Any], shot_type: str | None) -> str | None:
    if shot_type in {"putt_lag", "putt_make_attempt"}:
        return "green"
    context = request.get("context") if isinstance(request.get("context"), dict) else {}
    lie = context.get("lie")
    if isinstance(lie, dict):
        authoritative = _surface(lie.get("lie_type"))
        if authoritative:
            return authoritative
    authoritative = _surface(context.get("lie_type"))
    if authoritative:
        return authoritative
    snapshot = shot.get("conditionSnapshot")
    return _surface(snapshot.get("lie")) if isinstance(snapshot, dict) else None


def extract_round_observations(round_id: str, round_save: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract only scored shots backed by an authoritative engine audit packet."""
    round_state = round_save.get("round_state")
    holes = round_state.get("holes") if isinstance(round_state, dict) else None
    if not isinstance(holes, list):
        return []
    course_id = _clean_text(round_save.get("course_id"), 80)
    observations: list[dict[str, Any]] = []
    for hole_index, hole in enumerate(holes):
        events = hole.get("events") if isinstance(hole, dict) else None
        if not isinstance(events, list):
            continue
        for event_index, event in enumerate(events):
            if not isinstance(event, dict) or event.get("event_type") != "shot_committed":
                continue
            payload = event.get("payload")
            shot = payload.get("shot") if isinstance(payload, dict) else None
            if not isinstance(shot, dict):
                continue
            strategy = shot.get("strategyPacket")
            decision = strategy.get("decision") if isinstance(strategy, dict) else None
            execution = strategy.get("execution") if isinstance(strategy, dict) else None
            packet = _authoritative_packet(shot)
            if packet is None or not isinstance(decision, dict):
                continue
            decision_score = _integer_score(decision.get("score"))
            execution_score = _integer_score(execution.get("score")) if isinstance(execution, dict) else None
            if decision_score is None or execution_score is None:
                continue
            request = shot.get("resultRequest") or shot.get("puttRequest") or {}
            if not isinstance(request, dict):
                request = {}
            audit = packet["audit"]
            stroke_number = audit.get("stroke_index")
            if not isinstance(stroke_number, int) or stroke_number < 1:
                stroke_number = event.get("stroke_index")
            if not isinstance(stroke_number, int) or stroke_number < 1:
                continue
            hole_number = audit.get("hole_number")
            if not isinstance(hole_number, int) or not 1 <= hole_number <= 18:
                hole_number = hole_index + 1
            shot_type = _clean_text(strategy.get("shot_type"), 40)
            starting_distance = _starting_distance(shot, request)
            snapshot = shot.get("conditionSnapshot") if isinstance(shot.get("conditionSnapshot"), dict) else {}
            intent = shot.get("playerIntent") if isinstance(shot.get("playerIntent"), dict) else {}
            instructions = intent.get("instructions")
            adjustment = " | ".join(
                text for item in instructions or [] if (text := _clean_text(item, 160))
            ) if isinstance(instructions, list) else None
            result_surface = _surface(packet.get("resolved_surface"))
            if not result_surface and isinstance(packet.get("relief"), dict):
                result_surface = _surface(packet["relief"].get("resulting_surface"))
            result_surface = result_surface or _surface(packet.get("landing_surface"))
            if shot.get("puttPacket") is packet:
                result_surface = "cup" if packet.get("made") is True else "green"
            reasons = decision.get("reasons")
            clean_reasons = sorted({
                reason for item in reasons or [] if (reason := _clean_text(item, 80))
            }) if isinstance(reasons, list) else []
            sidehill = shot.get("sidehillPlan") if isinstance(shot.get("sidehillPlan"), dict) else {}
            choice = shot.get("strategyChoice") if isinstance(shot.get("strategyChoice"), dict) else {}
            remaining = _finite_number(packet.get("remaining_distance_yards"))
            power = _integer_score(shot.get("power"))
            if power is None:
                continue
            penalty = _finite_number(packet.get("relief", {}).get("penalty_strokes")) \
                if isinstance(packet.get("relief"), dict) else _finite_number(shot.get("penalty"))
            observation_id = f"{round_id}:h{hole_number}:s{stroke_number}:e{event_index + 1}"
            observations.append({
                "id": observation_id,
                "round_id": round_id,
                "course_id": course_id,
                "hole_number": hole_number,
                "stroke_number": stroke_number,
                "engine_version": _clean_text(audit.get("engine_version"), 50),
                "shot_type": shot_type,
                "distance_yards": round(starting_distance, 2) if starting_distance is not None else None,
                "distance_band": _distance_band(starting_distance, shot_type),
                "start_lie": _starting_lie(shot, request, shot_type),
                "stance": _clean_text(snapshot.get("stance"), 60),
                "slope": _clean_text(snapshot.get("slope"), 30),
                "elevation_feet": _finite_number(snapshot.get("elevation_feet")),
                "club": _clean_text(shot.get("club"), 40),
                "power_percent": power,
                "intended_surface": _surface(shot.get("intendedLie")),
                "player_adjustment": adjustment,
                "decision_score": decision_score,
                "decision_label": _clean_text(decision.get("label"), 30),
                "decision_reasons": clean_reasons,
                "execution_score": execution_score,
                "execution_label": _clean_text(execution.get("label"), 40),
                "result_surface": result_surface or _surface(shot.get("lie")),
                "remaining_yards": round(remaining, 2) if remaining is not None else None,
                "penalty_strokes": max(0, round(penalty or 0)),
                "sidehill_compensation": _clean_text(sidehill.get("compensation"), 30),
                "strategy_choice": _clean_text(choice.get("title"), 40),
            })
    return observations


def observation_database_values(observation: dict[str, Any]) -> tuple[Any, ...]:
    """Return values in the player_shot_observations insert-column order."""
    return (
        observation["id"], observation["round_id"], observation["course_id"],
        observation["hole_number"], observation["stroke_number"], observation["engine_version"],
        observation["shot_type"], observation["distance_yards"], observation["distance_band"],
        observation["start_lie"], observation["stance"], observation["slope"],
        observation["elevation_feet"], observation["club"], observation["power_percent"],
        observation["intended_surface"], observation["player_adjustment"],
        observation["decision_score"], observation["decision_label"],
        json.dumps(observation["decision_reasons"], separators=(",", ":")),
        observation["execution_score"], observation["execution_label"],
        observation["result_surface"], observation["remaining_yards"],
        observation["penalty_strokes"], observation["sidehill_compensation"],
        observation["strategy_choice"],
    )


def _average(rows: list[dict[str, Any]], field: str) -> int:
    return round(sum(row[field] for row in rows) / len(rows))


def _group_stats(rows: Iterable[dict[str, Any]], field: str) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row.get(field):
            groups[row[field]].append(row)
    result = []
    for key, members in groups.items():
        result.append({
            "key": key,
            "sample_size": len(members),
            "round_count": len({member["round_id"] for member in members}),
            "decision_score": _average(members, "decision_score"),
        })
    return sorted(result, key=lambda item: item["key"])


def build_recent_round_progress(rounds: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Compare two three-round decision-score windows without using execution."""
    scored = []
    for row in rounds:
        if not isinstance(row, dict):
            continue
        strategy_score = _integer_score(row.get("strategy_score"))
        if strategy_score is None:
            continue
        scored.append({
            "round_id": _clean_text(row.get("id") or row.get("round_id"), 120),
            "course_name": _clean_text(row.get("course_name"), 100) or "Completed round",
            "tee": _clean_text(row.get("tee"), 30) or "White",
            "completed_at": _clean_text(row.get("completed_at"), 40),
            "strategy_score": strategy_score,
            "scored_shots": row.get("scored_shots") if isinstance(row.get("scored_shots"), int) else None,
        })
    recent = scored[:6]
    result = {
        "status": "building",
        "minimum_rounds": 6,
        "scored_rounds": len(recent),
        "rounds_needed": max(0, 6 - len(recent)),
        "rounds": list(reversed(recent)),
        "recent_average": None,
        "previous_average": None,
        "change": None,
    }
    if len(recent) < 6:
        return result
    recent_average = round(sum(row["strategy_score"] for row in recent[:3]) / 3)
    previous_average = round(sum(row["strategy_score"] for row in recent[3:]) / 3)
    change = recent_average - previous_average
    result.update({
        "status": "improving" if change >= 4 else "needs_attention" if change <= -4 else "steady",
        "recent_average": recent_average,
        "previous_average": previous_average,
        "change": change,
    })
    return result


def build_player_learning_summary(
    observations: list[dict[str, Any]],
    completed_rounds: int,
    recent_rounds: Iterable[dict[str, Any]] = (),
) -> dict[str, Any]:
    """Report only patterns that clear conservative sample and round thresholds."""
    eligible = [row for row in observations if row.get("decision_score") is not None and row.get("execution_score") is not None]
    verified: list[dict[str, Any]] = []
    lie_groups = _group_stats(eligible, "start_lie")
    for group in lie_groups:
        if group["sample_size"] < MIN_PATTERN_SAMPLES or group["round_count"] < MIN_PATTERN_ROUNDS:
            continue
        if group["decision_score"] >= 82:
            verified.append({"kind": "lie_strength", **group, "confidence": "verified"})
        elif group["decision_score"] <= 68:
            verified.append({"kind": "lie_improvement", **group, "confidence": "verified"})

    relevant_sidehill = [
        row for row in eligible
        if row.get("sidehill_compensation") in {"correct", "wrong_direction", "missing"}
    ]
    sidehill_rounds = len({row["round_id"] for row in relevant_sidehill})
    if len(relevant_sidehill) >= 6 and sidehill_rounds >= MIN_PATTERN_ROUNDS:
        correct = sum(row["sidehill_compensation"] == "correct" for row in relevant_sidehill)
        rate = round(correct / len(relevant_sidehill) * 100)
        if rate >= 75 or rate <= 45:
            verified.append({
                "kind": "sidehill_strength" if rate >= 75 else "sidehill_improvement",
                "key": "sidehill_compensation", "sample_size": len(relevant_sidehill),
                "round_count": sidehill_rounds, "success_rate": rate, "confidence": "verified",
            })

    reason_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in eligible:
        for reason in row.get("decision_reasons", []):
            if any(token in reason for token in ("wrong", "missed", "poor", "aggressive", "not_justified", "bad_")):
                reason_rows[reason].append(row)
    for reason, members in sorted(reason_rows.items()):
        rounds = len({row["round_id"] for row in members})
        if len(members) >= MIN_RECURRING_REASON_SAMPLES and rounds >= MIN_PATTERN_ROUNDS and len(members) / max(len(eligible), 1) >= .12:
            verified.append({
                "kind": "recurring_decision_mistake", "key": reason,
                "sample_size": len(members), "round_count": rounds, "confidence": "verified",
            })

    rounds_observed = len({row["round_id"] for row in eligible})
    return {
        "version": LEARNING_VERSION,
        "status": "verified_patterns_available" if verified else "building_record",
        "completed_rounds": completed_rounds,
        "rounds_with_observations": rounds_observed,
        "observation_count": len(eligible),
        "minimums": {
            "pattern_samples": MIN_PATTERN_SAMPLES,
            "pattern_rounds": MIN_PATTERN_ROUNDS,
            "recurring_reason_samples": MIN_RECURRING_REASON_SAMPLES,
        },
        "verified_patterns": verified,
        "coverage": {
            "lies": lie_groups,
            "adjustments_recorded": sum(bool(row.get("player_adjustment")) for row in eligible),
        },
        "recent_progress": build_recent_round_progress(recent_rounds),
    }


def attach_verified_learning_context(payload: dict[str, Any], learning: dict[str, Any] | None) -> None:
    """Replace all client learning claims with account-verified server facts."""
    payload.pop("verified_player_patterns", None)
    choices = payload.get("choices")
    if isinstance(choices, list):
        for choice in choices:
            if isinstance(choice, dict):
                choice.pop("verified_player_fit", None)
    patterns = [
        pattern for pattern in (learning or {}).get("verified_patterns", [])
        if isinstance(pattern, dict)
        and pattern.get("confidence") == "verified"
        and pattern.get("kind") != "preferred_distance_band"
    ]
    payload["verified_player_patterns"] = patterns
