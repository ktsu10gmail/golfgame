// Browser port of packages/simulation/putting.py. Keep numerical changes paired.
import { sampleCourseGreenContour } from "./browser_green_contour.mjs?v=20260807-5";

export const PUTTING_ENGINE_VERSION = "putt-v3";

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

const GREEN_FRICTION_YARDS_PER_SECOND_SQUARED = 1.35;
const GREEN_GRAVITY_YARDS_PER_SECOND_SQUARED = 10.72;
const CONTOUR_GRAVITY_SCALE = .12;
const PHYSICS_TIME_STEP_SECONDS = .04;
const PHYSICS_STOP_SPEED = .035;
const MAX_PHYSICS_STEPS = 650;

export function rollPuttAcrossContour({
  start,
  target,
  pin,
  greenPolygon,
  holeNumber,
  desiredTravelYards,
  lateralErrorYards = 0,
  contourStrength = 1
}) {
  assertFinitePoint(start, "start");
  assertFinitePoint(target, "target");
  const polygon = Array.isArray(greenPolygon) ? greenPolygon : [];
  if (polygon.length < 3) throw new Error("greenPolygon must contain at least three points");
  polygon.forEach((point, index) => assertFinitePoint(point, `greenPolygon[${index}]`));
  const travel = Math.max(0, Number(desiredTravelYards) || 0);
  const [forward, right] = targetAxes(start, target);
  const lateralRatio = Number(lateralErrorYards) / Math.max(travel, .25);
  const directionLength = Math.hypot(forward.x + right.x * lateralRatio, forward.y + right.y * lateralRatio) || 1;
  const direction = {
    x: (forward.x + right.x * lateralRatio) / directionLength,
    y: (forward.y + right.y * lateralRatio) / directionLength
  };
  let speed = Math.sqrt(2 * GREEN_FRICTION_YARDS_PER_SECOND_SQUARED * travel);
  let velocity = { x: direction.x * speed, y: direction.y * speed };
  let position = { x: start.x, y: start.y };
  const path = [{ ...position }];
  let traveled = 0;
  let steps = 0;
  let closestToPin = pin ? Math.hypot(position.x - pin.x, position.y - pin.y) : null;

  for (; steps < MAX_PHYSICS_STEPS && speed > PHYSICS_STOP_SPEED; steps += 1) {
    const sample = sampleCourseGreenContour(
      [position.x, position.y],
      polygon.map(point => [point.x, point.y]),
      holeNumber
    );
    const gravity = GREEN_GRAVITY_YARDS_PER_SECOND_SQUARED *
      Math.sin(sample.slope_degrees * Math.PI / 180) *
      CONTOUR_GRAVITY_SCALE * Math.max(0, Math.min(2, Number(contourStrength) || 0));
    const unitVelocity = speed > 1e-9 ? { x: velocity.x / speed, y: velocity.y / speed } : direction;
    const acceleration = {
      x: sample.downhill_course_x * gravity - unitVelocity.x * GREEN_FRICTION_YARDS_PER_SECOND_SQUARED,
      y: sample.downhill_course_y * gravity - unitVelocity.y * GREEN_FRICTION_YARDS_PER_SECOND_SQUARED
    };
    const nextVelocity = {
      x: velocity.x + acceleration.x * PHYSICS_TIME_STEP_SECONDS,
      y: velocity.y + acceleration.y * PHYSICS_TIME_STEP_SECONDS
    };
    if (nextVelocity.x * velocity.x + nextVelocity.y * velocity.y <= 0) break;
    const nextPosition = {
      x: position.x + (velocity.x + nextVelocity.x) * .5 * PHYSICS_TIME_STEP_SECONDS,
      y: position.y + (velocity.y + nextVelocity.y) * .5 * PHYSICS_TIME_STEP_SECONDS
    };
    traveled += Math.hypot(nextPosition.x - position.x, nextPosition.y - position.y);
    position = nextPosition;
    velocity = nextVelocity;
    speed = Math.hypot(velocity.x, velocity.y);
    if (pin) closestToPin = Math.min(closestToPin, Math.hypot(position.x - pin.x, position.y - pin.y));
    if (steps % 4 === 3) path.push({ ...position });
  }
  const finalPoint = { ...position };
  const last = path.at(-1);
  if (!last || Math.hypot(last.x - finalPoint.x, last.y - finalPoint.y) > 1e-7) path.push(finalPoint);
  return { landing: finalPoint, path, totalYards: traveled, steps, closestToPin };
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
  const executionGap = 1 - consistency;
  const paceNoise = (rng.random() + rng.random()) - 1;
  const lateralNoise = (rng.random() + rng.random()) - 1;
  const downhillStrength = Number(context.read.downhill_strength) || 0;
  const slopePaceMultiplier = Math.max(.9, Math.min(1.1, 1 + downhillStrength * .012));
  const contourPhysics = Array.isArray(context.green_polygon) && context.green_polygon.length >= 3;
  const baseTravelYards = context.profile.putter_range_feet / 3 * context.pace_scale * (contourPhysics ? 1 : slopePaceMultiplier);
  const distanceRamp = Math.max(0, Math.min(1, (context.read.feet - 10) / 5));
  const slopeDegrees = Number(context.read.slope_degrees) || 0;
  const contourDifficulty = (
    1 +
    Math.max(0, slopeDegrees - 2) * .07 +
    Math.min(.25, context.read.break_inches / Math.max(context.read.feet, 1) * .4) +
    Math.max(0, downhillStrength) * .025
  );
  const shortPaceErrorYards = baseTravelYards * paceNoise * executionGap * .08;
  const longPaceAmplitudeFeet = (context.read.feet + 8) * (.07 + executionGap * .65) * contourDifficulty;
  const longPaceErrorYards = paceNoise * longPaceAmplitudeFeet / 3;
  const paceErrorYards = shortPaceErrorYards * (1 - distanceRamp) + longPaceErrorYards * distanceRamp;
  const travelYards = Math.max(0, baseTravelYards + paceErrorYards);
  const powerMultiplier = travelYards / Math.max(baseTravelYards, 1e-9);
  const shortLateralYards = lateralNoise * executionGap * .18 * METERS_TO_YARDS;
  const longLateralAmplitudeFeet = (context.read.feet + 5) * (.018 + executionGap * .11) * contourDifficulty;
  const longLateralYards = lateralNoise * longLateralAmplitudeFeet / 3;
  const sampledLateralYards = shortLateralYards * (1 - distanceRamp) + longLateralYards * distanceRamp;
  let physics = null;
  let landing;
  let path;
  let actualTravelYards = travelYards;
  if (contourPhysics) {
    physics = rollPuttAcrossContour({
      start: context.start,
      target: context.target,
      pin: context.pin,
      greenPolygon: context.green_polygon,
      holeNumber: context.contour_key || Number(context.contour_hole_number) || holeNumber,
      desiredTravelYards: travelYards,
      lateralErrorYards: sampledLateralYards,
      contourStrength: context.contour_strength ?? 1
    });
    landing = physics.landing;
    path = physics.path;
    actualTravelYards = physics.totalYards;
  } else {
    landing = projectLanding(context.start, context.target, travelYards, sampledLateralYards);
    const traveledFraction = Math.min(1, Math.hypot(landing.x - context.start.x, landing.y - context.start.y) / Math.max(Math.hypot(context.pin.x - context.start.x, context.pin.y - context.start.y), 1));
    const pinDx = context.pin.x - context.start.x;
    const pinDy = context.pin.y - context.start.y;
    const pinLength = Math.hypot(pinDx, pinDy) || 1;
    const right = { x: pinDy / pinLength, y: -pinDx / pinLength };
    const breakYards = context.read.break_inches / 36 * traveledFraction * (context.read.direction === "right" ? 1 : -1);
    landing = {
      x: landing.x + right.x * breakYards,
      y: landing.y + right.y * breakYards
    };
    path = [{ ...context.start }, { ...landing }];
  }
  const pinDx = context.pin.x - context.start.x;
  const pinDy = context.pin.y - context.start.y;
  const pinLength = Math.hypot(pinDx, pinDy) || 1;
  const right = { x: pinDy / pinLength, y: -pinDx / pinLength };
  const readOffsetYards = context.read.break_inches / 36 * (context.read.start_direction === "right" ? 1 : -1);
  const idealTarget = {
    x: context.pin.x + right.x * readOffsetYards,
    y: context.pin.y + right.y * readOffsetYards
  };
  const aimErrorInches = Math.hypot(context.target.x - idealTarget.x, context.target.y - idealTarget.y) * 36;
  const requiredPower = context.read.feet / context.profile.putter_range_feet / slopePaceMultiplier;
  const powerErrorPoints = Math.abs(context.pace_scale - requiredPower) * 100;
  const aimQuality = Math.exp(-aimErrorInches / 8);
  const paceQuality = Math.exp(-powerErrorPoints / 12);
  const canReachCup = context.profile.putter_range_feet * context.pace_scale * slopePaceMultiplier >= context.read.feet * .97;
  const baseProbability = baselineMakeProbability(context.read.feet, context);
  const makeProbability = canReachCup
    ? Math.max(0, Math.min(1, baseProbability * (.15 + .85 * aimQuality) * (.1 + .9 * paceQuality)))
    : 0;
  const aimCorrect = aimErrorInches <= Math.max(2, context.read.break_inches * .35);
  const paceCorrect = powerErrorPoints <= 6;
  const correctDecision = aimCorrect && paceCorrect;
  const made = rng.random() < makeProbability;
  if (made) {
    landing = { ...context.pin };
    path = [...path, { ...context.pin }];
  }
  const signedPlayerOffsetYards =
    (context.target.x - context.pin.x) * right.x +
    (context.target.y - context.pin.y) * right.y;
  const playerOffsetInches = Math.abs(signedPlayerOffsetYards) * 36;
  const playerOffsetDirection = signedPlayerOffsetYards >= 0 ? "right" : "left";
  const assessment = puttAssessment(correctDecision, made);
  return {
    made,
    landing: { x: roundTo(landing.x, 4), y: roundTo(landing.y, 4) },
    path: path.map(point => ({ x: roundTo(point.x, 4), y: roundTo(point.y, 4) })),
    total_yards: roundTo(actualTravelYards, 2),
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
      make_probability: roundTo(makeProbability, 6),
      physics_steps: physics?.steps || 0,
      contour_physics: contourPhysics
    }
  };
}
