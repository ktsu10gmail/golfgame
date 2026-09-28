import test from "node:test";
import assert from "node:assert/strict";
import {
  GM_RECOMMENDATION_FALLBACK,
  PLAYER_SAFE_SHOT_ERROR,
  clubCanReachTarget,
  completedHoleDestination,
  formatBreak,
  gameMasterTargetSuggestion,
  hasGameMasterReply,
  modeledMakeChanceLabel,
  outcomeDelta,
  puttAnalysisMatchLabels,
  recommendationTargetAdvice,
  remainingDistanceBadge,
  shotConditionBriefing
} from "../packages/simulation/browser_gm_feedback.mjs";

test("Game Master target buttons keep their visible label and logged command aligned", () => {
  assert.deepEqual(gameMasterTargetSuggestion({ viewMode: "putting", remainingYards: 12, par: 4, teeYards: 400 }), {
    label: "Aim at cup", command: "Aim at cup"
  });
  assert.deepEqual(gameMasterTargetSuggestion({ viewMode: "course", remainingYards: 175, par: 4, teeYards: 400 }), {
    label: "Aim at pin", command: "Aim at pin"
  });
  assert.deepEqual(gameMasterTargetSuggestion({ viewMode: "course", remainingYards: 260, par: 5, teeYards: 500 }), {
    label: "Layup center", command: "Layup center"
  });
  assert.deepEqual(gameMasterTargetSuggestion({ viewMode: "course", remainingYards: 350, par: 5, teeYards: 500 }), {
    label: "Fairway center", command: "Aim fairway center"
  });
});

test("Recommendation fallback detection requires a visible Game Master reply", () => {
  const messages = [{ role: "player", text: "What do you recommend?" }];
  assert.equal(hasGameMasterReply(messages, 0), false);
  messages.push({ role: "gm", text: GM_RECOMMENDATION_FALLBACK });
  assert.equal(hasGameMasterReply(messages, 0), true);
  assert.match(GM_RECOMMENDATION_FALLBACK, /could not calculate a recommendation/i);
});

test("putt analysis distinguishes exact matches, tolerated lines, and maximum pace", () => {
  assert.deepEqual(puttAnalysisMatchLabels({
    aimCorrect: true,
    paceCorrect: false,
    aimErrorInches: 1,
    playerPace: 100,
    recommendedPace: 100
  }), {
    aim: "Within model tolerance",
    pace: "Maximum modeled pace",
    maximumModeledPace: true
  });
  assert.deepEqual(puttAnalysisMatchLabels({
    aimCorrect: true,
    paceCorrect: true,
    aimErrorInches: 0,
    playerPace: 64,
    recommendedPace: 64
  }), {
    aim: "Matched model",
    pace: "Matched model",
    maximumModeledPace: false
  });
  assert.equal(puttAnalysisMatchLabels({
    aimCorrect: true,
    paceCorrect: true,
    aimErrorInches: 1.5,
    playerPace: 95,
    recommendedPace: 100
  }).pace, "Within model tolerance");
});

test("recommendation wording respects tree recovery and par-three tee context", () => {
  assert.match(recommendationTargetAdvice({
    viewMode: "course",
    recoveryRequired: true,
    greenReachable: true,
    par: 4,
    startSurface: "Trees"
  }), /do not aim at the green through the trees/i);
  const parThree = recommendationTargetAdvice({
    viewMode: "course",
    recoveryRequired: false,
    greenReachable: false,
    par: 3,
    startSurface: "Tee"
  });
  assert.match(parThree, /not a layup hole/i);
  assert.doesNotMatch(parThree, /layup area/i);
});

test("completed-hole navigation advances exactly one hole", () => {
  assert.equal(completedHoleDestination(4), 5);
  assert.equal(completedHoleDestination(5), 6);
  assert.equal(completedHoleDestination(17), null);
});

test("near-zero modeled make chances do not display as zero percent", () => {
  assert.equal(modeledMakeChanceLabel(0), "under 1%");
  assert.equal(modeledMakeChanceLabel(.004), "under 1%");
  assert.equal(modeledMakeChanceLabel(.126), "13%");
  assert.equal(modeledMakeChanceLabel(undefined), "Unavailable");
  assert.equal(modeledMakeChanceLabel(null), "Unavailable");
});

test("remaining-distance badge distinguishes active putts, gimmes, and holed putts", () => {
  assert.deepEqual(remainingDistanceBadge({ putting: true, remainingYards: .25 }), {
    value: "9", label: "in from cup"
  });
  assert.deepEqual(remainingDistanceBadge({ putting: true, remainingYards: 2 }), {
    value: "6", label: "ft from cup"
  });
  assert.deepEqual(remainingDistanceBadge({
    putting: true, remainingYards: .25, holeFinished: true, completionType: "gimme"
  }), { value: "Gimme", label: "Hole complete" });
  assert.deepEqual(remainingDistanceBadge({
    putting: true, remainingYards: 0, holeFinished: true, completionType: "holed"
  }), { value: "Holed", label: "In cup" });
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
