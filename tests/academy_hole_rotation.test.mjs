import test from "node:test";
import assert from "node:assert/strict";

import {
  academyParFiveIndexes,
  rememberAcademyHole,
  selectAcademyParFiveIndex
} from "../packages/academy/academy_hole_rotation.mjs";

const scorecard = [4, 4, 4, 3, 5, 4, 4, 5, 4, 3, 4, 4, 3, 4, 5, 4, 3, 4]
  .map((Par, index) => ({ Hole: index + 1, Par }));

test("Academy identifies every Par 5 on a course", () => {
  assert.deepEqual(academyParFiveIndexes(scorecard), [4, 7, 14]);
});

test("Academy rotates through Par 5s before repeating one", () => {
  assert.equal(selectAcademyParFiveIndex(scorecard, []), 4);
  assert.equal(selectAcademyParFiveIndex(scorecard, [5]), 7);
  assert.equal(selectAcademyParFiveIndex(scorecard, [8, 5]), 14);
  assert.equal(selectAcademyParFiveIndex(scorecard, [15, 8, 5]), 4);
});

test("Academy recent-hole history remains newest-first without duplicates", () => {
  assert.deepEqual(rememberAcademyHole([8, 5], 15), [15, 8, 5]);
  assert.deepEqual(rememberAcademyHole([15, 8, 5], 8), [8, 15, 5]);
});

test("Academy safely handles courses without a Par 5", () => {
  assert.equal(selectAcademyParFiveIndex([{ Hole: 1, Par: 4 }], []), -1);
});
