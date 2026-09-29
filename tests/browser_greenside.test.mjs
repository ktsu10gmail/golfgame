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
  assert.deepEqual(packet.resolved_ball, { x: 17.268, y: -0.9935 });
  assert.equal(packet.landing_surface, "green");
  assert.equal(packet.resolved_surface, "green");
  assert.equal(packet.remaining_distance_yards, 2.91);
  assert.equal(packet.assessment.execution_assessment, "on_plan");
  assert.doesNotThrow(() => structuredClone(packet));
  assert.equal(
    packet.audit.modifiers.find(modifier => modifier.name === "greenside_roll_ratio")?.value,
    1
  );
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

test("landing-target nominal carry remains probabilistic and club rollout remains distinct", () => {
  const identity = { roundSeed: 7319, holeNumber: 12, strokeIndex: 3 };
  const sandWedge = simulateGreensideShot(context({
    target: { x: 16, y: 0 },
    nominal_carry_yards: 16,
    power: .32
  }), identity);
  const nineIron = simulateGreensideShot(context({
    target: { x: 16, y: 0 },
    nominal_carry_yards: 16,
    power: .14,
    club_id: "9_iron"
  }), identity);
  assert.notEqual(sandWedge.carry_yards, 16);
  assert.ok(sandWedge.carry_yards > 12 && sandWedge.carry_yards < 20);
  assert.equal(sandWedge.audit.nominal_carry_yards, 16);
  assert.equal(nineIron.carry_yards, sandWedge.carry_yards);
  assert.ok(nineIron.roll_yards > sandWedge.roll_yards);
});

test("landing-target carry reuses lie-specific greenside variability", () => {
  const identity = { roundSeed: 1804, holeNumber: 8, strokeIndex: 2 };
  const fairway = simulateGreensideShot(context({ nominal_carry_yards: 16, lie_type: "fairway_clean" }), identity);
  const bunker = simulateGreensideShot(context({ nominal_carry_yards: 16, lie_type: "bunker_greenside" }), identity);
  assert.notEqual(bunker.carry_yards, fairway.carry_yards);
  assert.ok(Math.abs(bunker.carry_yards - 16) > Math.abs(fairway.carry_yards - 16));
  assert.equal(Math.round(bunker.roll_yards / bunker.carry_yards * 100), 35);
  assert.ok(bunker.roll_yards < fairway.roll_yards);
});

test("rollout preserves the incoming direction instead of snapping toward the cup", () => {
  const packet = simulateGreensideShot(context({
    target: { x: 10, y: 0 },
    pin: { x: 20, y: 15 },
    surfaces: [
      { surface: "green", polygon: rectangle(-5, -10, 40, 30), priority: 70, region_id: "green" }
    ]
  }), { roundSeed: 90210, holeNumber: 4, strokeIndex: 2 });
  const [start, landing, firstRoll] = packet.path;
  const incoming = { x: landing.x - start.x, y: landing.y - start.y };
  const outgoing = { x: firstRoll.x - landing.x, y: firstRoll.y - landing.y };
  const cosine = (incoming.x * outgoing.x + incoming.y * outgoing.y) /
    (Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y));

  assert.ok(packet.path.length > 3, "roll should contain progressive contour samples");
  assert.ok(cosine > .995, `landing direction changed too sharply: ${cosine}`);
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

test("an overshot landing continues forward instead of rolling backward toward the cup", () => {
  const packet = simulateGreensideShot(
    context({
      target: { x: 20, y: 0 },
      pin: { x: 10, y: 0 },
      accuracy: 1,
      surfaces: [
        { surface: "fairway", polygon: rectangle(-5, -10, 5, 10), priority: 40, region_id: "fairway" },
        { surface: "green", polygon: rectangle(5, -10, 50, 10), priority: 70, region_id: "green" }
      ]
    }),
    { roundSeed: 972206328, holeNumber: 10, strokeIndex: 4 }
  );

  assert.ok(packet.landing.x > 10, "carry should finish beyond the cup");
  assert.ok(packet.resolved_ball.x > packet.landing.x, "roll must continue forward");
  assert.equal(packet.resolved_surface, "green");
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
