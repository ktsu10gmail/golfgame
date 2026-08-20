const DEFAULT_POINT_COUNT = 20;
const DEFAULT_TARGET_WIDTH_YARDS = 40;
const METERS_TO_YARDS = 1.09361;

function finitePoint(point) {
  return Array.isArray(point) && point.length >= 2 &&
    Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]));
}

function safePolygon(polygon) {
  const points = (Array.isArray(polygon) ? polygon : [])
    .filter(finitePoint)
    .map(point => [Number(point[0]), Number(point[1])]);
  if (points.length > 3 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1]) {
    points.pop();
  }
  if (points.length < 3) throw new Error("green polygon must contain at least three finite points");
  return points;
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value || "green")) {
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

function polygonCenter(polygon) {
  let twiceArea = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const cross = current[0] * next[1] - next[0] * current[1];
    twiceArea += cross;
    weightedX += (current[0] + next[0]) * cross;
    weightedY += (current[1] + next[1]) * cross;
  }
  if (Math.abs(twiceArea) > 1e-8) {
    return [weightedX / (3 * twiceArea), weightedY / (3 * twiceArea)];
  }
  return [
    polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length,
    polygon.reduce((sum, point) => sum + point[1], 0) / polygon.length
  ];
}

function principalAngle(polygon, center) {
  let xx = 0;
  let yy = 0;
  let xy = 0;
  polygon.forEach(point => {
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  });
  return .5 * Math.atan2(2 * xy, xx - yy);
}

function cross(first, second) {
  return first[0] * second[1] - first[1] * second[0];
}

function raySegmentDistance(origin, direction, start, end) {
  const segment = [end[0] - start[0], end[1] - start[1]];
  const denominator = cross(direction, segment);
  if (Math.abs(denominator) <= 1e-9) return null;
  const offset = [start[0] - origin[0], start[1] - origin[1]];
  const rayDistance = cross(offset, segment) / denominator;
  const segmentProgress = cross(offset, direction) / denominator;
  return rayDistance >= 0 && segmentProgress >= 0 && segmentProgress <= 1 ? rayDistance : null;
}

function rayPolygonDistance(origin, direction, polygon) {
  let nearest = null;
  for (let index = 0; index < polygon.length; index += 1) {
    const distance = raySegmentDistance(origin, direction, polygon[index], polygon[(index + 1) % polygon.length]);
    if (distance != null && (nearest == null || distance < nearest)) nearest = distance;
  }
  return nearest;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [x, y] = polygon[index];
    const [previousX, previousY] = polygon[previous];
    if (((y > point[1]) !== (previousY > point[1])) &&
        point[0] < (previousX - x) * (point[1] - y) / ((previousY - y) || 1e-9) + x) inside = !inside;
  }
  return inside;
}

function distance(first, second) {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return distance(point, start);
  const progress = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared
  ));
  return distance(point, [start[0] + dx * progress, start[1] + dy * progress]);
}

function distanceToPolygonBoundary(point, polygon) {
  return polygon.reduce((nearest, start, index) => Math.min(
    nearest,
    distanceToSegment(point, start, polygon[(index + 1) % polygon.length])
  ), Infinity);
}

function polygonBounds(polygon) {
  const xs = polygon.map(point => point[0]);
  const ys = polygon.map(point => point[1]);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys)
  };
}

function ellipseRadius(angle, orientation, majorRadius, minorRadius) {
  const local = angle - orientation;
  const cosine = Math.cos(local);
  const sine = Math.sin(local);
  return 1 / Math.sqrt(
    cosine * cosine / (majorRadius * majorRadius) +
    sine * sine / (minorRadius * minorRadius)
  );
}

function bunkerRayLimit(center, direction, bunkers, clearance) {
  let nearest = null;
  bunkers.forEach(polygon => {
    const distance = rayPolygonDistance(center, direction, polygon);
    if (distance != null && (nearest == null || distance < nearest)) nearest = distance;
  });
  return nearest == null ? null : Math.max(0, nearest - clearance);
}

export function generateBunkerAwareGreen({
  basePolygon,
  bunkerPolygons = [],
  pinPoints = [],
  courseId = "course",
  holeNumber = 1,
  targetWidthYards = DEFAULT_TARGET_WIDTH_YARDS,
  courseUnitsPerYard = 1 / METERS_TO_YARDS,
  pointCount = DEFAULT_POINT_COUNT
}) {
  const base = safePolygon(basePolygon);
  const bunkers = (Array.isArray(bunkerPolygons) ? bunkerPolygons : [])
    .map(polygon => {
      try { return safePolygon(polygon); } catch { return null; }
    })
    .filter(Boolean);
  const pins = (Array.isArray(pinPoints) ? pinPoints : []).filter(finitePoint).map(point => [Number(point[0]), Number(point[1])]);
  const center = polygonCenter(base);
  const random = seededRandom(`${courseId}:${holeNumber}:green-outline-v1`);
  const orientation = principalAngle(base, center) + (random() - .5) * .28;
  const bounds = polygonBounds(base);
  const existingSpan = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const targetWidth = Math.max(existingSpan, Number(targetWidthYards) * Number(courseUnitsPerYard));
  const majorRadius = targetWidth / 2;
  const minorRadius = majorRadius * (.72 + random() * .2);
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;
  const phaseC = random() * Math.PI * 2;
  const clearance = Math.max(.3, Number(courseUnitsPerYard) * .8);
  const count = Math.max(14, Math.round(Number(pointCount) || DEFAULT_POINT_COUNT));
  const outline = [];

  for (let index = 0; index < count; index += 1) {
    const angle = orientation + index / count * Math.PI * 2;
    const direction = [Math.cos(angle), Math.sin(angle)];
    const baseRadius = rayPolygonDistance(center, direction, base) || existingSpan / 2;
    const naturalRadius = ellipseRadius(angle, orientation, majorRadius, minorRadius) * (
      1 + Math.sin(angle * 2 + phaseA) * .055 +
      Math.sin(angle * 3 + phaseB) * .085 +
      Math.sin(angle * 5 + phaseC) * .04
    );
    const bunkerLimit = bunkerRayLimit(center, direction, bunkers, clearance);
    const mappedFootprintFloor = baseRadius * .9;
    const expandedRadius = Math.max(mappedFootprintFloor, naturalRadius);
    // Nearby bunkers carve an indentation into the generated outline. Retain
    // most of the mapped radial footprint while allowing a genuinely distinct
    // edge; pin zones are protected separately below.
    let radius = bunkerLimit == null
      ? expandedRadius
      : Math.min(expandedRadius, Math.max(mappedFootprintFloor, bunkerLimit));
    const pinRadius = pins.reduce((required, pin) => {
      const dx = pin[0] - center[0];
      const dy = pin[1] - center[1];
      const forward = dx * direction[0] + dy * direction[1];
      const lateral = Math.abs(dx * -direction[1] + dy * direction[0]);
      return forward > 0 && lateral < targetWidth / count * 2.2 ? Math.max(required, forward + clearance * 1.5) : required;
    }, 0);
    radius = Math.max(radius, pinRadius);
    outline.push([center[0] + direction[0] * radius, center[1] + direction[1] * radius]);
  }

  // A pin from the imported map must remain playable even with unusually
  // concave or tightly bunkered source geometry. Widen its local lobe while
  // leaving the rest of the bunker-shaped outline unchanged.
  pins.filter(pin => !pointInPolygon(pin, outline)).forEach(pin => {
    const pinAngle = Math.atan2(pin[1] - center[1], pin[0] - center[0]);
    const normalized = ((pinAngle - orientation) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const nearestIndex = Math.round(normalized / (Math.PI * 2) * count) % count;
    [-1, 0, 1].forEach(offset => {
      const index = (nearestIndex + offset + count) % count;
      const angle = orientation + index / count * Math.PI * 2;
      const direction = [Math.cos(angle), Math.sin(angle)];
      const forward = (pin[0] - center[0]) * direction[0] + (pin[1] - center[1]) * direction[1];
      const currentRadius = Math.hypot(outline[index][0] - center[0], outline[index][1] - center[1]);
      const radius = Math.max(currentRadius, forward + clearance * 2);
      outline[index] = [center[0] + direction[0] * radius, center[1] + direction[1] * radius];
    });
  });

  return outline;
}

export function generatedGreenHole(hole, options = {}) {
  const green = hole?.geometries?.green_complex;
  if (!green?.polygon) return hole;
  const mappedPolygon = safePolygon(green.mapped_polygon || green.polygon);
  const bunkerPolygons = (hole.geometries.hazards || [])
    .filter(hazard => !String(hazard?.lie_catalog_id || "").includes("water"))
    .map(hazard => hazard.polygon);
  const pinPoints = (green.pin_zones || []).map(zone => zone.center_point).filter(finitePoint);
  const polygon = generateBunkerAwareGreen({
    basePolygon: mappedPolygon,
    bunkerPolygons,
    pinPoints,
    courseId: options.courseId,
    holeNumber: options.holeNumber,
    targetWidthYards: options.targetWidthYards,
    courseUnitsPerYard: options.courseUnitsPerYard
  });
  return {
    ...hole,
    geometries: {
      ...hole.geometries,
      green_complex: {
        ...green,
        mapped_polygon: mappedPolygon,
        polygon,
        generated: {
          version: "bunker-aware-green-v1",
          course_id: String(options.courseId || "course"),
          hole_number: Number(options.holeNumber) || 1,
          target_width_yards: Number(options.targetWidthYards) || DEFAULT_TARGET_WIDTH_YARDS
        }
      }
    }
  };
}

export function isHazardFreePinPoint(hole, point) {
  if (!finitePoint(point)) return false;
  const green = hole?.geometries?.green_complex?.polygon;
  if (!Array.isArray(green) || green.length < 3 || !pointInPolygon(point, green)) return false;
  return !(hole.geometries.hazards || []).some(hazard =>
    Array.isArray(hazard?.polygon) && hazard.polygon.length >= 3 && pointInPolygon(point, hazard.polygon)
  );
}

export function ensureHazardFreePinZones(hole, { gridSize = 37 } = {}) {
  const green = hole?.geometries?.green_complex;
  if (!green?.polygon) return hole;
  const polygon = safePolygon(green.polygon);
  const hazards = (hole.geometries.hazards || [])
    .map(hazard => {
      try { return safePolygon(hazard.polygon); } catch { return null; }
    })
    .filter(Boolean);
  const bounds = polygonBounds(polygon);
  const count = Math.max(15, Math.round(Number(gridSize) || 37));
  const candidates = [polygonCenter(polygon)];
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      candidates.push([
        bounds.minX + (column + .5) / count * (bounds.maxX - bounds.minX),
        bounds.minY + (row + .5) / count * (bounds.maxY - bounds.minY)
      ]);
    }
  }
  const safeCandidates = candidates
    .filter(point => pointInPolygon(point, polygon))
    .filter(point => !hazards.some(hazard => pointInPolygon(point, hazard)))
    .map(point => ({
      point,
      clearance: Math.min(
        distanceToPolygonBoundary(point, polygon),
        ...hazards.map(hazard => distanceToPolygonBoundary(point, hazard))
      )
    }));
  if (!safeCandidates.length) {
    throw new Error(`Hole ${hole?.hole_metadata?.hole_number || "?"} has no hazard-free pin location on the green`);
  }
  const zones = (green.pin_zones || []).length
    ? green.pin_zones
    : [{ zone_id: "center", center_point: polygonCenter(polygon), radius_meters: 2.5 }];
  const adjustedZones = zones.map(zone => {
    const requested = finitePoint(zone.center_point) ? zone.center_point.map(Number) : polygonCenter(polygon);
    const requestedSafe = isHazardFreePinPoint(hole, requested);
    const requestedClearance = requestedSafe
      ? Math.min(distanceToPolygonBoundary(requested, polygon), ...hazards.map(hazard => distanceToPolygonBoundary(requested, hazard)))
      : -Infinity;
    const minimumClearance = Math.max(.75, Number(zone.radius_meters) || 2.5);
    if (requestedSafe && requestedClearance >= minimumClearance) {
      return { ...zone, center_point: requested };
    }
    const best = safeCandidates.reduce((winner, candidate) => {
      const score = Math.min(candidate.clearance, minimumClearance * 2) * 5 - distance(candidate.point, requested) * .12;
      return !winner || score > winner.score ? { ...candidate, score } : winner;
    }, null);
    return { ...zone, center_point: [...best.point] };
  });
  return {
    ...hole,
    geometries: {
      ...hole.geometries,
      green_complex: { ...green, pin_zones: adjustedZones }
    }
  };
}
