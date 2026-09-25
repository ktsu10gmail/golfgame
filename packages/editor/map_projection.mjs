function finiteSpan(minimum, maximum) {
  return Math.max(Number(maximum) - Number(minimum), 1e-6);
}

export function createUniformMapProjector(bounds, frame, options = {}) {
  const worldWidth = finiteSpan(bounds.minX, bounds.maxX);
  const worldHeight = finiteSpan(bounds.minY, bounds.maxY);
  const frameWidth = finiteSpan(frame.left, frame.right);
  const frameHeight = finiteSpan(frame.top, frame.bottom);
  const scale = Math.min(frameWidth / worldWidth, frameHeight / worldHeight);
  const worldCenterX = (Number(bounds.minX) + Number(bounds.maxX)) / 2;
  const worldCenterY = (Number(bounds.minY) + Number(bounds.maxY)) / 2;
  const screenCenterX = (Number(frame.left) + Number(frame.right)) / 2;
  const screenCenterY = (Number(frame.top) + Number(frame.bottom)) / 2;
  const verticalDirection = Number(options.verticalDirection) < 0 ? -1 : 1;

  const x = value => screenCenterX + (Number(value) - worldCenterX) * scale;
  const y = value => screenCenterY - (Number(value) - worldCenterY) * scale * verticalDirection;
  const point = ([pointX, pointY]) => [x(pointX), y(pointY)];
  const unproject = (screenX, screenY) => [
    worldCenterX + (Number(screenX) - screenCenterX) / scale,
    worldCenterY - (Number(screenY) - screenCenterY) / scale * verticalDirection
  ];

  return { x, y, point, unproject, scale };
}

export function uprightHoleCameraBounds(route, frame) {
  if (!Array.isArray(route) || route.length < 2) {
    throw new Error("an upright hole camera requires tee and pin route points");
  }
  const points = route.map(point => {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) {
      throw new Error("upright hole route points must contain finite x and y values");
    }
    return point;
  });
  const tee = points[0];
  const pin = points.at(-1);
  const verticalSpan = Math.max(Math.abs(pin[1] - tee[1]), 1);
  const frameWidth = finiteSpan(frame.left, frame.right);
  const frameHeight = finiteSpan(frame.top, frame.bottom);
  const cameraWidth = verticalSpan * frameWidth / frameHeight;
  const routeXs = points.map(point => point[0]);
  const centerX = (Math.min(...routeXs) + Math.max(...routeXs)) / 2;
  return {
    minX: centerX - cameraWidth / 2,
    maxX: centerX + cameraWidth / 2,
    minY: Math.min(tee[1], pin[1]),
    maxY: Math.max(tee[1], pin[1])
  };
}

function segmentDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) {
    return { distance: Math.hypot(point[0] - start[0], point[1] - start[1]), progress: 0 };
  }
  const progress = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, progress));
  const nearest = [start[0] + dx * clamped, start[1] + dy * clamped];
  return { distance: Math.hypot(point[0] - nearest[0], point[1] - nearest[1]), progress };
}

export function approachHoleCameraBounds({
  ball,
  target,
  greenPolygon = [],
  featurePolygons = [],
  unitsPerYard = 1,
  corridorWidthYards = 55
}) {
  for (const [label, point] of [["ball", ball], ["target", target]]) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) {
      throw new Error(`approach camera ${label} must contain finite coordinates`);
    }
  }
  const validGreen = greenPolygon.filter(point =>
    Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
  );
  const corridorWidth = Math.max(1, corridorWidthYards * unitsPerYard);
  const nearbyPoints = featurePolygons.flatMap(polygon => (Array.isArray(polygon) ? polygon : []))
    .filter(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))
    .filter(point => {
      const proximity = segmentDistance(point, ball, target);
      return proximity.progress >= -.12 && proximity.progress <= 1.12 && proximity.distance <= corridorWidth;
    });
  const points = [ball, target, ...validGreen, ...nearbyPoints];
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const shotDistance = Math.hypot(target[0] - ball[0], target[1] - ball[1]);
  const xPad = Math.max(18 * unitsPerYard, (maxX - minX) * .28, shotDistance * .08);
  const yPad = Math.max(15 * unitsPerYard, (maxY - minY) * .12);
  return {
    minX: minX - xPad,
    maxX: maxX + xPad,
    minY: minY - yPad,
    maxY: maxY + yPad
  };
}

export function imageViewportForWorldBounds(worldBounds, targetProjector, options = {}) {
  const imageWidth = Number(options.imageWidth) || 1000;
  const imageHeight = Number(options.imageHeight) || 1000;
  const sourceFrame = options.sourceFrame || { left: 100, right: 900, top: 50, bottom: 950 };
  const sourceProjector = createUniformMapProjector(worldBounds, sourceFrame);
  const worldTopLeft = sourceProjector.unproject(0, 0);
  const worldBottomRight = sourceProjector.unproject(imageWidth, imageHeight);
  const topLeft = targetProjector.point(worldTopLeft);
  const bottomRight = targetProjector.point(worldBottomRight);
  return {
    x: topLeft[0],
    y: topLeft[1],
    width: bottomRight[0] - topLeft[0],
    height: bottomRight[1] - topLeft[1]
  };
}
