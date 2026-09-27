import assert from "node:assert/strict";
import test from "node:test";

import {
  AimType,
  PowerStatus,
  expectedShortGameRoll,
  generateRuleOf12Candidates,
  markUnsafeTrajectory,
  nominalAimCarryYards,
  recommendNonPutterClubIndex,
  ruleOf12ClubNumber,
  solveShortGamePower
} from "../packages/simulation/browser_short_game.mjs";

const clubs = [
  { name: "7 Iron", carry: 140 },
  { name: "8 Iron", carry: 130 },
  { name: "9 Iron", carry: 120 },
  { name: "Pitching Wedge", carry: 105 },
  { name: "Sand Wedge", carry: 50 },
  { name: "Lob Wedge", carry: 42 }
];

test("landing target solves continuous nominal power from profile carry and lie", () => {
  const result = solveShortGamePower({ clubCarryYards: 50, desiredCarryYards: 16, lieMultiplier: 1 });
  assert.equal(result.status, PowerStatus.REACHABLE);
  assert.equal(result.power_percent, 32);
  assert.equal(result.expected_carry_yards, 16);
});

test("aim modes preserve direction/manual-power and landing/auto-carry semantics", () => {
  assert.equal(nominalAimCarryYards({
    aimType: AimType.DIRECTION_TARGET,
    targetDistanceYards: 16,
    clubCarryYards: 50,
    power: .5
  }), 25);
  assert.equal(nominalAimCarryYards({
    aimType: AimType.LANDING_TARGET,
    targetDistanceYards: 16,
    clubCarryYards: 50,
    power: .5
  }), 16);
});

test("power solver reports marginal and unreachable targets explicitly", () => {
  assert.equal(solveShortGamePower({ clubCarryYards: 100, desiredCarryYards: 10 }).status, PowerStatus.MARGINAL);
  assert.equal(solveShortGamePower({ clubCarryYards: 100, desiredCarryYards: 3 }).status, PowerStatus.UNREACHABLE);
  assert.equal(solveShortGamePower({ clubCarryYards: 50, desiredCarryYards: 60 }).status, PowerStatus.UNREACHABLE);
});

test("Rule of 12 proposes plausible clubs without overriding model status", () => {
  assert.equal(ruleOf12ClubNumber(3), 9);
  const candidates = generateRuleOf12Candidates({ clubs, carryDistanceYards: 8, rollDistanceYards: 24 });
  assert.equal(candidates.find(candidate => candidate.rule_of_12_candidate).club_name, "9 Iron");
  assert.equal(candidates.find(candidate => candidate.club_name === "7 Iron").status, PowerStatus.UNREACHABLE);
});

test("all supported irons and wedges retain distinct auto-power candidates for one target", () => {
  const candidates = generateRuleOf12Candidates({ clubs, carryDistanceYards: 16, rollDistanceYards: 9 });
  assert.deepEqual(candidates.map(candidate => candidate.club_name).sort(), clubs.map(club => club.name).sort());
  assert.equal(new Set(candidates.map(candidate => candidate.power_percent)).size, clubs.length);
  assert.equal(candidates.find(candidate => candidate.club_name === "Sand Wedge").power_percent, 32);
});

test("club rollout and hazard status stay distinct for the same landing target", () => {
  assert.equal(expectedShortGameRoll({ carryYards: 10, rollRatio: 1 }), 10);
  assert.equal(expectedShortGameRoll({ carryYards: 10, rollRatio: 5 }), 50);
  const candidate = generateRuleOf12Candidates({ clubs, carryDistanceYards: 16, rollDistanceYards: 9 })[0];
  assert.equal(markUnsafeTrajectory(candidate, true).status, PowerStatus.UNSAFE_TRAJECTORY);
  assert.equal(AimType.DIRECTION_TARGET, "direction_target");
});

test("non-green fallback recommendation never selects the putter", () => {
  const bunkerClubs = [
    { name: "Sand Wedge", carry: 50 },
    { name: "Lob Wedge", carry: 30 },
    { name: "Putter", carry: 20 }
  ];
  const index = recommendNonPutterClubIndex({
    clubs: bunkerClubs,
    targetDistanceYards: 6.42,
    lieMultiplier: .72
  });
  assert.equal(bunkerClubs[index].name, "Lob Wedge");
});

test("fallback recommendation allows Driver only from the tee", () => {
  const longClubs = [
    { name: "Driver", carry: 220 },
    { name: "3 Wood", carry: 200 },
    { name: "6 Iron", carry: 155 },
    { name: "Putter", carry: 20 }
  ];
  const recommendation = startSurface => recommendNonPutterClubIndex({
    clubs: longClubs,
    targetDistanceYards: 220,
    lieMultiplier: 1,
    startSurface
  });

  assert.equal(longClubs[recommendation("Tee")].name, "Driver");
  for (const surface of ["Fairway", "Rough", "Heavy rough", "Trees", "Bunker"]) {
    assert.notEqual(longClubs[recommendation(surface)].name, "Driver", surface);
  }
});
