import test from "node:test";
import assert from "node:assert/strict";

import {
  closestProjectedPolygonPoint,
  enlargedGreenFocusBounds,
  projectedPairCenterOffset
} from "../packages/simulation/browser_green_relief_interaction.mjs";

const square = [[0, 0], [10, 0], [10, 10], [0, 10]];

test("3D green click resolves to the matching course point", () => {
  const project = ([x, y]) => [100 + x * 8 + y * .4, 500 - y * 5 + x * .2];
  const expected = [7.25, 3.5];
  const result = closestProjectedPolygonPoint(project(expected), square, project);

  assert.ok(result);
  assert.ok(Math.abs(result[0] - expected[0]) < .02);
  assert.ok(Math.abs(result[1] - expected[1]) < .02);
});

test("3D green click ignores points outside the projected surface", () => {
  const project = ([x, y]) => [200 + x * 4, 300 - y * 3];
  assert.equal(closestProjectedPolygonPoint([30, 30], square, project), null);
});

test("3D green click accepts a small edge tolerance", () => {
  const project = ([x, y]) => [100 + x * 10, 100 + y * 10];
  const result = closestProjectedPolygonPoint([202, 150], square, project, { edgeTolerance: 3 });
  assert.ok(result);
  assert.ok(Math.abs(result[0] - 10) < .02);
});

test("3D green boundary projection does not use vertex indexes as elevations", () => {
  const receivedElevations = [];
  const project = ([x, y], explicitElevation) => {
    receivedElevations.push(explicitElevation);
    return [100 + x * 10, 100 + y * 10];
  };

  const result = closestProjectedPolygonPoint([150, 150], square, project, {
    divisions: 12,
    refinements: 1
  });

  assert.ok(result);
  assert.deepEqual(receivedElevations.slice(0, square.length), [undefined, undefined, undefined, undefined]);
});

test("enlarged green centers every zoom level between ball and pin", () => {
  for (const zoom of [1, 2, 3, 4, 5]) {
    const bounds = enlargedGreenFocusBounds({
      greenPolygon: square,
      ball: [2, 4],
      pin: [8, 6],
      zoom
    });
    assert.deepEqual(bounds.center, [5, 5]);
    assert.ok(bounds.minX < 2 && bounds.maxX > 8);
    assert.ok(bounds.minY < 4 && bounds.maxY > 6);
  }
});

test("five-times zoom backs off only enough to keep a long putt visible", () => {
  const bounds = enlargedGreenFocusBounds({
    greenPolygon: [[0, 0], [40, 0], [40, 40], [0, 40]],
    ball: [2, 20],
    pin: [38, 20],
    zoom: 5
  });
  assert.ok(bounds.effectiveZoom < 5);
  assert.ok(bounds.minX < 2 && bounds.maxX > 38);
  assert.deepEqual(bounds.center, [20, 20]);
});

test("3D focus offset centers the projected ball and pin despite elevation", () => {
  const offset = projectedPairCenterOffset([430, 670], [510, 410]);
  assert.deepEqual(offset, [30, -40]);
  const shiftedBall = [430 + offset[0], 670 + offset[1]];
  const shiftedPin = [510 + offset[0], 410 + offset[1]];
  assert.deepEqual([
    (shiftedBall[0] + shiftedPin[0]) / 2,
    (shiftedBall[1] + shiftedPin[1]) / 2
  ], [500, 500]);
});
