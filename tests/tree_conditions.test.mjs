import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTreeCondition,
  treeConditionMessage,
  TREE_CONDITION_INVENTORY
} from "../packages/simulation/browser_tree_conditions.mjs";

const rectangle = (left, bottom, right, top) => [[left, bottom], [right, bottom], [right, top], [left, top]];

test("points outside mapped trees do not receive invented tree conditions", () => {
  assert.equal(evaluateTreeCondition({
    ball: [20, 5], pin: [100, 5], treeZones: [{ id: "left", polygon: rectangle(0, 0, 10, 10) }]
  }), null);
});

test("the visible canopy fringe counts as an edge-of-trees lie", () => {
  const condition = evaluateTreeCondition({
    ball: [12.8, 5], pin: [100, 5], yardsPerUnit: 1,
    treeZones: [{ id: "woods", polygon: rectangle(0, 0, 10, 10) }]
  });
  assert.equal(condition.tree_position, "edge_of_trees");
  assert.equal(condition.inside_mapped_canopy, false);
  assert.equal(condition.pin_line, "clear");
  assert.match(treeConditionMessage(condition), /direct line to the pin is clear of the mapped canopy/);
});

test("a protected playing surface overrides an overlapping tree fringe", () => {
  const condition = evaluateTreeCondition({
    ball: [12.8, 5], pin: [15, 5], yardsPerUnit: 1,
    treeZones: [{ id: "woods", polygon: rectangle(0, 0, 10, 10) }],
    protectedZones: [rectangle(11, 0, 20, 10)]
  });
  assert.equal(condition, null);
});

test("a tee box never receives a tree restriction", () => {
  const teeBox = rectangle(-5, -5, 5, 5);
  const condition = evaluateTreeCondition({
    ball: [0, 0], pin: [0, 150], yardsPerUnit: 1,
    treeZones: [{ id: "tee-side-trees", polygon: rectangle(2, -10, 18, 30) }],
    protectedZones: [teeBox]
  });
  assert.equal(condition, null);
});

test("tree depth selects only inventoried conditions and a stable code", () => {
  const condition = evaluateTreeCondition({
    ball: [10, 10], pin: [100, 10], yardsPerUnit: 1,
    treeZones: [{ id: "woods", polygon: rectangle(0, 0, 30, 30) }],
    fairways: [{ polygon: rectangle(0, 31, 100, 60) }]
  });
  assert.equal(condition.tree_position, "deep_in_trees");
  assert.equal(condition.ball_surface, "deep_rough");
  assert.equal(condition.pin_line, "blocked");
  assert.equal(condition.swing_room, "punch_only");
  assert.ok(TREE_CONDITION_INVENTORY.escape_direction.includes(condition.escape_direction));
  assert.match(condition.code, /^TREE_DEEP-ROUGH_DEEP-IN-TREES_BLOCKED_LOW-BRANCHES_PUNCH-ONLY_/);
});

test("Game Master wording is assembled from verified tree facts", () => {
  const condition = evaluateTreeCondition({
    ball: [1, 5], pin: [100, 5], yardsPerUnit: 1,
    treeZones: [{ id: "woods", polygon: rectangle(0, 0, 6, 10) }],
    fairways: [{ polygon: rectangle(0, 11, 100, 30) }]
  });
  const message = treeConditionMessage({ ...condition, remaining_yards: 164 });
  assert.equal(condition.fairway_entry_yards, 6);
  assert.equal(condition.fairway_end_yards, 25);
  assert.equal(condition.recovery_target_yards, 16);
  assert.deepEqual(condition.recovery_target, [1, 20.5]);
  assert.equal(condition.recovery_angle_degrees, -90);
  assert.equal(condition.recovery_clock, 9);
  assert.match(message, /recovery cards compare a safer punch-out 90° left/);
  assert.match(message, /viable forward-progress alternatives/);
});

test("a blocked pin line describes mapped cover without inventing a solid branch wall", () => {
  const message = treeConditionMessage({
    remaining_yards: 171,
    tree_position: "deep_in_trees",
    ball_surface: "deep_rough",
    pin_line: "blocked",
    canopy: "low_branches",
    swing_room: "punch_only",
    escape_direction: "right",
    escape_destination: "fairway",
    recovery_target_yards: 46,
    recovery_angle_degrees: 90
  });
  assert.match(message, /significant mapped tree cover/);
  assert.match(message, /recovery cards compare a safer punch-out 90° right/);
  assert.doesNotMatch(message, /wall directly between/);
});
