import assert from "node:assert/strict";
import test from "node:test";

import {
  ADJUSTMENT_ACCURACY_CAP,
  ADJUSTMENT_REWARD_VERSION,
  gradeAdjustmentReward
} from "../packages/simulation/browser_adjustment_reward.mjs";

const sidehill = overrides => ({
  stance: "ball_above_feet",
  compensation: "correct",
  recommended_aim_yards: 4,
  player_aim_yards: 4,
  ...overrides
});

test("excellent declared sidehill adjustment adds 15 points for this shot", () => {
  const reward = gradeAdjustmentReward({
    instructions: ["Aim 4 yards right to account for the ball above my feet"],
    sidehillPlan: sidehill(),
    baseAccuracy: 65
  });

  assert.equal(reward.version, ADJUSTMENT_REWARD_VERSION);
  assert.equal(reward.grade, "excellent");
  assert.equal(reward.reason, "lie_respected");
  assert.equal(reward.accuracy_bonus, 15);
  assert.equal(reward.effective_accuracy, 80);
  assert.equal(reward.shot_only, true);
});

test("correct direction with an imperfect amount adds 8 points", () => {
  const reward = gradeAdjustmentReward({
    instructions: ["Aim slightly right"],
    sidehillPlan: sidehill({ player_aim_yards: 1.8 }),
    baseAccuracy: 65
  });

  assert.equal(reward.grade, "sound");
  assert.equal(reward.accuracy_bonus, 8);
  assert.equal(reward.effective_accuracy, 73);
});

test("wrong-direction sidehill adjustment receives no accuracy reward", () => {
  const reward = gradeAdjustmentReward({
    instructions: ["Aim 4 yards left"],
    sidehillPlan: sidehill({ compensation: "wrong_direction", player_aim_yards: -4 }),
    baseAccuracy: 65
  });

  assert.equal(reward.grade, "incorrect");
  assert.equal(reward.reason, "lie_not_respected");
  assert.equal(reward.accuracy_bonus, 0);
  assert.equal(reward.effective_accuracy, 65);
});

test("matching uphill club adjustment receives a sound reward", () => {
  const reward = gradeAdjustmentReward({
    instructions: ["7 Iron, one club up for the uphill lie"],
    slope: "uphill",
    clubAdjustment: 1,
    baseAccuracy: 72
  });

  assert.equal(reward.grade, "sound");
  assert.equal(reward.accuracy_bonus, 8);
  assert.equal(reward.effective_accuracy, 80);
});

test("rough plan receives partial credit and reward respects the cap", () => {
  const reward = gradeAdjustmentReward({
    instructions: ["From the rough I will take extra club and favor the safe side"],
    lie: "Rough",
    baseAccuracy: 90
  });

  assert.equal(reward.grade, "partial");
  assert.equal(reward.accuracy_bonus, 2);
  assert.equal(reward.effective_accuracy, ADJUSTMENT_ACCURACY_CAP);
});

test("setting a good aim without declaring it does not receive the typing reward", () => {
  const reward = gradeAdjustmentReward({
    instructions: [],
    sidehillPlan: sidehill(),
    baseAccuracy: 65
  });

  assert.equal(reward.grade, "not_declared");
  assert.equal(reward.accuracy_bonus, 0);
});
