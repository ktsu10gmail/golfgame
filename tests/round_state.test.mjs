import assert from "node:assert/strict";
import test from "node:test";

import {
  ROUND_STATE_VERSION,
  appendHoleEvent,
  buildHoleBrowserState,
  buildRoundBrowserState,
  createRoundState,
  loadRoundState,
  migrateLegacyRoundState,
  migrateLegacyRoundStateStorage,
  replaceHoleEvents,
  reduceHoleState,
  resetRoundState,
  roundStateStorageKey,
  saveRoundState
} from "../packages/simulation/round_state.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

test("createRoundState builds a versioned 18-hole document", () => {
  const round = createRoundState({ courseId: "meadows", roundSeed: 90210 });
  assert.equal(round.version, ROUND_STATE_VERSION);
  assert.equal(round.course_id, "meadows");
  assert.equal(round.round_seed, 90210);
  assert.equal(round.holes.length, 18);
  assert.deepEqual(round.holes[0], { hole_number: 1, score: null, events: [] });
});

test("appendHoleEvent stores normalized hole events and updates hole score", () => {
  const round = createRoundState({ courseId: "meadows", roundSeed: 1 });
  const next = appendHoleEvent(round, 0, {
    event_type: "shot_committed",
    stroke_index: 1,
    stroke_count_delta: 1,
    resolved_ball: [12, 3],
    resolved_lie: "Fairway",
    remaining_distance_yards: 145.237
  });
  assert.equal(round.holes[0].events.length, 0);
  assert.equal(next.holes[0].events.length, 1);
  assert.deepEqual(next.holes[0].events[0].resolved_ball, [12, 3]);
  assert.equal(next.holes[0].events[0].remaining_distance_yards, 145.24);
  assert.equal(next.holes[0].score, null);
});

test("reduceHoleState reconstructs transactional ball and scoring state", () => {
  const reduced = reduceHoleState([
    {
      event_type: "shot_committed",
      stroke_index: 1,
      stroke_count_delta: 1,
      resolved_ball: [100, 0],
      resolved_lie: "Water",
      remaining_distance_yards: 72,
      penalty_strokes: 1
    },
    {
      event_type: "declare_unplayable",
      penalty_strokes: 1,
      resolved_ball: [98, 0],
      resolved_lie: "Rough",
      remaining_distance_yards: 74
    },
    {
      event_type: "hole_finished",
      stroke_count_delta: 1,
      hole_finished: true,
      completion_type: "holed",
      score: 4,
      resolved_ball: [150, 0],
      resolved_lie: "Green",
      remaining_distance_yards: 0
    }
  ]);
  assert.equal(reduced.strokes, 2);
  assert.equal(reduced.penalty_strokes, 2);
  assert.equal(reduced.score, 4);
  assert.equal(reduced.hole_finished, true);
  assert.equal(reduced.completion_type, "holed");
  assert.deepEqual(reduced.ball, [150, 0]);
});

test("saveRoundState and loadRoundState persist by course-specific key", () => {
  const storage = memoryStorage();
  const round = createRoundState({ courseId: "cranbury", roundSeed: 7, tee: "Blue" });
  saveRoundState(storage, round);
  assert.ok(storage.getItem(roundStateStorageKey("cranbury")));
  assert.deepEqual(loadRoundState(storage, "cranbury"), round);
});

test("resetRoundState clears holes while preserving course identity", () => {
  const round = appendHoleEvent(createRoundState({ courseId: "warrenbrook", roundSeed: 5 }), 0, {
    stroke_count_delta: 1,
    resolved_ball: [10, 1]
  });
  const reset = resetRoundState(round, { roundSeed: 6 });
  assert.equal(reset.course_id, "warrenbrook");
  assert.equal(reset.round_seed, 6);
  assert.equal(reset.holes[0].events.length, 0);
});

test("migrateLegacyRoundState converts legacy history and scores into append-only hole events", () => {
  const round = migrateLegacyRoundState({
    courseId: "meadows",
    roundSeed: 11,
    tee: "Blue",
    roundHistory: [[
      {
        start: [0, 0],
        landing: [120, 5],
        resolvedBall: [120, 5],
        landingLie: "Fairway",
        lie: "Fairway",
        penalty: 0,
        remaining: 72
      },
      {
        start: [120, 5],
        landing: [148, 0],
        resolvedBall: [148, 0],
        landingLie: "Green",
        lie: "Green",
        penalty: 0,
        remaining: 0
      }
    ]],
    scores: [2]
  });

  assert.equal(round.round_seed, 11);
  assert.equal(round.tee, "Blue");
  assert.equal(round.holes[0].events.length, 3);
  assert.equal(round.holes[0].events[0].event_type, "shot_committed");
  assert.equal(round.holes[0].events[1].stroke_index, 2);
  assert.equal(round.holes[0].events[2].event_type, "hole_finished");
  assert.equal(round.holes[0].events[2].completion_type, "holed");
  assert.equal(round.holes[0].score, 2);
});

test("migrateLegacyRoundState splits legacy unplayable relief into its own event", () => {
  const round = migrateLegacyRoundState({
    courseId: "cranbury",
    roundSeed: 8,
    roundHistory: [[
      {
        start: [0, 0],
        landing: [100, 6],
        resolvedBall: [96, 2],
        landingLie: "Trees",
        lie: "Rough",
        penalty: 1,
        remaining: 88,
        relief: { reason: "unplayable", penalty_strokes: 1, relief_type: "back_on_line" },
        resultPacket: { remaining_distance_yards: 91 }
      }
    ]],
    scores: [3]
  });

  assert.equal(round.holes[0].events.length, 3);
  assert.equal(round.holes[0].events[0].event_type, "shot_committed");
  assert.equal(round.holes[0].events[0].penalty_strokes, 0);
  assert.deepEqual(round.holes[0].events[0].resolved_ball, [100, 6]);
  assert.equal(round.holes[0].events[1].event_type, "declare_unplayable");
  assert.equal(round.holes[0].events[1].penalty_strokes, 1);
  assert.deepEqual(round.holes[0].events[1].resolved_ball, [96, 2]);
  assert.equal(round.holes[0].events[2].completion_type, "gimme");
  assert.equal(round.holes[0].score, 3);
});

test("migrateLegacyRoundStateStorage persists the migrated document by course key", () => {
  const storage = memoryStorage();
  const migrated = migrateLegacyRoundStateStorage(storage, {
    courseId: "warrenbrook",
    roundSeed: 19,
    roundHistory: [],
    scores: []
  });
  assert.equal(migrated.course_id, "warrenbrook");
  assert.deepEqual(loadRoundState(storage, "warrenbrook"), migrated);
});

test("replaceHoleEvents clears and replaces one hole without touching others", () => {
  const seeded = appendHoleEvent(createRoundState({ courseId: "meadows", roundSeed: 22 }), 0, {
    stroke_count_delta: 1,
    resolved_ball: [10, 0]
  });
  const next = appendHoleEvent(seeded, 1, {
    stroke_count_delta: 1,
    resolved_ball: [20, 0]
  });
  const replaced = replaceHoleEvents(next, 0, [{
    stroke_count_delta: 2,
    hole_finished: true,
    score: 2,
    resolved_ball: [30, 1]
  }]);
  assert.equal(replaced.holes[0].events.length, 1);
  assert.equal(replaced.holes[0].score, 2);
  assert.equal(replaced.holes[1].events.length, 1);
});

test("buildHoleBrowserState recovers reload state from persisted round events", () => {
  let round = createRoundState({ courseId: "meadows", roundSeed: 31 });
  round = appendHoleEvent(round, 0, {
    event_type: "shot_committed",
    stroke_index: 1,
    stroke_count_delta: 1,
    resolved_ball: [110, 4],
    resolved_lie: "Trees",
    remaining_distance_yards: 92,
    payload: {
      shot: {
        start: [0, 0],
        landing: [110, 4],
        resolvedBall: [110, 4],
        lie: "Trees",
        lesson: "Missed left."
      }
    }
  });
  round = appendHoleEvent(round, 0, {
    event_type: "declare_unplayable",
    stroke_index: 1,
    penalty_strokes: 1,
    resolved_ball: [104, 2],
    resolved_lie: "Rough",
    remaining_distance_yards: 96,
    payload: {
      shot_index: 1,
      relief: {
        reason: "unplayable",
        relief_type: "unplayable_back_on_line",
        penalty_strokes: 1
      }
    }
  });
  const browserState = buildHoleBrowserState(round, 0, {
    ball: [0, 0],
    lie: "Tee",
    remaining_distance_yards: 150
  });
  assert.equal(browserState.hole_finished, false);
  assert.deepEqual(browserState.ball, [104, 2]);
  assert.equal(browserState.lie, "Rough");
  assert.equal(browserState.penalty_strokes, 1);
  assert.equal(browserState.shots.length, 1);
  assert.equal(browserState.shots[0].remaining, 96);
  assert.equal(browserState.shots[0].penalty, 1);
  assert.equal(browserState.shots[0].relief.reason, "unplayable");
});

test("buildHoleBrowserState preserves replay identity payload for recorded shots", () => {
  const request = { context: { start: { x: 0, y: 0 } }, roundSeed: 77, holeNumber: 4, strokeIndex: 2 };
  const packet = { audit: { shot_seed: "abc123" }, remaining_distance_yards: 18.4 };
  let round = createRoundState({ courseId: "cranbury", roundSeed: 77 });
  round = appendHoleEvent(round, 3, {
    event_type: "shot_committed",
    stroke_index: 2,
    stroke_count_delta: 1,
    resolved_ball: [142, -1],
    resolved_lie: "Green",
    remaining_distance_yards: 18.4,
    payload: {
      shot: {
        start: [120, 0],
        landing: [142, -1],
        resolvedBall: [142, -1],
        resultPacket: packet,
        resultRequest: request
      }
    }
  });
  const browserState = buildHoleBrowserState(round, 3, { ball: [100, 0] });
  assert.deepEqual(browserState.shots[0].resultRequest, request);
  assert.deepEqual(browserState.shots[0].resultPacket, packet);
});

test("buildRoundBrowserState reflects replay reset and full round reset recovery", () => {
  let round = createRoundState({ courseId: "warrenbrook", roundSeed: 50, tee: "Blue" });
  round = appendHoleEvent(round, 0, {
    event_type: "shot_committed",
    stroke_index: 1,
    stroke_count_delta: 2,
    hole_finished: true,
    completion_type: "gimme",
    score: 2,
    resolved_ball: [150, 0],
    resolved_lie: "Green",
    remaining_distance_yards: 0,
    payload: { shot: { start: [0, 0], landing: [150, 0], resolvedBall: [150, 0], lie: "Green" } }
  });
  round = appendHoleEvent(round, 1, {
    event_type: "shot_committed",
    stroke_index: 1,
    stroke_count_delta: 1,
    resolved_ball: [90, 5],
    resolved_lie: "Fairway",
    remaining_distance_yards: 125,
    payload: { shot: { start: [0, 0], landing: [90, 5], resolvedBall: [90, 5], lie: "Fairway" } }
  });
  const replayReset = replaceHoleEvents(round, 1, []);
  const replayState = buildRoundBrowserState(replayReset, [{ ball: [0, 0] }, { ball: [0, 0] }]);
  assert.deepEqual(replayState.scores.slice(0, 2), [2, null]);
  assert.equal(replayState.round_history[1].length, 0);
  const fullReset = resetRoundState(round, { roundSeed: 51, tee: "White" });
  const resetState = buildRoundBrowserState(fullReset, [{ ball: [0, 0] }, { ball: [0, 0] }]);
  assert.equal(fullReset.round_seed, 51);
  assert.equal(fullReset.tee, "White");
  assert.deepEqual(resetState.scores.slice(0, 2), [null, null]);
  assert.equal(resetState.round_history[0].length, 0);
  assert.equal(resetState.round_history[1].length, 0);
});
