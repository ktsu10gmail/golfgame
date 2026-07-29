// Browser port of packages/simulation/engine.py. Keep numerical changes paired.

export const ENGINE_VERSION = "full-shot-v3";
export const PENALTY_RELIEF_VERSION = "penalty-relief-v1";

const MASK_64 = (1n << 64n) - 1n;
const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const QUALITY_WEIGHTS = [
  ["slight_mishit", .35], ["fat", .25], ["thin", .22], ["topped", .08],
  ["heel", .05], ["toe", .04], ["shank", .01]
];
const QUALITY_MODIFIERS = {
  pure: [1.01, 1, .65, 0], solid: [1, 1, 1, 0], slight_mishit: [.91, .95, 1.25, 0],
  fat: [.58, .3, 1.15, 0], thin: [.82, 1.6, 1.3, 0], topped: [.28, 2.1, 1.55, 0],
  heel: [.87, .9, 1.55, 4], toe: [.89, .95, 1.45, -3], shank: [.55, .5, .8, 35],
  flyer: [1.1, 1.35, 1.15, 0]
};

class DeterministicRandom {
  constructor(seed) {
    this.state = seed & MASK_64;
    this.spareGaussian = null;
  }

  random() {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK_64;
    let value = this.state;
    value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
    value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
    value ^= value >> 31n;
    return Number(value >> 11n) / 9007199254740992;
  }

  gauss(mean, standardDeviation) {
    let standard;
    if (this.spareGaussian !== null) {
      standard = this.spareGaussian;
      this.spareGaussian = null;
    } else {
      const first = Math.max(this.random(), 1 / 9007199254740992);
      const second = this.random();
      const radius = Math.sqrt(-2 * Math.log(first));
      const angle = 2 * Math.PI * second;
      standard = radius * Math.cos(angle);
      this.spareGaussian = radius * Math.sin(angle);
    }
    return mean + standard * standardDeviation;
  }
}

function roundTo(value, places) {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function bounded(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value));
}

function riskLabel(risk) {
  if (risk < 30) return "Conservative";
  if (risk < 58) return "Measured risk";
  return "High risk";
}

export function deriveShotSeed(roundSeed, holeNumber, strokeIndex) {
  if (holeNumber < 1 || holeNumber > 18) throw new Error("hole_number must be between 1 and 18");
  if (strokeIndex < 1) throw new Error("stroke_index must be positive");
  const material = `${ENGINE_VERSION}:${roundSeed}:${holeNumber}:${strokeIndex}`;
  let hashed = FNV_OFFSET_64;
  for (const byte of new TextEncoder().encode(material)) {
    hashed ^= BigInt(byte);
    hashed = (hashed * FNV_PRIME_64) & MASK_64;
  }
  return hashed;
}

function targetAxes(start, target) {
  const dx = target.x - start.x, dy = target.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) throw new Error("start and target cannot be identical");
  const forward = { x: dx / length, y: dy / length };
  return [forward, { x: forward.y, y: -forward.x }];
}

export function projectLanding(start, target, forwardDistance, lateralDistance) {
  const [forward, right] = targetAxes(start, target);
  return {
    x: start.x + forward.x * forwardDistance + right.x * lateralDistance,
    y: start.y + forward.y * forwardDistance + right.y * lateralDistance
  };
}

function pointOnSegment(point, start, end, tolerance = 1e-3) {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (lengthSquared <= tolerance ** 2) return Math.hypot(point.x - start.x, point.y - start.y) <= tolerance;
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) / Math.sqrt(lengthSquared) > tolerance) return false;
  const dot = (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y);
  const length = Math.sqrt(lengthSquared);
  return dot >= -tolerance * length && dot <= lengthSquared + tolerance * length;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  let previous = polygon.at(-1);
  for (const current of polygon) {
    if (pointOnSegment(point, previous, current)) return true;
    if ((current.y > point.y) !== (previous.y > point.y)) {
      const intersection = (previous.x - current.x) * (point.y - current.y) /
        (previous.y - current.y) + current.x;
      if (point.x < intersection) inside = !inside;
    }
    previous = current;
  }
  return inside;
}

export function resolveSurface(point, surfaces, fallback = "rough") {
  const ordered = surfaces.map((surface, index) => ({ surface, index }))
    .sort((a, b) => b.surface.priority - a.surface.priority || a.index - b.index);
  const match = ordered.find(item => pointInPolygon(point, item.surface.polygon));
  return match ? [match.surface.surface, match.surface.region_id ?? null] : [fallback, null];
}

function decisionRisk(context) {
  const aim = Math.hypot(context.target.x - context.start.x, context.target.y - context.start.y);
  const expected = context.club.carry_mean * context.lie.carry_multiplier;
  const uncertainty = bounded(context.club.mishit_probability * 2.2, 0, 1);
  const [targetSurface] = resolveSurface(context.target, context.surfaces, context.default_surface);
  let risk = Math.abs(aim - expected) / Math.max(expected, 1) * 70 + uncertainty * 100 * .45;
  if (["water", "out_of_bounds"].includes(targetSurface)) risk += 35;
  if (["bunker", "rough", "native", "first_cut"].includes(targetSurface)) risk += 15;
  const rounded = Math.round(bounded(risk, 0, 100));
  return [rounded, riskLabel(rounded)];
}

function fullShotAssessment(context, landingSurface, relief) {
  const [decisionRiskValue, riskLabelValue] = decisionRisk(context);
  const [targetSurface] = resolveSurface(context.target, context.surfaces, context.default_surface);
  const resultSurface = relief?.resulting_surface || landingSurface;
  const execution = resultSurface === targetSurface ? "on_plan" : "missed";
  return {
    decision_assessment: decisionRiskValue < 58 ? "sound" : "review",
    execution_assessment: execution,
    overall_assessment: execution === "on_plan" ? "good" : "bad",
    decision_risk: decisionRiskValue,
    risk_label: riskLabelValue
  };
}

function roundedPoint(point) {
  return { x: roundTo(point.x, 4), y: roundTo(point.y, 4) };
}

function penaltyRegion(context, surface, regionId, point) {
  const matching = context.surfaces.filter(region => region.surface === surface);
  return matching.find(region => regionId !== null && region.region_id === regionId) ||
    matching.find(region => pointInPolygon(point, region.polygon)) || null;
}

function lastBoundaryEntry(path, polygon) {
  const states = path.map(point => pointInPolygon(point, polygon));
  let transition = null;
  for (let index = path.length - 1; index > 0; index--) {
    if (states[index] && !states[index - 1]) { transition = index; break; }
  }
  if (transition === null) return [path[0], path.at(-1)];
  let low = path[transition - 1], high = path[transition];
  for (let attempt = 0; attempt < 48; attempt++) {
    const middle = { x: (low.x + high.x) / 2, y: (low.y + high.y) / 2 };
    if (pointInPolygon(middle, polygon)) high = middle;
    else low = middle;
  }
  return [low, high];
}

function playableReliefPosition(context, reference, toward) {
  let dx = toward.x - reference.x, dy = toward.y - reference.y;
  let length = Math.hypot(dx, dy);
  if (length <= 1e-9) {
    dx = context.start.x - reference.x;
    dy = context.start.y - reference.y;
    length = Math.max(Math.hypot(dx, dy), 1);
  }
  const unit = { x: dx / length, y: dy / length };
  for (let reliefDistance = 2; reliefDistance <= 20; reliefDistance++) {
    const candidate = { x: reference.x + unit.x * reliefDistance, y: reference.y + unit.y * reliefDistance };
    const [surface, regionId] = resolveSurface(candidate, context.surfaces, context.default_surface);
    if (!new Set(["water", "out_of_bounds"]).has(surface)) {
      return [roundedPoint(candidate), surface, regionId];
    }
  }
  const [surface, regionId] = resolveSurface(context.start, context.surfaces, context.default_surface);
  return [roundedPoint(context.start), surface, regionId];
}

export function resolvePenaltyRelief(context, {
  landing, path, landingSurface, landingRegionId, declaredUnplayable = false
}) {
  if (declaredUnplayable) {
    if (["water", "out_of_bounds"].includes(landingSurface)) {
      throw new Error("unplayable relief cannot replace automatic water or out-of-bounds relief");
    }
    const [ballPosition, resultingSurface, resultingRegionId] = playableReliefPosition(context, landing, context.start);
    return {
      version: PENALTY_RELIEF_VERSION, reason: "unplayable", penalty_strokes: 1,
      relief_type: "unplayable_back_on_line", reference_point: roundedPoint(landing),
      ball_position: ballPosition, resulting_surface: resultingSurface, resulting_region_id: resultingRegionId
    };
  }
  if (landingSurface === "out_of_bounds") {
    const [resultingSurface, resultingRegionId] = resolveSurface(context.start, context.surfaces, context.default_surface);
    return {
      version: PENALTY_RELIEF_VERSION, reason: "out_of_bounds", penalty_strokes: 1,
      relief_type: "stroke_and_distance", reference_point: roundedPoint(landing),
      ball_position: roundedPoint(context.start), resulting_surface: resultingSurface, resulting_region_id: resultingRegionId
    };
  }
  if (landingSurface === "water") {
    const region = penaltyRegion(context, "water", landingRegionId, landing);
    const [outside, boundary] = region ? lastBoundaryEntry(path, region.polygon) : [context.start, landing];
    const [ballPosition, resultingSurface, resultingRegionId] = playableReliefPosition(context, boundary, outside);
    return {
      version: PENALTY_RELIEF_VERSION, reason: "water", penalty_strokes: 1,
      relief_type: "water_last_crossing", reference_point: roundedPoint(boundary),
      ball_position: ballPosition, resulting_surface: resultingSurface, resulting_region_id: resultingRegionId
    };
  }
  return null;
}

export function declareUnplayable(context, packet) {
  if (packet.relief !== null) throw new Error("this shot already has automatic penalty relief");
  return resolvePenaltyRelief(context, {
    landing: packet.landing, path: packet.path, landingSurface: packet.landing_surface,
    landingRegionId: packet.landing_region_id, declaredUnplayable: true
  });
}

function boundedGauss(rng, mean, deviation, lower, upper) {
  if (deviation === 0) return Math.min(upper, Math.max(lower, mean));
  let value = mean;
  for (let attempt = 0; attempt < 32; attempt++) {
    value = rng.gauss(mean, deviation);
    if (value >= lower && value <= upper) return value;
  }
  return Math.min(upper, Math.max(lower, value));
}

function mishitProbability(context) {
  return Math.min(.95, context.club.mishit_probability * context.lie.mishit_multiplier *
    context.environment.slope_mishit_multiplier * context.intent.complexity_multiplier);
}

function weightedQuality(rng, context) {
  if (rng.random() >= mishitProbability(context)) return rng.random() < .15 ? "pure" : "solid";
  const weights = context.club.quality_weights || QUALITY_WEIGHTS;
  const draw = rng.random() * weights.reduce((sum, [, weight]) => sum + weight, 0);
  let cumulative = 0;
  for (const [quality, weight] of weights) {
    cumulative += weight;
    if (draw <= cumulative) return quality;
  }
  return weights.at(-1)[0];
}

function pathSamples(start, target, totalYards, lateralYards) {
  const [forward, right] = targetAxes(start, target);
  return Array.from({ length: 13 }, (_, index) => {
    const progress = index / 12;
    return {
      x: roundTo(start.x + forward.x * totalYards * progress + right.x * lateralYards * progress ** 1.6, 4),
      y: roundTo(start.y + forward.y * totalYards * progress + right.y * lateralYards * progress ** 1.6, 4)
    };
  });
}

export function simulateFullShot(context, { roundSeed, holeNumber, strokeIndex }) {
  const shotSeed = deriveShotSeed(roundSeed, holeNumber, strokeIndex);
  const rng = new DeterministicRandom(shotSeed);
  const quality = weightedQuality(rng, context);
  const [qualityCarry, qualityRoll, qualityLateral, qualityBias] = QUALITY_MODIFIERS[quality];
  const lowerCarry = Math.max(1, context.club.carry_mean - 2.75 * context.club.carry_sd);
  const upperCarry = context.club.carry_mean + 2.75 * context.club.carry_sd;
  const sampledCarry = boundedGauss(rng, context.club.carry_mean, context.club.carry_sd, lowerCarry, upperCarry);
  const carryYards = Math.max(1, sampledCarry * context.lie.carry_multiplier *
    context.environment.elevation_carry_multiplier * qualityCarry * context.intent.distance_multiplier +
    context.environment.wind_forward_yards);
  const rollYards = Math.max(0, context.club.roll_mean * context.lie.roll_multiplier *
    context.environment.surface_roll_multiplier * context.environment.wind_roll_multiplier * qualityRoll);
  const totalYards = carryYards + rollYards;
  const lateralLimit = Math.max(1, context.club.lateral_sd * qualityLateral * 3);
  const sampledLateral = boundedGauss(rng, 0, context.club.lateral_sd * qualityLateral, -lateralLimit, lateralLimit);
  const lateralYards = sampledLateral + context.club.directional_bias + context.lie.lateral_bias_yards +
    context.environment.wind_lateral_yards + qualityBias;
  const landingRaw = projectLanding(context.start, context.target, totalYards, lateralYards);
  const [landingSurface, landingRegionId] = resolveSurface(landingRaw, context.surfaces, context.default_surface);
  const landing = { x: roundTo(landingRaw.x, 4), y: roundTo(landingRaw.y, 4) };
  const path = pathSamples(context.start, context.target, totalYards, lateralYards);
  const relief = resolvePenaltyRelief(context, {
    landing, path, landingSurface, landingRegionId, declaredUnplayable: false
  });
  const resolvedBall = relief?.ball_position || landing;
  const assessment = fullShotAssessment(context, landingSurface, relief);
  const modifiers = [
    ["lie_carry", context.lie.carry_multiplier], ["lie_roll", context.lie.roll_multiplier],
    ["lie_mishit", context.lie.mishit_multiplier], ["elevation_carry", context.environment.elevation_carry_multiplier],
    ["slope_mishit", context.environment.slope_mishit_multiplier], ["surface_roll", context.environment.surface_roll_multiplier],
    ["wind_roll", context.environment.wind_roll_multiplier], ["intent_distance", context.intent.distance_multiplier],
    ["intent_complexity", context.intent.complexity_multiplier], ["quality_carry", qualityCarry],
    ["quality_roll", qualityRoll], ["quality_lateral", qualityLateral]
  ].map(([name, value]) => ({ name, value }));
  return {
    quality,
    carry_yards: roundTo(carryYards, 2),
    roll_yards: roundTo(rollYards, 2),
    total_yards: roundTo(totalYards, 2),
    lateral_yards: roundTo(lateralYards, 2),
    landing,
    path,
    landing_surface: landingSurface,
    landing_region_id: landingRegionId,
    remaining_distance_yards: roundTo(Math.hypot(resolvedBall.x - context.pin.x, resolvedBall.y - context.pin.y), 2),
    assessment,
    audit: {
      engine_version: ENGINE_VERSION,
      round_seed: roundSeed,
      shot_seed: shotSeed.toString(),
      hole_number: holeNumber,
      stroke_index: strokeIndex,
      profile_version: context.profile_version,
      lie_version: context.lie.version,
      sampled_carry_yards: roundTo(sampledCarry, 4),
      sampled_lateral_yards: roundTo(sampledLateral, 4),
      mishit_probability: roundTo(mishitProbability(context), 6),
      modifiers
    },
    relief
  };
}
