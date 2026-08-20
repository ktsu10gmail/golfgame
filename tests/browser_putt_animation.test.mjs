import test from "node:test";
import assert from "node:assert/strict";

import {
  projectPuttPath,
  puttMotionTiming,
  puttRollDurationMs
} from "../packages/simulation/browser_putt_animation.mjs";

test("putt roll duration stays slow enough to read without becoming excessive", () => {
  assert.equal(puttRollDurationMs(1), 3000);
  assert.equal(puttRollDurationMs(10), 4050);
  assert.equal(puttRollDurationMs(30), 6500);
});

test("putt motion timing follows equal-time contour samples and visibly decelerates", () => {
  const timing = puttMotionTiming([[0, 0], [6, 0], [9, 0], [10, 0]]);
  assert.equal(timing.keyTimes, "0;0.33333;0.66667;1");
  assert.equal(timing.keyPoints, "0;0.6;0.9;1");
});

test("putt motion timing safely handles a degenerate path", () => {
  assert.deepEqual(puttMotionTiming([[2, 2]]), { keyPoints: "0;1", keyTimes: "0;1" });
});

test("3D putt path projection does not mistake the point index for elevation", () => {
  const receivedElevations = [];
  const projected = projectPuttPath([[2, 3], [4, 5], [6, 7]], (point, explicitElevation) => {
    receivedElevations.push(explicitElevation);
    return [point[0] * 10, point[1] * 10];
  });

  assert.deepEqual(projected, [[20, 30], [40, 50], [60, 70]]);
  assert.deepEqual(receivedElevations, [undefined, undefined, undefined]);
});
