import test from "node:test";
import assert from "node:assert/strict";

import {
  coursePointToGps,
  createGpsRoundId,
  createGpsRound,
  completeGpsHole,
  firstUnfinishedGpsHoleIndex,
  gpsDistanceYards,
  gpsHoleScore,
  gpsHoleReview,
  gpsRoundComplete,
  gpsRoundScore,
  gpsToCoursePoint,
  latestCompletedGpsHoleIndex,
  manualGpsStrategy,
  normalizeGpsBallConditions,
  recommendGpsClub,
  undoGpsHoleAction
} from "../packages/gps/browser_gps_mode.mjs";

const calibration = {
  origin: { lat: 40.3, lng: -74.6 },
  matrix: {
    east_meters_per_course_x: .95,
    east_meters_per_course_y: .08,
    north_meters_per_course_x: -.04,
    north_meters_per_course_y: 1.03
  }
};

test("GPS calibration round-trips a course point", () => {
  const point = [31.5, 284.25];
  const gps = coursePointToGps(calibration, point);
  const restored = gpsToCoursePoint(calibration, gps);
  assert.ok(Math.abs(restored[0] - point[0]) < .03);
  assert.ok(Math.abs(restored[1] - point[1]) < .03);
  assert.ok(gpsDistanceYards(calibration.origin, gps) > 300);
});

test("GPS round scoring separates completed shots, putts, and final stroke", () => {
  const round = createGpsRound("test-course");
  assert.match(round.round_id, /^gps-[A-Za-z0-9-]+$/);
  assert.equal(round.revision, 0);
  const hole = round.holes[0];
  hole.tee = { lat: 40.3, lng: -74.6 };
  hole.shots.push({ distance_yards: 190 }, { distance_yards: 140 }, { distance_yards: 42 });
  hole.putts = 1;
  hole.final_stroke = true;
  hole.finished = true;
  assert.equal(gpsHoleScore(hole), 5);
  assert.equal(gpsRoundScore(round), 5);
});

test("completing a GPS hole does not add a stroke", () => {
  const hole = createGpsRound("test-course").holes[0];
  hole.tee = { lat: 40.3, lng: -74.6 };
  hole.shots.push({ distance_yards: 190 }, { distance_yards: 120 });
  hole.putts = 2;
  assert.equal(completeGpsHole(hole), true);
  assert.equal(hole.finished, true);
  assert.equal(hole.final_stroke, false);
  assert.equal(gpsHoleScore(hole), 4);
  assert.equal(completeGpsHole(hole), false);
});

test("GPS round IDs are distinct", () => {
  assert.notEqual(createGpsRoundId(), createGpsRoundId());
});

test("GPS completion identifies the first unfinished hole", () => {
  const round = createGpsRound("test-course");
  round.holes.forEach(hole => { hole.finished = true; });
  assert.equal(gpsRoundComplete(round), true);
  assert.equal(firstUnfinishedGpsHoleIndex(round), -1);

  round.holes[3].finished = false;
  assert.equal(gpsRoundComplete(round), false);
  assert.equal(firstUnfinishedGpsHoleIndex(round), 3);
});

test("GPS hole review finds the nearest completed hole", () => {
  const round = createGpsRound("test-course");
  assert.equal(latestCompletedGpsHoleIndex(round, 4), -1);
  round.holes[1].finished = true;
  round.holes[3].finished = true;
  assert.equal(latestCompletedGpsHoleIndex(round, 4), 3);
  assert.equal(latestCompletedGpsHoleIndex(round, 2), 1);
  assert.equal(latestCompletedGpsHoleIndex(round, 0), 3);
});

test("GPS hole review lists shots and determines GIR", () => {
  const hole = createGpsRound("test-course").holes[0];
  hole.tee = { lat: 40.3, lng: -74.6 };
  hole.shots = [
    { distance_yards: 201.4, strategy: { club_name: "Driver" }, end: { lie: "Fairway" } },
    { distance_yards: 179.6, strategy: { club_name: "3 Wood" }, end: { lie: "Green" } }
  ];
  hole.putts = 2;
  hole.finished = true;
  const review = gpsHoleReview(hole, 4);
  assert.deepEqual(review.shots, [
    { number: 1, label: "Tee shot", club_name: "Driver", distance_yards: 201 },
    { number: 2, label: "2nd shot", club_name: "3 Wood", distance_yards: 180 }
  ]);
  assert.equal(review.green_in_regulation, true);
  assert.equal(review.green_reached_in, 2);
  assert.equal(review.putts, 2);
  assert.equal(review.score, 4);
});

test("GPS undo walks backward through hole completion, putts, shots, and tee", () => {
  const hole = createGpsRound("test-course").holes[0];
  hole.tee = { lat: 40.3, lng: -74.6 };
  hole.shots.push({ distance_yards: 190 });
  hole.putts = 1;
  hole.final_stroke = true;
  hole.finished = true;
  assert.equal(undoGpsHoleAction(hole), "hole completion");
  assert.equal(undoGpsHoleAction(hole), "putt");
  assert.equal(undoGpsHoleAction(hole), "ball location");
  assert.equal(undoGpsHoleAction(hole), "tee location");
  assert.equal(undoGpsHoleAction(hole), null);
});

test("manual GPS club and power retain the caddie plan that was considered", () => {
  const recommendation = {
    id: "safe-smart",
    title: "Safe & Smart",
    club_name: "5 Hybrid",
    club_index: 3,
    power: 90,
    target_label: "Center fairway"
  };
  const manual = manualGpsStrategy(recommendation, { clubName: "6 Iron", clubIndex: 4, power: 83 });
  const changedAgain = manualGpsStrategy(manual, { clubName: "6 Iron", clubIndex: 4, power: 70 });

  assert.equal(manual.title, "Player choice");
  assert.equal(manual.power, 75);
  assert.equal(manual.considered_strategy.id, "safe-smart");
  assert.equal(changedAgain.power, 75);
  assert.equal(changedAgain.considered_strategy.id, "safe-smart");
});

test("GPS ball conditions normalize defaults and rough depth", () => {
  assert.deepEqual(normalizeGpsBallConditions(null, "Fairway"), {
    stance: "level", slope: "level", rough_depth: null
  });
  assert.deepEqual(normalizeGpsBallConditions({
    stance: "above_feet", slope: "uphill", rough_depth: "deep"
  }, "Rough"), {
    stance: "above_feet", slope: "uphill", rough_depth: "deep"
  });
  assert.deepEqual(normalizeGpsBallConditions({
    stance: "invalid", slope: "invalid", rough_depth: "mild"
  }, "Bunker"), {
    stance: "level", slope: "level", rough_depth: null
  });
  assert.deepEqual(normalizeGpsBallConditions(null, "Rough"), {
    stance: "level", slope: "level", rough_depth: "light"
  });
});

test("GPS club recommendation matches profile carry and favors a fuller swing", () => {
  const clubs = [
    { name: "Driver", carry: 220, accuracy: 56 },
    { name: "3 Wood", carry: 200, accuracy: 61 },
    { name: "7 Iron", carry: 142, accuracy: 75 },
    { name: "9 Iron", carry: 118, accuracy: 81 },
    { name: "Pitching Wedge", carry: 105, accuracy: 83 },
    { name: "Sand Wedge", carry: 72, accuracy: 85 },
    { name: "Lob Wedge", carry: 55, accuracy: 82 },
    { name: "Putter", carry: 20, accuracy: 100 }
  ];

  assert.deepEqual(
    (({ clubName, power }) => ({ clubName, power }))(recommendGpsClub(clubs, 118)),
    { clubName: "9 Iron", power: 100 }
  );
  assert.deepEqual(
    (({ clubName, power }) => ({ clubName, power }))(recommendGpsClub(clubs, 55)),
    { clubName: "Lob Wedge", power: 100 }
  );
  assert.equal(recommendGpsClub(clubs, 218, { lie: "Fairway" }).clubName, "3 Wood");
  assert.equal(recommendGpsClub(clubs, 218, { lie: "Tee" }).clubName, "Driver");
});

test("GPS club recommendation adjusts expected carry for the lie", () => {
  const clubs = [
    { name: "7 Iron", carry: 142, accuracy: 75 },
    { name: "8 Iron", carry: 130, accuracy: 78 },
    { name: "Putter", carry: 20, accuracy: 100 }
  ];
  const match = recommendGpsClub(clubs, 128, { distanceMultiplier: .9 });
  assert.equal(match.clubName, "7 Iron");
  assert.equal(match.power, 100);
  assert.ok(Math.abs(match.expectedYards - 127.8) < .01);
});
