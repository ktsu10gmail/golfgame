// Browser port of packages/simulation/greenside.py. Keep numerical changes paired.

import {
  projectLanding,
  resolvePenaltyRelief,
  resolveSurface
} from "./browser_engine.mjs?v=20260815-4";

export const GREENSIDE_ENGINE_VERSION = "greenside-chip-v3";
const GREENSIDE_SEED_VERSION = "greenside-chip-v2";

const MASK_64 = (1n << 64n) - 1n;
const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;

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

function roundedPoint(point) {
  return { x: roundTo(point.x, 4), y: roundTo(point.y, 4) };
}

function assertFinitePoint(point, label) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${label} must be a finite point`);
  }
}

function rollRatio(clubId) {
  const name = clubId.toLowerCase().replaceAll("_", " ");
  if (name.includes("lob wedge")) return 0.8;
  if (name.includes("sand wedge")) return 1;
  if (name.includes("gap wedge")) return 1.5;
  if (name.includes("pitching wedge")) return 2;
  if (name.includes("9 iron")) return 3;
  if (name.includes("8 iron")) return 4;
  if (name.includes("7 iron")) return 5;
  if (name.includes("6 iron")) return 6;
  return 2.5;
}

function lieSpread(lieType) {
  if (lieType === "rough_deep") return [0.08, 0.05];
  if (["rough_light", "rough_medium", "rough_flyer"].includes(lieType)) return [0.05, 0.03];
  return [0.03, 0.01];
}

function breakInches(feet, contourModifier) {
  if (feet <= 3) {
    return Math.min(2, Math.max(0, Math.round(feet * 0.15 + contourModifier * 0.25)));
  }
  if (feet <= 8) {
    return Math.min(4, Math.max(1, Math.round(0.75 + (feet - 3) * 0.35 + contourModifier * 0.25)));
  }
  if (feet <= 15) {
    return Math.min(8, Math.max(3, Math.round(2.5 + (feet - 8) * 0.55 + contourModifier * 0.6)));
  }
  return Math.min(16, Math.max(8, Math.round(6.5 + (feet - 15) * 0.5 + contourModifier)));
}

export function deriveGreensideSeed(roundSeed, holeNumber, strokeIndex) {
  if (holeNumber < 1 || holeNumber > 18) throw new Error("hole_number must be between 1 and 18");
  if (strokeIndex < 1) throw new Error("stroke_index must be positive");
  const material = `${GREENSIDE_SEED_VERSION}:${roundSeed}:${holeNumber}:${strokeIndex}`;
  let hashed = FNV_OFFSET_64;
  for (const byte of new TextEncoder().encode(material)) {
    hashed ^= BigInt(byte);
    hashed = (hashed * FNV_PRIME_64) & MASK_64;
  }
  return hashed;
}

export function simulateGreensideShot(context, { roundSeed, holeNumber, strokeIndex }) {
  assertFinitePoint(context.start, "start");
  assertFinitePoint(context.target, "target");
  assertFinitePoint(context.pin, "pin");
  if (!context.club_id) throw new Error("club_id is required");
  if (!Number.isFinite(context.accuracy) || context.accuracy < 0 || context.accuracy > 1) {
    throw new Error("accuracy must be between 0 and 1");
  }
  if (!Number.isFinite(context.power) || context.power < 0 || context.power > 1.5) {
    throw new Error("power is outside the supported range");
  }
  if (!Number.isFinite(context.roll_slope_factor) || context.roll_slope_factor <= 0) {
    throw new Error("roll_slope_factor must be positive");
  }
  if (!["left", "right"].includes(context.break_direction)) {
    throw new Error("break_direction must be left or right");
  }
  if (!Number.isInteger(context.contour_modifier) ||
    context.contour_modifier < -2 || context.contour_modifier > 2) {
    throw new Error("contour_modifier must be between -2 and 2");
  }

  const shotSeed = deriveGreensideSeed(roundSeed, holeNumber, strokeIndex);
  const rng = new DeterministicRandom(shotSeed);
  const carryTarget = Math.hypot(context.target.x - context.start.x, context.target.y - context.start.y);
  const [carryLieSpread, lateralLieSpread] = lieSpread(context.lie_type);
  const carryBias = 0.82 + context.power * 0.2;
  const carrySd = Math.max(
    0.4,
    carryTarget * (0.05 + (1 - context.accuracy) * 0.12 + carryLieSpread)
  );
  const actualCarry = Math.max(0.5, rng.gauss(carryTarget * carryBias, carrySd));
  const lateralSd = Math.max(
    0.15,
    carryTarget * (0.015 + (1 - context.accuracy) * 0.06 + lateralLieSpread)
  );
  const lateralYards = rng.gauss(0, lateralSd);
  const carryPoint = projectLanding(context.start, context.target, actualCarry, lateralYards);
  const [landingSurface, landingRegionId] = resolveSurface(
    carryPoint, context.surfaces, context.default_surface
  );

  const feetToPin = Math.hypot(carryPoint.x - context.pin.x, carryPoint.y - context.pin.y) * 3;
  const readBreakInches = breakInches(feetToPin, context.contour_modifier);
  const greensideRollRatio = rollRatio(context.club_id);
  const surfaceFactor = landingSurface === "green" ? 1 : 0.65;
  const rollYards = Math.max(
    0,
    actualCarry * greensideRollRatio * context.roll_slope_factor * surfaceFactor
  );
  const distanceToPin = Math.hypot(carryPoint.x - context.pin.x, carryPoint.y - context.pin.y);
  const breakScale = Math.min(1.3, rollYards / Math.max(distanceToPin, 1));
  const lateralBreak = readBreakInches / 36 * breakScale *
    (context.break_direction === "right" ? 1 : -1);
  const forwardX = context.pin.x - context.start.x;
  const forwardY = context.pin.y - context.start.y;
  const forwardLength = Math.max(Math.hypot(forwardX, forwardY), 1e-9);
  const pinStillAhead = (context.pin.x - carryPoint.x) * forwardX +
    (context.pin.y - carryPoint.y) * forwardY > 0;
  // Roll toward the cup while it remains ahead. If carry dispersion has
  // already passed the cup, continue generally forward instead of reversing
  // the ball back through its landing point.
  const rollTarget = pinStillAhead
    ? context.pin
    : {
        x: carryPoint.x + forwardX / forwardLength,
        y: carryPoint.y + forwardY / forwardLength
      };
  const finalPoint = projectLanding(carryPoint, rollTarget, rollYards, lateralBreak);
  const [finalSurface, finalRegionId] = resolveSurface(
    finalPoint, context.surfaces, context.default_surface
  );

  const roundedCarry = roundedPoint(carryPoint);
  const roundedFinal = roundedPoint(finalPoint);
  const path = [roundedPoint(context.start), roundedCarry, roundedFinal];
  const relief = resolvePenaltyRelief(context, {
    landing: roundedFinal,
    path,
    landingSurface: finalSurface,
    landingRegionId: finalRegionId,
    declaredUnplayable: false
  });
  const resolvedBall = relief?.ball_position || roundedFinal;
  const resolvedSurface = relief?.resulting_surface || finalSurface;
  const resolvedRegionId = relief ? relief.resulting_region_id : finalRegionId;
  const remaining = Math.hypot(resolvedBall.x - context.pin.x, resolvedBall.y - context.pin.y);
  const execution = remaining <= 4.5 && resolvedSurface === "green" ? "on_plan" : "missed";
  const targetMiss = Math.hypot(carryPoint.x - context.target.x, carryPoint.y - context.target.y);
  const quality = targetMiss <= 1.5 ? "solid" : targetMiss <= 3 ? "slight_mishit" : "fat";
  const roundedTargetMiss = roundTo(targetMiss, 1);
  const decisionRisk = Math.min(100, Math.round(20 + roundedTargetMiss * 8));
  const riskLabel = targetMiss <= 1.5
    ? "Conservative"
    : targetMiss <= 3
      ? "Measured risk"
      : "High risk";

  return {
    quality,
    carry_yards: roundTo(actualCarry, 2),
    roll_yards: roundTo(rollYards, 2),
    total_yards: roundTo(actualCarry + rollYards, 2),
    lateral_yards: roundTo(lateralYards, 2),
    landing: roundedCarry,
    resolved_ball: resolvedBall,
    path,
    landing_surface: landingSurface,
    landing_region_id: landingRegionId,
    resolved_surface: resolvedSurface,
    resolved_region_id: resolvedRegionId,
    remaining_distance_yards: roundTo(remaining, 2),
    assessment: {
      decision_assessment: "sound",
      execution_assessment: execution,
      overall_assessment: execution === "on_plan" ? "good" : "bad",
      decision_risk: decisionRisk,
      risk_label: riskLabel
    },
    audit: {
      engine_version: GREENSIDE_ENGINE_VERSION,
      round_seed: roundSeed,
      shot_seed: shotSeed.toString(),
      hole_number: holeNumber,
      stroke_index: strokeIndex,
      profile_version: context.profile_version,
      lie_version: context.lie_version,
      sampled_carry_yards: roundTo(actualCarry, 4),
      sampled_lateral_yards: roundTo(lateralYards, 4),
      mishit_probability: roundTo(1 - context.accuracy, 3),
      modifiers: [
        { name: "greenside_roll_ratio", value: greensideRollRatio },
        { name: "greenside_slope_factor", value: context.roll_slope_factor },
        { name: "intent_distance", value: context.power },
        { name: "contour_modifier", value: context.contour_modifier }
      ]
    },
    relief
  };
}
