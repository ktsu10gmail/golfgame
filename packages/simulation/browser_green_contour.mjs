// Original reusable practice-green contour. The rendered slope bands, downhill
// arrows, and putting read all sample this same deterministic height field.

const ROTATION_STEP_DEGREES = 30;
const SAMPLE_EPSILON = 0.0025;
const SEEDED_PROFILE_CACHE = new Map();

function bounded(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value)));
}

function gaussian(x, y, centerX, centerY, spreadX, spreadY, amplitude) {
  const dx = (x - centerX) / spreadX;
  const dy = (y - centerY) / spreadY;
  return amplitude * Math.exp(-(dx * dx + dy * dy));
}

function baseHeight(x, y) {
  // A broad tilted green with a back-left shelf, a soft center basin, and a
  // front-right shoulder. It creates readable single and double breaks while
  // keeping a few realistic pin plateaus.
  return (
    x * .18 - y * .12 +
    gaussian(x, y, -.48, .38, .42, .34, .72) -
    gaussian(x, y, -.08, -.02, .5, .42, .46) +
    gaussian(x, y, .5, -.38, .34, .44, .58) +
    gaussian(x, y, .48, .44, .5, .28, .28)
  );
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seedValue) {
  let state = hashSeed(seedValue) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function seededContourProfile(identity) {
  const key = String(identity);
  if (SEEDED_PROFILE_CACHE.has(key)) return SEEDED_PROFILE_CACHE.get(key);
  const random = seededRandom(`${key}:green-elevation-v1`);
  const feature = (sign, amplitudeFloor = .3) => ({
    x: random() * 1.4 - .7,
    y: random() * 1.4 - .7,
    spreadX: .25 + random() * .35,
    spreadY: .25 + random() * .35,
    amplitude: sign * (amplitudeFloor + random() * .46)
  });
  const profile = {
    rotation_degrees: Math.round(random() * 359),
    mirrored: random() >= .5,
    tiltX: (random() - .5) * .42,
    tiltY: (random() - .5) * .42,
    ripplePhase: random() * Math.PI * 2,
    rippleStrength: .035 + random() * .06,
    features: [feature(1, .42), feature(-1, .36), feature(1, .2), feature(-1, .18)]
  };
  SEEDED_PROFILE_CACHE.set(key, profile);
  return profile;
}

function seededHeight(x, y, identity) {
  const profile = seededContourProfile(identity);
  const shaped = profile.features.reduce((height, feature) => height + gaussian(
    x, y, feature.x, feature.y, feature.spreadX, feature.spreadY, feature.amplitude
  ), x * profile.tiltX + y * profile.tiltY);
  return shaped + Math.sin(x * 3.1 + y * 2.2 + profile.ripplePhase) * profile.rippleStrength;
}

export function greenContourTransform(holeNumber) {
  if (typeof holeNumber === "string" && holeNumber.trim()) {
    const profile = seededContourProfile(holeNumber);
    return { rotation_degrees: profile.rotation_degrees, mirrored: profile.mirrored };
  }
  const normalizedHole = Math.max(1, Math.trunc(Number(holeNumber) || 1));
  return {
    rotation_degrees: ((normalizedHole - 1) * ROTATION_STEP_DEGREES) % 360,
    mirrored: normalizedHole > 12
  };
}

function templatePoint(x, y, holeNumber) {
  const transform = greenContourTransform(holeNumber);
  const radians = -transform.rotation_degrees * Math.PI / 180;
  const mirroredX = transform.mirrored ? -x : x;
  return {
    x: mirroredX * Math.cos(radians) - y * Math.sin(radians),
    y: mirroredX * Math.sin(radians) + y * Math.cos(radians)
  };
}

function transformedHeight(x, y, holeNumber) {
  const point = templatePoint(x, y, holeNumber);
  return typeof holeNumber === "string" && holeNumber.trim()
    ? seededHeight(point.x, point.y, holeNumber)
    : baseHeight(point.x, point.y);
}

export function sampleGreenContour(x, y, holeNumber) {
  const safeX = bounded(x, -1.25, 1.25);
  const safeY = bounded(y, -1.25, 1.25);
  const height = transformedHeight(safeX, safeY, holeNumber);
  const dx = (
    transformedHeight(safeX + SAMPLE_EPSILON, safeY, holeNumber) -
    transformedHeight(safeX - SAMPLE_EPSILON, safeY, holeNumber)
  ) / (SAMPLE_EPSILON * 2);
  const dy = (
    transformedHeight(safeX, safeY + SAMPLE_EPSILON, holeNumber) -
    transformedHeight(safeX, safeY - SAMPLE_EPSILON, holeNumber)
  ) / (SAMPLE_EPSILON * 2);
  const gradient = Math.hypot(dx, dy);
  const slopeDegrees = bounded(.35 + gradient * 3.9, .35, 6.8);
  const downhillX = gradient > 1e-8 ? -dx / gradient : 0;
  const downhillY = gradient > 1e-8 ? -dy / gradient : 1;
  return {
    height,
    slope_degrees: slopeDegrees,
    downhill_x: downhillX,
    downhill_y: downhillY
  };
}

export function greenContourColor(slopeDegrees) {
  if (slopeDegrees < 1.25) return "#79c6b2";
  if (slopeDegrees < 2.5) return "#91c878";
  if (slopeDegrees < 3.75) return "#d1c65e";
  if (slopeDegrees < 5) return "#df9850";
  return "#b95643";
}

// A turf-first elevation ramp: low areas are deep green and high areas become
// progressively lighter, while preserving enough contrast to read each band.
const ELEVATION_COLORS = ["#2f6b4f", "#438058", "#57945f", "#6ca766", "#84b96f", "#9dcb7b"];

export function greenElevationColor(height, minimumHeight, maximumHeight) {
  const minimum = Number(minimumHeight);
  const maximum = Number(maximumHeight);
  const value = Number(height);
  if (![minimum, maximum, value].every(Number.isFinite)) return ELEVATION_COLORS[2];
  const normalized = maximum - minimum > 1e-9
    ? bounded((value - minimum) / (maximum - minimum), 0, 1)
    : .5;
  return ELEVATION_COLORS[Math.min(ELEVATION_COLORS.length - 1, Math.floor(normalized * ELEVATION_COLORS.length))];
}

function polygonBounds(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new Error("green polygon must contain at least three points");
  }
  const xs = polygon.map(point => Number(point[0]));
  const ys = polygon.map(point => Number(point[1]));
  if (![...xs, ...ys].every(Number.isFinite)) throw new Error("green polygon points must be finite");
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys)
  };
}

export function normalizedGreenPoint(point, polygon) {
  const bounds = polygonBounds(polygon);
  const width = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const height = Math.max(bounds.maxY - bounds.minY, 1e-6);
  return {
    x: ((Number(point[0]) - bounds.minX) / width) * 2 - 1,
    y: ((Number(point[1]) - bounds.minY) / height) * 2 - 1,
    bounds
  };
}

export function sampleCourseGreenContour(point, polygon, holeNumber) {
  const normalized = normalizedGreenPoint(point, polygon);
  const sample = sampleGreenContour(normalized.x, normalized.y, holeNumber);
  const width = Math.max(normalized.bounds.maxX - normalized.bounds.minX, 1e-6);
  const height = Math.max(normalized.bounds.maxY - normalized.bounds.minY, 1e-6);
  const courseDownhillX = sample.downhill_x * width;
  const courseDownhillY = sample.downhill_y * height;
  const length = Math.hypot(courseDownhillX, courseDownhillY) || 1;
  return {
    ...sample,
    downhill_course_x: courseDownhillX / length,
    downhill_course_y: courseDownhillY / length
  };
}

export function contourPuttStrength(feet) {
  // Preserve the existing feel through fifteen feet, then progressively make
  // the contour more influential while the ball spends longer slowing down.
  return 1 + bounded((Number(feet) - 15) / 10, 0, 1);
}

export function contourPuttRead({ start, pin, polygon, holeNumber, yardsPerCoordinateUnit = 1 }) {
  const dx = Number(pin[0]) - Number(start[0]);
  const dy = Number(pin[1]) - Number(start[1]);
  const coordinateDistance = Math.hypot(dx, dy);
  const distanceScale = Number(yardsPerCoordinateUnit);
  if (!Number.isFinite(distanceScale) || distanceScale <= 0) {
    throw new Error("yardsPerCoordinateUnit must be a positive finite number");
  }
  const yards = coordinateDistance * distanceScale;
  const feet = yards * 3;
  const forwardX = coordinateDistance > 1e-8 ? dx / coordinateDistance : 0;
  const forwardY = coordinateDistance > 1e-8 ? dy / coordinateDistance : 1;
  const rightX = forwardY;
  const rightY = -forwardX;
  let weightedLateral = 0;
  let weightedForward = 0;
  let weightedSlope = 0;
  const pathSamples = [.15, .35, .55, .75, .92];
  for (const progress of pathSamples) {
    const point = [Number(start[0]) + dx * progress, Number(start[1]) + dy * progress];
    const sample = sampleCourseGreenContour(point, polygon, holeNumber);
    const lateral = sample.downhill_course_x * rightX + sample.downhill_course_y * rightY;
    const forward = sample.downhill_course_x * forwardX + sample.downhill_course_y * forwardY;
    weightedLateral += lateral * sample.slope_degrees;
    weightedForward += forward * sample.slope_degrees;
    weightedSlope += sample.slope_degrees;
  }
  const averageLateral = weightedLateral / pathSamples.length;
  const averageForward = weightedForward / pathSamples.length;
  const averageSlope = weightedSlope / pathSamples.length;
  const direction = averageLateral >= 0 ? "right" : "left";
  const startDirection = direction === "right" ? "left" : "right";
  const breakInches = Math.round(bounded(
    feet * Math.abs(averageLateral) * .105 * contourPuttStrength(feet),
    0,
    Math.max(2, feet * .72)
  ));
  const slope = averageForward > .65 ? "downhill" : averageForward < -.65 ? "uphill" : "cross-slope";
  return {
    feet,
    direction,
    startDirection,
    breakInches,
    slope,
    slopeDegrees: averageSlope,
    downhillStrength: averageForward
  };
}
