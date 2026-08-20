function rgbToHsv(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return { hue, saturation: max ? delta / max : 0, value: max };
}

function pixelClass(data, offset) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const { hue, saturation, value } = rgbToHsv(red, green, blue);
  const sand = value > .49 && value < .94 && saturation > .08 && saturation < .48 &&
    hue >= 22 && hue <= 68 && green > blue * 1.04 && red > blue * 1.09;
  if (sand) return 1;
  return 0;
}

function denoise(classes, width, height) {
  const result = new Uint8Array(classes.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const type = classes[index];
      if (!type) continue;
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (classes[index + dy * width + dx] === type) neighbors += 1;
        }
      }
      if (neighbors >= 5) result[index] = type;
    }
  }
  return result;
}

function cross(origin, first, second) {
  return (first.x - origin.x) * (second.y - origin.y) -
    (first.y - origin.y) * (second.x - origin.x);
}

function convexHull(points) {
  const unique = [...new Map(points.map(point => [`${point.x},${point.y}`, point])).values()]
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (unique.length <= 3) return unique;
  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (const point of [...unique].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function tracedMaskBoundary(region, width, height) {
  const edges = [];
  const add = (start, end) => edges.push({ start, end });
  for (let index = 0; index < region.length; index += 1) {
    if (!region[index]) continue;
    const x = index % width, y = Math.floor(index / width);
    if (y === 0 || !region[index - width]) add({ x, y }, { x: x + 1, y });
    if (x === width - 1 || !region[index + 1]) add({ x: x + 1, y }, { x: x + 1, y: y + 1 });
    if (y === height - 1 || !region[index + width]) add({ x: x + 1, y: y + 1 }, { x, y: y + 1 });
    if (x === 0 || !region[index - 1]) add({ x, y: y + 1 }, { x, y });
  }
  const key = point => `${point.x},${point.y}`;
  const outgoing = new Map();
  edges.forEach((edge, index) => {
    const start = key(edge.start);
    if (!outgoing.has(start)) outgoing.set(start, []);
    outgoing.get(start).push(index);
  });
  const used = new Set();
  const loops = [];
  edges.forEach((edge, startIndex) => {
    if (used.has(startIndex)) return;
    const loop = [];
    let edgeIndex = startIndex;
    const first = key(edge.start);
    while (!used.has(edgeIndex)) {
      used.add(edgeIndex);
      const current = edges[edgeIndex];
      loop.push(current.start);
      const end = key(current.end);
      if (end === first) break;
      const next = (outgoing.get(end) || []).find(index => !used.has(index));
      if (next == null) break;
      edgeIndex = next;
    }
    if (loop.length >= 3 && key(edges[edgeIndex].end) === first) {
      const simplified = loop.filter((point, index, points) => {
        const previous = points[(index - 1 + points.length) % points.length];
        const next = points[(index + 1) % points.length];
        return (point.x - previous.x) * (next.y - point.y) !== (point.y - previous.y) * (next.x - point.x);
      });
      loops.push(simplified);
    }
  });
  const area = points => Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
  return loops.sort((first, second) => area(second) - area(first))[0] || [];
}

function componentRegions(classes, width, height, minimumPixels, maximumPixels, {
  type = "bunker",
  minimumSolidity = .22,
  touchMask = null,
  rejectMask = null,
  maximumRejectFraction = 1
} = {}) {
  const visited = new Uint8Array(classes.length);
  const regions = [];
  const offsets = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1];
  for (let start = 0; start < classes.length; start += 1) {
    if (visited[start] || classes[start] !== 1) continue;
    const queue = [start];
    visited[start] = 1;
    const pixels = [];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor];
      pixels.push(index);
      const x = index % width;
      for (const offset of offsets) {
        const next = index + offset;
        if (next < 0 || next >= classes.length || visited[next] || classes[next] !== 1) continue;
        const nextX = next % width;
        if (Math.abs(nextX - x) > 1) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    if (pixels.length < minimumPixels || pixels.length > maximumPixels) continue;
    if (touchMask && !pixels.some(index => touchMask[index])) continue;
    const rejectFraction = rejectMask
      ? pixels.reduce((count, index) => count + (rejectMask[index] ? 1 : 0), 0) / pixels.length
      : 0;
    if (rejectFraction > maximumRejectFraction) continue;
    const boundary = pixels.filter(index => {
      const x = index % width;
      const y = Math.floor(index / width);
      return x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        classes[index - 1] !== 1 || classes[index + 1] !== 1 ||
        classes[index - width] !== 1 || classes[index + width] !== 1;
    }).map(index => ({ x: index % width, y: Math.floor(index / width) }));
    const hull = convexHull(boundary);
    if (hull.length < 3) continue;
    const hullArea = Math.abs(hull.reduce((sum, point, index) => {
      const next = hull[(index + 1) % hull.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2);
    const solidity = hullArea ? pixels.length / hullArea : 0;
    if (solidity < minimumSolidity) continue;
    regions.push({
      type,
      pixels: pixels.length,
      confidence: Math.min(.95, .48 + Math.min(.28, pixels.length / 500) + Math.min(.19, solidity * .2)),
      protected_overlap: rejectFraction,
      points: hull
    });
  }
  return regions;
}

function treePixel(data, offset) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const { hue, saturation, value } = rgbToHsv(red, green, blue);
  // Aerial canopies include yellow-green crowns, muted foliage, and deep
  // neutral shadows. Mapped playing surfaces are masked before components
  // form, so this can favor recall without putting trees on a green/fairway.
  const mutedFoliage = hue >= 55 && hue <= 180 && saturation >= .1 && value >= .035 && value <= .64 &&
    green >= red * .94 && green >= blue * .88;
  return mutedFoliage;
}

function darkTreePixel(data, offset) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const { value } = rgbToHsv(red, green, blue);
  return value >= .018 && value <= .3;
}

function regionBounds(region) {
  return {
    minX: Math.min(...region.points.map(point => point.x)),
    maxX: Math.max(...region.points.map(point => point.x)),
    minY: Math.min(...region.points.map(point => point.y)),
    maxY: Math.max(...region.points.map(point => point.y))
  };
}

function regionsNear(first, second, padding = 4) {
  const a = regionBounds(first);
  const b = regionBounds(second);
  return a.minX <= b.maxX + padding && a.maxX + padding >= b.minX &&
    a.minY <= b.maxY + padding && a.maxY + padding >= b.minY;
}

function hueDistance(first, second) {
  const delta = Math.abs(first - second);
  return Math.min(delta, 360 - delta);
}

function guidedPixelMatches(data, offset, seed, type) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const sample = rgbToHsv(red, green, blue);
  const hueTolerance = type === "trees" ? 48 : type === "cart_path" ? 42 : 36;
  const saturationTolerance = type === "trees" ? .38 : type === "cart_path" ? .24 : .3;
  const valueTolerance = type === "trees" ? .26 : type === "cart_path" ? .2 : .28;
  const colorDistance = Math.hypot(red - seed.red, green - seed.green, blue - seed.blue) / 441.7;
  const similar = (seed.hsv.saturation < .1 || sample.saturation < .1 || hueDistance(sample.hue, seed.hsv.hue) <= hueTolerance) &&
    Math.abs(sample.saturation - seed.hsv.saturation) <= saturationTolerance &&
    Math.abs(sample.value - seed.hsv.value) <= valueTolerance &&
    colorDistance <= (type === "trees" ? .31 : type === "cart_path" ? .24 : .3);
  if (!similar) return false;
  if (type === "trees") {
    return sample.hue >= 48 && sample.hue <= 185 && sample.value <= .72 && green >= red * .88;
  }
  if (type === "cart_path") {
    const neutralPavement = sample.saturation <= .2 && sample.value >= .25 && sample.value <= .92;
    const warmPavement = sample.hue >= 12 && sample.hue <= 75 && sample.saturation <= .45 && sample.value >= .28 &&
      red >= green * .9 && green >= blue * .9;
    return neutralPavement || warmPavement;
  }
  return sample.hue >= 12 && sample.hue <= 88 && sample.value >= .34 && sample.saturation <= .68 &&
    red >= blue * .92;
}

function seedColor(data, width, height, seedX, seedY, radius = 2) {
  let red = 0, green = 0, blue = 0, count = 0;
  for (let y = Math.max(0, seedY - radius); y <= Math.min(height - 1, seedY + radius); y += 1) {
    for (let x = Math.max(0, seedX - radius); x <= Math.min(width - 1, seedX + radius); x += 1) {
      const offset = (y * width + x) * 4;
      red += data[offset];
      green += data[offset + 1];
      blue += data[offset + 2];
      count += 1;
    }
  }
  const average = { red: red / count, green: green / count, blue: blue / count };
  average.hsv = rgbToHsv(average.red, average.green, average.blue);
  return average;
}

export function detectGuidedRegion({ data, width, height, seedX, seedY, type }) {
  if (!data || !Number.isInteger(width) || !Number.isInteger(height) || data.length < width * height * 4) {
    throw new Error("guided detection requires RGBA pixels and valid image dimensions");
  }
  if (!new Set(["bunker", "trees", "cart_path"]).has(type)) throw new Error("guided detection supports bunker, trees, or cart path");
  const x = Math.round(seedX), y = Math.round(seedY);
  if (x < 0 || x >= width || y < 0 || y >= height) throw new Error("guided detection point is outside the image");
  const seed = seedColor(data, width, height, x, y);
  const matches = index => guidedPixelMatches(data, index * 4, seed, type);
  let start = y * width + x;
  if (!matches(start)) {
    let nearest = null;
    for (let radius = 1; radius <= 8 && nearest === null; radius += 1) {
      for (let dy = -radius; dy <= radius && nearest === null; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nextX = x + dx, nextY = y + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const candidate = nextY * width + nextX;
          if (matches(candidate)) { nearest = candidate; break; }
        }
      }
    }
    if (nearest === null) throw new Error(`no ${type === "trees" ? "tree canopy" : type === "cart_path" ? "cart-path surface" : "sand"} was recognized near that point`);
    start = nearest;
  }
  const visited = new Uint8Array(width * height);
  const queue = [start];
  const pixels = [];
  visited[start] = 1;
  const maximumPixels = Math.floor(width * height * (type === "bunker" ? .08 : type === "cart_path" ? .18 : .38));
  const startX = start % width, startY = Math.floor(start / width);
  const maximumRadius = type === "bunker" ? Math.max(12, Math.min(width, height) * .08) : Infinity;
  const neighborOffsets = type === "cart_path"
    ? [[0,-1],[-1,0],[1,0],[0,1]]
    : [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
  for (let cursor = 0; cursor < queue.length && pixels.length <= maximumPixels; cursor += 1) {
    const index = queue[cursor];
    pixels.push(index);
    const currentX = index % width, currentY = Math.floor(index / width);
    for (const [dx, dy] of neighborOffsets) {
      const nextX = currentX + dx, nextY = currentY + dy;
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
      if (Math.hypot(nextX - startX, nextY - startY) > maximumRadius) continue;
      const next = nextY * width + nextX;
      if (visited[next] || !matches(next)) continue;
      visited[next] = 1;
      queue.push(next);
    }
  }
  if (pixels.length < 10) throw new Error(`the ${type === "trees" ? "tree" : type === "cart_path" ? "cart path" : "bunker"} region is too small to trace`);
  if (pixels.length > maximumPixels) throw new Error("the detected region spread too far; click closer to the feature center");
  const region = new Uint8Array(width * height);
  pixels.forEach(index => { region[index] = 1; });
  const boundary = pixels.filter(index => {
    const px = index % width, py = Math.floor(index / width);
    return px === 0 || py === 0 || px === width - 1 || py === height - 1 ||
      !region[index - 1] || !region[index + 1] || !region[index - width] || !region[index + width];
  }).map(index => ({ x: index % width, y: Math.floor(index / width) }));
  const points = type === "cart_path" ? tracedMaskBoundary(region, width, height) : convexHull(boundary);
  if (points.length < 3) throw new Error("the detected region does not have a usable boundary");
  const hullArea = Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
  const solidity = hullArea ? pixels.length / hullArea : 0;
  if (type === "bunker" && solidity < .3) {
    throw new Error("the connected area looks like a path rather than a bunker; click farther inside the sand");
  }
  return {
    type,
    pixels: pixels.length,
    confidence: Math.min(.97, .62 + Math.min(.3, pixels.length / 1200)),
    solidity,
    points
  };
}

export function detectTreeRegions({
  data, width, height, allowedMask = null, touchMask = null, rejectMask = null,
  maximumRejectFraction = .35, minimumPixels = 28
}) {
  if (!data || !Number.isInteger(width) || !Number.isInteger(height) || data.length < width * height * 4) {
    throw new Error("tree detection requires RGBA pixels and valid image dimensions");
  }
  const classes = new Uint8Array(width * height);
  const shadowClasses = new Uint8Array(width * height);
  let allowedCount = 0;
  for (let index = 0; index < classes.length; index += 1) {
    if (allowedMask && !allowedMask[index]) continue;
    allowedCount += 1;
    classes[index] = treePixel(data, index * 4) ? 1 : 0;
    shadowClasses[index] = darkTreePixel(data, index * 4) ? 1 : 0;
  }
  const cleaned = denoise(classes, width, height);
  const cleanedShadows = denoise(shadowClasses, width, height);
  const maximumPixels = Math.max(minimumPixels + 1, Math.floor(allowedCount * .48));
  const options = {
    type: "trees",
    minimumSolidity: .07,
    touchMask,
    rejectMask,
    maximumRejectFraction
  };
  const foliage = componentRegions(cleaned, width, height, minimumPixels, maximumPixels, options);
  const shadows = componentRegions(cleanedShadows, width, height, minimumPixels, maximumPixels, options)
    .filter(shadow => !foliage.some(region => regionsNear(shadow, region)));
  return [...foliage, ...shadows]
    .sort((first, second) => second.pixels - first.pixels || second.confidence - first.confidence);
}

export function detectBunkerRegions({ data, width, height, allowedMask = null, minimumPixels = 16 }) {
  if (!data || !Number.isInteger(width) || !Number.isInteger(height) || data.length < width * height * 4) {
    throw new Error("bunker detection requires RGBA pixels and valid image dimensions");
  }
  const classes = new Uint8Array(width * height);
  let allowedCount = 0;
  for (let index = 0; index < classes.length; index += 1) {
    if (allowedMask && !allowedMask[index]) continue;
    allowedCount += 1;
    classes[index] = pixelClass(data, index * 4);
  }
  const cleaned = denoise(classes, width, height);
  const maximumPixels = Math.max(minimumPixels + 1, Math.floor(allowedCount * .16));
  return componentRegions(cleaned, width, height, minimumPixels, maximumPixels)
    .sort((first, second) => second.confidence - first.confidence);
}

export function buildCorridorMask(width, height, route, radiusPixels) {
  const mask = new Uint8Array(width * height);
  if (!Array.isArray(route) || route.length < 2) return mask;
  const radiusSquared = radiusPixels ** 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let segment = 1; segment < route.length; segment += 1) {
        const first = route[segment - 1];
        const second = route[segment];
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const lengthSquared = dx * dx + dy * dy;
        const amount = lengthSquared
          ? Math.max(0, Math.min(1, ((x - first.x) * dx + (y - first.y) * dy) / lengthSquared))
          : 0;
        const nearestX = first.x + amount * dx;
        const nearestY = first.y + amount * dy;
        if ((x - nearestX) ** 2 + (y - nearestY) ** 2 <= radiusSquared) {
          mask[y * width + x] = 1;
          break;
        }
      }
    }
  }
  return mask;
}

export function buildPolygonMask(width, height, polygons) {
  const mask = new Uint8Array(width * height);
  const usable = (Array.isArray(polygons) ? polygons : [])
    .filter(polygon => Array.isArray(polygon) && polygon.length >= 3);
  const contains = (x, y, polygon) => {
    let inside = false;
    let previous = polygon.at(-1);
    for (const current of polygon) {
      if ((current.y > y) !== (previous.y > y) &&
          x < (previous.x - current.x) * (y - current.y) /
            (previous.y - current.y) + current.x) inside = !inside;
      previous = current;
    }
    return inside;
  };
  usable.forEach(polygon => {
    const minX = Math.max(0, Math.floor(Math.min(...polygon.map(point => point.x))));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(...polygon.map(point => point.x))));
    const minY = Math.max(0, Math.floor(Math.min(...polygon.map(point => point.y))));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(...polygon.map(point => point.y))));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (contains(x + .5, y + .5, polygon)) mask[y * width + x] = 1;
      }
    }
  });
  return mask;
}
