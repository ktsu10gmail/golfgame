export const MULTI_RUN_EVALUATOR_VERSION = "multi-run-v1";
export const MULTI_RUN_RANKING_VERSION = "course-management-v1";

const PLAYABLE_SURFACES = new Set(["green", "fairway", "rough", "tee"]);
const PENALTY_SURFACES = new Set(["water", "out_of_bounds"]);

function finitePoint(point) {
  return point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
}

function distance(first, second) {
  return Math.hypot(Number(first.x) - Number(second.x), Number(first.y) - Number(second.y));
}

function percentile(sorted, proportion) {
  if (!sorted.length) return 0;
  const position = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * proportion));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const progress = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * progress;
}

function percent(count, total) {
  return Math.round(count / Math.max(1, total) * 100);
}

function bounded(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function resolvedSurface(packet) {
  return packet?.relief?.resulting_surface || packet?.resolved_surface || packet?.landing_surface || "rough";
}

function resolvedPoint(packet) {
  return packet?.relief?.ball_position || packet?.resolved_ball || packet?.landing || null;
}

function missDirection(packet, candidate) {
  const point = resolvedPoint(packet);
  const start = candidate.context?.start;
  const target = candidate.target;
  if (!finitePoint(point) || !finitePoint(start) || !finitePoint(target)) return "center";
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const forward = ((point.x - start.x) * dx + (point.y - start.y) * dy) / length;
  const lateral = ((point.x - start.x) * dy - (point.y - start.y) * dx) / length;
  const planned = distance(start, target);
  if (Math.abs(lateral) >= Math.max(3, planned * .035)) return lateral > 0 ? "right" : "left";
  if (forward < planned - Math.max(4, planned * .05)) return "short";
  if (forward > planned + Math.max(4, planned * .05)) return "long";
  return "center";
}

function summarize(candidate, packets) {
  const counts = {
    target: 0, playable: 0, green: 0, fairway: 0, rough: 0,
    bunker: 0, water: 0, out_of_bounds: 0, penalty: 0,
    left: 0, right: 0, short: 0, long: 0, center: 0
  };
  const leaves = [];
  for (const packet of packets) {
    const surface = resolvedSurface(packet);
    const landingSurface = packet?.landing_surface || surface;
    const penalty = Number(packet?.relief?.penalty_strokes) > 0 || PENALTY_SURFACES.has(landingSurface);
    if (surface in counts) counts[surface] += 1;
    if (PLAYABLE_SURFACES.has(surface) && !penalty) counts.playable += 1;
    if (penalty) counts.penalty += 1;
    if (landingSurface === "water") counts.water += 1;
    if (landingSurface === "out_of_bounds") counts.out_of_bounds += 1;
    const point = resolvedPoint(packet);
    const leaveFeet = Number(packet?.remaining_distance_yards) * 3;
    if (surface === "green" && Number.isFinite(leaveFeet)) {
      if (leaveFeet <= 3) counts.inside_3ft = (counts.inside_3ft || 0) + 1;
      if (leaveFeet <= 6) counts.inside_6ft = (counts.inside_6ft || 0) + 1;
      if (leaveFeet <= 8) counts.inside_8ft = (counts.inside_8ft || 0) + 1;
      if (leaveFeet <= 15) counts.inside_15ft = (counts.inside_15ft || 0) + 1;
    }
    const targetHit = candidate.successSurface === "green"
      ? surface === "green"
      : finitePoint(point) && finitePoint(candidate.target) &&
        distance(point, candidate.target) <= candidate.targetRadiusYards;
    if (targetHit) counts.target += 1;
    const direction = missDirection(packet, candidate);
    counts[direction] += 1;
    if (surface !== "green" && direction === "short") counts.short_off_green = (counts.short_off_green || 0) + 1;
    if (surface !== "green" && direction === "long") counts.long_off_green = (counts.long_off_green || 0) + 1;
    const leave = Number(packet?.remaining_distance_yards);
    if (Number.isFinite(leave)) leaves.push(leave);
  }
  leaves.sort((first, second) => first - second);
  const missEntries = ["left", "right", "short", "long"]
    .map(direction => [direction, counts[direction]])
    .sort((first, second) => second[1] - first[1]);
  const commonMiss = missEntries[0][1] >= packets.length * .18 ? missEntries[0][0] : "mixed";
  return {
    sample_count: packets.length,
    target_percent: percent(counts.target, packets.length),
    green_percent: percent(counts.green, packets.length),
    playable_percent: percent(counts.playable, packets.length),
    fairway_percent: percent(counts.fairway, packets.length),
    rough_percent: percent(counts.rough, packets.length),
    bunker_percent: percent(counts.bunker, packets.length),
    water_percent: percent(counts.water, packets.length),
    out_of_bounds_percent: percent(counts.out_of_bounds, packets.length),
    penalty_percent: percent(counts.penalty, packets.length),
    median_leave_yards: Math.round(percentile(leaves, .5)),
    leave_p10_yards: Math.round(percentile(leaves, .1)),
    leave_p90_yards: Math.round(percentile(leaves, .9)),
    common_miss: commonMiss,
    inside_3ft_percent: percent(counts.inside_3ft || 0, packets.length),
    inside_6ft_percent: percent(counts.inside_6ft || 0, packets.length),
    inside_8ft_percent: percent(counts.inside_8ft || 0, packets.length),
    inside_15ft_percent: percent(counts.inside_15ft || 0, packets.length),
    expected_leave_feet: Math.round((leaves.reduce((sum, value) => sum + value, 0) / Math.max(1, leaves.length)) * 3 * 10) / 10,
    median_leave_feet: Math.round(percentile(leaves, .5) * 3 * 10) / 10,
    short_off_green_percent: percent(counts.short_off_green || 0, packets.length),
    long_off_green_percent: percent(counts.long_off_green || 0, packets.length)
  };
}

function deterministicRank(candidate) {
  return { Best: 0, Competitive: 1, "Higher risk": 2 }[candidate.deterministicOutlook] ?? 3;
}

export function rankCandidateSummaries(candidates, summaries) {
  const scored = candidates.map((candidate, index) => {
    const summary = summaries[candidate.id];
    if (!summary) throw new Error(`multi-run summary is missing for ${candidate.id}`);
    const startingDistance = finitePoint(candidate.context?.start) && finitePoint(candidate.context?.pin)
      ? distance(candidate.context.start, candidate.context.pin)
      : Math.max(summary.median_leave_yards, 1);
    const advancementScore = bounded(100 * (1 - summary.median_leave_yards / Math.max(startingDistance, 1)), 0, 100);
    const probabilityScore =
      summary.target_percent * .30 +
      summary.playable_percent * .25 +
      (100 - summary.penalty_percent) * .25 +
      (100 - summary.bunker_percent) * .08 +
      advancementScore * .12;
    return {
      id: candidate.id,
      probabilityScore: Math.round(probabilityScore * 10) / 10,
      deterministicRank: deterministicRank(candidate),
      inputIndex: index
    };
  }).sort((first, second) =>
    second.probabilityScore - first.probabilityScore ||
    first.deterministicRank - second.deterministicRank ||
    first.inputIndex - second.inputIndex
  );
  const bestScore = scored[0]?.probabilityScore ?? 0;
  const ranked = {};
  scored.forEach((entry, index) => {
    ranked[entry.id] = {
      probability_score: entry.probabilityScore,
      probability_rank: index + 1,
      hybrid_outlook: index === 0 ? "Best" : bestScore - entry.probabilityScore <= 3 ? "Competitive" : "Higher risk"
    };
  });
  return {
    ranking_version: MULTI_RUN_RANKING_VERSION,
    recommended_choice_id: scored[0]?.id || null,
    recommendation_margin: scored.length > 1
      ? Math.round((scored[0].probabilityScore - scored[1].probabilityScore) * 10) / 10
      : 0,
    candidates: ranked
  };
}

export function stableAnalysisSeed(material) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(String(material))) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash || 1;
}

export function evaluateShotCandidates({
  candidates,
  sampleCount = 400,
  analysisSeed,
  holeNumber,
  simulate
}) {
  if (!Array.isArray(candidates) || !candidates.length) throw new Error("multi-run evaluation requires candidates");
  if (!Number.isInteger(sampleCount) || sampleCount < 10 || sampleCount > 2000) {
    throw new Error("sampleCount must be an integer between 10 and 2000");
  }
  if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
    throw new Error("holeNumber must be between 1 and 18");
  }
  if (typeof simulate !== "function") throw new Error("multi-run evaluation requires a simulator");
  const seed = Number(analysisSeed) >>> 0 || 1;
  const packetsById = new Map(candidates.map(candidate => [candidate.id, []]));
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const identity = { roundSeed: seed, holeNumber, strokeIndex: sample + 1 };
    for (const candidate of candidates) {
      packetsById.get(candidate.id).push(simulate(candidate, identity));
    }
  }
  const summaries = Object.fromEntries(candidates.map(candidate => [
    candidate.id,
    summarize(candidate, packetsById.get(candidate.id))
  ]));
  const ranking = rankCandidateSummaries(candidates, summaries);
  return {
    version: MULTI_RUN_EVALUATOR_VERSION,
    ranking_version: ranking.ranking_version,
    analysis_seed: seed,
    sample_count: sampleCount,
    recommended_choice_id: ranking.recommended_choice_id,
    recommendation_margin: ranking.recommendation_margin,
    candidates: Object.fromEntries(candidates.map(candidate => [
      candidate.id,
      { ...summaries[candidate.id], ...ranking.candidates[candidate.id] }
    ]))
  };
}
