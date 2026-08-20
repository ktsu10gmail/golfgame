import { appendHoleEvent, buildHoleBrowserState, createRoundState, replaceHoleEvents } from "./round_state.mjs";

export const COMPETITION_VERSION = "game-master-competition-v1";
export const CompetitionMode = Object.freeze({ PLAY_VS_STRATEGIST: "play_vs_strategist" });
export const ParticipantType = Object.freeze({ HUMAN: "human", AI_STRATEGIST: "ai_strategist" });
export const StrategyPolicy = Object.freeze({ SMART_EXPECTED_SCORE: "smart_expected_score" });
export const CompetitionPhase = Object.freeze({
  READY_FOR_HUMAN: "ready_for_human",
  HUMAN_DECISION_LOCKED: "human_decision_locked",
  GM_DECIDING: "gm_deciding",
  BOTH_DECISIONS_LOCKED: "both_decisions_locked",
  RESOLVING: "resolving",
  COMPARISON_READY: "comparison_ready",
  ROUND_COMPLETE: "round_complete"
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function fnv1a(text) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function gameplayProfile(profile) {
  const ignored = new Set([
    "id", "name", "description", "ownerType", "locked", "profileCloneSourceId",
    "profileCloneHash", "profileVersion"
  ]);
  return Object.fromEntries(Object.entries(profile || {}).filter(([key]) => !ignored.has(key)));
}

export function gameplayProfileHash(profile) {
  if (!profile || typeof profile !== "object") throw new Error("player profile is required");
  return fnv1a(stableJson(gameplayProfile(profile)));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export function cloneStrategistProfile(source, { profileVersion = "browser-profile-v1" } = {}) {
  if (!source?.id) throw new Error("source profile must have an id");
  const hash = gameplayProfileHash(source);
  const clone = structuredClone(source);
  clone.id = `${source.id}-game-master-clone`;
  clone.name = `${source.name || "Player"} · Game Master clone`;
  clone.ownerType = ParticipantType.AI_STRATEGIST;
  clone.locked = true;
  clone.profileCloneSourceId = source.id;
  clone.profileCloneHash = hash;
  clone.profileVersion = profileVersion;
  return deepFreeze(clone);
}

export function validateSameGameplayProfile(humanProfile, strategistProfile) {
  const humanHash = gameplayProfileHash(humanProfile);
  const strategistHash = gameplayProfileHash(strategistProfile);
  const differences = [];
  if (humanHash !== strategistHash) differences.push("gameplay_profile_hash");
  if (strategistProfile?.profileCloneSourceId !== humanProfile?.id) differences.push("profile_clone_source_id");
  if (strategistProfile?.locked !== true) differences.push("profile_clone_locked");
  return { same_profile: differences.length === 0, differences, human_hash: humanHash, strategist_hash: strategistHash };
}

function mix32(seed) {
  let value = seed >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

export function pairedStrokeSeed(roundSeed, holeNumber, pairedStrokeIndex) {
  if (!Number.isInteger(roundSeed) || roundSeed < 1) throw new Error("roundSeed must be a positive integer");
  if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) throw new Error("holeNumber must be between 1 and 18");
  if (!Number.isInteger(pairedStrokeIndex) || pairedStrokeIndex < 1) throw new Error("pairedStrokeIndex must be positive");
  return mix32(roundSeed ^ Math.imul(holeNumber, 0x9e3779b1) ^ Math.imul(pairedStrokeIndex, 0x85ebca6b)) || 1;
}

export function createPairedExecutionSample(roundSeed, holeNumber, pairedStrokeIndex) {
  const pairedSeed = pairedStrokeSeed(roundSeed, holeNumber, pairedStrokeIndex);
  let state = pairedSeed;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const gaussian = () => {
    const first = Math.max(random(), Number.EPSILON);
    return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * random());
  };
  return Object.freeze({
    id: `pair-${holeNumber}-${pairedStrokeIndex}-${pairedSeed.toString(16)}`,
    paired_seed: pairedSeed,
    hole_number: holeNumber,
    paired_stroke_index: pairedStrokeIndex,
    contact_quantile: random(),
    distance_error_z: gaussian(),
    lateral_error_z: gaussian(),
    mishit_roll: random(),
    putting_read_z: gaussian(),
    putting_pace_z: gaussian()
  });
}

function idFrom(prefix, seed, now) {
  return `${prefix}-${fnv1a(`${seed}:${now}`)}`;
}

export function competitionStorageKey(courseId, playerId = null) {
  const player = playerId == null ? "guest" : `player-${String(playerId)}`;
  return `golfgame-${player}-${courseId}-game-master-competition`;
}

export function createCompetitionRound({ courseId, tee, roundSeed, humanProfile, pace = "normal", coachingEnabled = true, now = new Date().toISOString() }) {
  const strategistProfile = cloneStrategistProfile(humanProfile);
  const fairness = validateSameGameplayProfile(humanProfile, strategistProfile);
  if (!fairness.same_profile) throw new Error(`competition profile mismatch: ${fairness.differences.join(", ")}`);
  const id = idFrom("competition", roundSeed, now);
  return {
    version: COMPETITION_VERSION,
    id,
    mode: CompetitionMode.PLAY_VS_STRATEGIST,
    course_id: courseId,
    tee,
    round_seed: roundSeed,
    status: "active",
    phase: CompetitionPhase.READY_FOR_HUMAN,
    current_hole: 1,
    pace: pace === "fast" ? "fast" : "normal",
    coaching_enabled: coachingEnabled !== false,
    created_at: now,
    profile_clone_source_id: humanProfile.id,
    profile_clone_hash: fairness.human_hash,
    profile_version: strategistProfile.profileVersion,
    human_profile_snapshot: structuredClone(humanProfile),
    strategist_profile: structuredClone(strategistProfile),
    human_participant: { id: `${id}-human`, type: ParticipantType.HUMAN, display_name: "You" },
    strategist_participant: {
      id: `${id}-strategist`, type: ParticipantType.AI_STRATEGIST, display_name: "Game Master",
      strategy_policy: StrategyPolicy.SMART_EXPECTED_SCORE
    },
    strategist_round: createRoundState({ courseId, roundSeed, tee }),
    turns: [],
    paired_execution_samples: [],
    hole_summaries: Array(18).fill(null)
  };
}

export function saveCompetition(storage, competition, playerId = null) {
  storage.setItem(competitionStorageKey(competition.course_id, playerId), JSON.stringify(competition));
  return competition;
}

export function loadCompetition(storage, courseId, playerId = null) {
  const raw = storage.getItem(competitionStorageKey(courseId, playerId));
  if (!raw) return null;
  const competition = JSON.parse(raw);
  if (competition.version !== COMPETITION_VERSION) return null;
  const fairness = validateSameGameplayProfile(competition.human_profile_snapshot, competition.strategist_profile);
  if (!fairness.same_profile) throw new Error("saved competition failed profile fairness validation");
  return competition;
}

export function recoverInterruptedCompetition(competition, { now = new Date().toISOString() } = {}) {
  const interruptedPhases = new Set([
    CompetitionPhase.HUMAN_DECISION_LOCKED,
    CompetitionPhase.GM_DECIDING,
    CompetitionPhase.BOTH_DECISIONS_LOCKED,
    CompetitionPhase.RESOLVING
  ]);
  const turn = competition.turns?.at(-1);
  if (!interruptedPhases.has(competition.phase) || !turn || turn.resolved_at) {
    return { competition: structuredClone(competition), recovered: false, replay_required: false };
  }
  const next = structuredClone(competition);
  const removedTurn = next.turns.pop();
  const holeIndex = removedTurn.hole_number - 1;
  const events = next.human_round?.holes?.[holeIndex]?.events || [];
  const lastEvent = events.at(-1);
  const lastShot = lastEvent?.payload?.shot;
  const decision = removedTurn.human_decision;
  const shotWasCommitted = lastEvent?.event_type === "shot_committed" && lastShot && decision &&
    lastShot.club === decision.club && Number(lastShot.power) === Number(decision.power_percent);
  if (shotWasCommitted) {
    next.human_round = replaceHoleEvents(next.human_round, holeIndex, events.slice(0, -1));
  }
  next.interrupted_turns ||= [];
  next.interrupted_turns.push({
    recovered_at: now,
    turn: removedTurn,
    human_event: shotWasCommitted ? lastEvent : null
  });
  next.phase = CompetitionPhase.READY_FOR_HUMAN;
  return { competition: next, recovered: true, replay_required: Boolean(shotWasCommitted) };
}

export function lockCompetitionDecision(competition, participantType, decision, { now = new Date().toISOString() } = {}) {
  if (![ParticipantType.HUMAN, ParticipantType.AI_STRATEGIST].includes(participantType)) throw new Error("unknown participant type");
  if (participantType === ParticipantType.HUMAN && competition.phase !== CompetitionPhase.READY_FOR_HUMAN) {
    throw new Error("human decision can only be locked when ready for human");
  }
  if (participantType === ParticipantType.AI_STRATEGIST && ![CompetitionPhase.HUMAN_DECISION_LOCKED, CompetitionPhase.GM_DECIDING].includes(competition.phase)) {
    throw new Error("Game Master decision requires a locked human decision");
  }
  const next = structuredClone(competition);
  const turn = participantType === ParticipantType.HUMAN
    ? {
        id: `${competition.id}-h${competition.current_hole}-t${competition.turns.filter(item => item.hole_number === competition.current_hole).length + 1}`,
        hole_number: competition.current_hole,
        paired_stroke_index: competition.turns.filter(item => item.hole_number === competition.current_hole).length + 1,
        human_decision: null,
        strategist_decision: null,
        execution_sample_id: null,
        resolved_at: null
      }
    : next.turns.at(-1);
  const locked = structuredClone(decision);
  locked.decision_locked_at = now;
  locked.decision_hash = fnv1a(stableJson(decision));
  if (participantType === ParticipantType.HUMAN) {
    turn.human_decision = locked;
    next.turns.push(turn);
    next.phase = CompetitionPhase.HUMAN_DECISION_LOCKED;
  } else {
    turn.strategist_decision = locked;
    next.phase = CompetitionPhase.BOTH_DECISIONS_LOCKED;
  }
  return next;
}

export function markGameMasterDeciding(competition) {
  if (competition.phase !== CompetitionPhase.HUMAN_DECISION_LOCKED) throw new Error("human decision must be locked first");
  return { ...structuredClone(competition), phase: CompetitionPhase.GM_DECIDING };
}

export function resolveCompetitionTurn(competition, { humanResult, strategistResult, humanDecisionScore = null, strategistDecisionScore = null, now = new Date().toISOString() }) {
  if (competition.phase !== CompetitionPhase.BOTH_DECISIONS_LOCKED) throw new Error("both decisions must be locked before resolution");
  const next = structuredClone(competition);
  const turn = next.turns.at(-1);
  const sample = createPairedExecutionSample(next.round_seed, turn.hole_number, turn.paired_stroke_index);
  turn.execution_sample_id = sample.id;
  turn.paired_seed = sample.paired_seed;
  turn.simulation_started_at = now;
  turn.human_result = structuredClone(humanResult);
  turn.strategist_result = structuredClone(strategistResult);
  turn.human_decision_score = humanDecisionScore;
  turn.strategist_decision_score = strategistDecisionScore;
  turn.resolved_at = now;
  next.paired_execution_samples.push(sample);
  next.phase = CompetitionPhase.COMPARISON_READY;
  return next;
}

export function continueCompetition(competition) {
  if (competition.phase !== CompetitionPhase.COMPARISON_READY) throw new Error("comparison is not ready");
  return { ...structuredClone(competition), phase: CompetitionPhase.READY_FOR_HUMAN };
}

export function appendStrategistResult(competition, holeIndex, event) {
  const next = structuredClone(competition);
  next.strategist_round = appendHoleEvent(next.strategist_round, holeIndex, event);
  return next;
}

export function strategistHoleState(competition, holeIndex, initialState) {
  return buildHoleBrowserState(competition.strategist_round, holeIndex, initialState);
}

export function expectedScoreCost(summary, { preferredScoringRange = [40, 80] } = {}) {
  const median = Number(summary.median_leave_yards) || 0;
  const [preferredLow, preferredHigh] = preferredScoringRange;
  const preferredPenalty = median >= preferredLow && median <= preferredHigh ? -.12 : 0;
  const recoveryCost = median / 145;
  return Math.round((1 + recoveryCost + (Number(summary.penalty_percent) || 0) * .022 +
    (Number(summary.bunker_percent) || 0) * .009 + (100 - (Number(summary.playable_percent) || 0)) * .005 +
    preferredPenalty) * 1000) / 1000;
}

export function selectSmartExpectedScore(candidates, analysis, options = {}) {
  if (!Array.isArray(candidates) || !candidates.length) throw new Error("strategy candidates are required");
  const evaluated = candidates.map((candidate, inputIndex) => {
    const summary = analysis?.candidates?.[candidate.id];
    if (!summary) return { candidate, expected_score: Number.POSITIVE_INFINITY, inputIndex, summary: null };
    return { candidate, expected_score: expectedScoreCost(summary, options), inputIndex, summary };
  }).sort((first, second) =>
    first.expected_score - second.expected_score ||
    (first.summary?.penalty_percent ?? 100) - (second.summary?.penalty_percent ?? 100) ||
    (second.summary?.playable_percent ?? 0) - (first.summary?.playable_percent ?? 0) ||
    first.inputIndex - second.inputIndex
  );
  const selected = evaluated[0];
  return {
    policy: StrategyPolicy.SMART_EXPECTED_SCORE,
    candidate: selected.candidate,
    expected_score: selected.expected_score,
    summary: selected.summary,
    alternatives: evaluated.slice(1, 3).map(item => ({
      candidate: item.candidate, expected_score: item.expected_score, summary: item.summary
    }))
  };
}

export function competitionTotals(scores, pars) {
  let strokes = 0;
  let par = 0;
  let completed = 0;
  scores.forEach((score, index) => {
    if (!Number.isInteger(score)) return;
    strokes += score;
    par += Number(pars[index]) || 0;
    completed += 1;
  });
  return { strokes, relative_to_par: strokes - par, holes_completed: completed };
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.round(finite.reduce((sum, value) => sum + value, 0) / finite.length) : null;
}

export function recordCompetitionHoleSummary(competition, holeIndex) {
  const humanScore = competition.human_round?.holes?.[holeIndex]?.score;
  const strategistScore = competition.strategist_round?.holes?.[holeIndex]?.score;
  if (!Number.isInteger(humanScore) || !Number.isInteger(strategistScore)) return competition;
  const next = structuredClone(competition);
  const turns = next.turns.filter(turn => turn.hole_number === holeIndex + 1 && turn.resolved_at);
  const rankedTurns = turns.map((turn, index) => {
    const humanExpected = turn.human_decision?.expected_score;
    const strategistExpected = turn.strategist_decision?.expected_score;
    return {
      turn,
      index,
      expectedDifference: Number.isFinite(humanExpected) && Number.isFinite(strategistExpected)
        ? humanExpected - strategistExpected
        : null,
      gradeDifference: (turn.strategist_decision_score ?? 0) - (turn.human_decision_score ?? 0)
    };
  });
  const key = [...rankedTurns].sort((first, second) =>
    Math.abs(second.expectedDifference ?? second.gradeDifference / 100) -
    Math.abs(first.expectedDifference ?? first.gradeDifference / 100)
  )[0] || null;
  const expectedDifferences = rankedTurns.map(item => item.expectedDifference).filter(Number.isFinite);
  const expectedStrategyDifference = expectedDifferences.length
    ? Math.round(expectedDifferences.reduce((sum, value) => sum + value, 0) * 100) / 100
    : null;
  const humanClub = key?.turn.human_decision?.club || "the chosen line";
  const strategistClub = key?.turn.strategist_decision?.club || "its chosen line";
  const edgeOwner = expectedStrategyDifference > 0 ? "The Game Master" : expectedStrategyDifference < 0 ? "You" : "Neither player";
  next.hole_summaries[holeIndex] = {
    hole_number: holeIndex + 1,
    human_score: humanScore,
    strategist_score: strategistScore,
    human_decision_score: average(turns.map(turn => turn.human_decision_score)),
    strategist_decision_score: average(turns.map(turn => turn.strategist_decision_score)),
    expected_strategy_difference: expectedStrategyDifference,
    actual_score_difference: humanScore - strategistScore,
    key_turn: key ? key.index + 1 : null,
    narrative: key
      ? `${edgeOwner} held the modeled strategy edge on shot ${key.index + 1}: you chose ${humanClub}, while the Game Master chose ${strategistClub}. Actual execution is scored separately.`
      : `Both players completed hole ${holeIndex + 1}; no comparable decision pair was recorded.`
  };
  return next;
}

export function competitionRoundSummary(competition, pars) {
  const humanScores = competition.human_round?.holes?.map(hole => hole.score ?? null) || [];
  const strategistScores = competition.strategist_round?.holes?.map(hole => hole.score ?? null) || [];
  const summaries = (competition.hole_summaries || []).filter(Boolean);
  const expected = summaries.map(summary => summary.expected_strategy_difference).filter(Number.isFinite);
  return {
    human: competitionTotals(humanScores, pars),
    strategist: competitionTotals(strategistScores, pars),
    holes_completed: summaries.length,
    expected_strategy_difference: expected.length
      ? Math.round(expected.reduce((sum, value) => sum + value, 0) * 100) / 100
      : null,
    key_holes: [...summaries].sort((first, second) =>
      Math.abs(second.expected_strategy_difference || 0) - Math.abs(first.expected_strategy_difference || 0)
    ).slice(0, 3).map(summary => summary.hole_number)
  };
}
