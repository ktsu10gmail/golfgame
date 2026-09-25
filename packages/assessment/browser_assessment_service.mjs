export const ASSESSMENT_VERSION = "1.0";
export const DECISION_POLICY_VERSION = "decision-policy-v1";

export const ResultLabel = Object.freeze({
  GOOD: "GOOD_RESULT",
  MIXED: "MIXED_RESULT",
  COSTLY: "COSTLY_RESULT",
  RECORDED: "RECORDED_RESULT"
});

export const DecisionLabel = Object.freeze({
  PREFERRED: "PREFERRED_PLAN",
  COMPETITIVE: "COMPETITIVE_PLAN",
  HIGHER_RISK: "HIGHER_RISK_PLAN",
  NOT_GRADED: "DECISION_NOT_GRADED"
});

const COSTLY_SURFACES = new Set(["bunker", "water", "out of bounds", "out_of_bounds", "trees", "trees/recovery", "recovery"]);
const MIXED_SURFACES = new Set(["rough", "heavy rough", "fringe"]);
const CURRENT_DECISION_LABELS = new Set(Object.values(DecisionLabel));
const CURRENT_RESULT_LABELS = new Set(Object.values(ResultLabel));

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function probability(value) {
  const number = finite(value);
  return number === null ? null : Math.max(0, Math.min(1, number / 100));
}

function reasonCode(value) {
  return String(value || "")
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function uniqueCodes(values) {
  return [...new Set(values.map(reasonCode).filter(Boolean))];
}

function surfaceCode(surface) {
  const normalized = String(surface || "").toLowerCase();
  return {
    green: "GREEN_REACHED",
    fairway: "FAIRWAY_FINISH",
    rough: "ROUGH_FINISH",
    "heavy rough": "ROUGH_FINISH",
    fringe: "FRINGE_FINISH",
    bunker: "BUNKER_FINISH",
    water: "WATER_PENALTY",
    "out of bounds": "OUT_OF_BOUNDS",
    out_of_bounds: "OUT_OF_BOUNDS"
  }[normalized] || null;
}

function resultAssessment(context) {
  const finish = String(context.finish_surface || "").toLowerCase();
  const intended = String(context.intended_surface || "").toLowerCase();
  const start = String(context.start_surface || "").toLowerCase();
  const reasons = [];
  const finishCode = surfaceCode(finish);
  if (finishCode) reasons.push(finishCode);
  if (context.holed_out) reasons.push("HOLED_OUT");
  if (context.penalty_strokes > 0 && finish !== "water" && finish !== "out of bounds" && finish !== "out_of_bounds") {
    reasons.push("PENALTY_STROKE");
  }
  if (context.holed_out) return { label: ResultLabel.GOOD, reason_codes: uniqueCodes(reasons) };
  if (context.penalty_strokes > 0 || COSTLY_SURFACES.has(finish)) {
    return { label: ResultLabel.COSTLY, reason_codes: uniqueCodes(reasons) };
  }
  if (context.mode === "GPS" && ["fairway", "rough", "heavy rough", "tee"].includes(finish)) {
    const goodFairwayRecovery = finish === "fairway" && (start === "tee" || COSTLY_SURFACES.has(start));
    const goodProgress = finite(context.progress_ratio) !== null && context.progress_ratio >= 0.55;
    return {
      label: goodFairwayRecovery || goodProgress ? ResultLabel.GOOD : ResultLabel.MIXED,
      reason_codes: uniqueCodes(reasons)
    };
  }
  if (finish && intended && finish === intended) {
    return { label: ResultLabel.GOOD, reason_codes: uniqueCodes(reasons) };
  }
  if (finish === "green" || finish === "fairway") {
    return { label: ResultLabel.GOOD, reason_codes: uniqueCodes(reasons) };
  }
  if (MIXED_SURFACES.has(finish)) {
    return { label: ResultLabel.MIXED, reason_codes: uniqueCodes(reasons) };
  }
  return { label: ResultLabel.RECORDED, reason_codes: uniqueCodes(reasons) };
}

function decisionAssessment(context) {
  const strategy = context.strategy_evidence;
  if (!strategy) {
    return { label: DecisionLabel.NOT_GRADED, reason_codes: ["SIMULATION_EVIDENCE_MISSING"] };
  }
  const outlook = String(strategy.hybrid_outlook || strategy.outlook || "");
  const sourceLabel = String(strategy.decision_label || "").toLowerCase();
  let label = DecisionLabel.NOT_GRADED;
  if (outlook === "Best") label = DecisionLabel.PREFERRED;
  else if (outlook === "Competitive") label = DecisionLabel.COMPETITIVE;
  else if (outlook === "Higher risk") label = DecisionLabel.HIGHER_RISK;
  else if (sourceLabel === "excellent") label = DecisionLabel.PREFERRED;
  else if (["sound", "acceptable"].includes(sourceLabel)) label = DecisionLabel.COMPETITIVE;
  else if (["review", "poor", "bad"].includes(sourceLabel)) label = DecisionLabel.HIGHER_RISK;
  const reasons = uniqueCodes(strategy.reason_codes || []);
  if (label === DecisionLabel.PREFERRED && strategy.recommended_choice_id) reasons.push("BETTER_EXPECTED_STROKES");
  if (label === DecisionLabel.NOT_GRADED) reasons.push("SIMULATION_EVIDENCE_MISSING");
  return { label, reason_codes: uniqueCodes(reasons) };
}

function outcomeAssessment(context) {
  const lateral = finite(context.target_delta?.lateral_yards);
  const depth = finite(context.target_delta?.distance_yards);
  if (!context.target_preserved || lateral === null || depth === null) {
    return {
      available: false,
      target_kind: context.target_kind,
      reason_codes: ["TARGET_EVIDENCE_MISSING"]
    };
  }
  return {
    available: true,
    target_kind: context.target_kind,
    distance_from_target_yards: Math.round(Math.hypot(lateral, depth) * 100) / 100,
    lateral_miss_yards: Math.round(lateral * 100) / 100,
    depth_miss_yards: Math.round(depth * 100) / 100,
    lateral_direction: Math.abs(lateral) < 0.01 ? "CENTER" : lateral > 0 ? "RIGHT" : "LEFT",
    depth_direction: Math.abs(depth) < 0.01 ? "AT_DISTANCE" : depth > 0 ? "LONG" : "SHORT",
    reason_codes: []
  };
}

function riskAssessment(context) {
  const source = context.risk_evidence || {};
  const normalized = {
    modeled_risk_score: finite(source.modeled_risk_score),
    penalty_probability: probability(source.penalty_percent),
    bunker_probability: probability(source.bunker_percent),
    water_probability: probability(source.water_percent),
    out_of_bounds_probability: probability(source.out_of_bounds_percent),
    playable_lie_probability: probability(source.playable_percent),
    green_probability: probability(source.green_percent),
    target_probability: probability(source.target_percent),
    reason_codes: []
  };
  if (normalized.penalty_probability === 0) normalized.reason_codes.push("LOW_PENALTY_RISK");
  return normalized;
}

function executionAssessment(context) {
  const evidence = context.execution_evidence;
  const physics = context.physics_execution;
  const score = finite(evidence?.score);
  const label = String(evidence?.label || "").toLowerCase();
  const reasons = uniqueCodes(evidence?.reason_codes || []);
  const manageableLag = context.shot_type === "putt_lag"
    && score !== null
    && score >= 70
    && (label === "slight_miss" || reasons.includes("MANAGEABLE_LEAVE"));
  if (manageableLag) return { label: "ACCEPTABLE_EXECUTION", score: Math.round(score), reason_codes: reasons };
  if (physics === "on_plan" || label === "matched_plan" || label === "excellent") {
    return { label: "ON_PLAN_EXECUTION", score: score === null ? null : Math.round(score), reason_codes: reasons };
  }
  if (label === "slight_miss" && score !== null && score >= 70) {
    return { label: "ACCEPTABLE_EXECUTION", score: Math.round(score), reason_codes: reasons };
  }
  if (physics === "missed" || label === "missed" || (score !== null && score < 70)) {
    return { label: "MISSED_EXECUTION", score: score === null ? null : Math.round(score), reason_codes: reasons };
  }
  return { label: "EXECUTION_NOT_GRADED", score: score === null ? null : Math.round(score), reason_codes: reasons };
}

function refinements(context, decision) {
  const sidehill = context.sidehill_plan;
  if (!sidehill || ["correct", "not_required"].includes(sidehill.compensation)) return [];
  const amount = Math.round(Math.abs(finite(sidehill.recommended_aim_yards) || 0) * 10) / 10;
  if (!amount) return [];
  const direction = Number(sidehill.recommended_aim_yards) > 0 ? "right" : "left";
  return [{
    domain: "SIDEHILL",
    label: [DecisionLabel.PREFERRED, DecisionLabel.COMPETITIVE].includes(decision.label) ? "REFINEMENT" : "REVIEW",
    reason_code: reasonCode(`SIDEHILL_COMPENSATION_${sidehill.compensation}`),
    recommended_aim_yards: amount,
    recommended_direction: direction.toUpperCase(),
    message: `Aim about ${amount} yards ${direction} of the chosen target to account for the sidehill curve.`
  }];
}

export function gameShotAssessmentContext(shot) {
  const strategyChoice = shot?.strategyChoice;
  const strategyPacket = shot?.strategyPacket;
  const probabilityEvidence = {
    ...(strategyChoice?.probability_analysis || {}),
    modeled_risk_score: strategyChoice?.modeled_risk ?? shot?.resultPacket?.assessment?.decision_risk ?? null
  };
  const strategyReasons = [...(strategyPacket?.decision?.reasons || [])];
  if (shot?.landingTargetPlan?.rule_of_12_candidate) strategyReasons.push("RULE_OF_12_CANDIDATE");
  return {
    mode: "PC_SIMULATION",
    shot_type: strategyPacket?.shot_type || shot?.shotType || null,
    intended_surface: shot?.intendedLie || null,
    landing_surface: shot?.landingLie || null,
    finish_surface: shot?.lie || shot?.landingLie || null,
    penalty_strokes: Math.max(0, Math.round(finite(shot?.penalty) || 0)),
    remaining_yards: finite(shot?.remaining),
    holed_out: shot?.puttPacket?.made === true || finite(shot?.remaining) === 0,
    target_kind: shot?.club === "Putter" || String(strategyPacket?.shot_type || "").startsWith("putt_")
      ? "PUTTING_LINE"
      : shot?.aimType === "landing_target"
        ? "LANDING_TARGET"
        : "DIRECTION_TARGET",
    target_preserved: Boolean(shot?.outcomeVsTarget),
    target_delta: shot?.outcomeVsTarget || null,
    strategy_evidence: strategyPacket || strategyChoice ? {
      hybrid_outlook: strategyChoice?.hybrid_outlook || null,
      outlook: strategyChoice?.outlook || null,
      decision_label: strategyPacket?.decision?.label || null,
      reason_codes: strategyReasons,
      recommended_choice_id: strategyChoice?.analysis_identity?.recommended_choice_id || null
    } : null,
    execution_evidence: strategyPacket?.execution ? {
      score: strategyPacket.execution.score,
      label: strategyPacket.execution.label,
      reason_codes: strategyPacket.execution.reasons || []
    } : null,
    physics_execution: shot?.resultPacket?.assessment?.execution_assessment
      || shot?.puttPacket?.assessment?.execution_assessment
      || null,
    risk_evidence: probabilityEvidence,
    sidehill_plan: shot?.sidehillPlan || null,
    evidence: {
      simulation_version: shot?.resultPacket?.audit?.engine_version || shot?.puttPacket?.audit?.engine_version || null,
      evaluator_version: strategyChoice?.analysis_identity?.version || strategyPacket?.version || null,
      decision_policy_version: DECISION_POLICY_VERSION,
      seed: strategyChoice?.analysis_identity?.seed || shot?.resultPacket?.audit?.shot_seed || shot?.puttPacket?.audit?.shot_seed || null,
      sample_count: strategyChoice?.analysis_identity?.sample_count || null,
      landing_target_model_version: shot?.landingTargetPlan?.version || null
    }
  };
}

export function gpsShotAssessmentContext(shot, targetDelta = null, pinPoint = null) {
  const strategy = shot?.strategy;
  const decisionEvidence = strategy?.decision_evidence;
  const selectedId = decisionEvidence?.selected_choice_id || strategy?.id;
  const selected = Array.isArray(decisionEvidence?.candidates)
    ? decisionEvidence.candidates.find(candidate => candidate.id === selectedId)
    : null;
  const startPoint = shot?.start?.course_point;
  const endPoint = shot?.end?.course_point;
  const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(value => Number.isFinite(Number(value)));
  const before = validPoint(startPoint) && validPoint(pinPoint) ? Math.hypot(startPoint[0] - pinPoint[0], startPoint[1] - pinPoint[1]) : null;
  const after = validPoint(endPoint) && validPoint(pinPoint) ? Math.hypot(endPoint[0] - pinPoint[0], endPoint[1] - pinPoint[1]) : null;
  return {
    mode: "GPS",
    start_surface: shot?.start?.lie || null,
    shot_type: strategy?.shot_type || null,
    intended_surface: strategy?.target_label || null,
    landing_surface: shot?.end?.lie || null,
    finish_surface: shot?.end?.lie || null,
    penalty_strokes: Math.max(0, Math.round(finite(shot?.penalty_strokes) || 0)),
    remaining_yards: finite(shot?.remaining_yards),
    holed_out: shot?.completion_type === "holed",
    progress_ratio: before && after !== null ? (before - after) / before : null,
    target_kind: "RECORDED_TARGET",
    target_preserved: Boolean(targetDelta),
    target_delta: targetDelta,
    strategy_evidence: decisionEvidence ? {
      hybrid_outlook: selected?.analysis?.hybrid_outlook || strategy?.hybrid_outlook || null,
      decision_label: null,
      reason_codes: [],
      recommended_choice_id: decisionEvidence.recommended_choice_id || null
    } : null,
    execution_evidence: null,
    physics_execution: null,
    risk_evidence: selected?.analysis || strategy?.probability_analysis || null,
    evidence: {
      simulation_version: null,
      evaluator_version: decisionEvidence?.version || null,
      decision_policy_version: DECISION_POLICY_VERSION,
      seed: decisionEvidence?.analysis_seed || null,
      sample_count: decisionEvidence?.sample_count || null
    }
  };
}

export function assessShotContext(context) {
  const decision = decisionAssessment(context);
  return {
    assessment_version: ASSESSMENT_VERSION,
    result: resultAssessment(context),
    decision,
    outcome_vs_target: outcomeAssessment(context),
    risk: riskAssessment(context),
    execution: executionAssessment(context),
    refinements: refinements(context, decision),
    evidence: {
      mode: context.mode,
      target_kind: context.target_kind,
      landing_surface: context.landing_surface,
      finish_surface: context.finish_surface,
      ...context.evidence
    }
  };
}

export function assessGameShot(shot) {
  return assessShotContext(gameShotAssessmentContext(shot));
}

export function assessGpsShot(shot, targetDelta = null, pinPoint = null) {
  return assessShotContext(gpsShotAssessmentContext(shot, targetDelta, pinPoint));
}

export function isCanonicalAssessment(value) {
  return Boolean(
    value
    && value.assessment_version === ASSESSMENT_VERSION
    && CURRENT_RESULT_LABELS.has(value.result?.label)
    && CURRENT_DECISION_LABELS.has(value.decision?.label)
  );
}

export function canonicalAssessmentForGameShot(shot) {
  return isCanonicalAssessment(shot?.canonicalAssessment)
    ? shot.canonicalAssessment
    : assessGameShot(shot);
}

export function canonicalAssessmentForGpsShot(shot, targetDelta = null, pinPoint = null) {
  return isCanonicalAssessment(shot?.canonicalAssessment)
    ? shot.canonicalAssessment
    : assessGpsShot(shot, targetDelta, pinPoint);
}

export function legacyPacketAssessment(canonical) {
  if (!canonical) return null;
  const decision = canonical.decision?.label;
  const execution = canonical.execution?.label;
  const decisionAssessment = [DecisionLabel.PREFERRED, DecisionLabel.COMPETITIVE].includes(decision)
    ? "sound"
    : decision === DecisionLabel.HIGHER_RISK
      ? "review"
      : null;
  const executionAssessment = ["ON_PLAN_EXECUTION", "ACCEPTABLE_EXECUTION"].includes(execution)
    ? "on_plan"
    : execution === "MISSED_EXECUTION"
      ? "missed"
      : null;
  return {
    decision_assessment: decisionAssessment,
    execution_assessment: executionAssessment,
    overall_assessment: decisionAssessment === null || executionAssessment === null
      ? null
      : decisionAssessment === "sound" && ["ON_PLAN_EXECUTION", "ACCEPTABLE_EXECUTION"].includes(execution)
        ? "good"
        : "bad",
    decision_risk: null,
    risk_label: null
  };
}
