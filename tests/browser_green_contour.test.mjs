import test from "node:test";
import assert from "node:assert/strict";

import {
  contourPuttRead,
  contourPuttStrength,
  greenContourColor,
  greenElevationColor,
  greenContourTransform,
  sampleCourseGreenContour,
  sampleGreenContour
} from "../packages/simulation/browser_green_contour.mjs";

const green = [[0, 0], [20, 0], [20, 16], [0, 16]];

test("generic contour rotates thirty degrees for each hole and mirrors after twelve", () => {
  assert.deepEqual(greenContourTransform(1), { rotation_degrees: 0, mirrored: false });
  assert.deepEqual(greenContourTransform(2), { rotation_degrees: 30, mirrored: false });
  assert.deepEqual(greenContourTransform(12), { rotation_degrees: 330, mirrored: false });
  assert.deepEqual(greenContourTransform(13), { rotation_degrees: 0, mirrored: true });
  assert.deepEqual(greenContourTransform(18), { rotation_degrees: 150, mirrored: true });
});

test("contour sampling is deterministic and produces a usable downhill vector", () => {
  const first = sampleGreenContour(.2, -.15, 6);
  const replay = sampleGreenContour(.2, -.15, 6);
  assert.deepEqual(first, replay);
  assert.ok(first.slope_degrees >= .35 && first.slope_degrees <= 6.8);
  assert.ok(Math.abs(Math.hypot(first.downhill_x, first.downhill_y) - 1) < 1e-8);
});

test("course and hole keys create stable, distinct elevation fields", () => {
  const key = "future-course:hole-4:bunker-aware-green-v1";
  const first = sampleCourseGreenContour([7, 6], green, key);
  const replay = sampleCourseGreenContour([7, 6], green, key);
  const anotherHole = sampleCourseGreenContour([7, 6], green, "future-course:hole-5:bunker-aware-green-v1");

  assert.deepEqual(first, replay);
  assert.notDeepEqual(first, anotherHole);
  assert.deepEqual(greenContourTransform(key), greenContourTransform(key));
  assert.notDeepEqual(greenContourTransform(key), greenContourTransform("future-course:hole-5:bunker-aware-green-v1"));
});

test("course sampling maps the generic slope into the mapped green", () => {
  const sample = sampleCourseGreenContour([10, 8], green, 4);
  assert.ok(Number.isFinite(sample.height));
  assert.ok(Math.abs(Math.hypot(sample.downhill_course_x, sample.downhill_course_y) - 1) < 1e-8);
});

test("putting read follows the same field used by the visual contour", () => {
  const read = contourPuttRead({ start: [4, 4], pin: [16, 12], polygon: green, holeNumber: 7 });
  assert.ok(read.feet > 40);
  assert.ok(["left", "right"].includes(read.direction));
  assert.ok(["uphill", "downhill", "cross-slope"].includes(read.slope));
  assert.ok(read.breakInches >= 0);
  assert.ok(read.slopeDegrees > 0);
});

test("putting distance converts mapped course units to true feet", () => {
  const read = contourPuttRead({
    start: [2, 4],
    pin: [12, 4],
    polygon: green,
    holeNumber: 7,
    yardsPerCoordinateUnit: 1.09361
  });

  assert.ok(Math.abs(read.feet - 32.8083) < 1e-8);
  assert.notEqual(Math.round(read.feet), 30);
});

test("putting distance rejects an invalid course scale", () => {
  assert.throws(() => contourPuttRead({
    start: [2, 4], pin: [12, 4], polygon: green, holeNumber: 7, yardsPerCoordinateUnit: 0
  }), /yardsPerCoordinateUnit/);
});

test("contour influence increases after fifteen feet without changing short putts", () => {
  assert.equal(contourPuttStrength(10), 1);
  assert.equal(contourPuttStrength(15), 1);
  assert.ok(contourPuttStrength(20) > 1);
  assert.equal(contourPuttStrength(25), 2);
  assert.equal(contourPuttStrength(60), 2);
});

test("slope palette has five distinct bands", () => {
  assert.equal(new Set([.5, 1.5, 3, 4.5, 6].map(greenContourColor)).size, 5);
});

test("elevation palette assigns bands by relative height", () => {
  const colors = [0, .2, .4, .6, .8, 1].map(height => greenElevationColor(height, 0, 1));
  assert.equal(new Set(colors).size, 6);
  assert.equal(greenElevationColor(.11, 0, 1), greenElevationColor(.14, 0, 1));
  assert.notEqual(greenElevationColor(.1, 0, 1), greenElevationColor(.9, 0, 1));
});
