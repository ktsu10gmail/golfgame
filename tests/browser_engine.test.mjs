import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ENGINE_VERSION,
  declareUnplayable,
  segmentPolygonEntryProgress,
  simulateFullShot
} from "../packages/simulation/browser_engine.mjs";
import {
  PUTTING_ENGINE_VERSION,
  derivePuttSeed,
  rollPuttAcrossContour,
  simulatePutt
} from "../packages/simulation/browser_putting.mjs";
import { sampleCourseGreenContour } from "../packages/simulation/browser_green_contour.mjs";
import {
  ParticipantType,
  competitionExecutionIdentity
} from "../packages/simulation/competition.mjs";

const METERS_TO_YARDS = 1.09361;
const rectangle = (x1, y1, x2, y2) => [
  { x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }
];

function baseContext(overrides = {}) {
  return {
    start: { x: 0, y: 0 }, target: { x: 140, y: 0 }, pin: { x: 150, y: 0 },
    club: {
      club_id: "7_iron", carry_mean: 133, carry_sd: 9, roll_mean: 7,
      lateral_sd: 12, directional_bias: 3, mishit_probability: .08
    },
    lie: {
      carry_multiplier: 1, roll_multiplier: 1, mishit_multiplier: 1,
      lateral_bias_yards: 0, version: "2026.07.1"
    },
    environment: {
      wind_forward_yards: 0, wind_lateral_yards: 0, wind_roll_multiplier: 1,
      elevation_carry_multiplier: 1, slope_mishit_multiplier: 1, surface_roll_multiplier: 1
    },
    intent: { distance_multiplier: 1, complexity_multiplier: 1, label: "stock" },
    surfaces: [
      { surface: "fairway", polygon: rectangle(75, -25, 145, 25), priority: 10, region_id: "test-fairway" },
      { surface: "green", polygon: rectangle(145, -15, 165, 15), priority: 20, region_id: "test-green" }
    ],
    default_surface: "rough", profile_version: "2026.07.1", ...overrides
  };
}

test("green-edge entry progress distinguishes edge distance from cup distance", () => {
  const green = rectangle(8, -4, 12, 4);
  assert.equal(
    segmentPolygonEntryProgress({ x: 0, y: 0 }, { x: 10, y: 0 }, green),
    .8
  );
  assert.equal(
    segmentPolygonEntryProgress({ x: 9, y: 0 }, { x: 10, y: 0 }, green),
    0
  );
  assert.equal(
    segmentPolygonEntryProgress({ x: 0, y: 8 }, { x: 10, y: 8 }, green),
    null
  );
});

function puttContext(overrides = {}) {
  return {
    start: { x: 0, y: 0 },
    target: { x: -1.0, y: 12 },
    pin: { x: 0, y: 12 },
    profile: {
      make_rate_3ft: 0.9,
      make_rate_6ft: 0.55,
      make_rate_10ft: 0.3,
      putter_range_feet: 60
    },
    read: { feet: 36, direction: "right", start_direction: "left", break_inches: 4 },
    pace_scale: 0.58,
    profile_version: "browser-profile-90",
    ...overrides
  };
}

test("browser packet exactly matches the Python engine golden result", () => {
  const packet = simulateFullShot(baseContext(), { roundSeed: 90210, holeNumber: 4, strokeIndex: 2 });
  assert.equal(packet.audit.engine_version, ENGINE_VERSION);
  assert.equal(packet.audit.shot_seed, "9101625523428572884");
  assert.equal(packet.quality, "solid");
  assert.deepEqual(packet.assessment, {
    decision_assessment: "sound",
    execution_assessment: "on_plan",
    overall_assessment: "good",
    decision_risk: 12,
    risk_label: "Conservative"
  });
  assert.equal(packet.total_yards, 133.19);
  assert.deepEqual(packet.landing, { x: 133.1899, y: -16.8409 });
  assert.equal(packet.landing_surface, "fairway");
  assert.equal(packet.remaining_distance_yards, 23.79);
  assert.equal(packet.path.length, 13);
});

test("recorded seed identity replays the same complete packet", () => {
  const identity = { roundSeed: 7319, holeNumber: 12, strokeIndex: 3 };
  assert.deepEqual(simulateFullShot(baseContext(), identity), simulateFullShot(baseContext(), identity));
});

test("matching competition shots use independent participant rolls", () => {
  const humanIdentity = competitionExecutionIdentity(90210, 4, 2, ParticipantType.HUMAN);
  const strategistIdentity = competitionExecutionIdentity(90210, 4, 2, ParticipantType.AI_STRATEGIST);
  const human = simulateFullShot(baseContext(), humanIdentity);
  const strategist = simulateFullShot(baseContext(), strategistIdentity);
  assert.deepEqual(human, simulateFullShot(baseContext(), humanIdentity));
  assert.deepEqual(strategist, simulateFullShot(baseContext(), strategistIdentity));
  assert.notDeepEqual(human.landing, strategist.landing);
});

test("full shots cap carry at 108 percent while keeping roll separate", () => {
  const club = {
    club_id: "3_wood", carry_mean: 200, carry_sd: 40, roll_mean: 12,
    lateral_sd: 0, directional_bias: 0, mishit_probability: 0
  };
  const environment = {
    wind_forward_yards: 0, wind_lateral_yards: 0, wind_roll_multiplier: 1,
    elevation_carry_multiplier: 2, slope_mishit_multiplier: 1, surface_roll_multiplier: 1
  };
  let longest = null;
  for (let roundSeed = 1; roundSeed <= 100; roundSeed++) {
    const packet = simulateFullShot(baseContext({ club, environment, target: { x: 250, y: 0 } }), {
      roundSeed, holeNumber: 7, strokeIndex: 2
    });
    if (!longest || packet.carry_yards > longest.carry_yards) longest = packet;
    assert.ok(packet.carry_yards <= 216);
    assert.equal(packet.total_yards, Math.round((packet.carry_yards + packet.roll_yards) * 100) / 100);
  }
  assert.equal(longest.carry_yards, 216);
  assert.equal(longest.total_yards, 228);
});

test("authoritative putt packet exactly matches the Python golden result", () => {
  const packet = simulatePutt(puttContext(), { roundSeed: 90210, holeNumber: 4, strokeIndex: 2 });
  assert.equal(packet.audit.engine_version, PUTTING_ENGINE_VERSION);
  assert.equal(packet.audit.shot_seed, derivePuttSeed(90210, 4, 2).toString());
  assert.deepEqual(packet.assessment, {
    decision_assessment: "review",
    execution_assessment: "missed",
    overall_assessment: "bad",
    decision_risk: null,
    risk_label: null
  });
  assert.deepEqual(packet.landing, { x: -0.7965, y: 11.7134 });
  assert.equal(packet.remaining_distance_yards, .85);
  assert.equal(packet.made, false);
  assert.equal(packet.make_probability, 0);
});

test("recorded putt seed identity replays the same complete packet", () => {
  const identity = { roundSeed: 7319, holeNumber: 12, strokeIndex: 3 };
  assert.deepEqual(simulatePutt(puttContext(), identity), simulatePutt(puttContext(), identity));
});

test("a short putt reaching the cup radius retains a nonzero make chance", () => {
  const packet = simulatePutt(puttContext({
    target: { x: 0, y: 1.25 },
    pin: { x: 0, y: 1.25 },
    read: { feet: 3.75, direction: "right", start_direction: "right", break_inches: 0 },
    pace_scale: .06
  }), { roundSeed: 19, holeNumber: 10, strokeIndex: 3 });
  assert.ok(packet.make_probability > 0);
  assert.equal(packet.pace_correct, true);
  assert.equal(packet.correct_decision, true);
});

test("putting read is graded relative to the player-to-cup line on a rotated green", () => {
  const packet = simulatePutt(puttContext({
    start: { x: 0, y: 0 },
    pin: { x: 12, y: 0 },
    target: { x: 12, y: -4 / 36 },
    read: { feet: 12, direction: "right", start_direction: "right", break_inches: 4 },
    pace_scale: .2
  }), { roundSeed: 41, holeNumber: 3, strokeIndex: 2 });

  assert.equal(packet.aim_error_inches, 0);
  assert.equal(packet.player_offset_inches, 4);
  assert.equal(packet.player_offset_direction, "right");
  assert.equal(packet.aim_correct, true);
});

test("contour putt physics preserves calibrated flat-green travel", () => {
  const greenPolygon = rectangle(-8, -8, 8, 8);
  const result = rollPuttAcrossContour({
    start: { x: 0, y: 0 }, target: { x: 0, y: 6 }, pin: { x: 0, y: 6 },
    greenPolygon, holeNumber: 1, desiredTravelYards: 6, contourStrength: 0
  });
  assert.ok(Math.abs(result.totalYards - 6) < .01);
  assert.ok(result.path.length > 10);
  assert.deepEqual(result.path[0], { x: 0, y: 0 });
  assert.deepEqual(result.path.at(-1), result.landing);
});

test("contour putt physics travels farther downhill than uphill", () => {
  const greenPolygon = rectangle(-8, -8, 8, 8);
  const sample = sampleCourseGreenContour([0, 0], greenPolygon.map(({ x, y }) => [x, y]), 1);
  const downhill = { x: sample.downhill_course_x, y: sample.downhill_course_y };
  const roll = direction => rollPuttAcrossContour({
    start: { x: 0, y: 0 },
    target: { x: direction.x * 6, y: direction.y * 6 },
    greenPolygon, holeNumber: 1, desiredTravelYards: 6
  });
  assert.ok(roll(downhill).totalYards > roll({ x: -downhill.x, y: -downhill.y }).totalYards + .1);
});

test("contour putt physics turns a cross-slope putt downhill", () => {
  const greenPolygon = rectangle(-8, -8, 8, 8);
  const sample = sampleCourseGreenContour([0, 0], greenPolygon.map(({ x, y }) => [x, y]), 1);
  const downhill = { x: sample.downhill_course_x, y: sample.downhill_course_y };
  const crossSlope = { x: -downhill.y, y: downhill.x };
  const result = rollPuttAcrossContour({
    start: { x: 0, y: 0 }, target: { x: crossSlope.x * 5, y: crossSlope.y * 5 },
    greenPolygon, holeNumber: 1, desiredTravelYards: 5
  });
  const downhillDeflection = result.landing.x * downhill.x + result.landing.y * downhill.y;
  assert.ok(downhillDeflection > .05);
});

test("contour putt physics supports a changing double-break curve", () => {
  const result = rollPuttAcrossContour({
    start: { x: -6, y: -6 }, target: { x: -6, y: 6 },
    greenPolygon: rectangle(-8, -8, 8, 8), holeNumber: 1, desiredTravelYards: 12
  });
  const lateralSteps = result.path.slice(1).map((point, index) => point.x - result.path[index].x);
  const curvature = lateralSteps.slice(1).map((step, index) => step - lateralSteps[index]);
  assert.ok(Math.min(...curvature) < -.001);
  assert.ok(Math.max(...curvature) > .001);
});

test("authoritative contour putt exposes the replayable curved path", () => {
  const context = puttContext({
    start: { x: 0, y: -4 }, target: { x: 0, y: 4 }, pin: { x: 0, y: 4 },
    read: { feet: 24, direction: "right", start_direction: "left", break_inches: 0,
      slope: "level", slope_degrees: 0, downhill_strength: 0 },
    pace_scale: .4,
    green_polygon: rectangle(-8, -8, 8, 8),
    contour_hole_number: 1,
    contour_strength: 1,
    profile_version: "contour-test"
  });
  const packet = simulatePutt(context, { roundSeed: 90210, holeNumber: 1, strokeIndex: 1 });
  assert.deepEqual(packet.landing, { x: .097, y: 4.4586 });
  assert.equal(packet.path.length, 23);
  assert.deepEqual(packet.path.at(-1), packet.landing);
  assert.equal(packet.audit.contour_physics, true);
  assert.equal(packet.audit.physics_steps, 87);
});

test("authoritative putt uses the course-specific contour key", () => {
  const shared = {
    start: { x: 0, y: -4 }, target: { x: 0, y: 4 }, pin: { x: 0, y: 4 },
    read: { feet: 24, direction: "right", start_direction: "left", break_inches: 0,
      slope: "level", slope_degrees: 0, downhill_strength: 0 },
    pace_scale: .4,
    green_polygon: rectangle(-8, -8, 8, 8),
    contour_hole_number: 1,
    contour_strength: 1,
    profile_version: "seeded-contour-test"
  };
  const identity = { roundSeed: 90210, holeNumber: 1, strokeIndex: 1 };
  const first = simulatePutt(puttContext({ ...shared, contour_key: "course-a:hole-1" }), identity);
  const second = simulatePutt(puttContext({ ...shared, contour_key: "course-a:hole-2" }), identity);

  assert.notDeepEqual(first.path, second.path);
  assert.notDeepEqual(first.landing, second.landing);
});

test("green contour slope changes putt travel and required pace", () => {
  const averageTravel = read => {
    let total = 0;
    for (let roundSeed = 1; roundSeed <= 1000; roundSeed++) {
      total += simulatePutt(puttContext({ read }), { roundSeed, holeNumber: 12, strokeIndex: 3 }).total_yards;
    }
    return total / 1000;
  };
  const levelRead = puttContext().read;
  const downhill = averageTravel({ ...levelRead, slope: "downhill", slope_degrees: 5, downhill_strength: 5 });
  const level = averageTravel(levelRead);
  const uphill = averageTravel({ ...levelRead, slope: "uphill", slope_degrees: 5, downhill_strength: -5 });
  assert.ok(downhill > level);
  assert.ok(level > uphill);
});

test("well-planned long putts meet the calibrated two-foot leave bands", () => {
  const expected = new Map([[20, [50, 65]], [30, [30, 45]], [50, [15, 30]], [70, [10, 20]]]);
  for (const [feet, [minimum, maximum]] of expected) {
    const yards = feet / 3;
    const context = puttContext({
      pin: { x: 0, y: yards },
      target: { x: 0, y: yards },
      read: { feet, direction: "right", start_direction: "left", break_inches: 0 },
      pace_scale: feet / 60
    });
    let insideTwoFeet = 0;
    for (let roundSeed = 1; roundSeed <= 2000; roundSeed++) {
      const packet = simulatePutt(context, { roundSeed, holeNumber: 1, strokeIndex: 1 });
      if (packet.remaining_distance_yards <= .67) insideTwoFeet++;
    }
    const percentage = insideTwoFeet / 20;
    assert.ok(percentage >= minimum && percentage <= maximum, `${feet} ft produced ${percentage}%`);
  }
});

test("putting engine rejects non-finite point inputs", () => {
  const identity = { roundSeed: 90210, holeNumber: 4, strokeIndex: 2 };
  assert.throws(
    () => simulatePutt(puttContext({ target: { x: Number.NaN, y: 12 } }), identity),
    /target must be a finite point/
  );
});

function penaltyContext(surface) {
  return baseContext({
    target: { x: 100, y: 0 }, pin: { x: 150, y: 0 },
    club: {
      club_id: "test_club", carry_mean: 90, carry_sd: 0, roll_mean: 0,
      lateral_sd: 0, directional_bias: 0, mishit_probability: 0
    },
    surfaces: [
      { surface: "tee", polygon: rectangle(-5, -5, 5, 5), priority: 60, region_id: "tee" },
      { surface, polygon: rectangle(80, -20, 120, 20), priority: 100, region_id: `test-${surface}` }
    ]
  });
}

test("authoritative water, out-of-bounds, and unplayable relief are replayable", () => {
  const identity = { roundSeed: 1, holeNumber: 1, strokeIndex: 1 };
  const waterContext = penaltyContext("water");
  const water = simulateFullShot(waterContext, identity);
  assert.deepEqual(water, simulateFullShot(waterContext, identity));
  assert.deepEqual(water.relief, {
    version: "penalty-relief-v1", reason: "water", penalty_strokes: 1,
    relief_type: "water_last_crossing", reference_point: { x: 79.999, y: 0 },
    ball_position: { x: 77.999, y: 0 }, resulting_surface: "rough", resulting_region_id: null
  });
  assert.equal(water.remaining_distance_yards, 72);

  const outContext = penaltyContext("out_of_bounds");
  const out = simulateFullShot(outContext, identity);
  assert.equal(out.relief.relief_type, "stroke_and_distance");
  assert.deepEqual(out.relief.ball_position, { x: 0, y: 0 });
  assert.equal(out.remaining_distance_yards, 150);

  const playable = simulateFullShot(baseContext(), { roundSeed: 90210, holeNumber: 4, strokeIndex: 2 });
  assert.deepEqual(declareUnplayable(baseContext(), playable), declareUnplayable(baseContext(), playable));
  assert.equal(declareUnplayable(baseContext(), playable).reason, "unplayable");
  assert.throws(() => declareUnplayable(waterContext, water), /automatic penalty relief/);
});

function polygonCenter(coordinates) {
  const points = coordinates[0][0] === coordinates.at(-1)[0] && coordinates[0][1] === coordinates.at(-1)[1]
    ? coordinates.slice(0, -1) : coordinates;
  return {
    x: points.reduce((sum, point) => sum + point[0], 0) / points.length * METERS_TO_YARDS,
    y: points.reduce((sum, point) => sum + point[1], 0) / points.length * METERS_TO_YARDS
  };
}

function regionContext(coordinates, surface, regionId) {
  const center = polygonCenter(coordinates);
  const polygon = coordinates.map(([x, y]) => ({ x: x * METERS_TO_YARDS, y: y * METERS_TO_YARDS }));
  const start = { x: center.x, y: Math.min(...polygon.map(point => point.y)) - 10 };
  const carry = Math.hypot(center.x - start.x, center.y - start.y);
  return baseContext({
    start, target: center, pin: center,
    club: {
      club_id: "test_club", carry_mean: carry, carry_sd: 0, roll_mean: 0,
      lateral_sd: 0, directional_bias: 0, mishit_probability: 0
    },
    surfaces: [{ surface, polygon, priority: 100, region_id: regionId }]
  });
}

test("real Meadows and Warrenbrook surfaces resolve through browser packets", async () => {
  const meadow = JSON.parse(await readFile(new URL("../data/themeadow/hole2.json", import.meta.url)));
  const warrenbrook = JSON.parse(await readFile(new URL("../data/warrenbrook/hole6.json", import.meta.url)));
  const meadowWater = meadow.geometries.hazards.find(item => item.lie_catalog_id.includes("water"));
  const warrenbrookWater = warrenbrook.geometries.hazards.find(item => item.lie_catalog_id.includes("water"));
  const cases = [
    [regionContext(meadow.geometries.green_complex.polygon, "green", "meadow-green"), 2, "green"],
    [regionContext(meadowWater.polygon, "water", meadowWater.id), 2, "water"],
    [regionContext(warrenbrook.geometries.green_complex.polygon, "green", "warrenbrook-green"), 6, "green"],
    [regionContext(warrenbrookWater.polygon, "water", warrenbrookWater.id), 6, "water"]
  ];
  for (const [context, holeNumber, expectedSurface] of cases) {
    const packet = simulateFullShot(context, { roundSeed: 1, holeNumber, strokeIndex: 1 });
    assert.equal(packet.landing_surface, expectedSurface);
    assert.ok(packet.landing_region_id);
    if (expectedSurface === "water") {
      assert.equal(packet.relief.reason, "water");
      assert.equal(packet.relief.penalty_strokes, 1);
      assert.notEqual(packet.relief.resulting_surface, "water");
    }
  }
});

test("real Cranbury green and forced-carry water resolve through browser packets", async () => {
  const cranbury = JSON.parse(await readFile(new URL("../data/cranbury-golf-club/hole14.json", import.meta.url)));
  const water = cranbury.geometries.hazards.find(item => item.lie_catalog_id.includes("water"));
  const cases = [
    [regionContext(cranbury.geometries.green_complex.polygon, "green", "cranbury-green"), "green"],
    [regionContext(water.polygon, "water", water.id), "water"]
  ];
  for (const [context, expectedSurface] of cases) {
    const packet = simulateFullShot(context, { roundSeed: 7, holeNumber: 14, strokeIndex: 1 });
    assert.equal(packet.landing_surface, expectedSurface);
    assert.ok(packet.landing_region_id);
    if (expectedSurface === "water") assert.equal(packet.relief.relief_type, "water_last_crossing");
  }
});

test("real Galloping Hill green and water resolve through browser packets", async () => {
  const gallopingHill = JSON.parse(await readFile(new URL("../data/gallopinghills/hole12.json", import.meta.url)));
  const water = gallopingHill.geometries.hazards.find(item => item.lie_catalog_id.includes("water"));
  const cases = [
    [regionContext(gallopingHill.geometries.green_complex.polygon, "green", "galloping-hill-green"), "green"],
    [regionContext(water.polygon, "water", water.id), "water"]
  ];
  for (const [context, expectedSurface] of cases) {
    const packet = simulateFullShot(context, { roundSeed: 11, holeNumber: 12, strokeIndex: 1 });
    assert.equal(packet.landing_surface, expectedSurface);
    assert.ok(packet.landing_region_id);
    if (expectedSurface === "water") assert.equal(packet.relief.relief_type, "water_last_crossing");
  }
});
