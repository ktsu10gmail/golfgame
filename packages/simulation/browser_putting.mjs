// Browser port of packages/simulation/putting.py. Keep numerical changes paired.

export const PUTTING_ENGINE_VERSION = "putt-v1";

const MASK_64 = (1n << 64n) - 1n;
const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const METERS_TO_YARDS = 1.09361;

class DeterministicRandom {
  constructor(seed) {
    this.state = seed & MASK_64;
  }

  random() {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK_64;
    let value = this.state;
    value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
    value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
    value ^= value >> 31n;
    return Number(value >> 11n) / 9007199254740992;
  }
}

function roundTo(value, places) {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function assertFinitePoint(point, label) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${label} must be a finite point`);
  }
}

function puttAssessment(correctDecision, made) {
  return {
    decision_assessment: correctDecision ? "sound" : "review",
    execution_assessment: made ? "on_plan" : "missed",
    overall_assessment: made || correctDecision ? "good" : "bad",
    decision_risk: null,
    risk_label: null
  };
}

export function derivePuttSeed(roundSeed, holeNumber, strokeIndex) {
  if (holeNumber < 1 || holeNumber > 18) throw new Error("hole_number must be between 1 and 18");
  if (strokeIndex < 1) throw new Error("stroke_index must be positive");
  const material = `${PUTTING_ENGINE_VERSION}:${roundSeed}:${holeNumber}:${strokeIndex}`;
  let hashed = FNV_OFFSET_64;
  for (const byte of new TextEncoder().encode(material)) {
    hashed ^= BigInt(byte);
    hashed = (hashed * FNV_PRIME_64) & MASK_64;
  }
  return hashed;
}

function targetAxes(start, target) {
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) throw new Error("start and target cannot be identical");
  const forward = { x: dx / length, y: dy / length };
  return [forward, { x: forward.y, y: -forward.x }];
}

function projectLanding(start, target, forwardDistance, lateralDistance) {
  const [forward, right] = targetAxes(start, target);
  return {
    x: start.x + forward.x * forwardDistance + right.x * lateralDistance,
    y: start.y + forward.y * forwardDistance + right.y * lateralDistance
  };
}

function puttingConsistency(context) {
  const weighted = (
    context.profile.make_rate_3ft * .3 +
    context.profile.make_rate_6ft * .4 +
    context.profile.make_rate_10ft * .3
  );
  return Math.max(.45, Math.min(.98, .45 + weighted * .55));
}

function baselineMakeProbability(feet, context) {
  const rates = context.profile;
  const interpolate = (distance, startDistance, endDistance, startRate, endRate) => {
    const progress = (distance - startDistance) / (endDistance - startDistance);
    return startRate + (endRate - startRate) * progress;
  };
  let percentage;
  if (feet <= 3) percentage = interpolate(feet, 0, 3, 1, rates.make_rate_3ft);
  else if (feet <= 6) percentage = interpolate(feet, 3, 6, rates.make_rate_3ft, rates.make_rate_6ft);
  else if (feet <= 10) percentage = interpolate(feet, 6, 10, rates.make_rate_6ft, rates.make_rate_10ft);
  else if (rates.make_rate_10ft <= 0) percentage = 0;
  else {
    const observedDecay = rates.make_rate_6ft > 0 ? rates.make_rate_10ft / rates.make_rate_6ft : .7;
    const fourFootDecay = Math.max(.35, Math.min(.95, observedDecay));
    percentage = rates.make_rate_10ft * Math.pow(fourFootDecay, (feet - 10) / 4);
  }
  return Math.max(0, Math.min(1, percentage));
}

export function simulatePutt(context, { roundSeed, holeNumber, strokeIndex }) {
  assertFinitePoint(context.start, "start");
  assertFinitePoint(context.target, "target");
  assertFinitePoint(context.pin, "pin");
  const shotSeed = derivePuttSeed(roundSeed, holeNumber, strokeIndex);
  const rng = new DeterministicRandom(shotSeed);
  const consistency = puttingConsistency(context);
  const powerMultiplier = 1 + (rng.random() - .5) * (1 - consistency) * .16;
  const travelYards = context.profile.putter_range_feet / 3 * context.pace_scale * powerMultiplier;
  const sampledLateralYards = ((rng.random() + rng.random()) - 1) * (1 - consistency) * .18 * METERS_TO_YARDS;
  let landing = projectLanding(context.start, context.target, travelYards, sampledLateralYards);
  const traveledFraction = Math.min(1, Math.hypot(landing.x - context.start.x, landing.y - context.start.y) / Math.max(Math.hypot(context.pin.x - context.start.x, context.pin.y - context.start.y), 1));
  const breakYards = context.read.break_inches / 36 * traveledFraction;
  landing = {
    x: landing.x + (context.read.direction === "right" ? breakYards : -breakYards),
    y: landing.y
  };
  const idealTarget = {
    x: context.pin.x + (context.read.start_direction === "right" ? context.read.break_inches / 36 : -context.read.break_inches / 36),
    y: context.pin.y
  };
  const aimErrorInches = Math.hypot(context.target.x - idealTarget.x, context.target.y - idealTarget.y) * 36;
  const requiredPower = context.read.feet / context.profile.putter_range_feet;
  const powerErrorPoints = Math.abs(context.pace_scale - requiredPower) * 100;
  const aimQuality = Math.exp(-aimErrorInches / 8);
  const paceQuality = Math.exp(-powerErrorPoints / 12);
  const canReachCup = context.profile.putter_range_feet * context.pace_scale >= context.read.feet * .97;
  const baseProbability = baselineMakeProbability(context.read.feet, context);
  const makeProbability = canReachCup
    ? Math.max(0, Math.min(1, baseProbability * (.15 + .85 * aimQuality) * (.1 + .9 * paceQuality)))
    : 0;
  const aimCorrect = aimErrorInches <= Math.max(2, context.read.break_inches * .35);
  const paceCorrect = powerErrorPoints <= 6;
  const correctDecision = aimCorrect && paceCorrect;
  const made = rng.random() < makeProbability;
  if (made) landing = { ...context.pin };
  const playerOffsetInches = Math.abs(context.target.x - context.pin.x) * 36;
  const playerOffsetDirection = context.target.x >= context.pin.x ? "right" : "left";
  const assessment = puttAssessment(correctDecision, made);
  return {
    made,
    landing: { x: roundTo(landing.x, 4), y: roundTo(landing.y, 4) },
    total_yards: roundTo(travelYards, 2),
    remaining_distance_yards: roundTo(Math.hypot(landing.x - context.pin.x, landing.y - context.pin.y), 2),
    aim_error_inches: roundTo(aimErrorInches, 2),
    power_error_points: roundTo(powerErrorPoints, 2),
    make_probability: roundTo(makeProbability, 6),
    aim_correct: aimCorrect,
    pace_correct: paceCorrect,
    correct_decision: correctDecision,
    player_offset_inches: roundTo(playerOffsetInches, 2),
    player_offset_direction: playerOffsetDirection,
    read: { ...context.read },
    assessment,
    audit: {
      engine_version: PUTTING_ENGINE_VERSION,
      round_seed: roundSeed,
      shot_seed: shotSeed.toString(),
      hole_number: holeNumber,
      stroke_index: strokeIndex,
      profile_version: context.profile_version,
      sampled_power_multiplier: roundTo(powerMultiplier, 6),
      sampled_lateral_yards: roundTo(sampledLateralYards, 6),
      make_probability: roundTo(makeProbability, 6)
    }
  };
}
