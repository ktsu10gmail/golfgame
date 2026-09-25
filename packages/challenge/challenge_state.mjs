export const CHALLENGE_VERSION = "three-hole-challenge-v1";
export const CHALLENGE_PARTICIPANT_VERSION = "challenge-participant-v1";
export const CHALLENGE_PARS = Object.freeze([3, 4, 5]);

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function emptyHole(slot) {
  return { hole_number: slot + 1, score: null, events: [] };
}

export function createChallengeParticipantState() {
  return {
    version: CHALLENGE_PARTICIPANT_VERSION,
    holes: CHALLENGE_PARS.map((_, slot) => emptyHole(slot))
  };
}

export function validateChallengeHoleRef(hole, slot) {
  if (!hole || typeof hole !== "object") throw new Error(`challenge hole ${slot + 1} is required`);
  if (Number(hole.par) !== CHALLENGE_PARS[slot]) {
    throw new Error(`challenge slot ${slot + 1} must be par ${CHALLENGE_PARS[slot]}`);
  }
  if (!hole.course_id || !hole.course_version_id) throw new Error("challenge hole course/version is required");
  positiveInteger(Number(hole.source_hole_number), "source hole number");
  if (!hole.tee_id) throw new Error("challenge hole tee is required");
  return hole;
}

export function createChallengeState({
  id,
  holes,
  seeds,
  playerProfile,
  gmProfile,
  implementationVersions = {},
  now = new Date().toISOString()
}) {
  if (!id) throw new Error("challenge id is required");
  if (!Array.isArray(holes) || holes.length !== 3) throw new Error("challenge must contain exactly three holes");
  holes.forEach(validateChallengeHoleRef);
  for (const key of ["selection_seed", "pin_condition_seed", "player_execution_seed", "gm_execution_seed"]) {
    positiveInteger(Number(seeds?.[key]), key);
  }
  if (!playerProfile?.id) throw new Error("player profile snapshot is required");
  if (!gmProfile?.id) throw new Error("Game Master profile snapshot is required");
  return {
    version: CHALLENGE_VERSION,
    id,
    type: "RANDOM_3",
    status: "READY",
    current_slot: 0,
    created_at: now,
    updated_at: now,
    completed_at: null,
    seeds: structuredClone(seeds),
    holes: holes.map((hole, slot) => ({
      challenge_slot: slot + 1,
      ...structuredClone(hole),
      status: "READY",
      player_score: null,
      gm_score: null,
      official_leader_after_hole: null
    })),
    player_profile_snapshot: structuredClone(playerProfile),
    gm_profile_snapshot: structuredClone(gmProfile),
    implementation_versions: structuredClone(implementationVersions),
    duration_seconds: null,
    human_state: createChallengeParticipantState(),
    strategist_state: createChallengeParticipantState(),
    strategy_summaries: Array(3).fill(null),
    final_result: null
  };
}

export function validateChallengeState(challenge) {
  if (!challenge || challenge.version !== CHALLENGE_VERSION) throw new Error("unsupported challenge state");
  if (!Array.isArray(challenge.holes) || challenge.holes.length !== 3) throw new Error("challenge must contain three holes");
  challenge.holes.forEach(validateChallengeHoleRef);
  if (!Number.isInteger(challenge.current_slot) || challenge.current_slot < 0 || challenge.current_slot > 2) {
    throw new Error("challenge current slot is invalid");
  }
  return challenge;
}

function totals(challenge, throughSlot = 2) {
  const holes = challenge.holes.slice(0, throughSlot + 1);
  const player = holes.reduce((sum, hole) => sum + (Number.isInteger(hole.player_score) ? hole.player_score : 0), 0);
  const gm = holes.reduce((sum, hole) => sum + (Number.isInteger(hole.gm_score) ? hole.gm_score : 0), 0);
  const completed = holes.filter(hole => Number.isInteger(hole.player_score) && Number.isInteger(hole.gm_score)).length;
  return { player, gm, completed };
}

export function officialMatchState(challenge, throughSlot = challenge.current_slot) {
  validateChallengeState(challenge);
  const score = totals(challenge, throughSlot);
  if (!score.completed) return { ...score, leader: "TIED", margin: 0 };
  const difference = score.player - score.gm;
  return {
    ...score,
    leader: difference < 0 ? "PLAYER" : difference > 0 ? "GAME_MASTER" : "TIED",
    margin: Math.abs(difference)
  };
}

export function challengeScoreToPar(challenge, throughSlot = challenge.current_slot) {
  validateChallengeState(challenge);
  const holes = challenge.holes.slice(0, throughSlot + 1)
    .filter(hole => Number.isInteger(hole.player_score) && Number.isInteger(hole.gm_score));
  const player = holes.reduce((sum, hole) => sum + hole.player_score, 0);
  const gm = holes.reduce((sum, hole) => sum + hole.gm_score, 0);
  const par = holes.reduce((sum, hole) => sum + hole.par, 0);
  return {
    player,
    gm,
    par,
    completed: holes.length,
    player_to_par: player - par,
    gm_to_par: gm - par
  };
}

export function startChallenge(challenge, now = new Date().toISOString()) {
  validateChallengeState(challenge);
  const next = structuredClone(challenge);
  next.status = "IN_PROGRESS";
  next.holes[next.current_slot].status = "IN_PROGRESS";
  next.updated_at = now;
  return next;
}

export function recordChallengeHole(challenge, {
  slot = challenge.current_slot,
  playerScore,
  gmScore,
  humanHole,
  strategistHole,
  strategySummary = null,
  now = new Date().toISOString()
}) {
  validateChallengeState(challenge);
  if (!Number.isInteger(playerScore) || playerScore < 1 || !Number.isInteger(gmScore) || gmScore < 1) {
    throw new Error("both posted hole scores are required");
  }
  const next = structuredClone(challenge);
  const hole = next.holes[slot];
  hole.player_score = playerScore;
  hole.gm_score = gmScore;
  hole.status = "COMPLETE";
  next.human_state.holes[slot] = structuredClone(humanHole);
  next.strategist_state.holes[slot] = structuredClone(strategistHole);
  next.strategy_summaries[slot] = structuredClone(strategySummary);
  const official = officialMatchState(next, slot);
  hole.official_leader_after_hole = { leader: official.leader, margin: official.margin };
  next.updated_at = now;
  if (slot === 2) {
    next.status = "COMPLETE";
    next.completed_at = now;
    const started = Date.parse(next.created_at);
    const finished = Date.parse(now);
    next.duration_seconds = Number.isFinite(started) && Number.isFinite(finished)
      ? Math.max(0, Math.round((finished - started) / 1000))
      : null;
    next.final_result = official;
  } else {
    next.current_slot = slot + 1;
    next.holes[next.current_slot].status = "IN_PROGRESS";
  }
  return next;
}

export function postedScoreRequirement({ completedPlayer, completedGm, postedScore, actor = "GAME_MASTER" }) {
  if (![completedPlayer, completedGm, postedScore].every(Number.isInteger)) return null;
  if (actor !== "GAME_MASTER") return null;
  const scoreToTie = completedGm + postedScore - completedPlayer;
  return {
    score_to_tie: scoreToTie,
    score_to_win: scoreToTie - 1
  };
}

export function compactChallengeForStorage(challenge) {
  const compact = structuredClone(validateChallengeState(challenge));
  for (const participant of [compact.human_state, compact.strategist_state]) {
    for (const hole of participant.holes) {
      for (const event of hole.events || []) {
        const shot = event?.payload?.shot;
        for (const request of [shot?.resultRequest, shot?.puttRequest]) {
          if (request?.context?.surfaces) delete request.context.surfaces;
        }
      }
    }
  }
  return compact;
}
