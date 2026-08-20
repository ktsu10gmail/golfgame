function finiteSpan(minimum, maximum) {
  return Math.max(Number(maximum) - Number(minimum), 1e-6);
}

export function createUniformMapProjector(bounds, frame) {
  const worldWidth = finiteSpan(bounds.minX, bounds.maxX);
  const worldHeight = finiteSpan(bounds.minY, bounds.maxY);
  const frameWidth = finiteSpan(frame.left, frame.right);
  const frameHeight = finiteSpan(frame.top, frame.bottom);
  const scale = Math.min(frameWidth / worldWidth, frameHeight / worldHeight);
  const worldCenterX = (Number(bounds.minX) + Number(bounds.maxX)) / 2;
  const worldCenterY = (Number(bounds.minY) + Number(bounds.maxY)) / 2;
  const screenCenterX = (Number(frame.left) + Number(frame.right)) / 2;
  const screenCenterY = (Number(frame.top) + Number(frame.bottom)) / 2;

  const x = value => screenCenterX + (Number(value) - worldCenterX) * scale;
  const y = value => screenCenterY - (Number(value) - worldCenterY) * scale;
  const point = ([pointX, pointY]) => [x(pointX), y(pointY)];
  const unproject = (screenX, screenY) => [
    worldCenterX + (Number(screenX) - screenCenterX) / scale,
    worldCenterY - (Number(screenY) - screenCenterY) / scale
  ];

  return { x, y, point, unproject, scale };
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
