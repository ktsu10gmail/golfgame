import test from "node:test";
import assert from "node:assert/strict";

import {
  ROUND_SAVE_VERSION,
  createRoundSave,
  parseRoundSave,
  roundSaveFilename
} from "../packages/simulation/round_save.mjs";
import { appendHoleEvent, createRoundState } from "../packages/simulation/round_state.mjs";

const PROFILE = {
  id: "90",
  name: "90+ player",
  clubs: [
    { name: "Driver", carry: 220, accuracy: 56 },
    { name: "Putter", carry: 20, accuracy: 100 }
  ]
};

function playedRound() {
  const round = createRoundState({ courseId: "meadows", roundSeed: 12345, tee: "White" });
  return appendHoleEvent(round, 0, {
    stroke_index: 1,
    stroke_count_delta: 1,
    remaining_distance_yards: 184.5,
    resolved_lie: "Fairway",
    resolved_ball: [142.5, 8],
    payload: { shot: { club: "Driver", power: 100 } }
  });
}

test("portable save retains round position, player, and replay state", () => {
  const save = createRoundSave({
    roundState: playedRound(),
    currentHoleIndex: 0,
    pinIndex: 2,
    playerProfile: PROFILE,
    roundSummary: {
      course_name: "The Meadows at Middlesex", tee: "White", holes_completed: 1,
      total_strokes: 1, total_par: 5, score_to_par: -4,
      strategy_score: 82, execution_score: 74, scored_shots: 1
    },
    savedAt: "2026-07-30T12:00:00.000Z"
  });

  const restored = parseRoundSave(JSON.stringify(save));

  assert.equal(restored.version, ROUND_SAVE_VERSION);
  assert.equal(restored.course_id, "meadows");
  assert.equal(restored.round_state.round_seed, 12345);
  assert.equal(restored.round_state.holes[0].events.length, 1);
  assert.equal(restored.player_profile.name, "90+ player");
  assert.equal(restored.current_hole_index, 0);
  assert.equal(restored.pin_index, 2);
  assert.equal(restored.round_summary.strategy_score, 82);
  assert.equal(roundSaveFilename(restored), "meadows-hole-1-2026-07-30.golfround");
});

test("portable save is detached from live round and profile objects", () => {
  const round = playedRound();
  const profile = structuredClone(PROFILE);
  const save = createRoundSave({
    roundState: round,
    currentHoleIndex: 3,
    pinIndex: 1,
    playerProfile: profile
  });

  round.holes[0].events.length = 0;
  profile.name = "Changed";

  assert.equal(save.round_state.holes[0].events.length, 1);
  assert.equal(save.player_profile.name, "90+ player");
});

test("portable save rejects unsupported and malformed files", () => {
  assert.throws(() => parseRoundSave("not json"), /not valid JSON/);
  assert.throws(
    () => parseRoundSave(JSON.stringify({ version: "old-save" })),
    /unsupported save file version/
  );
  const save = createRoundSave({
    roundState: playedRound(),
    currentHoleIndex: 0,
    pinIndex: 2,
    playerProfile: PROFILE
  });
  save.course_id = "cranbury";
  assert.throws(() => parseRoundSave(JSON.stringify(save)), /course does not match/);
});
