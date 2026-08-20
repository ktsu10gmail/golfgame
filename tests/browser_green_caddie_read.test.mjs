import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGreenCaddieRead,
  greenPlayerViewYawDegrees,
  greenQuarterTurnYawDegrees
} from "../packages/simulation/browser_green_caddie_read.mjs";

const rectangle = (left, bottom, right, top) => [
  { x: left, y: bottom },
  { x: right, y: bottom },
  { x: right, y: top },
  { x: left, y: top }
];

test("caddie read produces a contour-aware teaching trace and pace window", () => {
  const read = buildGreenCaddieRead({
    start: { x: -6, y: -6 },
    pin: { x: -6, y: 6 },
    greenPolygon: rectangle(-9, -9, 9, 9),
    contourKey: "teaching-green:hole-1",
    contourStrength: 1,
    putterRangeFeet: 60
  });

  assert.ok(read.path.length > 5);
  assert.deepEqual(read.path.at(0), { x: -6, y: -6 });
  assert.equal(read.sections.length, 3);
  assert.ok(read.pace_range[0] <= read.pace_percent);
  assert.ok(read.pace_range[1] >= read.pace_percent);
  assert.ok(Math.abs(read.aim_offset_inches) <= 48);
  assert.ok(read.predicted_leave_feet < 1.5);
  assert.ok(read.finish_radius_feet >= 2);
});

test("caddie read is deterministic and does not depend on player dispersion", () => {
  const input = {
    start: { x: 1, y: -7 },
    pin: { x: -2, y: 7 },
    greenPolygon: rectangle(-10, -10, 10, 10),
    contourKey: "teaching-green:hole-2",
    contourStrength: 1.15,
    putterRangeFeet: 60
  };
  assert.deepEqual(buildGreenCaddieRead(input), buildGreenCaddieRead(input));
});

test("player-view yaw places the cup straight ahead of the ball", () => {
  const cases = [
    [{ x: 0, y: 0 }, { x: 0, y: 8 }],
    [{ x: 0, y: 0 }, { x: 8, y: 0 }],
    [{ x: 4, y: 7 }, { x: -3, y: -2 }]
  ];
  for (const [start, pin] of cases) {
    const yaw = greenPlayerViewYawDegrees(start, pin) * Math.PI / 180;
    const dx = pin.x - start.x;
    const dy = pin.y - start.y;
    const rotatedX = dx * Math.cos(yaw) - dy * Math.sin(yaw);
    const rotatedY = dx * Math.sin(yaw) + dy * Math.cos(yaw);
    assert.ok(Math.abs(rotatedX) < 1e-9);
    assert.ok(rotatedY > 0);
  }
});

test("quarter-turn control rotates through all four green views", () => {
  const first = greenQuarterTurnYawDegrees(35);
  const second = greenQuarterTurnYawDegrees(first);
  const third = greenQuarterTurnYawDegrees(second);
  const fourth = greenQuarterTurnYawDegrees(third);
  assert.deepEqual([first, second, third, fourth], [-55, -145, 125, 35]);
});
