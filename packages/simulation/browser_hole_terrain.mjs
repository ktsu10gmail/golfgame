function finitePoint(point) {
  return Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(value => Number.isFinite(Number(value)));
}

function finiteBounds(bounds) {
  return bounds && [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(value => Number.isFinite(Number(value))) &&
    bounds.maxX > bounds.minX && bounds.maxY > bounds.minY;
}

function bounded(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value)));
}

export function createHoleTerrainProjection({
  bounds,
  elevationAt = () => 0,
  cameraStart = null,
  cameraTarget = null,
  yawDegrees = 0,
  tiltDegrees = 50,
  centerX = 500,
  bottom = 905,
  elevationExaggeration = 1.3
}) {
  if (!finiteBounds(bounds)) throw new Error("terrain bounds must be finite and non-empty");
  if (typeof elevationAt !== "function") throw new Error("elevationAt must be a function");
  const fallbackStart = [(bounds.minX + bounds.maxX) / 2, bounds.minY];
  const fallbackTarget = [(bounds.minX + bounds.maxX) / 2, bounds.maxY];
  const start = finitePoint(cameraStart) ? cameraStart.map(Number) : fallbackStart;
  const target = finitePoint(cameraTarget) ? cameraTarget.map(Number) : fallbackTarget;
  const baseDx = target[0] - start[0];
  const baseDy = target[1] - start[1];
  const baseLength = Math.hypot(baseDx, baseDy) || 1;
  const offset = Number(yawDegrees) * Math.PI / 180;
  const baseForward = [baseDx / baseLength, baseDy / baseLength];
  const forward = [
    baseForward[0] * Math.cos(offset) - baseForward[1] * Math.sin(offset),
    baseForward[0] * Math.sin(offset) + baseForward[1] * Math.cos(offset)
  ];
  const right = [forward[1], -forward[0]];
  const tilt = bounded(tiltDegrees, 32, 68);
  const corners = [
    [bounds.minX, bounds.minY], [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY]
  ];
  const courseCoordinates = point => {
    const dx = Number(point[0]) - start[0];
    const dy = Number(point[1]) - start[1];
    return { lateral: dx * right[0] + dy * right[1], forward: dx * forward[0] + dy * forward[1] };
  };
  const cornerCoordinates = corners.map(courseCoordinates);
  // The lens follows the shot that the player is planning. Features elsewhere
  // in a large source polygon must not make a 100-yard approach look like a
  // full 500-yard hole from orbit.
  const forwardSpan = Math.max(20, baseLength * 1.15);
  // Keep the ball near the bottom of the frame at every shot length. A fixed
  // five-yard setback overwhelms the lens when the cup is only a few yards
  // away and pushes the ball halfway up the screen.
  const setback = bounded(forwardSpan * .025, .5, 14);
  const focalDepth = forwardSpan * (.13 + (tilt - 32) / 36 * .11);
  const usableHeight = 735 - (tilt - 50) * 4.2;
  const maximumLateral = Math.max(12, ...cornerCoordinates.map(point => Math.abs(point.lateral)));
  const nearPerspective = .3 + .7 * focalDepth / (focalDepth + setback);
  const horizontalScale = 820 / Math.max(maximumLateral * 2 * nearPerspective, 1);
  const sampledElevations = [...corners, start, target].map(point => Number(elevationAt(point)) || 0);
  const elevationBase = Number(elevationAt(start)) || Math.min(...sampledElevations);

  const depthFor = point => courseCoordinates(point).forward + setback;
  const perspectiveAt = point => {
    const depth = Math.max(-focalDepth * .72, depthFor(point));
    // A green can extend behind the ball once the player reaches the putting
    // surface. A pin-focused perspective must not enlarge that foreground
    // portion into a giant strip, so keep the near lens photographic rather
    // than allowing the reciprocal depth curve to explode.
    return bounded(.3 + .7 * focalDepth / Math.max(focalDepth + depth, focalDepth * .28), .3, 1.18);
  };
  const groundProgressAt = point => {
    const depth = Math.max(-focalDepth * .72, depthFor(point));
    return bounded(depth / Math.max(depth + focalDepth, focalDepth * .28), -.12, .92);
  };

  const project = (point, options = {}) => {
    if (!finitePoint(point)) throw new Error("terrain point must be finite");
    const coordinate = courseCoordinates(point);
    const perspective = perspectiveAt(point);
    const elevation = Number.isFinite(Number(options.elevationMeters))
      ? Number(options.elevationMeters)
      : Number(elevationAt(point)) || 0;
    const airLiftPixels = Math.max(0, Number(options.airLiftPixels) || 0);
    const elevationLift = (elevation - elevationBase) * horizontalScale * Number(elevationExaggeration) * perspective;
    return [
      Number(centerX) + coordinate.lateral * horizontalScale * perspective,
      Number(bottom) - groundProgressAt(point) * usableHeight - elevationLift - airLiftPixels
    ];
  };

  return {
    project,
    perspectiveAt,
    scale: horizontalScale,
    centerX: Number(centerX),
    elevationBase,
    corners,
    cameraStart: [...start],
    cameraTarget: [...target],
    forward,
    right
  };
}

export function closestProjectedTerrainPoint(screenPoint, bounds, project, options = {}) {
  if (!finitePoint(screenPoint) || !finiteBounds(bounds) || typeof project !== "function") return null;
  const divisions = Math.max(16, Math.round(Number(options.divisions) || 42));
  let best = null;
  const consider = point => {
    if (point[0] < bounds.minX || point[0] > bounds.maxX || point[1] < bounds.minY || point[1] > bounds.maxY) return;
    const projected = project(point);
    const error = (projected[0] - screenPoint[0]) ** 2 + (projected[1] - screenPoint[1]) ** 2;
    if (!best || error < best.error) best = { point, error };
  };
  for (let row = 0; row <= divisions; row += 1) {
    for (let column = 0; column <= divisions; column += 1) {
      consider([
        bounds.minX + column / divisions * (bounds.maxX - bounds.minX),
        bounds.minY + row / divisions * (bounds.maxY - bounds.minY)
      ]);
    }
  }
  if (!best) return null;
  let stepX = (bounds.maxX - bounds.minX) / divisions;
  let stepY = (bounds.maxY - bounds.minY) / divisions;
  for (let iteration = 0; iteration < Math.max(2, Math.round(Number(options.refinements) || 7)); iteration += 1) {
    const centerPoint = [...best.point];
    for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        consider([centerPoint[0] + xOffset * stepX, centerPoint[1] + yOffset * stepY]);
      }
    }
    stepX /= 2;
    stepY /= 2;
  }
  const maximumError = Number(options.maxErrorPixels);
  if (Number.isFinite(maximumError) && Math.sqrt(best.error) > maximumError) return null;
  return [...best.point];
}

export function fullShotAnimationDurationMs(totalYards, { compact = false } = {}) {
  const yards = Math.max(0, Number(totalYards) || 0);
  const desktopDuration = bounded(1900 + yards * 10, 2400, 4600);
  return Math.round(compact
    ? bounded(desktopDuration * 1.45, 3400, 6800)
    : desktopDuration);
}

export function projectedBallFlight({ carry = [], roll = [], project, clubName = "" }) {
  if (typeof project !== "function") return [];
  const carryPoints = (Array.isArray(carry) ? carry : []).filter(finitePoint);
  const rollPoints = (Array.isArray(roll) ? roll : []).filter(finitePoint);
  if (carryPoints.length < 2) return [...carryPoints, ...rollPoints].map(point => project(point));
  const carryScreen = carryPoints.map(point => project(point));
  const chord = Math.hypot(
    carryScreen.at(-1)[0] - carryScreen[0][0],
    carryScreen.at(-1)[1] - carryScreen[0][1]
  );
  const lowerFlight = /putter|chip|sand wedge|lob wedge/i.test(String(clubName));
  const peak = bounded(chord * (lowerFlight ? .13 : .23), lowerFlight ? 34 : 58, lowerFlight ? 105 : 165);
  const airborne = carryPoints.map((point, index) => project(point, {
    airLiftPixels: Math.sin(index / (carryPoints.length - 1) * Math.PI) * peak
  }));
  const groundedRoll = rollPoints.length > 1
    ? rollPoints.slice(1).map(point => project(point))
    : [];
  return [...airborne, ...groundedRoll];
}
