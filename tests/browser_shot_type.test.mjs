import assert from "node:assert/strict";
import test from "node:test";

import {
  RULE_OF_12_MAX_CARRY_YARDS,
  ShotType,
  landingTargetAllowed,
  recommendShotType,
  shotTypeUsesGreensideEngine,
  validateShotType
} from "../packages/simulation/browser_shot_type.mjs";

const base = {
  lie: "Fairway",
  clubName: "Pitching Wedge",
  distanceToPinYards: 91,
  targetSurface: "Green",
  effectiveCarryYards: 100,
  landingTarget: true
};

test("Landing Target remains available for long non-putting shots", () => {
  assert.equal(landingTargetAllowed({ lie: "Fairway", clubName: "5 Iron" }), true);
  assert.equal(landingTargetAllowed({ lie: "Fairway", clubName: "Pitching Wedge" }), true);
  assert.equal(landingTargetAllowed({ lie: "Green", clubName: "Putter" }), false);
  assert.equal(landingTargetAllowed({ lie: "Fairway", clubName: "Putter" }), false);
});

test("a 91-yard pitching-wedge landing target defaults to Approach and full-shot physics", () => {
  const shotType = recommendShotType({ ...base, targetDistanceYards: 91 });
  assert.equal(shotType, ShotType.APPROACH);
  assert.equal(shotTypeUsesGreensideEngine({ shotType, targetDistanceYards: 91 }), false);
});

test("Rule of 12 ends at 30 yards and 31 yards becomes an Approach", () => {
  assert.equal(RULE_OF_12_MAX_CARRY_YARDS, 30);
  const chip = recommendShotType({ ...base, distanceToPinYards: 30, targetDistanceYards: 30 });
  const approach = recommendShotType({ ...base, distanceToPinYards: 31, targetDistanceYards: 31 });
  assert.equal(chip, ShotType.CHIP_AND_RUN);
  assert.equal(approach, ShotType.APPROACH);
  assert.equal(shotTypeUsesGreensideEngine({ shotType: chip, targetDistanceYards: 30 }), true);
  assert.equal(shotTypeUsesGreensideEngine({ shotType: approach, targetDistanceYards: 31 }), false);
  assert.equal(recommendShotType({ ...base, distanceToPinYards: 18, targetDistanceYards: null }), ShotType.CHIP_AND_RUN);
});

test("lie, club, and tactical distance choose useful automatic shot types", () => {
  assert.equal(recommendShotType({ ...base, lie: "Green", clubName: "Putter" }), ShotType.PUTTING);
  assert.equal(recommendShotType({ ...base, lie: "Bunker", targetDistanceYards: 12 }), ShotType.BUNKER);
  assert.equal(recommendShotType({ ...base, lie: "Trees" }), ShotType.RECOVERY);
  assert.equal(recommendShotType({ ...base, lie: "Tee", clubName: "Driver", distanceToPinYards: 420 }), ShotType.DRIVING);
  assert.equal(recommendShotType({
    ...base,
    clubName: "7 Iron",
    distanceToPinYards: 330,
    targetDistanceYards: 150,
    targetSurface: "Fairway",
    effectiveCarryYards: 140,
    landingTarget: false
  }), ShotType.LAY_UP);
});

test("manual chip-and-run choice rejects a 91-yard target with actionable guidance", () => {
  const validation = validateShotType({
    shotType: ShotType.CHIP_AND_RUN,
    lie: "Fairway",
    clubName: "Pitching Wedge",
    targetDistanceYards: 91
  });
  assert.equal(validation.valid, false);
  assert.match(validation.message, /up to 30 yards/);
  assert.match(validation.message, /Choose Approach/);
});
