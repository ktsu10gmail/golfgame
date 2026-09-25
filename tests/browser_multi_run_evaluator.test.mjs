import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateShotCandidates,
  rankCandidateSummaries,
  stableAnalysisSeed
} from "../packages/simulation/browser_multi_run_evaluator.mjs";
import { simulateFullShot } from "../packages/simulation/browser_engine.mjs";

const rectangle = (left, bottom, right, top) => [
  { x: left, y: bottom }, { x: right, y: bottom },
  { x: right, y: top }, { x: left, y: top }
];

function context(accuracy, target = { x: 0, y: 150 }) {
  return {
    start: { x: 0, y: 0 }, target, pin: { x: 0, y: 180 },
    club: {
      club_id: "7_iron", carry_mean: 150, carry_sd: 150 * (.025 + (1 - accuracy) * .12),
      roll_mean: 5, lateral_sd: 150 * (.015 + (1 - accuracy) * .2),
      directional_bias: (1 - accuracy) * 8, mishit_probability: (1 - accuracy) / 2.2
    },
    lie: { lie_type: "fairway_clean", carry_multiplier: 1, roll_multiplier: 1, mishit_multiplier: 1, lateral_bias_yards: 0, version: "test" },
    environment: { wind_forward_yards: 0, wind_lateral_yards: 0, wind_roll_multiplier: 1, elevation_carry_multiplier: 1, slope_mishit_multiplier: 1, surface_roll_multiplier: 1 },
    intent: { distance_multiplier: 1, complexity_multiplier: 1, label: "stock" },
    surfaces: [
      { surface: "green", priority: 70, polygon: rectangle(-16, 164, 16, 192) },
      { surface: "bunker", priority: 60, polygon: rectangle(17, 145, 38, 180) },
      { surface: "fairway", priority: 40, polygon: rectangle(-25, 0, 25, 163) },
      { surface: "rough", priority: 20, polygon: rectangle(-60, -10, 60, 210) }
    ],
    default_surface: "rough", profile_version: "test"
  };
}

test("paired multi-run evaluation is stable and summarizes authoritative packets", () => {
  const candidates = [
    { id: "aggressive", context: context(.65), target: { x: 0, y: 180 }, successSurface: "green", targetRadiusYards: 12 },
    { id: "safe_smart", context: context(.88, { x: 0, y: 145 }), target: { x: 0, y: 145 }, successSurface: null, targetRadiusYards: 18 }
  ];
  const options = {
    candidates, sampleCount: 300, analysisSeed: stableAnalysisSeed("same decision"), holeNumber: 4,
    simulate: (candidate, identity) => simulateFullShot(candidate.context, identity)
  };
  const first = evaluateShotCandidates(options);
  const replay = evaluateShotCandidates(options);

  assert.deepEqual(first, replay);
  assert.equal(first.sample_count, 300);
  assert.ok(["aggressive", "safe_smart"].includes(first.recommended_choice_id));
  assert.equal(first.candidates[first.recommended_choice_id].hybrid_outlook, "Best");
  assert.equal(first.ranking_version, "course-management-v1");
  assert.ok(first.candidates.aggressive.green_percent >= 0);
  assert.ok(first.candidates.safe_smart.playable_percent >= first.candidates.aggressive.playable_percent);
  assert.ok(first.candidates.aggressive.leave_p10_yards <= first.candidates.aggressive.median_leave_yards);
  assert.ok(first.candidates.aggressive.median_leave_yards <= first.candidates.aggressive.leave_p90_yards);
  assert.ok(first.candidates.aggressive.inside_3ft_percent <= first.candidates.aggressive.inside_6ft_percent);
  assert.ok(first.candidates.aggressive.inside_6ft_percent <= first.candidates.aggressive.inside_8ft_percent);
  assert.ok(first.candidates.aggressive.inside_8ft_percent <= first.candidates.aggressive.inside_15ft_percent);
  assert.ok(first.candidates.aggressive.median_leave_feet >= 0);
  assert.ok(Math.abs(first.candidates.aggressive.median_leave_feet - first.candidates.aggressive.median_leave_yards * 3) <= 1.5);
});

test("paired probabilities can override the deterministic fallback ranking", () => {
  const candidates = [
    { id: "aggressive", deterministicOutlook: "Best", context: { start: { x: 0, y: 0 }, pin: { x: 0, y: 200 } } },
    { id: "safe_smart", deterministicOutlook: "Higher risk", context: { start: { x: 0, y: 0 }, pin: { x: 0, y: 200 } } }
  ];
  const result = rankCandidateSummaries(candidates, {
    aggressive: { target_percent: 28, playable_percent: 54, penalty_percent: 24, bunker_percent: 18, median_leave_yards: 85 },
    safe_smart: { target_percent: 62, playable_percent: 91, penalty_percent: 2, bunker_percent: 5, median_leave_yards: 105 }
  });
  assert.equal(result.recommended_choice_id, "safe_smart");
  assert.equal(result.candidates.safe_smart.hybrid_outlook, "Best");
  assert.equal(result.candidates.aggressive.hybrid_outlook, "Higher risk");
});

test("every candidate receives the same paired sample identities", () => {
  const identities = { first: [], second: [] };
  const candidates = ["first", "second"].map(id => ({
    id, context: { start: { x: 0, y: 0 } }, target: { x: 0, y: 10 }, targetRadiusYards: 5
  }));
  evaluateShotCandidates({
    candidates, sampleCount: 10, analysisSeed: 77, holeNumber: 2,
    simulate: (candidate, identity) => {
      identities[candidate.id].push({ ...identity });
      return { landing: { x: 0, y: 10 }, landing_surface: "fairway", remaining_distance_yards: 10 };
    }
  });
  assert.deepEqual(identities.first, identities.second);
});
