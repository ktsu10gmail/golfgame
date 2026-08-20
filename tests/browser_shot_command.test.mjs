import assert from "node:assert/strict";
import test from "node:test";

import { parseShotTargetInstruction } from "../packages/simulation/browser_shot_command.mjs";

test("parses a landing distance, quoted offset, and rollout as separate intentions", () => {
  const parsed = parseShotTargetInstruction('sand wedge aim 8 yard from ball and let ball roll to cup, aim 14" right');
  assert.equal(parsed.landing_yards, 8);
  assert.equal(parsed.lateral_inches, 14);
  assert.equal(parsed.lateral_direction, "right");
  assert.equal(parsed.roll_to_cup, true);
  assert.equal(parsed.explicit_pin_aim, false);
});

test("roll-to-cup language is not mistaken for an aim-at-cup command", () => {
  const parsed = parseShotTargetInstruction("let the ball roll toward the cup");
  assert.equal(parsed.roll_to_cup, true);
  assert.equal(parsed.explicit_pin_aim, false);
});

test("recognizes explicit pin aim and common inch spellings", () => {
  assert.equal(parseShotTargetInstruction("aim at the pin").explicit_pin_aim, true);
  assert.equal(parseShotTargetInstruction("aim 12 inches left").lateral_inches, 12);
  assert.equal(parseShotTargetInstruction("aim 12″ left").lateral_direction, "left");
});

test("exposes target language even when the landing instruction is unclear", () => {
  const parsed = parseShotTargetInstruction("aim somewhere about eight yards ahead");
  assert.equal(parsed.mentions_targeting, true);
  assert.equal(parsed.landing_yards, null);
  assert.equal(parsed.explicit_pin_aim, false);
});

test("understands target-distance and pin-line language with common typing slips", () => {
  const parsed = parseShotTargetInstruction(
    "Use Gap wedge 50% power, Aaim pin, target distanc eis 40 yard let the ball rolll to pin"
  );
  assert.equal(parsed.landing_yards, 40);
  assert.equal(parsed.explicit_pin_aim, true);
  assert.equal(parsed.roll_to_cup, true);
});

test("understands a pin line followed by a landing target at a stated distance", () => {
  const parsed = parseShotTargetInstruction(
    "aim pin target at 13 yard distance and let the ball roll to cup"
  );
  assert.equal(parsed.landing_yards, 13);
  assert.equal(parsed.explicit_pin_aim, true);
  assert.equal(parsed.roll_to_cup, true);
});
