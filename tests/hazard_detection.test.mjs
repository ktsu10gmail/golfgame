import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCorridorMask,
  buildPolygonMask,
  detectBunkerRegions,
  detectGuidedRegion,
  detectTreeRegions
} from "../packages/editor/hazard_detection.mjs";

function image(width, height, background = [74, 112, 67]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data.set([...background, 255], index * 4);
  }
  return data;
}

function fill(data, width, left, top, right, bottom, color) {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) data.set([...color, 255], (y * width + x) * 4);
  }
}

test("bunker detector finds sand but does not suggest water-colored regions", () => {
  const width = 80;
  const height = 60;
  const data = image(width, height);
  fill(data, width, 12, 18, 26, 28, [194, 169, 104]);
  fill(data, width, 48, 30, 68, 43, [45, 78, 92]);

  const regions = detectBunkerRegions({ data, width, height, minimumPixels: 12 });

  assert.deepEqual(new Set(regions.map(region => region.type)), new Set(["bunker"]));
  assert.equal(regions.length, 1);
  assert.ok(regions.every(region => region.points.length >= 4));
});

test("bunker detector ignores tiny color specks and pixels outside the hole corridor", () => {
  const width = 90;
  const height = 60;
  const data = image(width, height);
  fill(data, width, 4, 4, 7, 7, [194, 169, 104]);
  fill(data, width, 78, 20, 88, 35, [45, 78, 92]);
  fill(data, width, 35, 22, 50, 34, [194, 169, 104]);
  const mask = buildCorridorMask(width, height, [{ x: 10, y: 30 }, { x: 60, y: 30 }], 15);

  const regions = detectBunkerRegions({ data, width, height, allowedMask: mask, minimumPixels: 12 });

  assert.equal(regions.length, 1);
  assert.equal(regions[0].type, "bunker");
});

test("bunker detector validates image input", () => {
  assert.throws(() => detectBunkerRegions({ data: [], width: 5, height: 5 }), /RGBA pixels/);
});

test("tree detector finds distinct dark-green canopy clusters", () => {
  const width = 100;
  const height = 70;
  const data = image(width, height, [132, 170, 103]);
  fill(data, width, 8, 10, 32, 32, [37, 83, 47]);
  fill(data, width, 66, 35, 92, 62, [42, 92, 52]);
  fill(data, width, 44, 28, 50, 34, [194, 169, 104]);

  const regions = detectTreeRegions({ data, width, height, minimumPixels: 24 });

  assert.equal(regions.length, 2);
  assert.ok(regions.every(region => region.type === "trees"));
  assert.ok(regions.every(region => region.points.length >= 4));
});

test("tree corridor keeps a complete cluster when any part touches the route mask", () => {
  const width = 120;
  const height = 70;
  const data = image(width, height, [132, 170, 103]);
  fill(data, width, 42, 8, 82, 34, [37, 83, 47]);
  fill(data, width, 92, 42, 116, 65, [42, 92, 52]);
  const corridor = buildCorridorMask(width, height, [{ x: 10, y: 30 }, { x: 58, y: 30 }], 7);

  const regions = detectTreeRegions({ data, width, height, touchMask: corridor, minimumPixels: 24 });

  assert.equal(regions.length, 1);
  assert.ok(Math.max(...regions[0].points.map(point => point.x)) >= 81,
    "the retained contour must not be clipped at the corridor boundary");
});

test("tree detector rejects dark regions mostly contained by mapped playing surfaces", () => {
  const width = 120;
  const height = 70;
  const data = image(width, height, [132, 170, 103]);
  fill(data, width, 12, 16, 38, 42, [37, 83, 47]);
  fill(data, width, 72, 16, 104, 48, [42, 92, 52]);
  const protectedMask = buildPolygonMask(width, height, [[
    { x: 8, y: 10 }, { x: 45, y: 10 }, { x: 45, y: 50 }, { x: 8, y: 50 }
  ]]);

  const regions = detectTreeRegions({
    data, width, height, rejectMask: protectedMask, maximumRejectFraction: .32, minimumPixels: 24
  });

  assert.equal(regions.length, 1);
  assert.ok(regions[0].points.every(point => point.x > 65));
});

test("tree detector retains a canopy that only overhangs a mapped surface edge", () => {
  const width = 100;
  const height = 60;
  const data = image(width, height, [132, 170, 103]);
  fill(data, width, 35, 12, 65, 45, [37, 83, 47]);
  const protectedMask = buildPolygonMask(width, height, [[
    { x: 0, y: 0 }, { x: 43, y: 0 }, { x: 43, y: 59 }, { x: 0, y: 59 }
  ]]);

  const regions = detectTreeRegions({
    data, width, height, rejectMask: protectedMask, maximumRejectFraction: .32, minimumPixels: 24
  });

  assert.equal(regions.length, 1);
  assert.ok(regions[0].protected_overlap > 0 && regions[0].protected_overlap < .32);
});

test("tree detector keeps small sunlit aerial canopies", () => {
  const width = 100;
  const height = 60;
  const data = image(width, height, [132, 170, 103]);
  fill(data, width, 14, 14, 19, 19, [102, 154, 76]);
  fill(data, width, 62, 33, 68, 39, [91, 142, 69]);

  const regions = detectTreeRegions({ data, width, height, minimumPixels: 12 });

  assert.equal(regions.length, 2);
});

test("tree detector does not duplicate a shadow beside a green crown", () => {
  const width = 90;
  const height = 60;
  const data = image(width, height, [132, 170, 103]);
  fill(data, width, 26, 18, 48, 40, [67, 58, 49]);
  fill(data, width, 34, 25, 40, 31, [43, 91, 48]);

  const regions = detectTreeRegions({ data, width, height, minimumPixels: 12 });

  assert.equal(regions.length, 1);
  assert.ok(regions[0].points.length >= 4);
});

test("tree detector recognizes irregular near-black aerial canopy", () => {
  const width = 90;
  const height = 60;
  const data = image(width, height, [132, 170, 103]);
  fill(data, width, 20, 18, 43, 24, [31, 32, 29]);
  fill(data, width, 27, 12, 35, 38, [26, 29, 25]);

  const [region] = detectTreeRegions({ data, width, height, minimumPixels: 12 });

  assert.ok(region);
  assert.ok(region.points.length >= 4);
});

test("tree allowed mask clips every generated contour away from fairway and green", () => {
  const width = 100;
  const height = 60;
  const data = image(width, height, [132, 170, 103]);
  fill(data, width, 28, 12, 72, 48, [37, 83, 47]);
  const protectedMask = buildPolygonMask(width, height, [[
    { x: 45, y: 0 }, { x: 99, y: 0 }, { x: 99, y: 59 }, { x: 45, y: 59 }
  ]]);
  const allowedMask = Uint8Array.from(protectedMask, value => value ? 0 : 1);

  const regions = detectTreeRegions({ data, width, height, allowedMask, minimumPixels: 24 });

  assert.equal(regions.length, 1);
  assert.ok(regions[0].points.every(point => point.x < 45));
});

test("tree detector rejects invalid image input", () => {
  assert.throws(() => detectTreeRegions({ data: [], width: 5, height: 5 }), /RGBA pixels/);
});

test("guided bunker scan traces only the connected sand containing the hint", () => {
  const width = 100;
  const height = 70;
  const data = image(width, height, [91, 135, 74]);
  fill(data, width, 8, 12, 30, 32, [198, 174, 112]);
  fill(data, width, 68, 38, 94, 62, [201, 178, 116]);

  const region = detectGuidedRegion({ data, width, height, seedX: 18, seedY: 22, type: "bunker" });

  assert.equal(region.type, "bunker");
  assert.ok(region.points.every(point => point.x < 35));
  assert.ok(region.pixels > 300);
});

test("guided tree scan follows the selected canopy cluster", () => {
  const width = 100;
  const height = 70;
  const data = image(width, height, [132, 170, 103]);
  fill(data, width, 7, 9, 34, 34, [38, 84, 48]);
  fill(data, width, 65, 37, 94, 64, [42, 92, 52]);

  const region = detectGuidedRegion({ data, width, height, seedX: 80, seedY: 50, type: "trees" });

  assert.equal(region.type, "trees");
  assert.ok(region.points.every(point => point.x > 60));
  assert.ok(region.pixels > 500);
});

test("guided cart-path scan preserves a connected path bend instead of filling its bounds", () => {
  const width = 100;
  const height = 80;
  const data = image(width, height, [67, 113, 69]);
  fill(data, width, 10, 20, 80, 26, [158, 157, 150]);
  fill(data, width, 10, 20, 18, 65, [158, 157, 150]);

  const region = detectGuidedRegion({ data, width, height, seedX: 14, seedY: 40, type: "cart_path" });
  const area = Math.abs(region.points.reduce((sum, point, index) => {
    const next = region.points[(index + 1) % region.points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);

  assert.equal(region.type, "cart_path");
  assert.ok(region.pixels > 600);
  assert.ok(area < 1000, `expected a concave path outline, got area ${area}`);
  assert.ok(region.points.length >= 6);
});
