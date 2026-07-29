"""Deterministic course-management scoring."""

from __future__ import annotations

from packages.golf_domain import (
    ClubStat,
    DecisionConfidence,
    DecisionEvaluation,
    DecisionLabel,
    DecisionReason,
    DecisionSubscores,
    ExecutionEvaluation,
    ExecutionLabel,
    LieType,
    PreferredMiss,
    ShotResultPacket,
    StrategicShotType,
    StrategyContext,
    StrategyScorePacket,
    SurfaceType,
)


DECISION_SCORE_VERSION = "decision-score-v1"

_LIE_ADVICE_KEYS: dict[LieType, str] = {
    LieType.TEE_STANDARD: "tee_standard",
    LieType.FAIRWAY_CLEAN: "fairway_clean",
    LieType.ROUGH_LIGHT: "rough_light",
    LieType.ROUGH_MEDIUM: "rough_medium",
    LieType.ROUGH_DEEP: "rough_deep",
    LieType.ROUGH_FLYER: "rough_flyer",
    LieType.HARDPAN: "hardpan",
    LieType.BUNKER_FAIRWAY: "bunker_fairway",
    LieType.BUNKER_BURIED: "bunker_buried",
}

_SEVERE_LIES = {
    LieType.ROUGH_MEDIUM,
    LieType.ROUGH_DEEP,
    LieType.HARDPAN,
    LieType.BUNKER_FAIRWAY,
    LieType.BUNKER_BURIED,
}

_VERY_SEVERE_LIES = {
    LieType.ROUGH_DEEP,
    LieType.BUNKER_BURIED,
}

_LOW_CONTROL_LIES = _SEVERE_LIES | {LieType.ROUGH_FLYER}

_DEFAULT_WEIGHTS = {
    "target_selection": 0.25,
    "club_selection": 0.20,
    "lie_management": 0.15,
    "hazard_management": 0.20,
    "recovery_discipline": 0.10,
    "miss_planning": 0.10,
}

_SHOT_TYPE_WEIGHTS: dict[StrategicShotType, dict[str, float]] = {
    StrategicShotType.TEE_POSITIONING: {
        "target_selection": 0.30,
        "club_selection": 0.18,
        "lie_management": 0.15,
        "hazard_management": 0.25,
        "recovery_discipline": 0.04,
        "miss_planning": 0.08,
    },
    StrategicShotType.APPROACH_STANDARD: {
        "target_selection": 0.24,
        "club_selection": 0.22,
        "lie_management": 0.15,
        "hazard_management": 0.18,
        "recovery_discipline": 0.08,
        "miss_planning": 0.13,
    },
    StrategicShotType.APPROACH_FORCED_CARRY: {
        "target_selection": 0.18,
        "club_selection": 0.28,
        "lie_management": 0.12,
        "hazard_management": 0.25,
        "recovery_discipline": 0.07,
        "miss_planning": 0.10,
    },
    StrategicShotType.RECOVERY_ESCAPE: {
        "target_selection": 0.10,
        "club_selection": 0.16,
        "lie_management": 0.18,
        "hazard_management": 0.22,
        "recovery_discipline": 0.26,
        "miss_planning": 0.08,
    },
    StrategicShotType.RECOVERY_ADVANCING: {
        "target_selection": 0.12,
        "club_selection": 0.18,
        "lie_management": 0.17,
        "hazard_management": 0.21,
        "recovery_discipline": 0.24,
        "miss_planning": 0.08,
    },
    StrategicShotType.BUNKER_ESCAPE: {
        "target_selection": 0.12,
        "club_selection": 0.15,
        "lie_management": 0.25,
        "hazard_management": 0.18,
        "recovery_discipline": 0.22,
        "miss_planning": 0.08,
    },
}


def _clamp(value: int, lower: int = 0, upper: int = 100) -> int:
    return min(upper, max(lower, value))


def _decision_label(score: int) -> DecisionLabel:
    if score >= 90:
        return DecisionLabel.EXCELLENT
    if score >= 80:
        return DecisionLabel.SOUND
    if score >= 70:
        return DecisionLabel.ACCEPTABLE
    if score >= 60:
        return DecisionLabel.AGGRESSIVE
    if score >= 45:
        return DecisionLabel.POOR
    return DecisionLabel.RECKLESS


def _execution_label(score: int) -> ExecutionLabel:
    if score >= 85:
        return ExecutionLabel.MATCHED_PLAN
    if score >= 70:
        return ExecutionLabel.SLIGHT_MISS
    if score >= 50:
        return ExecutionLabel.CLEAR_MISS
    return ExecutionLabel.MAJOR_MISS


def _weighted_score(shot_type: StrategicShotType, subscores: DecisionSubscores) -> int:
    weights = _SHOT_TYPE_WEIGHTS.get(shot_type, _DEFAULT_WEIGHTS)
    weighted = (
        subscores.target_selection * weights["target_selection"]
        + subscores.club_selection * weights["club_selection"]
        + subscores.lie_management * weights["lie_management"]
        + subscores.hazard_management * weights["hazard_management"]
        + subscores.recovery_discipline * weights["recovery_discipline"]
        + subscores.miss_planning * weights["miss_planning"]
    )
    return round(weighted)


def _hazard_key(context: StrategyContext) -> str | None:
    if context.out_of_bounds_in_play:
        return "out_of_bounds_in_play"
    if context.forced_carry_yards > 0 and context.water_in_play:
        return "forced_water_carry"
    if context.water_in_play:
        return "water_in_play"
    if context.recovery_required:
        return "recovery_after_penalty" if "penalty" in context.strategy_notes else "unplayable_situation"
    if context.hazard_count > 0:
        return "fairway_bunker_in_play"
    return None


def _outcome_key(context: StrategyContext, reasons: set[DecisionReason]) -> str:
    if DecisionReason.HERO_SHOT_NOT_JUSTIFIED in reasons or context.recovery_required:
        return "restore_position"
    if context.forced_carry_yards > 0:
        return "cover_the_carry"
    if context.pin_risk_level >= 1:
        return "favor_center_green"
    if context.water_in_play or context.out_of_bounds_in_play:
        return "favor_safe_side"
    if context.lie_type in _VERY_SEVERE_LIES:
        return "escape_first"
    if context.lie_type in _LOW_CONTROL_LIES:
        return "prioritize_solid_contact"
    return "remove_big_miss"


def _shot_id(context: StrategyContext) -> str:
    return f"h{context.hole_number}:s{context.stroke_number}"


def _infer_preferred_miss(context: StrategyContext) -> PreferredMiss:
    if context.preferred_miss is not PreferredMiss.NONE_DECLARED:
        return context.preferred_miss
    if context.recovery_required:
        return PreferredMiss.BACK_IN_PLAY
    if context.out_of_bounds_in_play:
        return PreferredMiss.AWAY_FROM_OB
    if context.water_in_play:
        return PreferredMiss.DRY_SIDE
    if context.pin_risk_level >= 1:
        return PreferredMiss.CENTER_GREEN
    if context.shot_type in {StrategicShotType.TEE_POSITIONING, StrategicShotType.LAYUP_POSITIONING}:
        return PreferredMiss.WIDEST_LANDING_ZONE
    return PreferredMiss.NONE_DECLARED


def score_strategy(context: StrategyContext, result: ShotResultPacket | None = None) -> StrategyScorePacket:
    reasons: set[DecisionReason] = set()
    preferred_miss = _infer_preferred_miss(context)
    preferred_miss_inferred = context.preferred_miss is PreferredMiss.NONE_DECLARED

    target_selection = 85
    club_selection = 85
    lie_management = 85
    hazard_management = 85
    recovery_discipline = 85
    miss_planning = 85

    if context.target_aggression <= 0.30 and (context.water_in_play or context.out_of_bounds_in_play or context.pin_risk_level > 0):
        target_selection += 5
        hazard_management += 4
        reasons.add(DecisionReason.SAFE_TARGET_SELECTED)
        reasons.add(DecisionReason.HAZARD_RESPECTED)
    if context.target_aggression >= 0.70:
        target_selection -= 10
        reasons.add(DecisionReason.TARGET_TOO_AGGRESSIVE)
    if context.pin_risk_level >= 1 and context.target_aggression >= 0.55 and context.lie_type in _LOW_CONTROL_LIES:
        target_selection -= 12
        miss_planning -= 6
        reasons.add(DecisionReason.PIN_ATTACK_NOT_JUSTIFIED)
    elif context.pin_risk_level >= 1 and context.target_aggression <= 0.35:
        target_selection += 4
        reasons.add(DecisionReason.GREEN_CENTER_BIAS_CORRECT)

    if context.forced_carry_yards > 0:
        carry_margin = context.selected_club.carry_mean - context.forced_carry_yards
        if carry_margin >= 10:
            club_selection += 4
            reasons.add(DecisionReason.CORRECT_CLUB_FOR_CARRY)
        elif carry_margin < 5:
            club_selection -= 12
            hazard_management -= 10
            reasons.add(DecisionReason.CARRY_MARGIN_THIN)

    if context.lie_type in _VERY_SEVERE_LIES:
        if context.target_aggression > 0.35:
            lie_management -= 14
            reasons.add(DecisionReason.LIE_NOT_RESPECTED)
        else:
            lie_management += 4
            reasons.add(DecisionReason.LIE_RESPECTED)
    elif context.lie_type in _LOW_CONTROL_LIES:
        if context.target_aggression > 0.55:
            lie_management -= 10
            reasons.add(DecisionReason.LIE_NOT_RESPECTED)
        else:
            lie_management += 3
            reasons.add(DecisionReason.LIE_RESPECTED)

    if context.water_in_play and context.target_aggression >= 0.60:
        hazard_management -= 8
        reasons.add(DecisionReason.HAZARD_UNDERWEIGHTED)
    if context.out_of_bounds_in_play and context.target_aggression >= 0.45:
        hazard_management -= 12
        reasons.add(DecisionReason.OB_RISK_NOT_JUSTIFIED)

    if context.recovery_required:
        if context.shot_type in {StrategicShotType.RECOVERY_ESCAPE, StrategicShotType.BUNKER_ESCAPE}:
            recovery_discipline += 6
            reasons.add(DecisionReason.SENSIBLE_RECOVERY)
        else:
            recovery_discipline -= 15
            target_selection -= 6
            reasons.add(DecisionReason.RECOVERY_NOT_TAKEN)
            reasons.add(DecisionReason.HERO_SHOT_NOT_JUSTIFIED)

    if context.shot_type is StrategicShotType.LAYUP_POSITIONING:
        recovery_discipline += 2
        reasons.add(DecisionReason.SMART_LAYUP)

    safe_miss = False
    if preferred_miss is PreferredMiss.CENTER_GREEN and context.pin_risk_level >= 1:
        safe_miss = True
        reasons.add(DecisionReason.GOOD_MISS_PLAN)
    if preferred_miss is PreferredMiss.DRY_SIDE and context.water_in_play:
        safe_miss = True
        reasons.add(DecisionReason.GOOD_MISS_PLAN)
    if preferred_miss is PreferredMiss.AWAY_FROM_OB and context.out_of_bounds_in_play:
        safe_miss = True
        reasons.add(DecisionReason.GOOD_MISS_PLAN)
    if preferred_miss is PreferredMiss.BACK_IN_PLAY and context.recovery_required:
        safe_miss = True
        reasons.add(DecisionReason.GOOD_MISS_PLAN)
    if preferred_miss is PreferredMiss.WIDEST_LANDING_ZONE and context.shot_type in {
        StrategicShotType.TEE_POSITIONING,
        StrategicShotType.LAYUP_POSITIONING,
    }:
        safe_miss = True
        reasons.add(DecisionReason.GOOD_MISS_PLAN)
    if safe_miss:
        miss_planning += 4
    elif preferred_miss is not PreferredMiss.NONE_DECLARED:
        miss_planning -= 6
        reasons.add(DecisionReason.BAD_MISS_PLAN)

    subscores = DecisionSubscores(
        target_selection=_clamp(target_selection),
        club_selection=_clamp(club_selection),
        lie_management=_clamp(lie_management),
        hazard_management=_clamp(hazard_management),
        recovery_discipline=_clamp(recovery_discipline),
        miss_planning=_clamp(miss_planning),
    )
    decision_score = _weighted_score(context.shot_type, subscores)
    decision = DecisionEvaluation(
        score=decision_score,
        label=_decision_label(decision_score),
        confidence=DecisionConfidence.HIGH,
        subscores=subscores,
        reasons=tuple(sorted(reasons, key=str)),
        advice_keys=tuple(
            key
            for key in (
                _LIE_ADVICE_KEYS[context.lie_type],
                _hazard_key(context),
                _outcome_key(context, reasons),
            )
            if key is not None
        ),
    )
    execution = _score_execution(context.selected_club, context.distance_to_target_yards, result) if result else None
    return StrategyScorePacket(
        version=DECISION_SCORE_VERSION,
        shot_id=_shot_id(context),
        preferred_miss=preferred_miss,
        preferred_miss_inferred=preferred_miss_inferred,
        decision=decision,
        execution=execution,
    )


def _score_execution(club: ClubStat, target_distance_yards: float, result: ShotResultPacket) -> ExecutionEvaluation:
    score = 80
    reasons: list[str] = []
    if result.relief is not None or result.landing_surface in {SurfaceType.WATER, SurfaceType.OUT_OF_BOUNDS}:
        score -= 35
        reasons.append("penalty_or_unplayable_result")
    if result.assessment.execution_assessment != "on_plan":
        score -= 12
        reasons.append("result_missed_plan")
    if result.remaining_distance_yards > max(12.0, target_distance_yards * 0.35):
        score -= 10
        reasons.append("distance_short_of_plan")
    if abs(result.lateral_yards) > max(club.lateral_sd * 1.5, 12.0):
        score -= 8
        reasons.append("missed_start_line")
    if not reasons:
        score += 10
        reasons.append("matched_intended_window")
    score = _clamp(score)
    return ExecutionEvaluation(
        score=score,
        label=_execution_label(score),
        plan_match="matched_window" if score >= 85 else "below_expected_start_line_and_distance",
        reasons=tuple(reasons),
    )
