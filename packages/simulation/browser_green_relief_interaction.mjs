function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [x, y] = polygon[index];
    const [previousX, previousY] = polygon[previous];
    const crosses = ((y > point[1]) !== (previousY > point[1])) &&
      (point[0] < (previousX - x) * (point[1] - y) / ((previousY - y) || 1e-9) + x);
    if (crosses) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const fraction = lengthSquared
    ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared))
    : 0;
  return Math.hypot(point[0] - (start[0] + dx * fraction), point[1] - (start[1] + dy * fraction));
}

function pointTouchesPolygon(point, polygon, tolerance = 7) {
  if (pointInPolygon(point, polygon)) return true;
  return polygon.some((start, index) =>
    distanceToSegment(point, start, polygon[(index + 1) % polygon.length]) <= tolerance
  );
}

export function enlargedGreenFocusBounds({ greenPolygon, ball, pin, zoom = 1 }) {
  if (!Array.isArray(greenPolygon) || greenPolygon.length < 3) {
    throw new Error("greenPolygon needs at least three points");
  }
  const validPoint = point => Array.isArray(point) && point.length >= 2 && point.every(Number.isFinite);
  if (!greenPolygon.every(validPoint) || !validPoint(ball) || !validPoint(pin)) {
    throw new Error("green, ball, and pin points must be finite");
  }

  const xs = greenPolygon.map(point => point[0]);
  const ys = greenPolygon.map(point => point[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 12);
  const requestedZoom = Math.max(1, Math.min(5, Number(zoom) || 1));
  const centerX = (ball[0] + pin[0]) / 2;
  const centerY = (ball[1] + pin[1]) / 2;
  const pairSpanX = Math.abs(pin[0] - ball[0]);
  const pairSpanY = Math.abs(pin[1] - ball[1]);
  const pairSpan = Math.hypot(pairSpanX, pairSpanY);
  const markerMargin = Math.max(span * .06, pairSpan * .12, .8);
  const requestedHalfView = (span / 2 + span * .16) / requestedZoom;
  const halfView = Math.max(
    requestedHalfView,
    pairSpanX / 2 + markerMargin,
    pairSpanY / 2 + markerMargin
  );

  return {
    minX: centerX - halfView,
    maxX: centerX + halfView,
    minY: centerY - halfView,
    maxY: centerY + halfView,
    center: [centerX, centerY],
    requestedZoom,
    effectiveZoom: (span / 2 + span * .16) / halfView
  };
}

export function projectedPairCenterOffset(projectedBall, projectedPin, viewportCenter = [500, 500]) {
  const validPoint = point => Array.isArray(point) && point.length >= 2 && point.every(Number.isFinite);
  if (![projectedBall, projectedPin, viewportCenter].every(validPoint)) {
    throw new Error("projected points and viewport center must be finite");
  }
  return [
    viewportCenter[0] - (projectedBall[0] + projectedPin[0]) / 2,
    viewportCenter[1] - (projectedBall[1] + projectedPin[1]) / 2
  ];
}

export function closestProjectedPolygonPoint(screenPoint, polygon, project, options = {}) {
  if (!Array.isArray(screenPoint) || screenPoint.length < 2 ||
      !Array.isArray(polygon) || polygon.length < 3 || typeof project !== "function") return null;

  // Keep Array.map's index out of projectors that accept an optional second
  // parameter (for example, the green relief projector's explicit height).
  const projectedPolygon = polygon.map(point => project(point));
  if (!pointTouchesPolygon(screenPoint, projectedPolygon, options.edgeTolerance ?? 7)) return null;

  const xs = polygon.map(point => point[0]);
  const ys = polygon.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const divisions = Math.max(12, Math.round(options.divisions ?? 32));
  let best = null;

  const consider = point => {
    if (!pointTouchesPolygon(point, polygon, 1e-7)) return;
    const projected = project(point);
    const error = (projected[0] - screenPoint[0]) ** 2 + (projected[1] - screenPoint[1]) ** 2;
    if (!best || error < best.error) best = { point, error };
  };

  for (let row = 0; row <= divisions; row += 1) {
    for (let column = 0; column <= divisions; column += 1) {
      consider([
        minX + column / divisions * (maxX - minX),
        minY + row / divisions * (maxY - minY)
      ]);
    }
  }
  polygon.forEach(consider);
  if (!best) return null;

  let stepX = (maxX - minX) / divisions;
  let stepY = (maxY - minY) / divisions;
  const refinements = Math.max(1, Math.round(options.refinements ?? 8));
  for (let iteration = 0; iteration < refinements; iteration += 1) {
    const center = best.point;
    for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        consider([center[0] + xOffset * stepX, center[1] + yOffset * stepY]);
      }
    }
    stepX /= 2;
    stepY /= 2;
  }
  return [...best.point];
}
