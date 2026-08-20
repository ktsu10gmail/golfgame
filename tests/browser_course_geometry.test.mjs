import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { expandSandHazards, sandHazardScaleForCourse } from "../packages/simulation/browser_course_geometry.mjs";

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [x1, y1] = polygon[index];
    const [x2, y2] = polygon[previous];
    if (((y1 > point[1]) !== (y2 > point[1])) &&
        point[0] < (x2 - x1) * (point[1] - y1) / ((y2 - y1) || 1e-9) + x1) inside = !inside;
  }
  return inside;
}

test("doubled gameplay bunker contains the recent Meadows third-shot result", () => {
  const hole = JSON.parse(fs.readFileSync(new URL("../data/themeadow/hole1.json", import.meta.url), "utf8"));
  const ball = [24.211411105290797, 430.82761115282074];
  const bunker = hole.geometries.hazards.find(hazard => hazard.id === "bunker_h1_greenside_left_3");
  assert.equal(pointInPolygon(ball, bunker.polygon), false);

  const expanded = expandSandHazards(hole, 2);
  const expandedBunker = expanded.geometries.hazards.find(hazard => hazard.id === bunker.id);
  assert.equal(pointInPolygon(ball, expandedBunker.polygon), true);
  assert.notDeepEqual(expandedBunker.polygon, bunker.polygon);
});

test("bunker expansion leaves water geometry unchanged", () => {
  const hole = {
    geometries: {
      hazards: [
        { id: "sand", lie_catalog_id: "lie_hazard_sand", polygon: [[0, 0], [2, 0], [2, 2], [0, 2]] },
        { id: "water", lie_catalog_id: "lie_hazard_water", polygon: [[5, 5], [7, 5], [7, 7], [5, 7]] }
      ]
    }
  };
  const expanded = expandSandHazards(hole, 2);
  assert.deepEqual(expanded.geometries.hazards[1].polygon, hole.geometries.hazards[1].polygon);
  assert.notDeepEqual(expanded.geometries.hazards[0].polygon, hole.geometries.hazards[0].polygon);
});

test("editor-installed courses keep authored bunker dimensions", () => {
  const editorHole = {
    hole_metadata: {
      geometry_calibration: { hazards_authored_at_game_scale: true }
    }
  };
  const existingMeadowsHole = {
    hole_metadata: {
      geometry_calibration: { method: "User-aligned local hole artwork transformed from mapped coordinates" }
    }
  };
  assert.equal(sandHazardScaleForCourse({ isCustomMap: true }, editorHole), 1);
  assert.equal(sandHazardScaleForCourse({ isCustomMap: true }, existingMeadowsHole), 1);
  assert.equal(sandHazardScaleForCourse({ isCustomMap: true }, null), 2);
  assert.equal(sandHazardScaleForCourse({ isCustomMap: false }), 2);
  assert.equal(sandHazardScaleForCourse(null), 2);
});
