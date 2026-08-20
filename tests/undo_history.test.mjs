import test from "node:test";
import assert from "node:assert/strict";

import { createUndoHistory } from "../packages/editor/undo_history.mjs";

test("undo history restores independent snapshots newest first", () => {
  const history = createUndoHistory();
  const state = { features: [] };
  history.push(state, "add bunker");
  state.features.push("bunker");
  history.push(state, "rotate bunker");
  state.features[0] = "rotated bunker";

  assert.equal(history.pop().state.features[0], "bunker");
  assert.deepEqual(history.pop().state.features, []);
  assert.equal(history.pop(), null);
});

test("undo history coalesces rapid edits with the same key", () => {
  let time = 1000;
  const history = createUndoHistory({ coalesceWindowMs: 500, now: () => time });
  assert.equal(history.push({ label: "S" }, "rename", { key: "label-1" }), true);
  time += 200;
  assert.equal(history.push({ label: "Sa" }, "rename", { key: "label-1" }), false);
  time += 600;
  assert.equal(history.push({ label: "Sand" }, "rename", { key: "label-1" }), true);
  assert.equal(history.size, 2);
});

test("undo history enforces its configured limit", () => {
  const history = createUndoHistory({ limit: 2 });
  history.push({ step: 1 }, "one");
  history.push({ step: 2 }, "two");
  history.push({ step: 3 }, "three");
  assert.equal(history.size, 2);
  assert.equal(history.pop().state.step, 3);
  assert.equal(history.pop().state.step, 2);
});
