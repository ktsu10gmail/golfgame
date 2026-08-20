import test from "node:test";
import assert from "node:assert/strict";
import { unionSimplePolygons } from "../packages/editor/polygon_union.mjs";

function area(points) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
}

test("overlapping shapes merge along their original exposed edges", () => {
  const first = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const second = [[6, 4], [16, 4], [16, 14], [6, 14]];
  const [merged] = unionSimplePolygons([first, second]);

  assert.equal(area(merged), 176);
  assert.ok(merged.some(point => point[0] === 0 && point[1] === 0));
  assert.ok(merged.some(point => point[0] === 16 && point[1] === 14));
  assert.ok(merged.length > 4, "the union must not collapse to a rectangle");
});

test("disconnected shapes remain separate union loops", () => {
  const first = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const second = [[10, 0], [14, 0], [14, 4], [10, 4]];
  assert.equal(unionSimplePolygons([first, second]).length, 2);
});

test("a contained shape does not alter the outer outline", () => {
  const outer = [[0, 0], [20, 0], [20, 20], [0, 20]];
  const inner = [[5, 5], [15, 5], [15, 15], [5, 15]];
  const [merged] = unionSimplePolygons([outer, inner]);
  assert.equal(area(merged), 400);
  assert.equal(merged.length, 4);
});
