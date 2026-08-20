const EPSILON = 1e-9;

function cross(first, second) {
  return first[0] * second[1] - first[1] * second[0];
}

function subtract(first, second) {
  return [first[0] - second[0], first[1] - second[1]];
}

function interpolate(start, end, amount) {
  return [
    start[0] + (end[0] - start[0]) * amount,
    start[1] + (end[1] - start[1]) * amount
  ];
}

function polygonArea(points) {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function normalizedPolygon(points) {
  const polygon = points.map(point => [Number(point[0]), Number(point[1])]);
  return polygonArea(polygon) < 0 ? polygon.reverse() : polygon;
}

function parameterOnSegment(point, start, end) {
  const delta = subtract(end, start);
  const lengthSquared = delta[0] ** 2 + delta[1] ** 2;
  if (lengthSquared < EPSILON) return 0;
  return ((point[0] - start[0]) * delta[0] + (point[1] - start[1]) * delta[1]) / lengthSquared;
}

function segmentIntersections(first, second) {
  const r = subtract(first.end, first.start);
  const s = subtract(second.end, second.start);
  const offset = subtract(second.start, first.start);
  const denominator = cross(r, s);
  if (Math.abs(denominator) > EPSILON) {
    const t = cross(offset, s) / denominator;
    const u = cross(offset, r) / denominator;
    return t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON
      ? [{ t: Math.max(0, Math.min(1, t)), u: Math.max(0, Math.min(1, u)) }]
      : [];
  }
  if (Math.abs(cross(offset, r)) > EPSILON) return [];
  const candidates = [
    { point: first.start, t: 0, u: parameterOnSegment(first.start, second.start, second.end) },
    { point: first.end, t: 1, u: parameterOnSegment(first.end, second.start, second.end) },
    { point: second.start, t: parameterOnSegment(second.start, first.start, first.end), u: 0 },
    { point: second.end, t: parameterOnSegment(second.end, first.start, first.end), u: 1 }
  ];
  return candidates
    .filter(candidate => candidate.t >= -EPSILON && candidate.t <= 1 + EPSILON && candidate.u >= -EPSILON && candidate.u <= 1 + EPSILON)
    .map(candidate => ({ t: Math.max(0, Math.min(1, candidate.t)), u: Math.max(0, Math.min(1, candidate.u)) }));
}

function pointOnSegment(point, start, end, tolerance) {
  const segment = subtract(end, start);
  const offset = subtract(point, start);
  if (Math.abs(cross(segment, offset)) > tolerance * Math.max(1, Math.hypot(...segment))) return false;
  const projection = offset[0] * segment[0] + offset[1] * segment[1];
  return projection >= -tolerance && projection <= segment[0] ** 2 + segment[1] ** 2 + tolerance;
}

function pointInPolygon(point, polygon, tolerance) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous], end = polygon[index];
    if (pointOnSegment(point, start, end, tolerance)) return true;
    if ((end[1] > point[1]) !== (start[1] > point[1]) &&
        point[0] < (start[0] - end[0]) * (point[1] - end[1]) / (start[1] - end[1]) + end[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function uniqueSorted(values) {
  return [...values].sort((first, second) => first - second)
    .filter((value, index, sorted) => index === 0 || Math.abs(value - sorted[index - 1]) > 1e-8);
}

function simplifyLoop(points, tolerance) {
  if (points.length < 4) return points;
  return points.filter((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const first = subtract(point, previous);
    const second = subtract(next, point);
    return Math.abs(cross(first, second)) > tolerance * Math.max(1, Math.hypot(...first), Math.hypot(...second));
  });
}

export function unionSimplePolygons(inputPolygons) {
  if (!Array.isArray(inputPolygons) || inputPolygons.length < 2 ||
      inputPolygons.some(polygon => !Array.isArray(polygon) || polygon.length < 3)) {
    throw new Error("polygon union requires at least two valid polygons");
  }
  const polygons = inputPolygons.map(normalizedPolygon);
  const allPoints = polygons.flat();
  const xs = allPoints.map(point => point[0]), ys = allPoints.map(point => point[1]);
  const diagonal = Math.max(1, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
  const tolerance = diagonal * 1e-7;
  const sampleOffset = diagonal * 1e-5;
  const segments = polygons.flatMap((polygon, polygonIndex) => polygon.map((start, edgeIndex) => ({
    polygonIndex,
    start,
    end: polygon[(edgeIndex + 1) % polygon.length],
    splits: [0, 1]
  })));

  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const first = segments[firstIndex], second = segments[secondIndex];
      if (first.polygonIndex === second.polygonIndex) continue;
      for (const intersection of segmentIntersections(first, second)) {
        first.splits.push(intersection.t);
        second.splits.push(intersection.u);
      }
    }
  }

  const contains = point => polygons.some(polygon => pointInPolygon(point, polygon, tolerance));
  const boundary = [];
  for (const segment of segments) {
    const splits = uniqueSorted(segment.splits);
    for (let index = 0; index < splits.length - 1; index += 1) {
      let start = interpolate(segment.start, segment.end, splits[index]);
      let end = interpolate(segment.start, segment.end, splits[index + 1]);
      const delta = subtract(end, start);
      const length = Math.hypot(...delta);
      if (length <= tolerance) continue;
      const midpoint = interpolate(start, end, .5);
      const normal = [-delta[1] / length * sampleOffset, delta[0] / length * sampleOffset];
      const leftInside = contains([midpoint[0] + normal[0], midpoint[1] + normal[1]]);
      const rightInside = contains([midpoint[0] - normal[0], midpoint[1] - normal[1]]);
      if (leftInside === rightInside) continue;
      if (!leftInside) [start, end] = [end, start];
      boundary.push({ start, end });
    }
  }

  const snap = point => `${Math.round(point[0] / tolerance)},${Math.round(point[1] / tolerance)}`;
  const uniqueBoundary = [...new Map(boundary.map(segment => {
    const ends = [snap(segment.start), snap(segment.end)].sort();
    return [`${ends[0]}|${ends[1]}`, segment];
  })).values()];
  const outgoing = new Map();
  uniqueBoundary.forEach((segment, index) => {
    const key = snap(segment.start);
    if (!outgoing.has(key)) outgoing.set(key, []);
    outgoing.get(key).push(index);
  });

  const used = new Set();
  const loops = [];
  for (let startIndex = 0; startIndex < uniqueBoundary.length; startIndex += 1) {
    if (used.has(startIndex)) continue;
    const loop = [];
    let segmentIndex = startIndex;
    const firstKey = snap(uniqueBoundary[startIndex].start);
    while (!used.has(segmentIndex)) {
      used.add(segmentIndex);
      const segment = uniqueBoundary[segmentIndex];
      loop.push(segment.start);
      const endKey = snap(segment.end);
      if (endKey === firstKey) break;
      const next = (outgoing.get(endKey) || []).find(candidate => !used.has(candidate));
      if (next == null) break;
      segmentIndex = next;
    }
    if (loop.length >= 3 && snap(uniqueBoundary[segmentIndex].end) === firstKey) {
      loops.push(simplifyLoop(loop, tolerance));
    }
  }
  return loops.filter(loop => loop.length >= 3).sort((first, second) => Math.abs(polygonArea(second)) - Math.abs(polygonArea(first)));
}
