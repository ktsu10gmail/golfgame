import test from "node:test";
import assert from "node:assert/strict";
import { createUniformMapProjector, imageViewportForWorldBounds } from "../packages/editor/map_projection.mjs";

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
