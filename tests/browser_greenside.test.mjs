import assert from "node:assert/strict";
import test from "node:test";

import {
  GREENSIDE_ENGINE_VERSION,
  deriveGreensideSeed,
  simulateGreensideShot
} from "../packages/simulation/browser_greenside.mjs";

const rectangle = (x1, y1, x2, y2) => [
  { x: x1, y: y1 },
  { x: x2, y: y1 },
  { x: x2, y: y2 },
  { x: x1, y: y2 }
];

function context({ waterFinish = false, ...overrides } = {}) {
  const surfaces = [
    { surface: "fairway", polygon: rectangle(-5, -10, 5, 10), priority: 40, region_id: "fairway" },
    { surface: "green", polygon: rectangle(5, -10, waterFinish ? 10 : 30, 10), priority: 70, region_id: "green" }
  ];
  if (waterFinish) {
    surfaces.push({
      surface: "water",
      polygon: rectangle(10, -10, 30, 10),
      priority: 90,
      region_id: "water"
    });
  }
  return {
    start: { x: 0, y: 0 },
    target: { x: 8, y: 0 },
    pin: { x: 20, y: 0 },
    club_id: "sand_wedge",
    accuracy: 0.88,
    lie_type: "fairway_clean",
    power: 0.9,
    roll_slope_factor: 1,
    break_direction: "right",
    contour_modifier: 1,
    surfaces,
    default_surface: "rough",
    profile_version: "test-profile",
    lie_version: "test-lie",
    ...overrides
  };
}

test("browser greenside packet exactly matches the Python golden result", () => {
  const packet = simulateGreensideShot(
    context(),
    { roundSeed: 90210, holeNumber: 4, strokeIndex: 2 }
  );

  assert.equal(packet.audit.engine_version, GREENSIDE_ENGINE_VERSION);
  assert.equal(packet.audit.shot_seed, "13337505522666382803");
  assert.equal(packet.audit.shot_seed, deriveGreensideSeed(90210, 4, 2).toString());
  assert.equal(packet.quality, "solid");
  assert.equal(packet.carry_yards, 8.64);
  assert.equal(packet.roll_yards, 8.64);
  assert.deepEqual(packet.landing, { x: 8.6435, y: -0.3279 });
  assert.deepEqual(packet.resolved_ball, { x: 17.2932, y: -0.4164 });
  assert.equal(packet.landing_surface, "green");
  assert.equal(packet.resolved_surface, "green");
  assert.equal(packet.remaining_distance_yards, 2.74);
  assert.equal(packet.assessment.execution_assessment, "on_plan");
});

test("recorded greenside seed identity replays the complete packet", () => {
  const identity = { roundSeed: 7319, holeNumber: 12, strokeIndex: 3 };
  assert.deepEqual(
    simulateGreensideShot(context(), identity),
    simulateGreensideShot(context(), identity)
  );
  assert.notDeepEqual(
    simulateGreensideShot(context(), identity),
    simulateGreensideShot(context(), { ...identity, strokeIndex: 4 })
  );
});

test("greenside roll into water receives authoritative relief", () => {
  const packet = simulateGreensideShot(
    context({ waterFinish: true }),
    { roundSeed: 90210, holeNumber: 4, strokeIndex: 2 }
  );

  assert.equal(packet.landing_surface, "green");
  assert.equal(packet.relief.reason, "water");
  assert.equal(packet.relief.penalty_strokes, 1);
  assert.equal(packet.resolved_surface, "green");
  assert.deepEqual(packet.resolved_ball, packet.relief.ball_position);
});

test("browser greenside engine rejects invalid canonical input", () => {
  const identity = { roundSeed: 1, holeNumber: 1, strokeIndex: 1 };
  assert.throws(
    () => simulateGreensideShot(context({ target: { x: Number.NaN, y: 0 } }), identity),
    /target must be a finite point/
  );
  assert.throws(
    () => simulateGreensideShot(context({ accuracy: 2 }), identity),
    /accuracy must be between 0 and 1/
  );
});
