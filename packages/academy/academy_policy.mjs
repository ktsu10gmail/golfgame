export const ACADEMY_DECISION_POLICY_VERSION = "academy-decision-v1";
export const ACADEMY_COMPETITIVE_MARGIN = 3;

const ACADEMY_DECISION_POINTS = Object.freeze({
  PREFERRED: 100,
  COMPETITIVE: 85,
  WEAK: 55
});

function probability(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric / 100));
}

export function normalizeAcademyEvaluation(summary = {}) {
  return {
    target_probability: probability(summary.target_percent),
    playable_lie_probability: probability(summary.playable_percent),
    green_probability: probability(summary.green_percent),
    bunker_probability: probability(summary.bunker_percent),
    water_probability: probability(summary.water_percent),
    penalty_probability: probability(summary.penalty_percent),
    typical_leave_yards: Number.isFinite(Number(summary.median_leave_yards))
      ? Number(summary.median_leave_yards)
      : null
  };
}

export function academyDecisionBand(analysis, choiceId, margin = ACADEMY_COMPETITIVE_MARGIN) {
  const candidate = analysis?.candidates?.[choiceId];
  if (!candidate) return "UNRANKED";
  const scores = Object.values(analysis.candidates)
    .map(item => Number(item.probability_score))
    .filter(Number.isFinite);
  const best = scores.length ? Math.max(...scores) : Number(candidate.probability_score);
  const delta = best - Number(candidate.probability_score);
  if (delta <= 0.001) return "PREFERRED";
  return delta <= margin ? "COMPETITIVE" : "WEAK";
}

export function academyChoiceEvidence(choice, analysis) {
  const summary = analysis?.candidates?.[choice.id] || {};
  const scores = Object.values(analysis?.candidates || {})
    .map(item => Number(item.probability_score))
    .filter(Number.isFinite);
  const score = Number(summary.probability_score);
  return {
    strategy_id: choice.id,
    decision_band: academyDecisionBand(analysis, choice.id),
    modeled_score_delta: Number.isFinite(score) && scores.length
      ? Math.round((Math.max(...scores) - score) * 10) / 10
      : null,
    evaluation: normalizeAcademyEvaluation(summary),
    evidence: {
      sample_count: analysis?.sample_count ?? null,
      analysis_seed: analysis?.analysis_seed ?? null,
      evaluator_version: analysis?.version ?? null,
      ranking_version: analysis?.ranking_version ?? null,
      academy_policy_version: ACADEMY_DECISION_POLICY_VERSION
    }
  };
}

export function scoreAcademySession(decisions = []) {
  const scored = decisions
    .map(decision => decision?.evidence?.decision_band || decision?.decision_band)
    .filter(band => Object.hasOwn(ACADEMY_DECISION_POINTS, band));
  const counts = scored.reduce((result, band) => {
    result[band.toLowerCase()] += 1;
    return result;
  }, { preferred: 0, competitive: 0, weak: 0 });
  const score = scored.length
    ? Math.round(scored.reduce((sum, band) => sum + ACADEMY_DECISION_POINTS[band], 0) / scored.length)
    : 0;
  const rating = score >= 95
    ? "Excellent course manager"
    : score >= 82
      ? "Strong strategic player"
      : score >= 68
        ? "Developing good judgment"
        : "Build a safer decision pattern";
  let comment;
  if (!scored.length) {
    comment = "Complete at least one full-shot decision to receive an Academy assessment.";
  } else if (score >= 95) {
    comment = "You consistently chose the plan with the strongest modeled balance of opportunity and risk. Keep using this same discipline before every shot.";
  } else if (score >= 82) {
    comment = counts.competitive
      ? "You made sound choices and recognized that more than one plan can be reasonable. Keep matching the tradeoff to the situation before committing."
      : "Your strategy was strong. Continue comparing the likely leave and hazard exposure before committing.";
  } else if (score >= 68) {
    comment = "Your decision process has a good base, but one or more choices gave away avoidable value. Compare the typical leave and penalty exposure more carefully.";
  } else {
    comment = "Slow the decision down. Favor plans that preserve a playable next shot unless the extra risk creates a meaningful scoring opportunity.";
  }
  return {
    score,
    rating,
    comment,
    decision_count: scored.length,
    ...counts
  };
}
