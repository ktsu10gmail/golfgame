import { ASSESSMENT_VERSION, DecisionLabel, ResultLabel, canonicalAssessmentForGameShot } from "../assessment/browser_assessment_service.mjs";
import { ROUND_STRATEGY_VERSION, analyzeRoundStrategy } from "../simulation/browser_round_analysis.mjs";

export const POST_ROUND_SCHEMA_VERSION = "2.0";
export const POST_ROUND_REPORT_VERSION = "2.0";
export const POST_ROUND_REPORT_BUILDER_VERSION = "post-round-report-v2.1";
export const POST_ROUND_NARRATIVE_PROMPT_VERSION = "post-round-narrative-v2";

const SOUND_DECISIONS = new Set([DecisionLabel.PREFERRED, DecisionLabel.COMPETITIVE]);
const GRADED_DECISIONS = new Set([...SOUND_DECISIONS, DecisionLabel.HIGHER_RISK]);
const ON_PLAN_EXECUTIONS = new Set(["ON_PLAN_EXECUTION", "ACCEPTABLE_EXECUTION"]);
const GRADED_EXECUTIONS = new Set([...ON_PLAN_EXECUTIONS, "MISSED_EXECUTION"]);
const COSTLY_SURFACES = new Set(["water", "out of bounds", "out_of_bounds", "bunker", "trees", "trees/recovery"]);

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percent(numerator, denominator) {
  return denominator ? Math.round(numerator / denominator * 100) : null;
}

export function reportLabel(value, fallback = "Not available") {
  if (!value) return fallback;
  return String(value)
    .replaceAll("_", " ")
    .replace(/\bob\b/gi, "OB")
    .replace(/\b\w/g, character => character.toUpperCase());
}

export function relativeScoreLabel(value) {
  if (!Number.isFinite(value)) return "—";
  return value === 0 ? "E" : value > 0 ? `+${value}` : String(value);
}

function scoreName(relative) {
  if (!Number.isFinite(relative)) return "Incomplete";
  if (relative <= -3) return "Albatross";
  if (relative === -2) return "Eagle";
  if (relative === -1) return "Birdie";
  if (relative === 0) return "Par";
  if (relative === 1) return "Bogey";
  if (relative === 2) return "Double bogey";
  if (relative === 3) return "Triple bogey";
  return `${relative} over par`;
}

function stableHash(value) {
  const stableValue = item => {
    if (Array.isArray(item)) return item.map(stableValue);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, stableValue(item[key])]));
  };
  const text = JSON.stringify(stableValue(value));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function shotType(shot) {
  return shot?.strategyPacket?.shot_type || shot?.shotType || (shot?.club === "Putter" ? "putt_make_attempt" : "shot");
}

function powerLabel(shot) {
  const power = Math.round(Number(shot?.power));
  if (!Number.isFinite(power)) return "";
  return shot?.club === "Putter" ? `${power}% pace` : `${power}% power`;
}

function patternKeyForShot(shot) {
  const request = shot?.resultRequest?.context || {};
  return request?.lie?.lie_type || request?.lie_type || {
    Tee: "tee_standard", Fairway: "fairway_clean", Rough: "rough_light",
    "Heavy rough": "rough_deep", Bunker: "bunker_fairway", Green: "green"
  }[shot?.conditionSnapshot?.lie] || null;
}

function matchingPatternIds(shot, patterns) {
  const reasons = new Set(shot?.strategyPacket?.decision?.reasons || []);
  const lieKey = patternKeyForShot(shot);
  return patterns.filter(pattern =>
    (["lie_strength", "lie_improvement"].includes(pattern.kind) && pattern.key === lieKey) ||
    (pattern.kind === "recurring_decision_mistake" && reasons.has(pattern.key)) ||
    (["sidehill_strength", "sidehill_improvement"].includes(pattern.kind) &&
      ["correct", "wrong_direction", "missing"].includes(shot?.sidehillPlan?.compensation))
  ).map(pattern => pattern.pattern_id);
}

function normalizedPatterns(patterns = []) {
  return patterns.filter(pattern => pattern?.confidence === "verified").map((pattern, index) => ({
    pattern_id: `${pattern.kind}:${pattern.key || index}`,
    kind: pattern.kind,
    key: pattern.key || null,
    label: reportLabel(pattern.key || pattern.kind),
    status: pattern.kind === "recurring_decision_mistake" ? "verified_recurring_pattern" : "verified",
    sample_size: finite(pattern.sample_size),
    round_count: finite(pattern.round_count),
    decision_score: finite(pattern.decision_score),
    success_rate: finite(pattern.success_rate),
    source: "player_history"
  }));
}

function shotEvidence(shot, holeNumber, strokeNumber, patterns) {
  const assessment = canonicalAssessmentForGameShot(shot);
  const decisionLabel = assessment?.decision?.label || DecisionLabel.NOT_GRADED;
  const executionLabel = assessment?.execution?.label || "EXECUTION_NOT_GRADED";
  const strategy = shot?.strategyPacket || null;
  const finish = shot?.lie || shot?.landingLie || null;
  const start = shot?.conditionSnapshot?.lie || shot?.startLie || null;
  const evidenceRef = `shot:h${holeNumber}:s${strokeNumber}`;
  return {
    shot_id: `h${holeNumber}:s${strokeNumber}`,
    hole_number: holeNumber,
    stroke_number: strokeNumber,
    club: shot?.club || "Shot",
    power_percent: finite(shot?.power),
    power_label: powerLabel(shot),
    shot_type: shotType(shot),
    shot_type_label: reportLabel(shotType(shot)),
    decision: {
      label: decisionLabel,
      display: SOUND_DECISIONS.has(decisionLabel) ? "Sound Decision" : decisionLabel === DecisionLabel.HIGHER_RISK ? "Decision to Review" : "Not Graded",
      graded: GRADED_DECISIONS.has(decisionLabel),
      sound: SOUND_DECISIONS.has(decisionLabel),
      reason_codes: [...(assessment?.decision?.reason_codes || [])]
    },
    execution: {
      label: executionLabel,
      display: ON_PLAN_EXECUTIONS.has(executionLabel) ? "On Plan" : executionLabel === "MISSED_EXECUTION" ? "Missed Plan" : "Not Graded",
      graded: GRADED_EXECUTIONS.has(executionLabel),
      on_plan: ON_PLAN_EXECUTIONS.has(executionLabel),
      score: finite(assessment?.execution?.score),
      reason_codes: [...(assessment?.execution?.reason_codes || [])]
    },
    result: {
      label: assessment?.result?.label || ResultLabel.RECORDED,
      display: reportLabel(assessment?.result?.label || "Recorded Result"),
      start_lie: start,
      finish_lie: finish,
      penalty_strokes: Math.max(0, Math.round(finite(shot?.penalty) || 0)),
      remaining_yards: finite(shot?.remaining),
      outcome_vs_target: structuredClone(assessment?.outcome_vs_target || null)
    },
    strategy: strategy ? {
      score: finite(strategy.decision?.score),
      label: strategy.decision?.label || null,
      preferred_miss: strategy.preferred_miss || null,
      preferred_miss_inferred: Boolean(strategy.preferred_miss_inferred),
      reasons: [...(strategy.decision?.reasons || [])]
    } : null,
    lesson: typeof shot?.lesson === "string" ? shot.lesson : "",
    landing_target: shot?.landingTargetPlan ? structuredClone(shot.landingTargetPlan) : null,
    adjustment: shot?.adjustmentReward ? structuredClone(shot.adjustmentReward) : null,
    sidehill: shot?.sidehillPlan ? structuredClone(shot.sidehillPlan) : null,
    tree_outcome: shot?.treeRecovery?.resolved_outcome || shot?.resolvedTreeCondition?.code || null,
    player_pattern_refs: matchingPatternIds(shot, patterns),
    provenance: structuredClone(assessment?.evidence || {}),
    evidence_refs: [`${evidenceRef}:assessment`, `${evidenceRef}:result`, `${evidenceRef}:strategy`]
  };
}

function momentForShot(shot, holeScore) {
  const reasons = [];
  let importance = 0;
  if (shot.decision.label === DecisionLabel.HIGHER_RISK) { importance += 35; reasons.push("decision_review"); }
  if (shot.decision.sound && shot.execution.label === "MISSED_EXECUTION") { importance += 32; reasons.push("strong_strategy_bad_execution"); }
  if (shot.result.penalty_strokes > 0) { importance += 48; reasons.push("penalty_or_water"); }
  const finish = String(shot.result.finish_lie || "").toLowerCase();
  if (finish.includes("tree") || shot.tree_outcome) { importance += 26; reasons.push("tree_contact"); }
  if (finish === "bunker") { importance += 18; reasons.push("bunker_consequence"); }
  if (shot.shot_type.startsWith("putt_") && shot.decision.reason_codes.some(code => code.includes("LINE"))) { importance += 24; reasons.push("putting_read_failure"); }
  if (shot.shot_type.startsWith("putt_") && shot.decision.reason_codes.some(code => code.includes("PACE"))) { importance += 22; reasons.push("putting_pace_failure"); }
  if (shot.adjustment?.accuracy_bonus > 0) { importance += 24; reasons.push("good_adjustment"); }
  if (shot.player_pattern_refs.length) { importance += 18; reasons.push("recurring_pattern_match"); }
  if (shot.shot_type.includes("recovery") && shot.decision.sound) { importance += 20; reasons.push("high_value_recovery"); }
  if ((shot.strategy?.score || 0) >= 90) { importance += 14; reasons.push("exceptionally_good_decision"); }
  if (holeScore >= 2 && reasons.length) { importance += 8; reasons.push("double_bogey_associated_event"); }
  if (!reasons.length) return null;
  const type = reasons.includes("penalty_or_water") ? "penalty_or_water"
    : reasons.includes("strong_strategy_bad_execution") ? "strong_decision_bad_execution"
      : reasons.includes("decision_review") ? "decision_to_review"
        : reasons.includes("high_value_recovery") ? "high_value_recovery"
          : reasons.includes("good_adjustment") ? "good_adjustment"
            : reasons.includes("recurring_pattern_match") ? "recurring_pattern_match"
              : "notable_decision";
  const title = {
    penalty_or_water: "Penalty changed the hole",
    strong_decision_bad_execution: "The plan was better than the result",
    decision_to_review: "Decision deserves another look",
    high_value_recovery: "Recovery discipline",
    good_adjustment: "Adjustment worth repeating",
    recurring_pattern_match: "A verified pattern appeared",
    notable_decision: "A useful decision to remember"
  }[type];
  const takeaway = type === "strong_decision_bad_execution"
    ? "Keep the sound plan separate from the missed execution."
    : type === "decision_to_review"
      ? "Review the choice before judging the eventual result."
      : type === "penalty_or_water"
        ? "Prioritize margin for error when this situation returns."
        : type === "good_adjustment"
          ? "Carry this same adjustment process into the next similar lie."
          : type === "high_value_recovery"
            ? "Protect the recovery objective before trying to advance farther."
            : "Use the recorded evidence when this situation appears again.";
  return {
    moment_id: `${shot.shot_id}:${type}`,
    hole_number: shot.hole_number,
    stroke_number: shot.stroke_number,
    type,
    title,
    importance_score: importance,
    importance_reasons: [...new Set(reasons)],
    decision: shot.decision.display,
    execution: shot.execution.display,
    result: shot.result.finish_lie || shot.result.display,
    shot_type: shot.shot_type_label,
    takeaway,
    evidence_refs: [...shot.evidence_refs]
  };
}

function patternCopy(pattern) {
  const samples = pattern.sample_size == null ? "verified evidence" : `${pattern.sample_size} shots`;
  const rounds = pattern.round_count == null ? "" : ` across ${pattern.round_count} rounds`;
  if (pattern.kind === "recurring_decision_mistake") return `${samples}${rounds} matched this recurring decision pattern.`;
  if (pattern.kind.includes("strength")) return `${samples}${rounds} support this verified strength.`;
  return `${samples}${rounds} support this practice priority.`;
}

function focusAction(key) {
  return {
    putting_read_discipline: "Confirm the intended starting line before setting pace.",
    recovery_discipline: "Choose the recovery objective before deciding how far to advance.",
    miss_planning: "Name the preferred miss and favor the widest safe landing area.",
    hazard_management: "Give the main hazard a clear margin before choosing the target.",
    target_selection: "Choose the target from the available margin, not only the flag.",
    club_selection: "Match the club and swing to the intended carry window.",
    lie_management: "Include lie, slope, and sidehill effects before committing to the line."
  }[key] || "Repeat the evidence-supported plan in the next similar situation.";
}

function deterministicStory(round, summary) {
  if (!summary.graded_decisions) {
    return round.status === "completed"
      ? "This round does not contain enough graded decision evidence for a strategy summary. The scorecard and recorded shots remain available."
      : "This review is still in progress. Complete more graded shots to build a reliable round story.";
  }
  const scope = round.status === "completed" ? "Across the completed round" : `Through ${round.holes_completed} completed holes`;
  const ungradedDecisions = Math.max(0, summary.scored_decisions - summary.graded_decisions);
  const decisionEvidence = `${summary.sound_decisions} of ${summary.graded_decisions} graded plans met the current model's sound-plan criteria.`;
  const ungradedEvidence = ungradedDecisions
    ? ` ${ungradedDecisions} additional strategy-scored ${ungradedDecisions === 1 ? "shot was" : "shots were"} not categorically graded.`
    : "";
  const executionEvidence = summary.graded_executions
    ? ` Execution finished on plan for ${summary.on_plan_executions} of ${summary.graded_executions} graded shots.`
    : " Execution evidence was not available for categorical grading.";
  const focus = summary.practice_priority_label
    ? ` The lowest-scoring planning category was ${summary.practice_priority_label}.`
    : " No practice priority is supported yet.";
  return `${scope}, ${decisionEvidence}${ungradedEvidence}${executionEvidence}${focus}`;
}

function narrativeFallback(round, summary) {
  return {
    status: "deterministic_fallback",
    generated_at: null,
    provider: null,
    model: null,
    prompt_version: POST_ROUND_NARRATIVE_PROMPT_VERSION,
    schema_version: POST_ROUND_SCHEMA_VERSION,
    report_version: POST_ROUND_REPORT_VERSION,
    input_hash: null,
    round_story: {
      text: deterministicStory(round, summary),
      evidence_refs: ["summary:decision_quality", "summary:execution_quality", "summary:practice_priority"]
    },
    learning_moment_explanations: {},
    next_round_focus_explanations: {}
  };
}

function usableNarrative(narrative) {
  return narrative && ["available", "deterministic_fallback", "unavailable"].includes(narrative.status)
    && narrative.schema_version === POST_ROUND_SCHEMA_VERSION
    && narrative.report_version === POST_ROUND_REPORT_VERSION;
}

export function buildPostRoundReportModel({
  roundId,
  course,
  courseVersion = null,
  tee,
  scorecard = [],
  scores = [],
  roundHistory = [],
  verifiedPatterns = [],
  playerProfile = null,
  narrative = null,
  generatedAt = new Date().toISOString()
}) {
  const patterns = normalizedPatterns(verifiedPatterns);
  const completedIndexes = scores.map((score, index) => Number.isInteger(score) ? index : null).filter(index => index !== null);
  const completed = completedIndexes.length === scorecard.length && scorecard.length > 0;
  const roundScore = completedIndexes.reduce((total, index) => total + scores[index], 0);
  const roundPar = completedIndexes.reduce((total, index) => total + Number(scorecard[index]?.Par || scorecard[index]?.par || 0), 0);
  const strategyAnalysis = analyzeRoundStrategy(roundHistory);
  const shots = roundHistory.flatMap((holeShots, holeIndex) => (holeShots || []).map((shot, shotIndex) =>
    shotEvidence(shot, holeIndex + 1, shotIndex + 1, patterns)
  ));
  const gradedDecisions = shots.filter(shot => shot.decision.graded);
  const gradedExecutions = shots.filter(shot => shot.execution.graded);
  const soundDecisions = gradedDecisions.filter(shot => shot.decision.sound).length;
  const onPlanExecutions = gradedExecutions.filter(shot => shot.execution.on_plan).length;
  const strongestCategory = strategyAnalysis?.top_strength || null;
  const practicePriority = strategyAnalysis?.top_priority || null;
  const summary = {
    strategy_score: strategyAnalysis?.strategy_score ?? null,
    strategy_score_scale: 100,
    strategy_score_basis: "weighted_average_of_scored_shots",
    scored_decisions: strategyAnalysis?.scored_shots ?? 0,
    sound_decisions: soundDecisions,
    graded_decisions: gradedDecisions.length,
    ungraded_decisions: Math.max(0, (strategyAnalysis?.scored_shots ?? 0) - gradedDecisions.length),
    decision_quality_percent: percent(soundDecisions, gradedDecisions.length),
    on_plan_executions: onPlanExecutions,
    graded_executions: gradedExecutions.length,
    execution_quality_percent: percent(onPlanExecutions, gradedExecutions.length),
    strongest_category: strongestCategory,
    strongest_category_label: strongestCategory ? reportLabel(strongestCategory) : null,
    practice_priority: practicePriority,
    practice_priority_label: practicePriority ? reportLabel(practicePriority) : null
  };
  const round = {
    round_id: roundId,
    course_id: course?.id,
    course_name: course?.name || course?.id,
    tee,
    holes_completed: completedIndexes.length,
    score: roundScore,
    par: roundPar,
    relative_to_par: roundScore - roundPar,
    status: completed ? "completed" : "in_progress"
  };
  const scorecardRows = scorecard.map((entry, index) => {
    const par = Number(entry.Par ?? entry.par);
    const score = Number.isInteger(scores[index]) ? scores[index] : null;
    const relative = score == null ? null : score - par;
    return {
      hole: Number(entry.Hole ?? entry.hole ?? index + 1),
      par,
      distance_yards: Number(entry[`Yards_${tee}`] ?? entry.distance_yards),
      handicap: Number(entry.Handicap ?? entry.handicap),
      score,
      relative_to_par: relative,
      result: scoreName(relative)
    };
  });
  const moments = shots.map(shot => {
    const row = scorecardRows[shot.hole_number - 1];
    return momentForShot(shot, row?.relative_to_par);
  }).filter(Boolean).sort((a, b) => b.importance_score - a.importance_score || a.hole_number - b.hole_number || a.stroke_number - b.stroke_number).slice(0, 5);
  const momentHoleNumbers = new Set(moments.map(moment => moment.hole_number));
  const meaningfulHoles = scorecardRows.map(row => {
    const holeShots = shots.filter(shot => shot.hole_number === row.hole);
    const decisionReviews = holeShots.filter(shot => shot.decision.label === DecisionLabel.HIGHER_RISK).length;
    const executionReviews = holeShots.filter(shot => shot.execution.label === "MISSED_EXECUTION").length;
    const penalties = holeShots.reduce((total, shot) => total + shot.result.penalty_strokes, 0);
    const adjustments = holeShots.filter(shot => (shot.adjustment?.accuracy_bonus || 0) > 0).length;
    const reasons = [
      decisionReviews ? `${decisionReviews} ${decisionReviews === 1 ? "decision deserves" : "decisions deserve"} review` : null,
      executionReviews ? `${executionReviews} ${executionReviews === 1 ? "shot missed" : "shots missed"} the plan` : null,
      penalties ? `${penalties} penalty ${penalties === 1 ? "stroke" : "strokes"}` : null,
      adjustments ? `${adjustments} useful ${adjustments === 1 ? "adjustment" : "adjustments"}` : null,
      row.relative_to_par != null && Math.abs(row.relative_to_par) >= 2 ? `${relativeScoreLabel(row.relative_to_par)} scoring swing` : null
    ].filter(Boolean);
    return { ...row, why_it_matters: reasons.join("; "), reason_count: reasons.length, shots: holeShots };
  }).filter(hole => hole.reason_count || momentHoleNumbers.has(hole.hole)).sort((a, b) => {
    const firstMoment = moments.findIndex(moment => moment.hole_number === a.hole);
    const secondMoment = moments.findIndex(moment => moment.hole_number === b.hole);
    return (firstMoment < 0 ? 99 : firstMoment) - (secondMoment < 0 ? 99 : secondMoment) || a.hole - b.hole;
  }).slice(0, 6);
  const takeaways = [];
  if (summary.strongest_category_label) takeaways.push({ type: "strength", label: "Strength", text: `${summary.strongest_category_label} was your strongest category.`, evidence_refs: ["summary:strongest_category"] });
  if (summary.graded_decisions) takeaways.push({ type: "round_characteristic", label: "Decision making", text: `${summary.sound_decisions} of ${summary.graded_decisions} graded plans met the current model's sound-plan criteria.`, evidence_refs: ["summary:decision_quality"] });
  if (summary.practice_priority_label) takeaways.push({ type: "focus", label: "Focus", text: `${summary.practice_priority_label} is the first practice priority.`, evidence_refs: ["summary:practice_priority"] });
  const nextRoundFocus = [];
  if (summary.practice_priority) nextRoundFocus.push({ type: "priority", title: summary.practice_priority_label, action: focusAction(summary.practice_priority), evidence_refs: ["summary:practice_priority"] });
  const recurring = patterns.find(pattern => pattern.kind === "recurring_decision_mistake");
  if (recurring && nextRoundFocus.length < 2) nextRoundFocus.push({ type: "pattern", title: recurring.label, action: "Recognize this verified pattern before committing to the next similar plan.", evidence_refs: [`pattern:${recurring.pattern_id}`] });
  if (summary.strongest_category && summary.strongest_category !== summary.practice_priority && nextRoundFocus.length < 3) nextRoundFocus.push({ type: "keep_doing", title: `Keep ${summary.strongest_category_label}`, action: `Continue using the planning process that made ${summary.strongest_category_label.toLowerCase()} a strength.`, evidence_refs: ["summary:strongest_category"] });
  const base = {
    schema_version: POST_ROUND_SCHEMA_VERSION,
    report_version: POST_ROUND_REPORT_VERSION,
    report_builder_version: POST_ROUND_REPORT_BUILDER_VERSION,
    generated_at: generatedAt,
    round,
    summary,
    learning_summary: { three_things_to_remember: takeaways.slice(0, 3), learning_moments: moments, next_round_focus: nextRoundFocus.slice(0, 3) },
    patterns: patterns.map(pattern => ({ ...pattern, summary: patternCopy(pattern), evidence_refs: [`pattern:${pattern.pattern_id}`] })),
    scorecard: scorecardRows,
    meaningful_holes: meaningfulHoles,
    detailed_shots: shots,
    narrative: null,
    provenance: {
      report_engine_version: POST_ROUND_REPORT_BUILDER_VERSION,
      assessment_version: ASSESSMENT_VERSION,
      strategy_evaluator_version: strategyAnalysis?.version || ROUND_STRATEGY_VERSION,
      simulation_version: [...new Set(shots.map(shot => shot.provenance?.simulation_version).filter(Boolean))],
      player_profile_hash: stableHash(playerProfile || {}),
      course_version: courseVersion,
      ai_narrative_model: narrative?.model || null
    }
  };
  base.narrative = usableNarrative(narrative) ? structuredClone(narrative) : narrativeFallback(round, summary);
  return base;
}

export function buildReportNarrativePacket(report) {
  const packet = {
    schema_version: report.schema_version,
    report_version: report.report_version,
    round_summary: { ...report.round, ...report.summary },
    strengths: report.learning_summary.three_things_to_remember.filter(item => item.type === "strength"),
    practice_priorities: report.learning_summary.next_round_focus,
    verified_patterns: report.patterns,
    learning_moments: report.learning_summary.learning_moments,
    meaningful_holes: report.meaningful_holes.map(hole => ({
      hole_number: hole.hole,
      par: hole.par,
      score: hole.score,
      relative_to_par: hole.relative_to_par,
      why_it_matters: hole.why_it_matters,
      shots: hole.shots.map(shot => ({
        shot_id: shot.shot_id,
        club: shot.club,
        shot_type: shot.shot_type,
        decision: shot.decision,
        execution: shot.execution,
        result: shot.result,
        lesson: shot.lesson,
        evidence_refs: shot.evidence_refs
      }))
    })),
    allowed_terms: ["Sound Decision", "Decision to Review", "On Plan", "Missed Plan", "Preferred Miss", "Landing Target", "Expected Leave", "Putting Read", "Putting Pace", "Recovery", "Layup", "Margin for Error"],
    evidence_refs: ["summary:decision_quality", "summary:execution_quality", "summary:practice_priority", ...report.learning_summary.learning_moments.flatMap(moment => moment.evidence_refs)]
  };
  return { ...packet, input_hash: stableHash(packet) };
}

function contradictsEvidence(text, report) {
  const value = String(text || "").toLowerCase();
  if (/\b[a-z]+_[a-z_]+\b/.test(value)) return true;
  if (/decision(?:s| quality)? (?:was|were|is) sound[^.]*execution|execution produced a miss|does not justify changing a sound strategy/.test(value)) return true;
  if (/poor (swing|contact|strike)|bad (swing|contact|strike)|mishit|swing fault/.test(value)) return true;
  if (report.summary.graded_decisions && report.summary.sound_decisions === report.summary.graded_decisions && /bad decision|poor decision|wrong decision/.test(value)) return true;
  return false;
}

export function refreshPostRoundReportNarrative(report) {
  const next = structuredClone(report);
  if (!next?.round || !next?.summary || !next?.narrative) return next;
  next.summary.strategy_score_scale = 100;
  next.summary.strategy_score_basis = "weighted_average_of_scored_shots";
  next.summary.ungraded_decisions = Math.max(0, next.summary.scored_decisions - next.summary.graded_decisions);
  const story = next.narrative.round_story?.text || "";
  if (next.narrative.status === "deterministic_fallback" || contradictsEvidence(story, next)) {
    next.narrative = narrativeFallback(next.round, next.summary);
    next.report_builder_version = POST_ROUND_REPORT_BUILDER_VERSION;
    if (next.provenance) next.provenance.report_engine_version = POST_ROUND_REPORT_BUILDER_VERSION;
  }
  return next;
}

export function attachPostRoundNarrative(report, response, { generatedAt = new Date().toISOString() } = {}) {
  const packet = buildReportNarrativePacket(report);
  const story = String(response?.verdict || response?.round_story || "").trim();
  if (!story || contradictsEvidence(story, report)) return structuredClone(report);
  const reviews = new Map((response?.hole_reviews || []).map(review => [Number(review?.hole_number), review]));
  const explanations = {};
  const explainedHoles = new Set();
  for (const moment of report.learning_summary.learning_moments) {
    const review = reviews.get(moment.hole_number);
    if (!review || explainedHoles.has(moment.hole_number)) continue;
    const text = [review.insight, review.credit && `Credit: ${review.credit}`, review.correction && `Improve: ${review.correction}`, review.next_time && `Next time: ${review.next_time}`].filter(Boolean).join(" ");
    if (!text || contradictsEvidence(text, report)) continue;
    explanations[moment.moment_id] = { text, evidence_refs: [...moment.evidence_refs] };
    explainedHoles.add(moment.hole_number);
  }
  const next = structuredClone(report);
  next.narrative = {
    status: "available",
    generated_at: generatedAt,
    provider: response?.provider || null,
    model: response?.model || null,
    prompt_version: POST_ROUND_NARRATIVE_PROMPT_VERSION,
    schema_version: report.schema_version,
    report_version: report.report_version,
    input_hash: packet.input_hash,
    round_story: { text: story, evidence_refs: ["summary:decision_quality", "summary:execution_quality", "summary:practice_priority"] },
    learning_moment_explanations: explanations,
    next_round_focus_explanations: {}
  };
  next.provenance.ai_narrative_model = response?.model || null;
  return next;
}
