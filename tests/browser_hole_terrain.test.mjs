import test from "node:test";
import assert from "node:assert/strict";

import {
  closestProjectedTerrainPoint,
  createHoleTerrainProjection,
  fullShotAnimationDurationMs,
  projectedBallFlight
} from "../packages/simulation/browser_hole_terrain.mjs";

const bounds = { minX: -20, maxX: 80, minY: 0, maxY: 240 };

test("terrain projection and inverse recover a selected course point", () => {
  const terrain = createHoleTerrainProjection({ bounds, elevationAt: ([, y]) => y * .03 });
  const expected = [27.5, 168.25];
  const recovered = closestProjectedTerrainPoint(terrain.project(expected), bounds, terrain.project);
  assert.ok(recovered);
  assert.ok(Math.abs(recovered[0] - expected[0]) < .05);
  assert.ok(Math.abs(recovered[1] - expected[1]) < .05);
});

test("terrain inverse rejects clicks far outside the course tabletop", () => {
  const terrain = createHoleTerrainProjection({ bounds, elevationAt: () => 0 });
  assert.equal(closestProjectedTerrainPoint([5, 5], bounds, terrain.project, { maxErrorPixels: 20 }), null);
});

test("bird's-eye perspective makes the distant fairway narrower", () => {
  const terrain = createHoleTerrainProjection({
    bounds,
    cameraStart: [30, 0],
    cameraTarget: [30, 240],
    elevationAt: () => 0
  });
  const nearWidth = Math.abs(terrain.project([50, 25])[0] - terrain.project([10, 25])[0]);
  const farWidth = Math.abs(terrain.project([50, 220])[0] - terrain.project([10, 220])[0]);
  assert.ok(nearWidth > farWidth * 1.5);
  assert.ok(terrain.project([30, 25])[1] > terrain.project([30, 220])[1]);
});

test("bird's-eye perspective keeps the green behind the ball proportionate", () => {
  const puttingTerrain = createHoleTerrainProjection({
    bounds,
    cameraStart: [30, 210],
    cameraTarget: [30, 220],
    elevationAt: () => 0
  });
  const ballWidth = Math.abs(puttingTerrain.project([40, 210])[0] - puttingTerrain.project([20, 210])[0]);
  const behindBallWidth = Math.abs(puttingTerrain.project([40, 190])[0] - puttingTerrain.project([20, 190])[0]);
  assert.ok(behindBallWidth < ballWidth * 1.35);
  assert.ok(puttingTerrain.project([30, 190])[1] < 1000);
});

test("ball flight rises above terrain and returns to its landing surface", () => {
  const terrain = createHoleTerrainProjection({ bounds, elevationAt: () => 0 });
  const carry = [[0, 10], [5, 70], [7, 130], [10, 190]];
  const roll = [[10, 190], [11, 202], [12, 210]];
  const flight = projectedBallFlight({ carry, roll, project: terrain.project, clubName: "7 Iron" });
  assert.equal(flight.length, 6);
  assert.ok(flight[1][1] < terrain.project(carry[1])[1]);
  assert.deepEqual(flight.at(-1), terrain.project(roll.at(-1)));
});

test("full-shot animation duration is readable and bounded", () => {
  assert.equal(fullShotAnimationDurationMs(10), 2400);
  assert.equal(fullShotAnimationDurationMs(180), 3700);
  assert.equal(fullShotAnimationDurationMs(400), 4600);
});

test("compact-screen ball flight is deliberately slower than desktop", () => {
  assert.equal(fullShotAnimationDurationMs(10, { compact: true }), 3480);
  assert.equal(fullShotAnimationDurationMs(180, { compact: true }), 5365);
  assert.equal(fullShotAnimationDurationMs(400, { compact: true }), 6670);
});
