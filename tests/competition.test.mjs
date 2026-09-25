import test from "node:test";
import assert from "node:assert/strict";
import {
  CompetitionPhase,
  ParticipantType,
  cloneStrategistProfile,
  competitionExecutionIdentity,
  competitionPairedTotals,
  competitionRoundSummary,
  continueCompetition,
  createCompetitionRound,
  createPairedExecutionSample,
  lockCompetitionDecision,
  participantExecutionSeed,
  recoverInterruptedCompetition,
  recordCompetitionHoleSummary,
  resolveCompetitionTurn,
  selectSmartExpectedScore,
  validateSameGameplayProfile
} from "../packages/simulation/competition.mjs";

const profile = {
  id: "90", name: "90+ player", puttingMakeRates: { 3: 90, 6: 55, 10: 31 },
  preferredScoringRangeYards: [40, 80],
  clubs: [{ name: "7 Iron", carry: 145, accuracy: 70 }, { name: "Putter", carry: 20, accuracy: 100 }]
};

test("strategist profile is an exact immutable gameplay clone", () => {
  const clone = cloneStrategistProfile(profile);
  assert.equal(validateSameGameplayProfile(profile, clone).same_profile, true);
  assert.equal(clone.profileCloneSourceId, profile.id);
  assert.equal(Object.isFrozen(clone), true);
  assert.equal(Object.isFrozen(clone.clubs), true);
  assert.throws(() => clone.clubs.push({ name: "Driver" }));
});

test("profile mismatch blocks fairness validation", () => {
  const clone = structuredClone(cloneStrategistProfile(profile));
  clone.clubs[0].carry += 1;
  assert.deepEqual(validateSameGameplayProfile(profile, clone).differences, ["gameplay_profile_hash"]);
});

test("paired execution samples are reproducible and change per paired stroke", () => {
  const first = createPairedExecutionSample(90210, 6, 2);
  assert.deepEqual(first, createPairedExecutionSample(90210, 6, 2));
  assert.notDeepEqual(first, createPairedExecutionSample(90210, 6, 3));
  assert.notEqual(first.human_execution_seed, first.strategist_execution_seed);
  assert.notDeepEqual(first.human_sample, first.strategist_sample);
  assert.equal(first.randomness, "independent_per_participant");
});

test("human and Game Master receive independent reproducible execution identities", () => {
  const human = competitionExecutionIdentity(90210, 6, 2, ParticipantType.HUMAN);
  const strategist = competitionExecutionIdentity(90210, 6, 2, ParticipantType.AI_STRATEGIST);
  assert.deepEqual(human, competitionExecutionIdentity(90210, 6, 2, ParticipantType.HUMAN));
  assert.equal(human.holeNumber, strategist.holeNumber);
  assert.equal(human.strokeIndex, strategist.strokeIndex);
  assert.notEqual(human.roundSeed, strategist.roundSeed);
  assert.notEqual(
    participantExecutionSeed(90210, 6, 2, ParticipantType.HUMAN),
    participantExecutionSeed(90210, 6, 2, ParticipantType.AI_STRATEGIST)
  );
  assert.throws(() => participantExecutionSeed(90210, 6, 2, "spectator"), /unknown participant type/);
});

test("decision locking prevents the strategist seeing future execution", () => {
  let round = createCompetitionRound({ courseId: "meadows", tee: "White", roundSeed: 12, humanProfile: profile });
  assert.throws(() => lockCompetitionDecision(round, ParticipantType.AI_STRATEGIST, { club: "7 Iron" }));
  round = lockCompetitionDecision(round, ParticipantType.HUMAN, { club: "7 Iron", power_percent: 100 });
  assert.equal(round.phase, CompetitionPhase.HUMAN_DECISION_LOCKED);
  assert.equal(round.turns[0].human_result, undefined);
  round = lockCompetitionDecision(round, ParticipantType.AI_STRATEGIST, { club: "7 Iron", power_percent: 100 });
  assert.equal(round.phase, CompetitionPhase.BOTH_DECISIONS_LOCKED);
  round = resolveCompetitionTurn(round, { humanResult: { yards: 144 }, strategistResult: { yards: 144 } });
  assert.equal(round.phase, CompetitionPhase.COMPARISON_READY);
  assert.equal(round.turns[0].human_result.yards, round.turns[0].strategist_result.yards);
  assert.notEqual(round.turns[0].human_execution_seed, round.turns[0].strategist_execution_seed);
  assert.equal(continueCompetition(round).phase, CompetitionPhase.READY_FOR_HUMAN);
});

test("smart expected score values playable preferred-distance leaves over raw advance", () => {
  const candidates = [{ id: "attack" }, { id: "layup" }];
  const choice = selectSmartExpectedScore(candidates, { candidates: {
    attack: { median_leave_yards: 18, penalty_percent: 14, bunker_percent: 24, playable_percent: 68 },
    layup: { median_leave_yards: 64, penalty_percent: 1, bunker_percent: 2, playable_percent: 94 }
  } }, { preferredScoringRange: [40, 80] });
  assert.equal(choice.candidate.id, "layup");
  assert.ok(choice.expected_score < choice.alternatives[0].expected_score);
});

test("completed holes persist decision and score summaries", () => {
  let round = createCompetitionRound({ courseId: "meadows", tee: "White", roundSeed: 73, humanProfile: profile });
  round.human_round = structuredClone(round.strategist_round);
  round.human_round.holes[0].score = 6;
  round.strategist_round.holes[0].score = 5;
  round.turns = [{
    hole_number: 1,
    resolved_at: "2026-08-20T00:00:00Z",
    human_decision: { club: "3 Wood", expected_score: 2.4 },
    strategist_decision: { club: "7 Iron", expected_score: 1.8 },
    human_decision_score: 74,
    strategist_decision_score: 91
  }];
  round = recordCompetitionHoleSummary(round, 0);
  assert.equal(round.hole_summaries[0].actual_score_difference, 1);
  assert.equal(round.hole_summaries[0].expected_strategy_difference, .6);
  assert.match(round.hole_summaries[0].narrative, /3 Wood/);
  const summary = competitionRoundSummary(round, Array(18).fill(4));
  assert.equal(summary.holes_completed, 1);
  assert.equal(summary.expected_strategy_difference, .6);
  assert.deepEqual(summary.key_holes, [1]);
});

test("18-hole scoreboard totals only completed paired holes", () => {
  const round = createCompetitionRound({ courseId: "meadows", tee: "White", roundSeed: 74, humanProfile: profile });
  round.human_round = structuredClone(round.strategist_round);
  round.human_round.holes[0].score = 4;
  round.strategist_round.holes[0].score = 4;
  round.human_round.holes[1].score = 5;
  round.strategist_round.holes[1].score = 4;
  // The player may finish a hole before the Game Master. It is not on the
  // shared score bar until both results are recorded.
  round.human_round.holes[2].score = 3;
  const totals = competitionPairedTotals(round, [3, 4, 5]);
  assert.deepEqual(totals.human, { strokes: 9, relative_to_par: 2, holes_completed: 2 });
  assert.deepEqual(totals.strategist, { strokes: 8, relative_to_par: 1, holes_completed: 2 });
});

test("an interrupted paired turn is archived and returned to a playable state", () => {
  let round = createCompetitionRound({ courseId: "meadows", tee: "White", roundSeed: 44, humanProfile: profile });
  round.human_round = structuredClone(round.strategist_round);
  round = lockCompetitionDecision(round, ParticipantType.HUMAN, { club: "7 Iron", power_percent: 100 });
  round = lockCompetitionDecision(round, ParticipantType.AI_STRATEGIST, { club: "7 Iron", power_percent: 100 });
  round.human_round.holes[0].events.push({
    event_type: "shot_committed",
    payload: { shot: { club: "7 Iron", power: 100 } }
  });
  const recovery = recoverInterruptedCompetition(round, { now: "2026-08-20T12:00:00Z" });
  assert.equal(recovery.recovered, true);
  assert.equal(recovery.replay_required, true);
  assert.equal(recovery.competition.phase, CompetitionPhase.READY_FOR_HUMAN);
  assert.equal(recovery.competition.turns.length, 0);
  assert.equal(recovery.competition.human_round.holes[0].events.length, 0);
  assert.equal(recovery.competition.interrupted_turns[0].turn.human_decision.club, "7 Iron");
});
