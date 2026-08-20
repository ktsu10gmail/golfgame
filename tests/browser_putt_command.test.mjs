import assert from "node:assert/strict";
import test from "node:test";

import { parsePuttAimInstruction } from "../packages/simulation/browser_putt_command.mjs";

test("putt aim instruction recognizes the cup", () => {
  assert.deepEqual(parsePuttAimInstruction("aim at cup"), {
    offset_inches: 0,
    description: "the cup"
  });
});

test("putt aim instruction recognizes offsets in natural phrasing", () => {
  assert.deepEqual(parsePuttAimInstruction("aim 2 in right to cup"), {
    offset_inches: 2,
    description: "2 in right of the cup"
  });
  assert.deepEqual(parsePuttAimInstruction("Aim 1.5 inches left of the pin"), {
    offset_inches: -1.5,
    description: "1.5 in left of the cup"
  });
});

test("putt aim instruction recognizes cup edges and rejects unrelated text", () => {
  assert.deepEqual(parsePuttAimInstruction("right edge of cup"), {
    offset_inches: 2.125,
    description: "right edge of the cup"
  });
  assert.equal(parsePuttAimInstruction("more power"), null);
});
