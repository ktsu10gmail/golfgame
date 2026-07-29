import assert from "node:assert/strict";
import test from "node:test";

import { scoreStrategy } from "../packages/simulation/browser_decision_scoring.mjs";

function club(overrides = {}) {
  return {
    club_id: "test_club",
    carry_mean: 150,
    carry_sd: 10,
    roll_mean: 8,
    lateral_sd: 8,
    directional_bias: 0,
    mishit_probability: 0.2,
    ...overrides
  };
}

function resultPacket(overrides = {}) {
  return {
    landing_surface: "green",
    lateral_yards: 3,
    remaining_distance_yards: 8,
    relief: null,
    assessment: { execution_assessment: "on_plan" },
    ...overrides
  };
}

test("browser decision scorer infers dry-side preferred miss from water context", () => {
  const packet = scoreStrategy({
    hole_number: 1,
    stroke_number: 2,
    distance_to_target_yards: 140,
    lie_type: "fairway_clean",
    shot_type: "approach_standard",
    selected_club: club({ carry_mean: 145 }),
    target_aggression: 0.2,
    hazard_count: 1,
    water_in_play: true,
    out_of_bounds_in_play: false,
    forced_carry_yards: 0,
    pin_risk_level: 1,
    recovery_required: false,
    preferred_miss: "none_declared",
    strategy_notes: []
  });

  assert.equal(packet.preferred_miss, "dry_side");
  assert.equal(packet.preferred_miss_inferred, true);
  assert.equal(packet.decision.label, "sound");
  assert.ok(packet.decision.reasons.includes("good_miss_plan"));
});

test("browser decision scorer adds execution grading when a result packet is supplied", () => {
  const packet = scoreStrategy({
    hole_number: 2,
    stroke_number: 2,
    distance_to_target_yards: 150,
    lie_type: "fairway_clean",
    shot_type: "approach_forced_carry",
    selected_club: club({ carry_mean: 160 }),
    target_aggression: 0.2,
    hazard_count: 1,
    water_in_play: true,
    out_of_bounds_in_play: false,
    forced_carry_yards: 145,
    pin_risk_level: 1,
    recovery_required: false,
    preferred_miss: "none_declared",
    strategy_notes: []
  }, resultPacket());

  assert.equal(packet.execution.label, "matched_plan");
  assert.ok(packet.decision.advice_keys.includes("cover_the_carry"));
});

test("browser decision scorer applies shot-type weighting", () => {
  const context = {
    hole_number: 3,
    stroke_number: 2,
    distance_to_target_yards: 35,
    lie_type: "bunker_buried",
    selected_club: club({ carry_mean: 45 }),
    target_aggression: 0.6,
    hazard_count: 0,
    water_in_play: false,
    out_of_bounds_in_play: false,
    forced_carry_yards: 0,
    pin_risk_level: 0,
    recovery_required: false,
    preferred_miss: "none_declared",
    strategy_notes: []
  };

  const bunker = scoreStrategy({ ...context, shot_type: "bunker_escape" });
  const approach = scoreStrategy({ ...context, shot_type: "approach_standard" });

  assert.deepEqual(bunker.decision.subscores, approach.decision.subscores);
  assert.ok(bunker.decision.score < approach.decision.score);
});
