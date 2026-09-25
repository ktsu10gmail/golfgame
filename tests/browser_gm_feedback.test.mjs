import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAYER_SAFE_SHOT_ERROR,
  formatBreak,
  modeledMakeChanceLabel,
  outcomeDelta
} from "../packages/simulation/browser_gm_feedback.mjs";

test("near-zero modeled make chances do not display as zero percent", () => {
  assert.equal(modeledMakeChanceLabel(0), "under 1%");
  assert.equal(modeledMakeChanceLabel(.004), "under 1%");
  assert.equal(modeledMakeChanceLabel(.126), "13%");
});

test("putting break uses inches below one foot and feet above it", () => {
  assert.equal(formatBreak(8), "8 inches");
  assert.equal(formatBreak(12), "1 foot");
  assert.equal(formatBreak(18), "1.5 feet");
  assert.equal(formatBreak(36), "3 feet");
});

test("outcome delta separates lateral and distance misses", () => {
  assert.deepEqual(outcomeDelta([0, 0], [0, 100], [27, 89]), {
    lateral_yards: 27,
    distance_yards: -11
  });
  assert.deepEqual(outcomeDelta([0, 0], [100, 0], [111, -8]), {
    lateral_yards: 8,
    distance_yards: 11
  });
});

test("player-safe shot error contains no implementation detail", () => {
  assert.match(PLAYER_SAFE_SHOT_ERROR, /ball and score have not changed/i);
  assert.doesNotMatch(PLAYER_SAFE_SHOT_ERROR, /exception|internal|strategy candidate|trace/i);
});
