import test from "node:test";
import assert from "node:assert/strict";

import {
  coursePointToGps,
  createGpsShotEvidenceSnapshot,
  createGpsRoundId,
  createGpsRound,
  completeGpsHole,
  correctGpsRecordedShot,
  firstUnfinishedGpsHoleIndex,
  deleteGpsRecordedShot,
  deleteLastGpsPutt,
  gpsDistanceYards,
  gpsHoleScore,
  holeOutGpsHole,
  gpsHoleReview,
  gpsStrategyWithSelectedTarget,
  gpsRoundComplete,
  gpsRoundReviewAction,
  gpsRoundScore,
  gpsToCoursePoint,
  latestCompletedGpsHoleIndex,
  manualGpsStrategy,
  nextGpsHoleIndex,
  normalizeGpsBallConditions,
  recommendGpsClub,
  undoGpsHoleAction
} from "../packages/gps/browser_gps_mode.mjs";
import {
  gpsReplayConditionDescription,
  gpsReplayFinishDescription,
  gpsReplayOutcomeVsTarget,
  gpsReplayShotEvidence,
  gpsReplaySteps
} from "../packages/gps/browser_gps_replay.mjs";

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

test("holing out from the GPS green records the final putt and completes the hole", () => {
  const hole = createGpsRound("test-course").holes[0];
  hole.tee = { lat: 40.3, lng: -74.6, lie: "Tee" };
  hole.shots.push({ distance_yards: 190, end: { lat: 40.31, lng: -74.61, lie: "Green" } });
  hole.putts = 2;
  assert.equal(holeOutGpsHole(hole), true);
  assert.equal(hole.putts, 3);
  assert.equal(hole.finished, true);
  assert.equal(gpsHoleScore(hole), 4);
  assert.equal(holeOutGpsHole(hole), false);
  assert.equal(hole.putts, 3);
});

test("GPS hole-out action is unavailable before the ball reaches the green", () => {
  const hole = createGpsRound("test-course").holes[0];
  hole.tee = { lat: 40.3, lng: -74.6, lie: "Tee" };
  hole.shots.push({ distance_yards: 190, end: { lat: 40.31, lng: -74.61, lie: "Fairway" } });
  assert.equal(holeOutGpsHole(hole), false);
  assert.equal(gpsHoleScore(hole), 1);
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

test("GPS next-hole navigation wraps from the final hole to hole 1", () => {
  assert.equal(nextGpsHoleIndex(0), 1);
  assert.equal(nextGpsHoleIndex(16), 17);
  assert.equal(nextGpsHoleIndex(17), 0);
});

test("GPS hole review finishes the round instead of wrapping after hole 18", () => {
  const round = createGpsRound("test-course");
  round.holes.forEach(hole => { hole.finished = true; });
  assert.deepEqual(gpsRoundReviewAction(round, 16), { kind: "next", holeIndex: 17 });
  assert.deepEqual(gpsRoundReviewAction(round, 17), { kind: "complete", holeIndex: 17 });

  round.holes[4].finished = false;
  assert.deepEqual(gpsRoundReviewAction(round, 17), { kind: "unfinished", holeIndex: 4 });
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
    { number: 1, label: "Tee shot", club_name: "Driver", power: null, distance_yards: 201, lie: "Tee", conditions: null, target: null },
    { number: 2, label: "2nd shot", club_name: "3 Wood", power: null, distance_yards: 180, lie: null, conditions: null, target: null }
  ]);
  assert.equal(review.green_in_regulation, true);
  assert.equal(review.green_reached_in, 2);
  assert.equal(review.putts, 2);
  assert.equal(review.score, 4);
});

test("completed GPS shots can receive a corrected club and swing in review", () => {
  const hole = createGpsRound("test-course").holes[0];
  hole.finished = true;
  hole.shots.push({ distance_yards: 151, strategy: null });

  const strategy = correctGpsRecordedShot(
    hole,
    0,
    { clubName: "7 Iron", clubIndex: 6, power: 74 },
    "2026-08-25T12:00:00.000Z"
  );

  assert.equal(strategy.club_name, "7 Iron");
  assert.equal(strategy.power, 75);
  assert.equal(strategy.corrected_in_review_at, "2026-08-25T12:00:00.000Z");
  assert.equal(gpsHoleReview(hole, 4).shots[0].club_name, "7 Iron");
});

test("any recorded GPS shot can be deleted and the remaining shots are renumbered", () => {
  const hole = createGpsRound("test-course").holes[0];
  hole.shots.push(
    { distance_yards: 151, strategy: null },
    { distance_yards: 132, strategy: { club_name: "7 Iron", power: 100 } }
  );

  const deleted = deleteGpsRecordedShot(hole, 1);

  assert.equal(deleted.distance_yards, 132);
  assert.equal(hole.shots.length, 1);
  assert.equal(gpsHoleReview(hole, 4).shots[0].number, 1);
  assert.equal(gpsHoleReview(hole, 4).shots[0].club_name, "No shot selected");
  assert.throws(() => deleteGpsRecordedShot(hole, 4), /recorded shot was not found/);
});

test("recorded putts can be deleted one stroke at a time", () => {
  const hole = createGpsRound("test-course").holes[0];
  hole.putts = 2;
  hole.final_stroke = true;
  hole.finished = true;

  assert.equal(deleteLastGpsPutt(hole), true);
  assert.equal(hole.putts, 1);
  assert.equal(hole.finished, true);
  assert.equal(deleteLastGpsPutt(hole), true);
  assert.equal(hole.putts, 0);
  assert.equal(deleteLastGpsPutt(hole), true);
  assert.equal(hole.final_stroke, false);
  assert.throws(() => deleteLastGpsPutt(hole), /no recorded putt/);
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
    target_label: "Center fairway",
    target_course_point: [12, 180],
    target_type: "fairway_center",
    target_source: "player_selected_caddie_option"
  };
  const manual = manualGpsStrategy(recommendation, { clubName: "6 Iron", clubIndex: 4, power: 83 });
  const changedAgain = manualGpsStrategy(manual, { clubName: "6 Iron", clubIndex: 4, power: 70 });

  assert.equal(manual.title, "Player choice");
  assert.equal(manual.power, 75);
  assert.equal(manual.considered_strategy.id, "safe-smart");
  assert.deepEqual(manual.target_course_point, [12, 180]);
  assert.equal(manual.target_label, "Center fairway");
  assert.notEqual(manual.target_course_point, recommendation.target_course_point);
  assert.equal(changedAgain.power, 75);
  assert.equal(changedAgain.considered_strategy.id, "safe-smart");
  assert.deepEqual(changedAgain.target_course_point, [12, 180]);
});

test("GPS map target replaces the prior target and turns the plan into a player choice", () => {
  const strategy = gpsStrategyWithSelectedTarget({
    id: "safe-smart",
    title: "Safe & Smart",
    club_name: "7 Iron",
    club_index: 5,
    power: 75,
    target_label: "Center green",
    target_course_point: [0, 140],
    ball_conditions: { stance: "level", slope: "level", rough_depth: null },
    club_snapshot: { name: "7 Iron", carry_yards: 145 }
  }, {
    coursePoint: [18, 132],
    label: "Fairway target"
  });

  assert.equal(strategy.id, "manual-choice");
  assert.equal(strategy.club_name, "7 Iron");
  assert.equal(strategy.target_label, "Fairway target");
  assert.deepEqual(strategy.target_course_point, [18, 132]);
  assert.equal(strategy.target_source, "player_selected_live_map");
  assert.deepEqual(strategy.considered_strategy.target_course_point, [0, 140]);
  assert.deepEqual(strategy.ball_conditions, { stance: "level", slope: "level", rough_depth: null });
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

test("GPS shot evidence freezes situation, intent, and decision at capture time", () => {
  const start = {
    lie: "Rough",
    course_point: [10, 20],
    conditions: { stance: "above_feet", slope: "uphill", rough_depth: "mild" }
  };
  const strategy = {
    id: "center-left",
    club_name: "7 Iron",
    power: 85,
    target_label: "Center-left green",
    target_type: "green_quadrant",
    target_source: "player_selected_caddie_option",
    target_course_point: [22, 164]
  };
  const snapshot = createGpsShotEvidenceSnapshot(start, strategy, "2026-09-28T12:00:00.000Z");

  assert.deepEqual(snapshot.situation, {
    lie: "Rough",
    conditions: { stance: "above_feet", slope: "uphill", rough_depth: "mild" }
  });
  assert.equal(snapshot.intent.target_label, "Center-left green");
  assert.deepEqual(snapshot.intent.target_course_point, [22, 164]);
  assert.equal(snapshot.intent.target_distance_yards, 144);
  assert.deepEqual(snapshot.decision, {
    club: "7 Iron", swing_effort_percent: 85, choice_source: "selected_plan"
  });
  start.conditions.stance = "level";
  strategy.target_course_point[0] = 99;
  assert.equal(snapshot.situation.conditions.stance, "above_feet");
  assert.deepEqual(snapshot.intent.target_course_point, [22, 164]);
});

test("GPS replay condition labels distinguish sidehill, slope, and rough depth", () => {
  assert.equal(gpsReplayConditionDescription({
    stance: "below_feet", slope: "downhill", rough_depth: "deep"
  }, "Rough"), "Ball below feet · Downhill slope · Heavy rough");
  assert.equal(gpsReplayConditionDescription(null, "Fairway"), "Conditions not recorded");
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

test("GPS replay describes a finish relative to the original pin line", () => {
  assert.equal(gpsReplayFinishDescription([0, 0], [18, 82], [0, 100]), "25 yards short-right");
  assert.equal(gpsReplayFinishDescription([0, 0], [1, 98], [0, 100]), "near the pin");
});

test("GPS replay reports endpoint geometry against the recorded target without diagnosing causality", () => {
  assert.deepEqual(gpsReplayOutcomeVsTarget([0, 0], [0, 174], [27, 163]), {
    available: true,
    lateralYards: 27,
    distanceYards: -11,
    lateralLabel: "27 yd right",
    distanceLabel: "11 yd short",
    summary: "27 yd right and 11 yd short"
  });
  assert.equal(gpsReplayOutcomeVsTarget([0, 0], null, [27, 163]).available, false);
});

test("GPS replay separates a costly bunker result from an ungraded decision", () => {
  const evidence = gpsReplayShotEvidence({
    holeNumber: 7,
    shotIndex: 1,
    pinPoint: [0, 181],
    shot: {
      number: 2,
      start: { lie: "Rough", course_point: [0, 0] },
      end: { lie: "Bunker", course_point: [18, 163] },
      distance_yards: 163,
      strategy: { club_name: "6 Iron", power: 75 }
    }
  });
  assert.equal(evidence.result.label, "Costly result");
  assert.equal(evidence.decision.label, "Decision not graded");
  assert.match(evidence.recorded, /6 Iron at 75% traveled 163 yards from Rough/);
  assert.match(evidence.recorded, /25 yards short-right/);
  assert.match(evidence.comment, /does not grade the decision/);
});

test("GPS replay quotes a saved lower-risk modeled alternative without promising it", () => {
  const evidence = gpsReplayShotEvidence({
    holeNumber: 7,
    shotIndex: 1,
    pinPoint: [0, 181],
    shot: {
      start: { lie: "Rough", course_point: [0, 0] },
      end: { lie: "Bunker", course_point: [18, 163] },
      distance_yards: 163,
      strategy: {
        id: "player-6i",
        club_name: "6 Iron",
        power: 75,
        target_label: "Center-left green",
        target_course_point: [0, 174],
        decision_evidence: {
          selected_choice_id: "player-6i",
          recommended_choice_id: "safe-5i",
          sample_count: 400,
          candidates: [
            { id: "player-6i", club_name: "6 Iron", analysis: { hybrid_outlook: "Higher risk", bunker_percent: 31 } },
            { id: "safe-5i", club_name: "5 Iron", analysis: { hybrid_outlook: "Best", bunker_percent: 14 } }
          ]
        }
      }
    }
  });
  assert.equal(evidence.decision.label, "Higher-risk plan");
  assert.equal(evidence.decision.detail, "6 Iron · Center-left green");
  assert.equal(evidence.outcomeVsTarget.lateralLabel, "18 yd right");
  assert.equal(evidence.outcomeVsTarget.distanceLabel, "11 yd short");
  assert.equal(evidence.target.label, "Center-left green");
  assert.deepEqual(evidence.target.coursePoint, [0, 174]);
  assert.equal(evidence.evidenceType, "modeled");
  assert.match(evidence.comment, /5 Iron modeled 14% bunker risk versus 31%/);
  assert.match(evidence.comment, /did not guarantee/);
  assert.match(evidence.comment, /18 yd right and 11 yd short/);
});

test("GPS replay builds one immutable navigation step per recorded shot", () => {
  const round = createGpsRound("test-course");
  round.holes[0].shots = [{ start: { lie: "Tee" }, end: { lie: "Fairway" }, distance_yards: 210 }];
  round.holes[1].shots = [
    { start: { lie: "Tee" }, end: { lie: "Rough" }, distance_yards: 190 },
    { start: { lie: "Rough" }, end: { lie: "Green" }, distance_yards: 140 }
  ];
  const steps = gpsReplaySteps(round);
  assert.deepEqual(steps.map(step => step.key), ["1:1", "2:1", "2:2"]);
  assert.equal(steps.at(-1).result.label, "Good result");
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
