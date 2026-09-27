import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAYER_SAFE_SHOT_ERROR,
  clubCanReachTarget,
  formatBreak,
  modeledMakeChanceLabel,
  outcomeDelta,
  shotConditionBriefing
} from "../packages/simulation/browser_gm_feedback.mjs";

test("near-zero modeled make chances do not display as zero percent", () => {
  assert.equal(modeledMakeChanceLabel(0), "under 1%");
  assert.equal(modeledMakeChanceLabel(.004), "under 1%");
  assert.equal(modeledMakeChanceLabel(.126), "13%");
  assert.equal(modeledMakeChanceLabel(undefined), "Unavailable");
  assert.equal(modeledMakeChanceLabel(null), "Unavailable");
});

test("green advice requires the selected club to reach the plays-like distance", () => {
  assert.equal(clubCanReachTarget({ distanceYards: 355, carryYards: 200 }), false);
  assert.equal(clubCanReachTarget({ distanceYards: 198, carryYards: 200 }), true);
  assert.equal(clubCanReachTarget({ distanceYards: 198, carryYards: 200, lieMultiplier: .85 }), false);
  assert.equal(clubCanReachTarget({ distanceYards: 198, carryYards: 200, elevationFeet: 16 }), false);
});

test("neutral stance and elevation stay silent while retaining useful distance", () => {
  const neutral = {
    remainingYards: 355,
    lie: "Tee",
    stanceType: "level",
    stance: "a fairly level stance",
    slope: "playing nearly level",
    elevationFeet: 1
  };
  assert.equal(shotConditionBriefing(neutral), "You have 355 yards to the pin from tee.");
  assert.equal(shotConditionBriefing({ ...neutral, includeDistance: false }), "");
});

test("shot briefing reports only non-neutral stance and elevation conditions", () => {
  const uphill = shotConditionBriefing({
    includeDistance: false,
    stanceType: "level",
    stance: "a fairly level stance",
    slope: "uphill",
    elevationFeet: 14
  });
  assert.equal(uphill, "The shot plays uphill by about 14 feet.");
  assert.doesNotMatch(uphill, /fairly level|nearly level/i);

  const sidehill = shotConditionBriefing({
    includeDistance: false,
    stanceType: "ball_above_feet",
    stance: "the ball above your feet",
    slope: "playing nearly level",
    elevationFeet: 0,
    sidehillAdvice: " Expect about 5 yards of movement left; aim roughly 5 yards right."
  });
  assert.equal(sidehill, "You have the ball above your feet. Expect about 5 yards of movement left; aim roughly 5 yards right.");
  assert.doesNotMatch(sidehill, /nearly level/i);
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
