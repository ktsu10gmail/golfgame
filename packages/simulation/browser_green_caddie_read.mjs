import { sampleCourseGreenContour } from "./browser_green_contour.mjs?v=20260807-5";
import { rollPuttAcrossContour } from "./browser_putting.mjs?v=20260807-5";

function bounded(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value)));
}

function finitePoint(point, label) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${label} must contain finite x and y coordinates`);
  }
  return point;
}

/**
 * Rotates the relief camera so the cup is directly ahead of the ball. In the
 * projected view the ball appears below the cup, matching the player's view
 * while standing over the putt.
 */
export function greenPlayerViewYawDegrees(start, pin) {
  finitePoint(start, "start");
  finitePoint(pin, "pin");
  const dx = pin.x - start.x;
  const dy = pin.y - start.y;
  if (Math.hypot(dx, dy) <= 1e-9) return 0;
  const degrees = Math.atan2(dx, dy) * 180 / Math.PI;
  return (degrees + 540) % 360 - 180;
}

/** Rotates the current green camera clockwise by one quarter turn. */
export function greenQuarterTurnYawDegrees(currentYaw) {
  const yaw = Number(currentYaw);
  if (!Number.isFinite(yaw)) throw new Error("currentYaw must be finite");
  return (yaw + 450) % 360 - 180;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index], b = polygon[previous];
    const crossing = ((a.y > point.y) !== (b.y > point.y)) &&
      point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (crossing) inside = !inside;
  }
  return inside;
}

function elevationSections(path, polygon, contourKey) {
  const labels = ["First section", "Middle section", "Final section"];
  const sections = [];
  for (let section = 0; section < 3; section += 1) {
    const from = path[Math.round(section / 3 * (path.length - 1))];
    const to = path[Math.round((section + 1) / 3 * (path.length - 1))];
    const fromHeight = sampleCourseGreenContour([from.x, from.y], polygon.map(point => [point.x, point.y]), contourKey).height;
    const toHeight = sampleCourseGreenContour([to.x, to.y], polygon.map(point => [point.x, point.y]), contourKey).height;
    const change = toHeight - fromHeight;
    sections.push({
      label: labels[section],
      tendency: change > .035 ? "uphill" : change < -.035 ? "downhill" : "nearly level"
    });
  }
  return sections;
}

/**
 * Finds a contour-aware teaching line without execution randomness. The result
 * is a green-reading reference, not a promise that the player's putt will hole.
 */
export function buildGreenCaddieRead({
  start,
  pin,
  greenPolygon,
  contourKey,
  contourStrength = 1,
  putterRangeFeet = 60
}) {
  finitePoint(start, "start");
  finitePoint(pin, "pin");
  if (!Array.isArray(greenPolygon) || greenPolygon.length < 3) throw new Error("greenPolygon needs at least three points");
  greenPolygon.forEach((point, index) => finitePoint(point, `greenPolygon[${index}]`));
  const dx = pin.x - start.x;
  const dy = pin.y - start.y;
  const directYards = Math.hypot(dx, dy);
  if (directYards < .05) throw new Error("the ball is already at the cup");
  const forward = { x: dx / directYards, y: dy / directYards };
  const right = { x: forward.y, y: -forward.x };
  const directFeet = directYards * 3;
  const rangeYards = putterRangeFeet / 3;
  const maximumOffsetInches = bounded(Math.max(12, directFeet * .72), 12, 48);
  const baselinePower = bounded(directYards / rangeYards * 100, 5, 100);

  const evaluate = (offsetInches, power) => {
    const offsetYards = offsetInches / 36;
    const target = {
      x: pin.x + right.x * offsetYards,
      y: pin.y + right.y * offsetYards
    };
    const roll = rollPuttAcrossContour({
      start,
      target,
      pin,
      greenPolygon,
      holeNumber: contourKey,
      desiredTravelYards: rangeYards * power / 100,
      contourStrength
    });
    const landingDistance = Math.hypot(roll.landing.x - pin.x, roll.landing.y - pin.y);
    const outsideSamples = roll.path.filter(point => !pointInPolygon(point, greenPolygon)).length;
    return {
      ...roll,
      target,
      offsetInches,
      power,
      landingDistance,
      score: landingDistance + outsideSamples * .35
    };
  };

  let best = null;
  const consider = candidate => {
    if (!best || candidate.score < best.score) best = candidate;
  };
  const coarsePowerMinimum = bounded(baselinePower * .68, 5, 100);
  const coarsePowerMaximum = bounded(Math.max(baselinePower * 1.35, baselinePower + 10), 5, 100);
  for (let offsetStep = 0; offsetStep <= 24; offsetStep += 1) {
    const offset = -maximumOffsetInches + offsetStep / 24 * maximumOffsetInches * 2;
    for (let powerStep = 0; powerStep <= 24; powerStep += 1) {
      const power = coarsePowerMinimum + powerStep / 24 * (coarsePowerMaximum - coarsePowerMinimum);
      consider(evaluate(offset, power));
    }
  }
  const coarseBest = best;
  for (let offsetStep = -10; offsetStep <= 10; offsetStep += 1) {
    const offset = bounded(coarseBest.offsetInches + offsetStep * .35, -maximumOffsetInches, maximumOffsetInches);
    for (let powerStep = -10; powerStep <= 10; powerStep += 1) {
      const power = bounded(coarseBest.power + powerStep * .22, 5, 100);
      consider(evaluate(offset, power));
    }
  }

  const pace = Math.round(best.power);
  const paceMargin = directFeet >= 40 ? 2 : directFeet >= 20 ? 3 : 4;
  const finishRadiusFeet = directFeet >= 40 ? 4 : directFeet >= 25 ? 3 : directFeet >= 15 ? 2.5 : 2;
  return {
    target: best.target,
    landing: best.landing,
    path: best.path,
    aim_offset_inches: Math.round(best.offsetInches),
    aim_direction: best.offsetInches >= 0 ? "right" : "left",
    pace_percent: pace,
    pace_range: [bounded(pace - paceMargin, 5, 100), bounded(pace + paceMargin, 5, 100)],
    finish_radius_feet: finishRadiusFeet,
    predicted_leave_feet: best.landingDistance * 3,
    direct_distance_feet: directFeet,
    sections: elevationSections(best.path, greenPolygon, contourKey)
  };
}
