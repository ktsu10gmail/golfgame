import test from "node:test";
import assert from "node:assert/strict";

import {
  ensureHazardFreePinZones,
  generateBunkerAwareGreen,
  generatedGreenHole,
  isHazardFreePinPoint
} from "../packages/simulation/browser_green_generator.mjs";

const rectangle = (minX, minY, maxX, maxY) => [
  [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]
];

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [x, y] = polygon[index];
    const [previousX, previousY] = polygon[previous];
    if (((y > point[1]) !== (previousY > point[1])) &&
        point[0] < (previousX - x) * (point[1] - y) / ((previousY - y) || 1e-9) + x) inside = !inside;
  }
  return inside;
}

const options = {
  basePolygon: rectangle(-5, -4, 5, 4),
  bunkerPolygons: [rectangle(10, -15, 17, 15)],
  pinPoints: [[0, 0], [4, 0]],
  courseId: "future-course",
  holeNumber: 7,
  targetWidthYards: 40,
  courseUnitsPerYard: 1
};

test("bunker-aware green generation is stable and keeps mapped pins playable", () => {
  const first = generateBunkerAwareGreen(options);
  const replay = generateBunkerAwareGreen(options);

  assert.deepEqual(first, replay);
  assert.equal(first.length, 20);
  assert.ok(options.pinPoints.every(pin => pointInPolygon(pin, first)));
});

test("nearby bunker carves the expansion on its side", () => {
  const constrained = generateBunkerAwareGreen(options);
  const open = generateBunkerAwareGreen({ ...options, bunkerPolygons: [] });
  const constrainedRight = Math.max(...constrained.filter(point => Math.abs(point[1]) < 8).map(point => point[0]));
  const openRight = Math.max(...open.filter(point => Math.abs(point[1]) < 8).map(point => point[0]));

  assert.ok(constrainedRight < openRight - 3);
  assert.ok(constrainedRight < 10);
});

test("course and hole identity produce reusable but distinct green outlines", () => {
  const holeSeven = generateBunkerAwareGreen(options);
  const holeEight = generateBunkerAwareGreen({ ...options, holeNumber: 8 });
  const anotherCourse = generateBunkerAwareGreen({ ...options, courseId: "another-course" });

  assert.notDeepEqual(holeSeven, holeEight);
  assert.notDeepEqual(holeSeven, anotherCourse);
});

test("generated hole preserves imported geometry as source metadata", () => {
  const hole = {
    geometries: {
      green_complex: {
        id: "green",
        polygon: rectangle(-5, -4, 5, 4),
        pin_zones: [{ zone_id: "center", center_point: [0, 0] }]
      },
      hazards: [{ id: "bunker", lie_catalog_id: "lie_hazard_sand", polygon: rectangle(10, -10, 16, 10) }]
    }
  };
  const generated = generatedGreenHole(hole, {
    courseId: "new-course",
    holeNumber: 1,
    courseUnitsPerYard: 1
  });

  assert.deepEqual(hole.geometries.green_complex.polygon, rectangle(-5, -4, 5, 4));
  assert.deepEqual(generated.geometries.green_complex.mapped_polygon, rectangle(-5, -4, 5, 4));
  assert.equal(generated.geometries.green_complex.generated.version, "bunker-aware-green-v1");
  assert.notDeepEqual(generated.geometries.green_complex.polygon, hole.geometries.green_complex.polygon);
});

test("pin zones are moved out of overlapping sand and water", () => {
  const hole = {
    hole_metadata: { hole_number: 6 },
    geometries: {
      green_complex: {
        polygon: rectangle(-20, -16, 20, 16),
        pin_zones: [
          { zone_id: "sand-side", center_point: [-10, 0], radius_meters: 2.5 },
          { zone_id: "water-side", center_point: [10, 0], radius_meters: 2.5 }
        ]
      },
      hazards: [
        { id: "sand", lie_catalog_id: "lie_hazard_sand", polygon: rectangle(-20, -16, -2, 16) },
        { id: "water", lie_catalog_id: "lie_hazard_water", polygon: rectangle(2, -16, 20, 16) }
      ]
    }
  };

  const adjusted = ensureHazardFreePinZones(hole);

  assert.ok(adjusted.geometries.green_complex.pin_zones.every(zone =>
    isHazardFreePinPoint(adjusted, zone.center_point)
  ));
  assert.ok(adjusted.geometries.green_complex.pin_zones.every(zone =>
    Math.abs(zone.center_point[0]) < 2
  ));
});
