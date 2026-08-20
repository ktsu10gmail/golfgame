import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGameCoursePackage,
  buildGameHoleJson,
  buildHoleGpsCalibration,
  buildAutoDraft,
  alignSecondaryTeesFromWhite,
  buildTreeBrushPolygon,
  createEngineTransform,
  createMapperProject,
  distanceMeters,
  gpsDeltaMeters,
  holeMappingStatus,
  offsetGpsPoint,
  coursePointToGps,
  parseGpsCoordinatePair,
  parseMapperProject,
  parseScorecardText,
  polygonsOverlap,
  quarterTurnGpsBounds,
  restoreMappedHoleFromGame,
  roundedGpsBounds,
  roundedGpsRectangle,
  resampleGpsPolygon,
  rotateGpsPolygon,
  scaleGpsPolygon,
  scaleGpsPointAround
} from "../packages/editor/course_mapper.mjs";
import { gamePreviewBounds, gamePreviewProjector, renderGameMapPreview } from "../packages/editor/game_map_preview.mjs";

const ORIGIN = { lat: 40.5, lng: -74.4 };

function rectangle(center, eastHalf, northHalf) {
  return [
    offsetGpsPoint(center, -eastHalf, -northHalf),
    offsetGpsPoint(center, eastHalf, -northHalf),
    offsetGpsPoint(center, eastHalf, northHalf),
    offsetGpsPoint(center, -eastHalf, northHalf)
  ];
}

function mappedProject() {
  const project = createMapperProject({
    courseName: "Test Links",
    courseId: "test-links",
    address: "1 Test Course Drive"
  });
  const hole = project.holes["1"];
  const pin = offsetGpsPoint(ORIGIN, 0, 360);
  hole.par = 4;
  hole.handicap = 7;
  hole.yardages = { blue: 410, white: 395, forward: 340 };
  hole.markers.white_tee = ORIGIN;
  hole.markers.blue_tee = offsetGpsPoint(ORIGIN, 0, -14);
  hole.markers.forward_tee = offsetGpsPoint(ORIGIN, 0, 50);
  hole.markers.pin = pin;
  hole.route_points = [offsetGpsPoint(ORIGIN, 18, 220)];
  hole.features = [
    { id: "blue-tee", type: "tee_blue", label: "Blue tee", points: rectangle(hole.markers.blue_tee, 4, 7) },
    { id: "white-tee", type: "tee_white", label: "White tee", points: rectangle(ORIGIN, 4, 7) },
    { id: "forward-tee", type: "tee_forward", label: "Forward tee", points: rectangle(hole.markers.forward_tee, 4, 7) },
    { id: "rough", type: "rough", label: "Primary rough", points: rectangle(offsetGpsPoint(ORIGIN, 0, 190), 45, 185) },
    { id: "fairway", type: "fairway", label: "Main fairway", points: rectangle(offsetGpsPoint(ORIGIN, 5, 190), 20, 130) },
    { id: "green", type: "green", label: "Green", points: rectangle(pin, 12, 14) },
    { id: "bunker", type: "bunker", label: "Right bunker", points: rectangle(offsetGpsPoint(pin, 18, -8), 5, 9) },
    { id: "trees", type: "trees", label: "Left trees", points: rectangle(offsetGpsPoint(ORIGIN, -38, 210), 9, 42) }
  ];
  return project;
}

test("GPS transform creates golfer-relative forward and right axes", () => {
  const pin = offsetGpsPoint(ORIGIN, 0, 300);
  const transform = createEngineTransform(ORIGIN, pin);

  const forward = transform(offsetGpsPoint(ORIGIN, 0, 100));
  const right = transform(offsetGpsPoint(ORIGIN, 25, 100));

  assert.ok(Math.abs(forward[0]) < .01);
  assert.ok(Math.abs(forward[1] - 100) < .01);
  assert.ok(Math.abs(right[0] - 25) < .01);
  assert.ok(Math.abs(right[1] - 100) < .01);
  assert.ok(Math.abs(distanceMeters(ORIGIN, pin) - 300) < .01);
});

test("secondary tee boxes align from the white tee shape and scorecard yardages", () => {
  const project = createMapperProject({ courseName: "Tee Alignment" });
  const hole = project.holes["1"];
  hole.yardages = { blue: 420, white: 400, forward: 340 };
  hole.markers.white_tee = ORIGIN;
  hole.markers.pin = offsetGpsPoint(ORIGIN, 0, 365);
  const whitePoints = [
    offsetGpsPoint(ORIGIN, -3, -8),
    offsetGpsPoint(ORIGIN, 5, -5),
    offsetGpsPoint(ORIGIN, 3, 8),
    offsetGpsPoint(ORIGIN, -5, 5)
  ];
  hole.features = [{ id: "white", type: "tee_white", label: "White tee", points: whitePoints }];

  const result = alignSecondaryTeesFromWhite(hole);

  assert.deepEqual(result.aligned, ["blue", "forward"]);
  assert.ok(Math.abs(distanceMeters(hole.markers.white_tee, hole.markers.blue_tee) - 20 * .9144) < .05);
  assert.ok(Math.abs(distanceMeters(hole.markers.white_tee, hole.markers.forward_tee) - 60 * .9144) < .05);
  for (const type of ["tee_blue", "tee_forward"]) {
    const generated = hole.features.find(feature => feature.type === type);
    assert.ok(generated);
    assert.equal(generated.points.length, whitePoints.length);
    assert.ok(Math.abs(distanceMeters(generated.points[0], generated.points[1]) - distanceMeters(whitePoints[0], whitePoints[1])) < .01);
  }
  assert.deepEqual(hole.yardages, { blue: 420, white: 400, forward: 340 });
});

test("tree brush creates one smooth editable contour around a dragged stroke", () => {
  const stroke = [ORIGIN, offsetGpsPoint(ORIGIN, 0, 12), offsetGpsPoint(ORIGIN, 8, 24)];
  const polygon = buildTreeBrushPolygon(stroke, 5);
  assert.ok(polygon.length >= 20 && polygon.length <= 48);
  assert.ok(polygon.every(point => Number.isFinite(point.lat) && Number.isFinite(point.lng)));
  const farthestFromStart = Math.max(...polygon.map(point => distanceMeters(ORIGIN, point)));
  assert.ok(farthestFromStart > 27 && farthestFromStart < 34);
});

test("three non-collinear Google Earth anchors calibrate course points to GPS", () => {
  const project = mappedProject();
  const hole = project.holes["1"];
  const realTee = { lat: 40.31912, lng: -74.61984 };
  hole.gps_control_points = {
    white_tee: realTee,
    green_center: offsetGpsPoint(realTee, 25, 360),
    bunker_center: offsetGpsPoint(realTee, 43, 350),
    bunker_feature_id: "bunker"
  };

  const calibration = buildHoleGpsCalibration(hole);
  const restoredGreen = coursePointToGps(calibration, calibration.anchors.green_center.course_point);
  const payload = buildGameHoleJson(project, 1);

  assert.equal(calibration.version, "gps-affine-v1");
  assert.ok(distanceMeters(restoredGreen, hole.gps_control_points.green_center) < .05);
  assert.equal(payload.hole_metadata.gps_calibration.anchors.bunker_center.feature_id, "bunker_h1_1");
  assert.equal(payload.hole_metadata.gps_calibration.anchors.bunker_center.source_feature_id, "bunker");
});

test("GPS coordinate paste accepts decimal pairs and rejects invalid coordinates", () => {
  assert.deepEqual(parseGpsCoordinatePair("40.31912, -74.61984"), { lat: 40.31912, lng: -74.61984 });
  assert.deepEqual(parseGpsCoordinatePair("(40.31912 -74.61984)"), { lat: 40.31912, lng: -74.61984 });
  assert.throws(() => parseGpsCoordinatePair("91, -74"), /latitude/);
  assert.throws(() => parseGpsCoordinatePair("Google Earth"), /latitude, longitude/);
});

test("GPS coordinate paste accepts Google Earth degrees, minutes, and seconds", () => {
  assert.deepEqual(
    parseGpsCoordinatePair(`40°36'47.89"N, 74°29'24.65"W`),
    { lat: 40.61330277777778, lng: -74.49018055555555 }
  );
  assert.deepEqual(
    parseGpsCoordinatePair("40°36′39.56″N 74°29′20.63″W"),
    { lat: 40.61098888888889, lng: -74.48906388888889 }
  );
  assert.throws(() => parseGpsCoordinatePair(`40°61'00"N, 74°29'00"W`), /below 60/);
  assert.throws(() => parseGpsCoordinatePair(`40°36'00"E, 74°29'00"N`), /latitude must use N or S/);
});

test("GPS calibration rejects a bunker control point on the hole centerline", () => {
  const project = mappedProject();
  const hole = project.holes["1"];
  hole.features.find(feature => feature.id === "bunker").points = rectangle(offsetGpsPoint(ORIGIN, 0, 340), 5, 5);
  const realTee = { lat: 40.31912, lng: -74.61984 };
  hole.gps_control_points = {
    white_tee: realTee,
    green_center: offsetGpsPoint(realTee, 0, 360),
    bunker_center: offsetGpsPoint(realTee, 0, 340),
    bunker_feature_id: "bunker"
  };
  assert.throws(() => buildHoleGpsCalibration(hole), /nearly in a straight line/);
  assert.throws(() => buildGameHoleJson(project, 1), /nearly in a straight line/);
});

test("polygon rotation preserves its center and point distances", () => {
  const points = rectangle(ORIGIN, 10, 4);
  const rotated = rotateGpsPolygon(points, 5);
  const originalRadii = points.map(point => distanceMeters(ORIGIN, point));
  const rotatedRadii = rotated.map(point => distanceMeters(ORIGIN, point));

  assert.equal(rotated.length, points.length);
  rotatedRadii.forEach((radius, index) => assert.ok(Math.abs(radius - originalRadii[index]) < .01));
  assert.ok(distanceMeters(points[0], rotated[0]) > .5);
});

test("polygon resampling reduces a detailed outline to eight perimeter points", () => {
  const detailed = Array.from({ length: 16 }, (_, index) => {
    const angle = index / 16 * Math.PI * 2;
    return offsetGpsPoint(ORIGIN, Math.cos(angle) * 12, Math.sin(angle) * 6);
  });

  const reduced = resampleGpsPolygon(detailed, 8);

  assert.equal(reduced.length, 8);
  assert.ok(reduced.every(point => distanceMeters(ORIGIN, point) > 5));
});

test("tree rectangle templates use rounded corner geometry", () => {
  const rectanglePoints = roundedGpsRectangle(ORIGIN, 40, 20, .22);
  const bounded = roundedGpsBounds(rectangle(offsetGpsPoint(ORIGIN, 8, 12), 20, 10), .22);

  assert.equal(rectanglePoints.length, 12);
  assert.equal(bounded.length, 12);
  const offsets = rectanglePoints.map(point => gpsDeltaMeters(ORIGIN, point));
  assert.equal(offsets.some(point => Math.abs(point.east) > 19.9 && Math.abs(point.north) > 9.9), false);
});

test("GPS point scaling preserves direction and applies the requested distance factor", () => {
  const point = offsetGpsPoint(ORIGIN, 30, 40);
  const scaled = scaleGpsPointAround(ORIGIN, point, 2);

  assert.ok(Math.abs(distanceMeters(ORIGIN, scaled) - 100) < .02);
  assert.throws(() => scaleGpsPointAround(ORIGIN, point, 0), /positive finite/);
});

test("polygon scaling changes every radius by five percent around a fixed center", () => {
  const points = rectangle(ORIGIN, 10, 4);
  const enlarged = scaleGpsPolygon(points, 1.05);
  const reduced = scaleGpsPolygon(points, .95);

  enlarged.forEach((point, index) => {
    assert.ok(Math.abs(distanceMeters(ORIGIN, point) / distanceMeters(ORIGIN, points[index]) - 1.05) < .001);
  });
  reduced.forEach((point, index) => {
    assert.ok(Math.abs(distanceMeters(ORIGIN, point) / distanceMeters(ORIGIN, points[index]) - .95) < .001);
  });
});

test("quarter-turn image bounds keep their center and swap width with height", () => {
  const bounds = {
    southWest: offsetGpsPoint(ORIGIN, -20, -60),
    northEast: offsetGpsPoint(ORIGIN, 20, 60)
  };
  const rotated = quarterTurnGpsBounds(bounds);
  const halfSize = gpsBounds => gpsDeltaMeters(ORIGIN, gpsBounds.northEast);
  const before = halfSize(bounds);
  const after = halfSize(rotated);

  assert.ok(Math.abs(after.east - before.north) < .02);
  assert.ok(Math.abs(after.north - before.east) < .02);
});

test("mapped hole exports directly to authoritative game geometry", () => {
  const project = mappedProject();
  const status = holeMappingStatus(project, 1);
  const payload = buildGameHoleJson(project, 1);

  assert.equal(status.ready, true);
  assert.equal(payload.hole_metadata.course_name, "Test Links");
  assert.equal(payload.hole_metadata.par, 4);
  assert.equal(payload.hole_metadata.geometry_calibration.imagery_source, "User-selected local hole images");
  assert.match(payload.hole_metadata.geometry_calibration.method, /local hole artwork/);
  assert.equal(payload.centerline_waypoints.length, 3);
  assert.equal(payload.geometries.tee_boxes.length, 3);
  assert.equal(payload.geometries.fairway_segments.length, 1);
  assert.equal(payload.geometries.tree_zones.length, 1);
  assert.equal(payload.geometries.tree_zones[0].polygon.length, 4);
  assert.equal(payload.geometries.tree_zones[0].gameplay_effect, "decorative_only");
  assert.equal(payload.geometries.hazards[0].lie_catalog_id, "lie_hazard_sand");
  assert.deepEqual(payload.geometries.green_complex.pin_zones[0].center_point, [0, 360]);
  assert.ok(payload.hole_metadata.total_distance_meters > 360);
});

test("tree export preserves an authored outer contour instead of replacing it with bounds", () => {
  const project = mappedProject();
  const tree = project.holes["1"].features.find(feature => feature.type === "trees");
  const center = offsetGpsPoint(ORIGIN, -38, 210);
  tree.points = [
    offsetGpsPoint(center, -12, -18),
    offsetGpsPoint(center, 2, -18),
    offsetGpsPoint(center, 2, -5),
    offsetGpsPoint(center, 13, -5),
    offsetGpsPoint(center, 13, 18),
    offsetGpsPoint(center, -12, 18)
  ];

  const exported = buildGameHoleJson(project, 1).geometries.tree_zones[0].polygon;
  assert.equal(exported.length, 6);
  assert.equal(new Set(exported.map(point => point[0].toFixed(2))).size, 3);
  assert.equal(new Set(exported.map(point => point[1].toFixed(2))).size, 3);
});

test("cart paths export as their own non-water geometry", () => {
  const project = mappedProject();
  const hole = project.holes["1"];
  hole.features.push({
    id: "painted-cart-path",
    type: "cart_path",
    label: "Painted cart path",
    source: "cart_path_brush",
    points: rectangle(offsetGpsPoint(ORIGIN, 30, 180), 1.8288, 55)
  });

  const exported = buildGameHoleJson(project, 1);
  assert.equal(exported.geometries.cart_paths.length, 1);
  assert.equal(exported.geometries.cart_paths[0].lie_catalog_id, "lie_cart_path");
  assert.equal(exported.geometries.cart_paths[0].gameplay_effect, "free_relief_reference");
  assert.doesNotMatch(renderGameMapPreview(exported), /preview-water[^>]*painted-cart-path/);
  const preview = renderGameMapPreview(exported);
  assert.match(preview, /class="preview-cart-path"/);
  assert.ok(preview.indexOf('class="preview-cart-path"') > preview.indexOf('class="preview-fairway-mow"'));
  assert.ok(preview.indexOf('class="preview-cart-path"') < preview.indexOf('class="preview-green-fringe"'));
});

test("painted streams receive a visible full-hole preview without changing water geometry", () => {
  const project = mappedProject();
  project.holes["1"].features.push({
    id: "painted-stream",
    type: "water",
    label: "Painted stream / ditch",
    source: "stream_brush",
    points: rectangle(offsetGpsPoint(ORIGIN, 0, 175), .9144, 50)
  });
  const exported = buildGameHoleJson(project, 1);
  const stream = exported.geometries.hazards.find(hazard => /stream|ditch/i.test(hazard.description));
  assert.ok(stream);
  assert.equal(stream.lie_catalog_id, "lie_hazard_water");
  assert.match(renderGameMapPreview(exported), /class="preview-stream"/);
});

test("trees entirely beyond the mapped rough remain in game geometry", () => {
  const project = mappedProject();
  const hole = project.holes["1"];
  const rough = hole.features.find(feature => feature.type === "rough");
  const outsideTrees = {
    id: "outside-trees",
    type: "trees",
    label: "Trees beyond rough",
    points: rectangle(offsetGpsPoint(ORIGIN, 90, 190), 10, 25)
  };
  hole.features.push(outsideTrees);

  assert.equal(polygonsOverlap(outsideTrees.points, rough.points), false);
  assert.equal(buildGameHoleJson(project, 1).geometries.tree_zones.length, 2);
});

test("game preview uses exported geometry without enlarging mapped bunkers", () => {
  const gameHole = buildGameHoleJson(mappedProject(), 1);
  gameHole.geometries.hazards.push({
    id: "water-test",
    lie_catalog_id: "lie_hazard_water",
    polygon: [[-12, 220], [0, 212], [12, 220], [0, 228]]
  });
  const bounds = gamePreviewBounds(gameHole);
  const preview = renderGameMapPreview(gameHole);

  assert.ok(bounds.minX < bounds.maxX);
  assert.ok(bounds.minY < bounds.maxY);
  assert.match(preview, /Final full-hole game preview/);
  assert.match(preview, /class="preview-sand"/);
  assert.match(preview, /class="preview-water"/);
  assert.match(preview, /class="preview-tree-canopy"/);
  assert.match(preview, /clipPath id="preview-tree-outer-0"/);
  assert.match(preview, /clipPath id="preview-tree-core-0"/);
  assert.match(preview, /assets\/tree-canopy-top\.png/);
  assert.doesNotMatch(preview, /preview-tree-rough-clip/);
  assert.match(preview, /class="preview-pin"/);
  const greenLayer = preview.indexOf('class="preview-green"');
  assert.ok(preview.indexOf('class="preview-water"') > greenLayer);
  assert.ok(preview.indexOf('class="preview-sand"') > greenLayer);
  assert.ok(preview.indexOf('class="preview-tree-canopy"') > greenLayer);
  assert.ok(preview.indexOf('class="preview-tee"') > preview.indexOf('class="preview-tree-canopy"'));
});

test("game preview preserves one physical scale in both directions", () => {
  const project = gamePreviewProjector({ minX: -50, maxX: 50, minY: 0, maxY: 400 });
  const origin = project([0, 100]);
  const east = project([20, 100]);
  const north = project([0, 120]);

  assert.ok(Math.abs(Math.abs(east[0] - origin[0]) - Math.abs(north[1] - origin[1])) < 1e-9);
});

test("par-three export and preview contain no fairway or synthetic approach", () => {
  const project = mappedProject();
  project.holes["1"].par = 3;
  const gameHole = buildGameHoleJson(project, 1);
  const preview = renderGameMapPreview(gameHole);

  assert.equal(gameHole.geometries.fairway_segments.length, 0);
  assert.equal(gameHole.geometries.tee_boxes.length, 3);
  assert.match(preview, /class="preview-tee"/);
  assert.doesNotMatch(preview, /preview-par-three-approach/);
  assert.doesNotMatch(preview, /class="preview-fairway"/);
});

test("local-image holes record their calibration source without embedding the image", () => {
  const project = mappedProject();
  project.imagery_source = "User-selected local hole images";
  project.hole_imagery = { "1": "local" };

  const payload = buildGameHoleJson(project, 1);

  assert.equal(payload.hole_metadata.geometry_calibration.source_image, "Local image for Hole 1");
  assert.match(payload.hole_metadata.geometry_calibration.imagery_source, /local hole images/);
});

test("installed game geometry restores into an artwork-aligned editor hole", () => {
  const sourceProject = mappedProject();
  const gameHole = buildGameHoleJson(sourceProject, 1);
  const restored = restoreMappedHoleFromGame(gameHole, {
    par: 4,
    handicap: 7,
    blue: 410,
    white: 395,
    forward: 340
  }, ORIGIN);

  assert.equal(restored.hole.features.length, sourceProject.holes["1"].features.length);
  assert.equal(restored.hole.markers.white_tee.lat, ORIGIN.lat);
  assert.ok(restored.hole.markers.blue_tee);
  assert.ok(restored.hole.markers.forward_tee);
  assert.ok(restored.hole.markers.pin);
  assert.ok(restored.imageBounds.southWest.lat < restored.hole.markers.white_tee.lat);
  assert.ok(restored.imageBounds.northEast.lat > restored.hole.markers.pin.lat);
  assert.equal(holeMappingStatus({ ...sourceProject, holes: { ...sourceProject.holes, "1": restored.hole } }, 1).ready, true);
});

test("project parsing validates feature geometry and required export datum", () => {
  const project = mappedProject();
  const restored = parseMapperProject(JSON.stringify(project));
  assert.equal(restored.course_id, "test-links");

  delete restored.holes["1"].markers.pin;
  const status = holeMappingStatus(restored, 1);
  assert.equal(status.ready, false);
  assert.match(status.problems.join(" "), /pin/);
  assert.throws(() => buildGameHoleJson(restored, 1), /mark the pin/);
});

test("mapped markers must sit inside their matching playing surfaces", () => {
  const project = mappedProject();
  project.holes["1"].markers.pin = offsetGpsPoint(ORIGIN, 80, 360);

  const status = holeMappingStatus(project, 1);
  assert.equal(status.ready, false);
  assert.match(status.problems.join(" "), /pin inside the green/);
});

test("game package includes every ready hole and reports unfinished holes", () => {
  const project = mappedProject();
  const payload = buildGameCoursePackage(project);

  assert.deepEqual(Object.keys(payload.holes), ["1"]);
  assert.match(payload.scorecard_csv, /Hole,Par,Handicap/);
  assert.match(payload.incomplete_holes["2"], /mark the white tee/);
});

test("auto draft builds editable playing surfaces from tee, route, and pin", () => {
  const project = createMapperProject();
  const hole = project.holes["1"];
  hole.par = 4;
  hole.yardages = { blue: 420, white: 400, forward: 340 };
  hole.markers.white_tee = ORIGIN;
  hole.markers.pin = offsetGpsPoint(ORIGIN, 30, 365);
  hole.route_points = [offsetGpsPoint(ORIGIN, -22, 210)];

  const draft = buildAutoDraft(hole);

  assert.ok(draft.markers.blue_tee);
  assert.ok(draft.markers.forward_tee);
  assert.deepEqual(
    new Set(draft.features.map(feature => feature.type)),
    new Set(["rough", "fairway", "green", "tee_blue", "tee_white", "tee_forward"])
  );
  assert.ok(draft.features.every(feature => feature.source === "auto_draft"));
  assert.ok(draft.features.every(feature => feature.points.length >= 4));
});

test("auto draft does not create fairway geometry for a par three", () => {
  const project = mappedProject();
  const hole = project.holes["1"];
  hole.par = 3;

  const draft = buildAutoDraft(hole);

  assert.equal(draft.features.some(feature => feature.type === "fairway"), false);
});

test("auto draft preserves hand-drawn surfaces instead of duplicating them", () => {
  const project = mappedProject();
  const hole = project.holes["1"];
  const originalGreen = hole.features.find(feature => feature.type === "green");

  const draft = buildAutoDraft(hole);

  assert.equal(draft.features.filter(feature => feature.type === "green").length, 1);
  assert.equal(draft.features.find(feature => feature.type === "green"), originalGreen);
  assert.ok(draft.skippedTypes.includes("green"));
});

test("scorecard paste parses the canonical 18-hole CSV snippet", () => {
  const lines = ["Hole,Par,Handicap,Blue_Yards,White_Yards,Red_Yards"];
  for (let hole = 1; hole <= 18; hole += 1) {
    lines.push(`${hole},${hole % 4 === 0 ? 3 : 4},${hole},${430 - hole},${410 - hole},${360 - hole}`);
  }
  const rows = parseScorecardText(lines.join("\n"));
  assert.equal(rows.length, 18);
  assert.deepEqual(rows[0], { hole: 1, par: 4, handicap: 1, blue: 429, white: 409, forward: 359 });
});

test("scorecard paste parses a copied across-the-card table and ignores totals", () => {
  const holes = Array.from({ length: 18 }, (_, index) => index + 1);
  const withTotals = values => [...values.slice(0, 9), values.slice(0, 9).reduce((a, b) => a + b), ...values.slice(9), values.slice(9).reduce((a, b) => a + b)];
  const line = (label, values) => [label, ...withTotals(values)].join("\t");
  const text = [
    ["Hole", ...holes.slice(0, 9), "Out", ...holes.slice(9), "In"].join("\t"),
    line("Blue", holes.map(hole => 440 - hole)),
    line("White", holes.map(hole => 420 - hole)),
    line("Gold", holes.map(hole => 360 - hole)),
    line("Par", holes.map(hole => hole % 4 === 0 ? 3 : 4)),
    line("Handicap", holes)
  ].join("\n");
  const rows = parseScorecardText(text);
  assert.equal(rows.length, 18);
  assert.equal(rows[9].hole, 10);
  assert.equal(rows[9].blue, 430);
  assert.equal(rows[9].forward, 350);
});
