import test from "node:test";
import assert from "node:assert/strict";
import {
  approachHoleCameraBounds,
  createUniformMapProjector,
  imageViewportForWorldBounds,
  uprightHoleCameraBounds
} from "../packages/editor/map_projection.mjs";

test("approach camera ignores distant vertices from a course-wide surface", () => {
  const ball = [-42, 241];
  const target = [0, 348];
  const bounds = approachHoleCameraBounds({
    ball,
    target,
    greenPolygon: [[-12, 338], [12, 338], [12, 360], [-12, 360]],
    featurePolygons: [
      [[-86, -79], [-40, 238], [52, 368], [20, 402]],
      [[-36, 236], [-29, 259], [-22, 281]]
    ],
    unitsPerYard: 1 / 1.09361
  });

  assert.ok(bounds.minY > 150, `camera reached too far behind the ball: ${bounds.minY}`);
  assert.ok(bounds.maxY < 390, `camera reached too far beyond the green: ${bounds.maxY}`);
  assert.ok(bounds.minX > -90, `camera included a distant course edge: ${bounds.minX}`);
  assert.ok(bounds.maxX < 50, `camera included a distant course edge: ${bounds.maxX}`);
});

test("approach camera retains nearby hazards within the playing corridor", () => {
  const bounds = approachHoleCameraBounds({
    ball: [0, 100],
    target: [0, 220],
    greenPolygon: [[-10, 210], [10, 210], [10, 230], [-10, 230]],
    featurePolygons: [[[-38, 155], [-30, 160], [-34, 170]]],
    unitsPerYard: 1
  });
  assert.ok(bounds.minX < -38);
  assert.ok(bounds.maxY > 230);
});

test("game map preserves one physical scale in both directions", () => {
  const projector = createUniformMapProjector(
    { minX: -50, maxX: 50, minY: 0, maxY: 400 },
    { left: 100, right: 900, top: 50, bottom: 950 }
  );
  const origin = projector.point([0, 0]);
  const tenRight = projector.point([10, 0]);
  const tenForward = projector.point([0, 10]);
  assert.equal(Math.abs(tenRight[0] - origin[0]), Math.abs(tenForward[1] - origin[1]));
});

test("game map click inverse returns the mapped course point", () => {
  const projector = createUniformMapProjector(
    { minX: -80, maxX: 60, minY: -20, maxY: 330 },
    { left: 70, right: 630, top: 118, bottom: 970 }
  );
  const coursePoint = [17.25, 208.5];
  const screenPoint = projector.point(coursePoint);
  const recovered = projector.unproject(...screenPoint);
  assert.ok(Math.abs(recovered[0] - coursePoint[0]) < 1e-9);
  assert.ok(Math.abs(recovered[1] - coursePoint[1]) < 1e-9);
});

test("generated artwork viewport stays aligned with uniform game geometry", () => {
  const bounds = { minX: -55, maxX: 65, minY: -20, maxY: 320 };
  const target = createUniformMapProjector(bounds, { left: 100, right: 900, top: 50, bottom: 950 });
  const viewport = imageViewportForWorldBounds(bounds, target);
  assert.ok(Math.abs(viewport.x) < 1e-9);
  assert.ok(Math.abs(viewport.y) < 1e-9);
  assert.ok(Math.abs(viewport.width - 1000) < 1e-9);
  assert.ok(Math.abs(viewport.height - 1000) < 1e-9);
});

test("upright full-hole camera places tee at bottom and pin at top across 90 percent of the viewport", () => {
  const frame = { left: 100, right: 900, top: 50, bottom: 950 };
  const route = [[0, 0], [28, 180], [12, 400]];
  const bounds = uprightHoleCameraBounds(route, frame);
  const projector = createUniformMapProjector(bounds, frame, { verticalDirection: 1 });
  assert.equal(projector.point(route[0])[1], 950);
  assert.equal(projector.point(route.at(-1))[1], 50);
  assert.equal(Math.abs(projector.point(route.at(-1))[1] - projector.point(route[0])[1]), 900);
});

test("upright full-hole camera flips a reversed legacy route so its tee remains at the bottom", () => {
  const frame = { left: 70, right: 630, top: 70, bottom: 970 };
  const route = [[5, 400], [20, 220], [10, 0]];
  const bounds = uprightHoleCameraBounds(route, frame);
  const projector = createUniformMapProjector(bounds, frame, { verticalDirection: -1 });
  assert.ok(Math.abs(projector.point(route[0])[1] - 970) < 1e-9);
  assert.ok(Math.abs(projector.point(route.at(-1))[1] - 70) < 1e-9);
  const recovered = projector.unproject(...projector.point(route[1]));
  assert.ok(Math.abs(recovered[0] - route[1][0]) < 1e-9);
  assert.ok(Math.abs(recovered[1] - route[1][1]) < 1e-9);
});
