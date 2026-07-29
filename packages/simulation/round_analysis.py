"""Deterministic hole and round strategy aggregation."""

from __future__ import annotations

import math
import re
from collections import defaultdict
from collections.abc import Iterable

from packages.golf_domain import (
    DecisionMoment,
    DecisionSubscores,
    HoleStrategyAnalysis,
    PuttDecisionSubscores,
    RoundStrategyAnalysis,
    RoundStrategySubscores,
    StrategicShotType,
    StrategyAnalysisShot,
    StrategyPattern,
    StrategyScorePacket,
)


ROUND_STRATEGY_VERSION = "round-strategy-v1"

_SHOT_WEIGHTS: dict[StrategicShotType, float] = {
    StrategicShotType.TEE_POSITIONING: 1.0,
    StrategicShotType.TEE_ATTACK: 1.0,
    StrategicShotType.APPROACH_STANDARD: 1.2,
    StrategicShotType.APPROACH_FORCED_CARRY: 1.35,
    StrategicShotType.LAYUP_POSITIONING: 1.0,
    StrategicShotType.RECOVERY_ESCAPE: 1.3,
    StrategicShotType.RECOVERY_ADVANCING: 1.3,
    StrategicShotType.BUNKER_ESCAPE: 1.2,
    StrategicShotType.GREENSIDE_ATTACK: 0.9,
    StrategicShotType.CHIP_PITCH_STANDARD: 0.9,
    StrategicShotType.PUTT_LAG: 0.6,
    StrategicShotType.PUTT_MAKE_ATTEMPT: 0.5,
}

_CATEGORY_ORDER = (
    "target_selection",
    "club_selection",
    "lie_management",
    "hazard_management",
    "recovery_discipline",
    "miss_planning",
    "putting_read_discipline",
)

_REASON_PATTERNS = {
    "target_too_aggressive": "aggressive_targets",
    "pin_attack_not_justified": "aggressive_targets",
    "carry_margin_thin": "thin_carry_choices",
    "hazard_underweighted": "hazard_underweighting",
    "ob_risk_not_justified": "hazard_underweighting",
    "bad_miss_plan": "poor_miss_planning",
    "recovery_not_taken": "missed_recovery",
    "hero_shot_not_justified": "missed_recovery",
    "putting_line_missed": "putting_plan",
    "putting_pace_missed": "putting_plan",
}

_PATTERN_SUMMARIES = {
    "aggressive_targets": "Aggressive target selection repeatedly raised avoidable risk.",
    "thin_carry_choices": "Carry choices repeatedly left too little safety margin.",
    "hazard_underweighting": "Hazards were repeatedly underweighted in the plan.",
    "poor_miss_planning": "Preferred-miss planning was repeatedly unclear or unsafe.",
    "missed_recovery": "Recovery situations repeatedly called for a safer reset.",
    "putting_plan": "Putting reads or pace plans repeatedly missed the intended window.",
}

_HIGH_COST_TYPES = {
    StrategicShotType.APPROACH_FORCED_CARRY,
    StrategicShotType.RECOVERY_ESCAPE,
    StrategicShotType.RECOVERY_ADVANCING,
    StrategicShotType.BUNKER_ESCAPE,
}

_SHOT_ID_RE = re.compile(r"^h(?P<hole>\d+):s(?P<stroke>\d+)$")


def _round_half_up(value: float) -> int:
    return math.floor(value + 0.5)


def _weighted_average(values: Iterable[tuple[int, float]]) -> int:
    pairs = tuple(values)
    return _round_half_up(sum(value * weight for value, weight in pairs) / sum(weight for _, weight in pairs))


def _moment(shot: StrategyAnalysisShot) -> DecisionMoment:
    return DecisionMoment(
        shot_id=shot.shot_id,
        hole_number=shot.hole_number,
        stroke_number=shot.stroke_number,
        shot_type=shot.shot_type,
        score=shot.decision_score,
        reasons=shot.reasons,
    )


def analysis_shot_from_packet(packet: StrategyScorePacket) -> StrategyAnalysisShot:
    """Normalize a score packet into the runtime-neutral aggregation input."""
    match = _SHOT_ID_RE.match(packet.shot_id)
    if match is None:
        raise ValueError(f"invalid strategy shot_id: {packet.shot_id}")
    full_subscores = packet.decision.subscores
    decision_subscores = full_subscores if isinstance(full_subscores, DecisionSubscores) else None
    putting_score = packet.decision.score if isinstance(full_subscores, PuttDecisionSubscores) else None
    return StrategyAnalysisShot(
        shot_id=packet.shot_id,
        hole_number=int(match.group("hole")),
        stroke_number=int(match.group("stroke")),
        shot_type=packet.shot_type,
        decision_score=packet.decision.score,
        decision_subscores=decision_subscores,
        putting_read_discipline=putting_score,
        reasons=tuple(str(reason) for reason in packet.decision.reasons),
        advice_keys=packet.decision.advice_keys,
        execution_score=packet.execution.score if packet.execution else None,
    )


def _shot_patterns(shot: StrategyAnalysisShot) -> set[str]:
    return {_REASON_PATTERNS[reason] for reason in shot.reasons if reason in _REASON_PATTERNS}


def _hole_summary(shots: tuple[StrategyAnalysisShot, ...]) -> str:
    counts: dict[str, int] = defaultdict(int)
    for shot in shots:
        for key in _shot_patterns(shot):
            counts[key] += 1
    if not counts:
        return "No repeated strategic concern on this hole."
    key = min(counts, key=lambda item: (-counts[item], tuple(_PATTERN_SUMMARIES).index(item)))
    return _PATTERN_SUMMARIES[key]


def analyze_round_strategy(
    shots: Iterable[StrategyAnalysisShot],
) -> RoundStrategyAnalysis | None:
    """Aggregate immutable shot decisions; return None for legacy/unscored rounds."""
    normalized = tuple(shots)
    if not normalized:
        return None

    def weight(shot: StrategyAnalysisShot) -> float:
        return _SHOT_WEIGHTS.get(shot.shot_type, 1.0)

    strategy_score = _weighted_average((shot.decision_score, weight(shot)) for shot in normalized)
    executed = tuple(shot for shot in normalized if shot.execution_score is not None)
    execution_score = (
        _weighted_average((shot.execution_score or 0, weight(shot)) for shot in executed)
        if executed
        else None
    )

    category_values: dict[str, list[tuple[int, float]]] = {key: [] for key in _CATEGORY_ORDER}
    for shot in normalized:
        shot_weight = weight(shot)
        if shot.decision_subscores is not None:
            for key in _CATEGORY_ORDER[:-1]:
                category_values[key].append((getattr(shot.decision_subscores, key), shot_weight))
        if shot.putting_read_discipline is not None:
            category_values["putting_read_discipline"].append((shot.putting_read_discipline, shot_weight))
    category_scores = {
        key: _weighted_average(values) if values else None
        for key, values in category_values.items()
    }
    available_categories = [key for key in _CATEGORY_ORDER if category_scores[key] is not None]
    top_strength = max(available_categories, key=lambda key: (category_scores[key], -_CATEGORY_ORDER.index(key)))
    top_priority = min(available_categories, key=lambda key: (category_scores[key], _CATEGORY_ORDER.index(key)))

    holes: list[HoleStrategyAnalysis] = []
    for hole_number in sorted({shot.hole_number for shot in normalized}):
        hole_shots = tuple(shot for shot in normalized if shot.hole_number == hole_number)
        key_shot = min(hole_shots, key=lambda shot: (shot.decision_score, shot.stroke_number, shot.shot_id))
        holes.append(
            HoleStrategyAnalysis(
                hole_number=hole_number,
                strategy_score=_weighted_average((shot.decision_score, weight(shot)) for shot in hole_shots),
                scored_shots=len(hole_shots),
                key_decision_moment=_moment(key_shot),
                pattern_summary=_hole_summary(hole_shots),
            )
        )

    pattern_counts: dict[str, int] = defaultdict(int)
    high_cost_counts: dict[str, int] = defaultdict(int)
    for shot in normalized:
        for key in _shot_patterns(shot):
            pattern_counts[key] += 1
            if shot.decision_score < 70 or shot.shot_type in _HIGH_COST_TYPES:
                high_cost_counts[key] += 1
    patterns = tuple(
        StrategyPattern(
            key=key,
            count=pattern_counts[key],
            high_cost_count=high_cost_counts[key],
            summary=_PATTERN_SUMMARIES[key],
        )
        for key in _PATTERN_SUMMARIES
        if pattern_counts[key] >= 3 or high_cost_counts[key] >= 2
    )
    pattern_summary = (
        " ".join(pattern.summary for pattern in patterns)
        if patterns
        else "No repeated strategic mistake reached the review threshold."
    )

    best = sorted(normalized, key=lambda shot: (-shot.decision_score, shot.hole_number, shot.stroke_number, shot.shot_id))
    costly = sorted(normalized, key=lambda shot: (shot.decision_score, shot.hole_number, shot.stroke_number, shot.shot_id))
    return RoundStrategyAnalysis(
        version=ROUND_STRATEGY_VERSION,
        strategy_score=strategy_score,
        execution_score=execution_score,
        scored_shots=len(normalized),
        subscores=RoundStrategySubscores(**category_scores),
        holes=tuple(holes),
        top_strength=top_strength,
        top_priority=top_priority,
        top_good_decisions=tuple(_moment(shot) for shot in best[:3]),
        top_costly_decisions=tuple(_moment(shot) for shot in costly[:3]),
        patterns=patterns,
        pattern_summary=pattern_summary,
    )
