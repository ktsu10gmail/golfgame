export const ROUND_STRATEGY_VERSION = "round-strategy-v1";

const SHOT_WEIGHTS = {
  tee_positioning: 1.0,
  tee_attack: 1.0,
  approach_standard: 1.2,
  approach_forced_carry: 1.35,
  layup_positioning: 1.0,
  recovery_escape: 1.3,
  recovery_advancing: 1.3,
  bunker_escape: 1.2,
  greenside_attack: 0.9,
  chip_pitch_standard: 0.9,
  putt_lag: 0.6,
  putt_make_attempt: 0.5
};

const CATEGORY_ORDER = [
  "target_selection",
  "club_selection",
  "lie_management",
  "hazard_management",
  "recovery_discipline",
  "miss_planning",
  "putting_read_discipline"
];

const REASON_PATTERNS = {
  target_too_aggressive: "aggressive_targets",
  pin_attack_not_justified: "aggressive_targets",
  carry_margin_thin: "thin_carry_choices",
  hazard_underweighted: "hazard_underweighting",
  ob_risk_not_justified: "hazard_underweighting",
  bad_miss_plan: "poor_miss_planning",
  recovery_not_taken: "missed_recovery",
  hero_shot_not_justified: "missed_recovery",
  putting_line_missed: "putting_plan",
  putting_pace_missed: "putting_plan"
};

const PATTERN_SUMMARIES = {
  aggressive_targets: "Aggressive target selection repeatedly raised avoidable risk.",
  thin_carry_choices: "Carry choices repeatedly left too little safety margin.",
  hazard_underweighting: "Hazards were repeatedly underweighted in the plan.",
  poor_miss_planning: "Preferred-miss planning was repeatedly unclear or unsafe.",
  missed_recovery: "Recovery situations repeatedly called for a safer reset.",
  putting_plan: "Putting reads or pace plans repeatedly missed the intended window."
};

const HIGH_COST_TYPES = new Set([
  "approach_forced_carry",
  "recovery_escape",
  "recovery_advancing",
  "bunker_escape"
]);

function weightedAverage(pairs) {
  const totalWeight = pairs.reduce((sum, [, weight]) => sum + weight, 0);
  return Math.round(pairs.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight);
}

function shotWeight(shot) {
  return SHOT_WEIGHTS[shot.shot_type] ?? 1;
}

function shotPatterns(shot) {
  return [...new Set(shot.reasons.map(reason => REASON_PATTERNS[reason]).filter(Boolean))];
}

function moment(shot) {
  return {
    shot_id: shot.shot_id,
    hole_number: shot.hole_number,
    stroke_number: shot.stroke_number,
    shot_type: shot.shot_type,
    score: shot.decision_score,
    reasons: [...shot.reasons]
  };
}

function normalizeShot(shot, holeNumber, strokeNumber) {
  const packet = shot?.strategyPacket ?? shot?.strategy_packet;
  if (!packet?.decision || !Number.isFinite(packet.decision.score)) return null;
  const idMatch = /^h(\d+):s(\d+)$/.exec(packet.shot_id || "");
  const subscores = packet.decision.subscores || {};
  const isPutt = "line_plan" in subscores || Boolean(shot?.puttPacket ?? shot?.putt_packet);
  const resolvedHole = idMatch ? Number(idMatch[1]) : holeNumber;
  const resolvedStroke = idMatch ? Number(idMatch[2]) : strokeNumber;
  return {
    shot_id: packet.shot_id || `h${resolvedHole}:s${resolvedStroke}`,
    hole_number: resolvedHole,
    stroke_number: resolvedStroke,
    shot_type: packet.shot_type || (isPutt
      ? (Number(shot?.puttPacket?.read?.feet ?? shot?.putt_packet?.read?.feet ?? 0) > 10
        ? "putt_lag"
        : "putt_make_attempt")
      : "unknown"),
    decision_score: packet.decision.score,
    decision_subscores: isPutt ? null : subscores,
    putting_read_discipline: isPutt ? packet.decision.score : null,
    reasons: Array.isArray(packet.decision.reasons) ? [...packet.decision.reasons] : [],
    advice_keys: Array.isArray(packet.decision.advice_keys) ? [...packet.decision.advice_keys] : [],
    execution_score: Number.isFinite(packet.execution?.score) ? packet.execution.score : null
  };
}

function holeSummary(shots) {
  const counts = Object.fromEntries(Object.keys(PATTERN_SUMMARIES).map(key => [key, 0]));
  shots.forEach(shot => shotPatterns(shot).forEach(key => { counts[key] += 1; }));
  const ranked = Object.keys(PATTERN_SUMMARIES).sort((a, b) => counts[b] - counts[a]);
  return counts[ranked[0]]
    ? PATTERN_SUMMARIES[ranked[0]]
    : "No repeated strategic concern on this hole.";
}

export function analyzeRoundStrategy(roundHistory) {
  const shots = (Array.isArray(roundHistory) ? roundHistory : [])
    .flatMap((holeShots, holeIndex) => (Array.isArray(holeShots) ? holeShots : [])
      .map((shot, strokeIndex) => normalizeShot(shot, holeIndex + 1, strokeIndex + 1)))
    .filter(Boolean);
  if (!shots.length) return null;

  const strategyScore = weightedAverage(shots.map(shot => [shot.decision_score, shotWeight(shot)]));
  const executed = shots.filter(shot => shot.execution_score !== null);
  const executionScore = executed.length
    ? weightedAverage(executed.map(shot => [shot.execution_score, shotWeight(shot)]))
    : null;
  const categoryValues = Object.fromEntries(CATEGORY_ORDER.map(key => [key, []]));
  shots.forEach(shot => {
    const weight = shotWeight(shot);
    CATEGORY_ORDER.slice(0, -1).forEach(key => {
      if (Number.isFinite(shot.decision_subscores?.[key])) {
        categoryValues[key].push([shot.decision_subscores[key], weight]);
      }
    });
    if (shot.putting_read_discipline !== null) {
      categoryValues.putting_read_discipline.push([shot.putting_read_discipline, weight]);
    }
  });
  const subscores = Object.fromEntries(CATEGORY_ORDER.map(key => [
    key,
    categoryValues[key].length ? weightedAverage(categoryValues[key]) : null
  ]));
  const available = CATEGORY_ORDER.filter(key => subscores[key] !== null);
  const topStrength = available.reduce((best, key) => subscores[key] > subscores[best] ? key : best);
  const topPriority = available.reduce((best, key) => subscores[key] < subscores[best] ? key : best);

  const holes = [...new Set(shots.map(shot => shot.hole_number))].sort((a, b) => a - b).map(holeNumber => {
    const holeShots = shots.filter(shot => shot.hole_number === holeNumber);
    const keyShot = [...holeShots].sort((a, b) =>
      a.decision_score - b.decision_score ||
      a.stroke_number - b.stroke_number ||
      a.shot_id.localeCompare(b.shot_id)
    )[0];
    return {
      hole_number: holeNumber,
      strategy_score: weightedAverage(holeShots.map(shot => [shot.decision_score, shotWeight(shot)])),
      scored_shots: holeShots.length,
      key_decision_moment: moment(keyShot),
      pattern_summary: holeSummary(holeShots)
    };
  });

  const patternCounts = Object.fromEntries(Object.keys(PATTERN_SUMMARIES).map(key => [key, 0]));
  const highCostCounts = Object.fromEntries(Object.keys(PATTERN_SUMMARIES).map(key => [key, 0]));
  shots.forEach(shot => shotPatterns(shot).forEach(key => {
    patternCounts[key] += 1;
    if (shot.decision_score < 70 || HIGH_COST_TYPES.has(shot.shot_type)) highCostCounts[key] += 1;
  }));
  const patterns = Object.keys(PATTERN_SUMMARIES)
    .filter(key => patternCounts[key] >= 3 || highCostCounts[key] >= 2)
    .map(key => ({
      key,
      count: patternCounts[key],
      high_cost_count: highCostCounts[key],
      summary: PATTERN_SUMMARIES[key]
    }));
  const good = [...shots].sort((a, b) =>
    b.decision_score - a.decision_score ||
    a.hole_number - b.hole_number ||
    a.stroke_number - b.stroke_number ||
    a.shot_id.localeCompare(b.shot_id)
  );
  const costly = [...shots].sort((a, b) =>
    a.decision_score - b.decision_score ||
    a.hole_number - b.hole_number ||
    a.stroke_number - b.stroke_number ||
    a.shot_id.localeCompare(b.shot_id)
  );

  return {
    version: ROUND_STRATEGY_VERSION,
    strategy_score: strategyScore,
    execution_score: executionScore,
    scored_shots: shots.length,
    subscores,
    holes,
    top_strength: topStrength,
    top_priority: topPriority,
    top_good_decisions: good.slice(0, 3).map(moment),
    top_costly_decisions: costly.slice(0, 3).map(moment),
    patterns,
    pattern_summary: patterns.length
      ? patterns.map(pattern => pattern.summary).join(" ")
      : "No repeated strategic mistake reached the review threshold."
  };
}
