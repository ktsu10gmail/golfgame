import test from "node:test";
import assert from "node:assert/strict";

import {
  buildScorecardCsv,
  buildGameCoursePackage,
  buildGameCoursePackages,
  buildGameHoleJson,
  buildGameHolePreview,
  prepareHoleForPreview,
  mapperStartTeePoint,
  prepareCourseTeeBoxes,
  placeStartTeeBox,
  selectStartTee,
  applyOsmStartTeeDefault,
  buildHoleGpsCalibration,
  buildWgs84GpsCalibration,
  buildAutoDraft,
  alignSecondaryTeesFromWhite,
  alignSecondaryTees,
  buildTreeBrushPolygon,
  createUprightGpsViewTransform,
  createEngineTransform,
  createMapperProject,
  configureMapperCourseStructure,
  distanceMeters,
  gpsDeltaMeters,
  hasDeterministicWgs84Geometry,
  holeMappingStatus,
  mapperHoleCount,
  MAPPER_COURSE_STRUCTURES,
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
  scaleGpsPointAround,
  uprightHoleViewTarget,
  validateMapperProject
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

test("upright editor view places the pin directly north of the tee and round-trips GPS edits", () => {
  const tee = ORIGIN;
  const pin = offsetGpsPoint(tee, 310, 95);
  const bunker = offsetGpsPoint(tee, 80, 170);
  const transform = createUprightGpsViewTransform(tee, pin);
  const displayedPin = transform.toView(pin);
  const displayedDelta = gpsDeltaMeters(tee, displayedPin);
  assert.ok(Math.abs(displayedDelta.east) < .01);
  assert.ok(displayedDelta.north > 320);
  const restoredBunker = transform.fromView(transform.toView(bunker));
  assert.ok(distanceMeters(restoredBunker, bunker) < .01);
});

test("dogleg editor orientation uses the first route point instead of the pin", () => {
  const tee = ORIGIN;
  const firstTurn = offsetGpsPoint(tee, 25, 180);
  const pin = offsetGpsPoint(tee, -120, 310);
  const hole = { markers: { white_tee: tee, pin }, route_points: [firstTurn] };
  const target = uprightHoleViewTarget(hole);
  const transform = createUprightGpsViewTransform(tee, target);
  const displayedTurn = gpsDeltaMeters(tee, transform.toView(firstTurn));
  const displayedPin = gpsDeltaMeters(tee, transform.toView(pin));

  assert.equal(target, firstTurn);
  assert.ok(Math.abs(displayedTurn.east) < .01);
  assert.ok(displayedTurn.north > 180);
  assert.ok(displayedPin.east < -100);
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

test("WGS84 source geometry deterministically supplies GPS calibration without three anchors", () => {
  const project = mappedProject();
  const hole = project.holes["1"];
  hole.geometry_reference = {
    coordinate_system: "WGS84",
    georeferenced: true,
    source: "openstreetmap"
  };
  delete hole.gps_control_points;

  const calibration = buildHoleGpsCalibration(hole, { project });
  const direct = buildWgs84GpsCalibration(hole);
  const sampleGps = offsetGpsPoint(ORIGIN, 17, 215);
  const sampleCourse = createEngineTransform(hole.markers.white_tee, hole.markers.pin)(sampleGps);
  const roundTrip = coursePointToGps(calibration, sampleCourse);
  const payload = buildGameHoleJson(project, 1);

  assert.equal(hasDeterministicWgs84Geometry(hole, project), true);
  assert.equal(calibration.version, "gps-wgs84-derived-v1");
  assert.equal(calibration.coordinate_system, "WGS84");
  assert.equal(calibration.manual_control_points_required, false);
  assert.equal(calibration.check.scale_ratio, 1);
  assert.deepEqual(calibration.matrix, direct.matrix);
  assert.ok(distanceMeters(sampleGps, roundTrip) < .05);
  assert.equal(payload.hole_metadata.gps_calibration.version, "gps-wgs84-derived-v1");
  assert.equal(payload.hole_metadata.gps_calibration.anchors.bunker_center, undefined);
});

test("legacy and local-image holes retain optional manual three-point calibration", () => {
  const project = mappedProject();
  const hole = project.holes["1"];
  assert.equal(hasDeterministicWgs84Geometry(hole, project), false);
  assert.throws(() => buildHoleGpsCalibration(hole, { project }), /enter all three/);
  assert.equal(buildGameHoleJson(project, 1).hole_metadata.gps_calibration, null);
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

test("game preview frames tee to green instead of distant water", () => {
  const gameHole = buildGameHoleJson(mappedProject(), 1);
  const expectedBounds = gamePreviewBounds(gameHole);
  gameHole.geometries.hazards.push({
    id: "remote-water",
    lie_catalog_id: "lie_hazard_water",
    polygon: [[-900, 40], [-850, 40], [-850, 90], [-900, 90]]
  });

  const bounds = gamePreviewBounds(gameHole);
  const project = gamePreviewProjector(bounds);
  const tee = project(gameHole.centerline_waypoints[0].point);
  const pin = project(gameHole.centerline_waypoints.at(-1).point);

  assert.deepEqual(bounds, expectedBounds);
  assert.ok(Math.abs(tee[1] - 875) < 1e-9);
  assert.ok(Math.abs(pin[1] - 125) < 1e-9);
  assert.ok(Math.abs((bounds.minX + bounds.maxX) / 2) < 100);
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

test("unknown imported penalty areas must be classified before export", () => {
  const project = mappedProject();
  project.holes["1"].features.push({
    id: "gi-unknown-penalty",
    type: "penalty_area_unknown",
    label: "Imported penalty area",
    source: "golf_intelligence",
    manual_override: false,
    points: rectangle(offsetGpsPoint(ORIGIN, 28, 210), 7, 22)
  });

  const status = holeMappingStatus(project, 1);
  assert.equal(status.ready, false);
  assert.match(status.problems.join(" "), /classify each imported penalty area/);
  assert.throws(() => buildGameHoleJson(project, 1), /classify each imported penalty area/);
});

test("game package includes every ready hole and reports unfinished holes", () => {
  const project = mappedProject();
  project.production_context = {
    production_item_id: "production_0123456789abcdef01234567",
    directory_course_id: "course_0123456789abcdef01234567"
  };
  project.external_course_source = {
    provider_name: "openstreetmap",
    attribution: "© OpenStreetMap contributors · ODbL"
  };
  const payload = buildGameCoursePackage(project);

  assert.deepEqual(Object.keys(payload.holes), ["1"]);
  assert.match(payload.scorecard_csv, /Hole,Par,Handicap/);
  assert.match(payload.incomplete_holes["2"], /enter at least one tee yardage/);
  assert.deepEqual(payload.production_context, project.production_context);
  assert.deepEqual(payload.external_course_source, project.external_course_source);
});

test("three-nine facility creates Central, North, and South editor holes", () => {
  const project = createMapperProject({ courseStructure: MAPPER_COURSE_STRUCTURES.THREE_NINES });
  assert.equal(mapperHoleCount(project), 27);
  assert.equal(project.holes["1"].handicap, 1);
  assert.equal(project.holes["10"].handicap, 1);
  assert.equal(project.holes["19"].handicap, 1);
  assert.equal(project.holes["27"].handicap, 9);

  configureMapperCourseStructure(project, MAPPER_COURSE_STRUCTURES.STANDARD);
  assert.equal(mapperHoleCount(project), 18);
  assert.ok(project.holes["27"], "switching layouts preserves South-nine work");
});

test("three-nine facility assembles all six ordered two-loop routes with custom names", () => {
  const source = mappedProject();
  configureMapperCourseStructure(source, MAPPER_COURSE_STRUCTURES.THREE_NINES);
  for (let holeNumber = 1; holeNumber <= 27; holeNumber += 1) {
    const hole = structuredClone(source.holes["1"]);
    hole.hole_number = holeNumber;
    hole.handicap = (holeNumber - 1) % 9 + 1;
    hole.yardages.white = 390 + holeNumber;
    source.holes[String(holeNumber)] = hole;
  }
  source.nine_loops = [
    { id: "central", name: "Lake" },
    { id: "north", name: "Ridge" },
    { id: "south", name: "Mountain" }
  ];

  const packages = buildGameCoursePackages(source);
  assert.deepEqual(packages.map(payload => payload.course_id), [
    "test-links-central-north",
    "test-links-central-south",
    "test-links-north-central",
    "test-links-north-south",
    "test-links-south-central",
    "test-links-south-north"
  ]);
  assert.deepEqual(packages.map(payload => payload.course_name), [
    "Test Links · Lake + Ridge",
    "Test Links · Lake + Mountain",
    "Test Links · Ridge + Lake",
    "Test Links · Ridge + Mountain",
    "Test Links · Mountain + Lake",
    "Test Links · Mountain + Ridge"
  ]);
  assert.ok(packages.every(payload => Object.keys(payload.holes).length === 18));
  assert.deepEqual(packages[0].source_holes, Array.from({ length: 18 }, (_, index) => index + 1));
  assert.deepEqual(packages[1].source_holes, [
    ...Array.from({ length: 9 }, (_, index) => index + 1),
    ...Array.from({ length: 9 }, (_, index) => index + 19)
  ]);
  assert.equal(packages[1].holes["10"].hole_metadata.facility_hole_number, 19);
  assert.equal(packages[1].holes["10"].hole_metadata.hole_number, 10);
  assert.match(packages[1].scorecard_csv.split("\n")[10], /^10,4,1,/);
  assert.deepEqual(packages[2].source_holes, [
    ...Array.from({ length: 9 }, (_, index) => index + 10),
    ...Array.from({ length: 9 }, (_, index) => index + 1)
  ]);
});

test("three-nine facility rejects duplicate loop names", () => {
  const project = createMapperProject({ courseStructure: MAPPER_COURSE_STRUCTURES.THREE_NINES });
  project.nine_loops[1].name = "central";
  assert.throws(() => validateMapperProject(project), /must have different names/);
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

test("scorecard paste accepts a selected nine-hole CSV", () => {
  const lines = ["Hole,Par,Handicap,Blue_Yards,White_Yards,Red_Yards"];
  for (let hole = 1; hole <= 9; hole += 1) {
    lines.push(`${hole},${hole % 4 === 0 ? 3 : 4},${hole},${430 - hole},${410 - hole},${360 - hole}`);
  }
  const rows = parseScorecardText(lines.join("\n"), { holeCount: 9 });
  assert.equal(rows.length, 9);
  assert.deepEqual(rows.at(-1), { hole: 9, par: 4, handicap: 9, blue: 421, white: 401, forward: 351 });
});

test("nine-hole scorecard selection rejects an incomplete card", () => {
  const lines = ["Hole,Par,Handicap,Blue_Yards,White_Yards,Red_Yards"];
  for (let hole = 1; hole <= 8; hole += 1) lines.push(`${hole},4,${hole},420,400,350`);
  assert.throws(
    () => parseScorecardText(lines.join("\n"), { holeCount: 9 }),
    /found 8 holes; exactly 9 are required/
  );
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

test("scorecard paste accepts a copied nine-hole matrix", () => {
  const holes = Array.from({ length: 9 }, (_, index) => index + 1);
  const line = (label, values) => [label, ...values].join("\t");
  const text = [
    line("Hole", holes),
    line("Blue", holes.map(hole => 440 - hole)),
    line("White", holes.map(hole => 420 - hole)),
    line("Gold", holes.map(hole => 360 - hole)),
    line("Par", holes.map(hole => hole % 4 === 0 ? 3 : 4)),
    line("Handicap", holes)
  ].join("\n");
  const rows = parseScorecardText(text, { holeCount: 9 });
  assert.equal(rows.length, 9);
  assert.equal(rows.at(-1).hole, 9);
  assert.equal(rows.at(-1).white, 411);
});


test("blue start generates white and forward tees, survives saving, and follows scorecard edits", () => {
  const project = createMapperProject({ courseName: "Blue geometry" });
  const hole = project.holes["1"];
  hole.tee_alignment_anchor = "blue";
  hole.yardages = { blue: 420, white: 400, forward: 340 };
  hole.markers.blue_tee = ORIGIN;
  hole.markers.pin = offsetGpsPoint(ORIGIN, 120, 360);
  assert.deepEqual(alignSecondaryTees(hole).aligned, ["white", "forward"]);
  const blueBox = hole.features.find(feature => feature.type === "tee_blue");
  assert.ok(blueBox);
  for (const [tee, yards] of [["white", 20], ["forward", 80]]) {
    assert.ok(Math.abs(distanceMeters(ORIGIN, hole.markers[`${tee}_tee`]) - yards * .9144) < .05);
    const delta = gpsDeltaMeters(ORIGIN, hole.markers[`${tee}_tee`]);
    assert.ok(delta.east > 0 && delta.north > 0);
    const box = hole.features.find(feature => feature.type === `tee_${tee}`);
    assert.ok(Math.abs(distanceMeters(box.points[0], box.points[1]) - distanceMeters(blueBox.points[0], blueBox.points[1])) < .01);
  }
  const restored = parseMapperProject(JSON.stringify(project)).holes["1"];
  assert.equal(restored.tee_alignment_anchor, "blue");
  restored.yardages.white = 390;
  alignSecondaryTees(restored);
  assert.deepEqual(restored.markers.blue_tee, ORIGIN);
  assert.ok(Math.abs(distanceMeters(ORIGIN, restored.markers.white_tee) - 30 * .9144) < .05);
  assert.equal(restored.features.filter(feature => feature.type === "tee_white").length, 1);
  const draft = buildAutoDraft(restored);
  assert.deepEqual(draft.markers.blue_tee, ORIGIN);
  assert.ok(draft.features.some(feature => feature.type === "tee_forward"));
});

test("blue alignment waits for pin and valid scorecard yardages", () => {
  const hole = createMapperProject().holes["1"];
  hole.tee_alignment_anchor = "blue";
  hole.markers.blue_tee = ORIGIN;
  hole.yardages = { blue: 420, white: 400, forward: 0 };
  assert.deepEqual(alignSecondaryTees(hole).aligned, []);
  assert.equal(hole.markers.white_tee, null);
  hole.markers.pin = offsetGpsPoint(ORIGIN, 0, 360);
  assert.deepEqual(alignSecondaryTees(hole).aligned, ["white"]);
  assert.equal(hole.markers.forward_tee, null);
  hole.yardages.white = 450;
  const white = hole.markers.white_tee;
  assert.deepEqual(alignSecondaryTees(hole).aligned, []);
  assert.deepEqual(hole.markers.white_tee, white);
});


test("preview allows a tee outside its box while export retains containment checks", () => {
  const project = mappedProject();
  const hole = project.holes["1"];
  hole.markers.forward_tee = offsetGpsPoint(ORIGIN, 200, 50);
  const before = JSON.stringify(hole);
  const preview = buildGameHolePreview(project, 1);
  assert.equal(preview.hole_metadata.mapper_preview.draft, true);
  assert.ok(preview.hole_metadata.mapper_preview.remaining_items.includes("place the forward tee marker inside its tee box"));
  assert.match(renderGameMapPreview(preview), /<svg/);
  assert.equal(JSON.stringify(hole), before);
  assert.throws(() => buildGameHoleJson(project, 1), /place the forward tee marker inside its tee box/);
});

test("creating either start box centers its marker and makes an imported hole previewable", () => {
  for (const anchor of ["blue", "white"]) {
    const project = mappedProject();
    const hole = project.holes["1"];
    hole.features = hole.features.filter(feature => !feature.type.startsWith("tee_") && feature.type !== "trees");
    hole.markers.blue_tee = null;
    hole.markers.white_tee = null;
    hole.markers.forward_tee = null;
    const center = offsetGpsPoint(ORIGIN, 5, 10);
    const box = { id: "new-start", type: `tee_${anchor}`, points: rectangle(center, 4, 7) };
    const result = placeStartTeeBox(hole, box, center);
    assert.equal(result.aligned.length, 2);
    assert.deepEqual(hole.markers[`${anchor}_tee`], center);
    assert.equal(hole.features.filter(feature => feature.type.startsWith("tee_")).length, 3);
    assert.equal(holeMappingStatus(project, 1).ready, true);
    assert.match(renderGameMapPreview(buildGameHolePreview(project, 1)), /<svg/);
    assert.doesNotThrow(() => buildGameHoleJson(project, 1));
    assert.equal(holeMappingStatus(project, 2).ready, false);
  }
});

test("draft preview uses imported surfaces without requiring rough or GPS setup", () => {
  const project = mappedProject();
  const hole = project.holes["1"];
  hole.features = hole.features.filter(feature => feature.type !== "rough" && feature.type !== "trees");
  hole.gps_control_points = { white_tee: null, green_center: null, bunker_center: null };
  const preview = buildGameHolePreview(project, 1);
  assert.ok(!preview.hole_metadata.mapper_preview.remaining_items.includes("add rough"));
  assert.equal(preview.hole_metadata.gps_calibration, null);
  assert.equal(preview.geometries.hazards.length, 1);
  assert.equal(preview.geometries.fairway_segments.length, 1);
  assert.match(renderGameMapPreview(preview), /<svg/);
  assert.throws(() => buildGameHoleJson(project, 1));
  hole.features = hole.features.filter(feature => feature.type !== "green");
  assert.throws(() => buildGameHolePreview(project, 1), /add a green/);
});


test("operator can assign the imported start to any tee and preview the ball there", () => {
  for (const anchor of ["blue", "white", "forward"]) {
    const project = mappedProject();
    const hole = project.holes["1"];
    const importedStart = { ...hole.markers.white_tee };
    const result = selectStartTee(hole, anchor);
    assert.equal(result.aligned.length, 2);
    assert.deepEqual(hole.markers[`${anchor}_tee`], importedStart);
    const ranks = ["blue", "white", "forward"];
    for (const secondary of ranks.filter(tee => tee !== anchor)) {
      const difference = hole.yardages[anchor] - hole.yardages[secondary];
      assert.ok(Math.abs(distanceMeters(importedStart, hole.markers[`${secondary}_tee`]) - Math.abs(difference) * .9144) < .05);
      assert.equal(Math.sign(gpsDeltaMeters(importedStart, hole.markers[`${secondary}_tee`]).north), Math.sign(difference));
    }
    const preview = buildGameHolePreview(project, 1);
    assert.equal(preview.hole_metadata.default_start_tee, anchor);
    const expected = createEngineTransform(hole.markers.white_tee, hole.markers.pin)(importedStart);
    assert.deepEqual(preview.hole_metadata.default_start_point, expected);
    const screen = gamePreviewProjector(gamePreviewBounds(preview))(expected);
    assert.ok(renderGameMapPreview(preview).includes(`class="preview-ball" transform="translate(${screen[0]},${screen[1]})"`));
    assert.equal(parseMapperProject(JSON.stringify(project)).holes["1"].tee_alignment_anchor, anchor);
  }
});

test("choosing blue on an OSM start without boxes generates all tee boxes", () => {
  const project = mappedProject();
  const hole = project.holes["1"];
  hole.features = hole.features.filter(feature => !feature.type.startsWith("tee_"));
  hole.markers.blue_tee = null;
  hole.markers.forward_tee = null;
  assert.deepEqual(selectStartTee(hole, "blue").aligned, ["white", "forward"]);
  assert.deepEqual(hole.markers.blue_tee, ORIGIN);
  assert.equal(hole.features.filter(feature => feature.type.startsWith("tee_")).length, 3);
  assert.equal(holeMappingStatus(project, 1).ready, true);
});


test("preview accepts the reported missing secondary tees, white box, and rough", () => {
  const project = mappedProject();
  const hole = project.holes["1"];
  hole.markers.blue_tee = null;
  hole.markers.forward_tee = null;
  hole.features = hole.features.filter(feature => !["tee_white", "tee_forward", "rough"].includes(feature.type));
  assert.throws(() => buildGameHoleJson(project, 1), /mark the blue tee, add a white tee box, mark the forward tee, add a forward tee box/);
  const preview = buildGameHolePreview(project, 1);
  assert.match(renderGameMapPreview(preview), /<svg/);
  assert.equal(preview.hole_metadata.mapper_preview.remaining_items.length, 4);
});


test("legacy OSM defaults become blue while pin and explicit tee choices remain", () => {
  const project = mappedProject();
  project.external_course_source = { provider_name: "openstreetmap" };
  const hole = project.holes["1"];
  const start = hole.markers.white_tee;
  const pin = hole.markers.pin;
  hole.markers.blue_tee = null;
  applyOsmStartTeeDefault(project);
  assert.equal(hole.tee_alignment_anchor, "blue");
  assert.deepEqual(hole.markers.blue_tee, start);
  assert.deepEqual(hole.markers.pin, pin);
  selectStartTee(hole, "white");
  applyOsmStartTeeDefault(project);
  assert.equal(hole.tee_alignment_anchor, "white");
});


test("preview prepares missing white and forward boxes from a blue start and scorecard", () => {
  const project = mappedProject();
  const hole = project.holes["1"];
  hole.tee_alignment_anchor = "blue";
  hole.markers.blue_tee = ORIGIN;
  hole.markers.white_tee = null;
  hole.markers.forward_tee = null;
  hole.features = hole.features.filter(feature => !feature.type.startsWith("tee_"));
  const original = JSON.stringify(hole);
  const preview = buildGameHolePreview(project, 1);
  assert.equal(preview.geometries.tee_boxes.length, 3);
  assert.equal(preview.hole_metadata.default_start_tee, "blue");
  assert.equal(JSON.stringify(hole), original);
  const prepared = prepareHoleForPreview(hole);
  assert.ok(prepared.markers.white_tee);
  assert.ok(prepared.markers.forward_tee);
  assert.deepEqual(prepared.markers.blue_tee, ORIGIN);
  assert.equal(prepared.features.filter(feature => feature.type.startsWith("tee_")).length, 3);
  assert.deepEqual(prepareHoleForPreview(prepared), prepared);
});


test("installation preparation generates scorecard tees across all eighteen holes", () => {
  const project = mappedProject();
  const template = structuredClone(project.holes["1"]);
  template.tee_alignment_anchor = "blue";
  template.markers.blue_tee = ORIGIN;
  template.markers.white_tee = null;
  template.markers.forward_tee = null;
  template.features = template.features.filter(feature => !feature.type.startsWith("tee_"));
  for (let number = 1; number <= 18; number += 1) {
    project.holes[String(number)] = { ...structuredClone(template), hole_number: number };
  }
  assert.equal(prepareCourseTeeBoxes(project).length, 18);
  for (let number = 1; number <= 18; number += 1) assert.equal(holeMappingStatus(project, number).ready, true);
  assert.equal(Object.keys(buildGameCoursePackage(project).holes).length, 18);
  assert.deepEqual(prepareCourseTeeBoxes(project), []);
});

test("zero-ready course reports specific export blockers", () => {
  const project = createMapperProject();
  assert.throws(() => buildGameCoursePackage(project), error =>
    /No holes are ready to export/.test(error.message) && /Hole 1: enter at least one tee yardage/.test(error.message) && /add a green/.test(error.message)
  );
});


test("all eighteen holes can export with default rough and no rough polygons", () => {
  const project = mappedProject();
  const template = structuredClone(project.holes["1"]);
  template.features = template.features.filter(feature => feature.type !== "rough");
  for (let number = 1; number <= 18; number += 1) {
    project.holes[String(number)] = { ...structuredClone(template), hole_number: number };
    assert.equal(holeMappingStatus(project, number).ready, true);
  }
  const payload = buildGameCoursePackage(project);
  assert.equal(Object.keys(payload.holes).length, 18);
  for (const hole of Object.values(payload.holes)) assert.ok(hole.geometries.rough_zones.every(zone => zone.lie_catalog_id === "lie_rough_light"));
});


test('empty OSM production context exports as absent without discarding supplied identities', () => {
  const project = mappedProject();
  project.production_context = {};
  assert.equal(buildGameCoursePackage(project).production_context, null);
  project.production_context = { production_item_id: 'invalid' };
  assert.deepEqual(buildGameCoursePackage(project).production_context, { production_item_id: 'invalid' });
});

for (const tees of [["blue"], ["blue", "forward"], ["white"], ["forward"]]) {
  test(`preview and export support only scorecard tees: ${tees.join(", ")}`, () => {
    const project = mappedProject();
    const hole = project.holes["1"];
    hole.tee_alignment_anchor = tees[0];
    for (const tee of ["blue", "white", "forward"]) {
      if (tees.includes(tee)) continue;
      hole.yardages[tee] = 0;
      hole.markers[`${tee}_tee`] = null;
      hole.features = hole.features.filter(feature => feature.type !== `tee_${tee}`);
    }
    hole.geometry_reference = { coordinate_system: "WGS84", georeferenced: true };
    assert.equal(holeMappingStatus(project, 1).ready, true);
    const preview = buildGameHolePreview(project, 1);
    const exported = buildGameHoleJson(project, 1);
    assert.equal(preview.geometries.tee_boxes.length, tees.length);
    assert.equal(exported.geometries.tee_boxes.length, tees.length);
    assert.equal(exported.hole_metadata.default_start_tee, tees[0]);
    assert.ok(exported.hole_metadata.gps_calibration);
  });
}

test("scorecard accepts missing white and forward columns without inventing yardages", () => {
  const csv = "Hole,Par,Handicap,Blue\n" + Array.from({ length: 18 }, (_, i) => `${i + 1},4,${i + 1},400`).join("\n");
  const rows = parseScorecardText(csv);
  assert.equal(rows.length, 18);
  assert.equal(rows[1].white, 0);
  assert.equal(rows[1].forward, 0);
});

test("Mapper route starts at the selected blue tee without requiring a white tee", () => {
  const hole = mappedProject().holes["1"];
  hole.tee_alignment_anchor = "blue";
  assert.deepEqual(mapperStartTeePoint(hole), hole.markers.blue_tee);
  hole.markers.white_tee = null;
  assert.deepEqual(mapperStartTeePoint(hole), hole.markers.blue_tee);
  hole.tee_alignment_anchor = "forward";
  assert.deepEqual(mapperStartTeePoint(hole), hole.markers.forward_tee);
  hole.markers = {};
  assert.equal(mapperStartTeePoint(hole), null);
});


test("standalone nine-hole project validates and round-trips without adding holes", () => {
  const project = createMapperProject({ courseName: "Nine Links", courseStructure: MAPPER_COURSE_STRUCTURES.NINE });
  assert.equal(mapperHoleCount(project), 9);
  assert.equal(Object.keys(project.holes).length, 9);
  validateMapperProject(project);
  assert.equal(mapperHoleCount(parseMapperProject(JSON.stringify(project))), 9);
  assert.equal(buildScorecardCsv(project).trim().split("\n").length, 10);
});

test("switching to nine holes preserves back-nine work and exports only the active nine", () => {
  const project = mappedProject();
  const template = structuredClone(project.holes["1"]);
  for (let i = 1; i <= 9; i++) project.holes[String(i)] = { ...structuredClone(template), hole_number: i, handicap: i };
  project.holes["10"].par = 5;
  configureMapperCourseStructure(project, MAPPER_COURSE_STRUCTURES.NINE);
  assert.equal(project.holes["10"].par, 5);
  const [payload] = buildGameCoursePackages(project);
  assert.equal(payload.hole_count, 9);
  assert.deepEqual(Object.keys(payload.holes), Array.from({ length: 9 }, (_, i) => String(i + 1)));
  assert.deepEqual(payload.incomplete_holes, {});
  assert.equal(payload.scorecard_csv.trim().split("\n").length, 10);
  configureMapperCourseStructure(project, MAPPER_COURSE_STRUCTURES.STANDARD);
  assert.equal(mapperHoleCount(project), 18);
  assert.equal(project.holes["10"].par, 5);
});


test("export selects the green containing the pin when another green comes first", () => {
  const project = mappedProject();
  const before = buildGameHoleJson(project, 1);
  const hole = project.holes["1"];
  const green = hole.features.find(feature => feature.type === "green");
  const other = structuredClone(green);
  other.id = "neighbor-green";
  other.points = other.points.map(point => ({...point, lat: point.lat + .01, lng: point.lng + .01}));
  hole.features.unshift(other);
  assert.equal(holeMappingStatus(project, 1).ready, true);
  assert.deepEqual(buildGameHoleJson(project, 1).geometries.green_complex.polygon, before.geometries.green_complex.polygon);
});
