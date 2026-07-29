import assert from "node:assert/strict";
import test from "node:test";

import {
  SIDEHILL_MODEL_VERSION,
  analyzeSidehillShot
} from "../packages/simulation/browser_sidehill.mjs";

test("browser sidehill model matches the Python golden plan", () => {
  const plan = analyzeSidehillShot({
    stance: "ball_below_feet",
    lateralDistanceYards: 14,
    shotDistanceYards: 160,
    playerAimYards: -4
  });

  assert.equal(SIDEHILL_MODEL_VERSION, "sidehill-v1");
  assert.deepEqual(plan, {
    stance: "ball_below_feet",
    severity: "moderate",
    expected_curve_yards: 4,
    recommended_aim_yards: -4,
    player_aim_yards: -4,
    compensation: "correct"
  });
});

test("browser sidehill model scales curve with distance and severity", () => {
  const short = analyzeSidehillShot({
    stance: "ball_above_feet",
    lateralDistanceYards: 8,
    shotDistanceYards: 80
  });
  const long = analyzeSidehillShot({
    stance: "ball_above_feet",
    lateralDistanceYards: 24,
    shotDistanceYards: 180
  });

  assert.equal(short.expected_curve_yards, -1.5);
  assert.equal(long.expected_curve_yards, -6.08);
  assert.ok(Math.abs(long.expected_curve_yards) > Math.abs(short.expected_curve_yards));
});
