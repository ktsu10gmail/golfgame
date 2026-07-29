export const ROUND_STATE_VERSION = "round-state-v1";

export function roundStateStorageKey(courseId) {
  return `golfgame-${courseId}-round-state`;
}

function emptyHole(index) {
  return {
    hole_number: index + 1,
    score: null,
    events: []
  };
}

function assertCourseId(courseId) {
  if (!courseId || typeof courseId !== "string") {
    throw new Error("courseId must be a non-empty string");
  }
}

function assertRoundSeed(roundSeed) {
  if (!Number.isInteger(roundSeed) || roundSeed < 1) {
    throw new Error("roundSeed must be a positive integer");
  }
}

function normalizeBall(point) {
  if (Array.isArray(point) && point.length === 2 && point.every(value => Number.isFinite(value))) {
    return [point[0], point[1]];
  }
  if (point && typeof point === "object" && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    return [point.x, point.y];
  }
  throw new Error(`resolved_ball must be a two-number array (received ${JSON.stringify(point)})`);
}

function normalizeEvent(event, sequence) {
  if (!event || typeof event !== "object") throw new Error("event must be an object");
  const normalized = {
    sequence,
    event_type: event.event_type || "shot_committed",
    stroke_index: Number.isInteger(event.stroke_index) ? event.stroke_index : null,
    stroke_count_delta: Number.isInteger(event.stroke_count_delta) ? event.stroke_count_delta : 0,
    penalty_strokes: Number.isInteger(event.penalty_strokes) ? event.penalty_strokes : 0,
    hole_finished: event.hole_finished === true,
    completion_type: event.completion_type ?? null,
    score: Number.isInteger(event.score) ? event.score : null,
    remaining_distance_yards: Number.isFinite(event.remaining_distance_yards)
      ? Math.round((event.remaining_distance_yards + Number.EPSILON) * 100) / 100
      : null,
    resolved_lie: typeof event.resolved_lie === "string" ? event.resolved_lie : null,
    resolved_ball: event.resolved_ball == null ? null : normalizeBall(event.resolved_ball),
    payload: event.payload && typeof event.payload === "object" ? structuredClone(event.payload) : null
  };
  return normalized;
}

function normalizeLegacyHoleArray(value) {
  if (!Array.isArray(value)) {
    return Array.from({ length: 18 }, () => []);
  }
  return Array.from({ length: 18 }, (_, index) => (Array.isArray(value[index]) ? value[index] : []));
}

function normalizeLegacyScores(value) {
  if (!Array.isArray(value)) {
    return Array(18).fill(null);
  }
  return Array.from({ length: 18 }, (_, index) => {
    const score = value[index];
    return Number.isInteger(score) ? score : null;
  });
}

function eventShotPayload(event) {
  const payload = event?.payload;
  if (!payload || typeof payload !== "object") return null;
  if (payload.shot && typeof payload.shot === "object") return structuredClone(payload.shot);
  if (event.event_type === "shot_committed") return structuredClone(payload);
  return null;
}

function applyUnplayableEventToShot(shot, event) {
  if (!shot) return;
  shot.relief = event.payload?.relief ?? shot.relief;
  shot.penalty = event.penalty_strokes;
  shot.resolvedBall = event.resolved_ball ? [...event.resolved_ball] : shot.resolvedBall;
  shot.lie = event.resolved_lie ?? shot.lie;
  shot.remaining = Math.round(event.remaining_distance_yards ?? shot.remaining ?? 0);
  if (shot.resultPacket && shot.relief) {
    shot.resultPacket = {
      ...shot.resultPacket,
      relief: shot.relief,
      remaining_distance_yards: event.remaining_distance_yards ?? shot.resultPacket.remaining_distance_yards
    };
  }
  if (typeof shot.lesson === "string" && shot.relief) {
    const note = `The ball was then declared unplayable; ${shot.relief.relief_type.replaceAll("_", " ")} added one penalty stroke.`;
    shot.lesson = shot.lesson.includes(note) ? shot.lesson : `${shot.lesson} ${note}`;
  }
}

function inferLegacyCompletionType({ score, strokes, penaltyStrokes }) {
  if (!Number.isInteger(score)) return null;
  return score === strokes + penaltyStrokes + 1 ? "gimme" : "holed";
}

function migrateLegacyShot(shot, strokeIndex) {
  const eventPayload = shot && typeof shot === "object" ? structuredClone(shot) : null;
  const landing = Array.isArray(shot?.landing) ? shot.landing : shot?.resolvedBall;
  const resolvedBall = Array.isArray(shot?.resolvedBall) ? shot.resolvedBall : landing;
  const baseEvent = {
    event_type: "shot_committed",
    stroke_index: strokeIndex,
    stroke_count_delta: 1,
    penalty_strokes: shot?.relief?.reason === "unplayable" ? 0 : (Number.isInteger(shot?.penalty) ? shot.penalty : 0),
    resolved_ball: shot?.relief?.reason === "unplayable" ? landing : resolvedBall,
    resolved_lie: shot?.relief?.reason === "unplayable" ? shot?.landingLie : shot?.lie,
    remaining_distance_yards: Number.isFinite(shot?.remaining) ? shot.remaining : null,
    payload: eventPayload
  };
  if (shot?.relief?.reason !== "unplayable") {
    return [baseEvent];
  }
  return [
    {
      ...baseEvent,
      remaining_distance_yards: Number.isFinite(shot?.resultPacket?.remaining_distance_yards)
        ? shot.resultPacket.remaining_distance_yards
        : baseEvent.remaining_distance_yards
    },
    {
      event_type: "declare_unplayable",
      stroke_index: strokeIndex,
      penalty_strokes: Number.isInteger(shot?.penalty) ? shot.penalty : 1,
      resolved_ball: resolvedBall,
      resolved_lie: shot?.lie ?? null,
      remaining_distance_yards: Number.isFinite(shot?.remaining) ? shot.remaining : null,
      payload: eventPayload
    }
  ];
}

export function createRoundState({ courseId, roundSeed, tee = "White" }) {
  assertCourseId(courseId);
  assertRoundSeed(roundSeed);
  return {
    version: ROUND_STATE_VERSION,
    course_id: courseId,
    round_seed: roundSeed,
    tee,
    holes: Array.from({ length: 18 }, (_, index) => emptyHole(index))
  };
}

export function validateRoundState(roundState) {
  if (!roundState || typeof roundState !== "object") throw new Error("roundState must be an object");
  if (roundState.version !== ROUND_STATE_VERSION) throw new Error(`unsupported round state version: ${roundState.version}`);
  assertCourseId(roundState.course_id);
  assertRoundSeed(roundState.round_seed);
  if (!Array.isArray(roundState.holes) || roundState.holes.length !== 18) {
    throw new Error("roundState.holes must contain 18 holes");
  }
  roundState.holes.forEach((hole, index) => {
    if (!hole || typeof hole !== "object") throw new Error(`hole ${index + 1} must be an object`);
    if (!Array.isArray(hole.events)) throw new Error(`hole ${index + 1} events must be an array`);
  });
  return roundState;
}

export function loadRoundState(storage, courseId) {
  assertCourseId(courseId);
  const raw = storage.getItem(roundStateStorageKey(courseId));
  if (!raw) return null;
  return validateRoundState(JSON.parse(raw));
}

export function saveRoundState(storage, roundState) {
  validateRoundState(roundState);
  storage.setItem(roundStateStorageKey(roundState.course_id), JSON.stringify(roundState));
  return roundState;
}

export function resetRoundState(roundState, { roundSeed, tee } = {}) {
  validateRoundState(roundState);
  const next = createRoundState({
    courseId: roundState.course_id,
    roundSeed: roundSeed ?? roundState.round_seed,
    tee: tee ?? roundState.tee
  });
  return next;
}

export function migrateLegacyRoundState(roundStateInput) {
  const {
    courseId,
    roundSeed,
    tee = "White",
    roundHistory,
    scores
  } = roundStateInput || {};
  const next = createRoundState({ courseId, roundSeed, tee });
  const normalizedHistory = normalizeLegacyHoleArray(roundHistory);
  const normalizedScores = normalizeLegacyScores(scores);
  normalizedHistory.forEach((legacyHole, holeIndex) => {
    let migrated = next;
    let strokes = 0;
    let penaltyStrokes = 0;
    for (const shot of legacyHole) {
      const migratedEvents = migrateLegacyShot(shot, strokes + 1);
      for (const event of migratedEvents) {
        migrated = appendHoleEvent(migrated, holeIndex, event);
        if (event.stroke_count_delta) strokes += event.stroke_count_delta;
        if (event.penalty_strokes) penaltyStrokes += event.penalty_strokes;
      }
    }
    const score = normalizedScores[holeIndex];
    if (Number.isInteger(score)) {
      const completionType = inferLegacyCompletionType({ score, strokes, penaltyStrokes });
      const extraStroke = Math.max(0, score - (strokes + penaltyStrokes));
      migrated = appendHoleEvent(migrated, holeIndex, {
        event_type: "hole_finished",
        stroke_index: strokes > 0 ? strokes : null,
        stroke_count_delta: extraStroke,
        hole_finished: true,
        completion_type: completionType,
        score
      });
    }
    next.holes[holeIndex] = migrated.holes[holeIndex];
  });
  return next;
}

export function migrateLegacyRoundStateStorage(storage, roundStateInput) {
  const migrated = migrateLegacyRoundState(roundStateInput);
  return saveRoundState(storage, migrated);
}

export function replaceHoleEvents(roundState, holeIndex, events) {
  validateRoundState(roundState);
  if (!Number.isInteger(holeIndex) || holeIndex < 0 || holeIndex > 17) {
    throw new Error("holeIndex must be between 0 and 17");
  }
  if (!Array.isArray(events)) {
    throw new Error("events must be an array");
  }
  let next = structuredClone(roundState);
  next.holes[holeIndex] = emptyHole(holeIndex);
  for (const event of events) {
    next = appendHoleEvent(next, holeIndex, event);
  }
  return next;
}

export function deriveHoleShotHistory(events) {
  if (!Array.isArray(events)) throw new Error("events must be an array");
  const shots = [];
  for (const event of events) {
    const normalized = normalizeEvent(event, shots.length + 1);
    if (normalized.event_type === "shot_committed") {
      const shot = eventShotPayload(normalized);
      if (!shot) continue;
      shot.resolvedBall = normalized.resolved_ball ? [...normalized.resolved_ball] : shot.resolvedBall;
      shot.lie = normalized.resolved_lie ?? shot.lie;
      if (Number.isFinite(normalized.remaining_distance_yards)) shot.remaining = Math.round(normalized.remaining_distance_yards);
      if (Number.isInteger(normalized.penalty_strokes)) shot.penalty = normalized.penalty_strokes;
      shots.push(shot);
      continue;
    }
    if (normalized.event_type === "declare_unplayable") {
      const shotIndex = Number.isInteger(normalized.payload?.shot_index) ? normalized.payload.shot_index - 1 : shots.length - 1;
      applyUnplayableEventToShot(shots[shotIndex], normalized);
    }
  }
  return shots;
}

export function buildHoleBrowserState(roundState, holeIndex, initialState = {}) {
  validateRoundState(roundState);
  if (!Number.isInteger(holeIndex) || holeIndex < 0 || holeIndex > 17) {
    throw new Error("holeIndex must be between 0 and 17");
  }
  const hole = roundState.holes[holeIndex];
  const reduced = reduceHoleState(hole.events, initialState);
  const shots = deriveHoleShotHistory(hole.events);
  const ball = reduced.ball ?? (initialState.ball ? normalizeBall(initialState.ball) : null);
  const lastShot = shots.at(-1) || null;
  return {
    score: hole.score ?? reduced.score,
    shots,
    ball,
    lie: reduced.lie,
    remaining_distance_yards: reduced.remaining_distance_yards,
    hole_finished: reduced.hole_finished,
    completion_type: reduced.completion_type,
    strokes: reduced.strokes,
    penalty_strokes: reduced.penalty_strokes,
    last_event_type: reduced.last_event_type,
    last_shot_line: lastShot?.start && lastShot?.landing ? [lastShot.start, lastShot.landing] : null
  };
}

export function buildRoundBrowserState(roundState, initialStates = []) {
  validateRoundState(roundState);
  const holes = roundState.holes.map((_, holeIndex) => buildHoleBrowserState(roundState, holeIndex, initialStates[holeIndex] || {}));
  return {
    scores: holes.map(hole => hole.score ?? null),
    round_history: holes.map(hole => hole.shots),
    holes
  };
}

export function appendHoleEvent(roundState, holeIndex, event) {
  validateRoundState(roundState);
  if (!Number.isInteger(holeIndex) || holeIndex < 0 || holeIndex > 17) {
    throw new Error("holeIndex must be between 0 and 17");
  }
  const next = structuredClone(roundState);
  const hole = next.holes[holeIndex];
  hole.events.push(normalizeEvent(event, hole.events.length + 1));
  const reduced = reduceHoleState(hole.events, { ball: null, lie: null });
  hole.score = reduced.score;
  return next;
}

export function reduceHoleState(events, initialState = {}) {
  if (!Array.isArray(events)) throw new Error("events must be an array");
  let state = {
    strokes: 0,
    penalty_strokes: 0,
    score: null,
    ball: initialState.ball ? normalizeBall(initialState.ball) : null,
    lie: initialState.lie ?? null,
    remaining_distance_yards: initialState.remaining_distance_yards ?? null,
    hole_finished: false,
    completion_type: initialState.completion_type ?? null,
    last_event_type: null
  };
  for (const [index, event] of events.entries()) {
    const normalized = normalizeEvent(event, index + 1);
    state = {
      ...state,
      strokes: state.strokes + normalized.stroke_count_delta,
      penalty_strokes: state.penalty_strokes + normalized.penalty_strokes,
      score: normalized.score ?? state.score,
      ball: normalized.resolved_ball ?? state.ball,
      lie: normalized.resolved_lie ?? state.lie,
      remaining_distance_yards: normalized.remaining_distance_yards ?? state.remaining_distance_yards,
      hole_finished: normalized.hole_finished || state.hole_finished,
      completion_type: normalized.completion_type ?? state.completion_type,
      last_event_type: normalized.event_type
    };
  }
  if (state.score == null && state.hole_finished) {
    state.score = state.strokes + state.penalty_strokes;
  }
  return state;
}
