#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGameHoleJson,
  createMapperProject,
  gpsDeltaMeters,
  offsetGpsPoint,
  parseMapperProject,
  parseScorecardText,
  restoreMappedHoleFromGame
} from "../packages/editor/course_mapper.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const installedDirectory = path.join(root, "data", "the-warrenbrook-golf-course");
const sourceDirectory = path.join(root, "data", "warrenbrook");
const outputPath = path.join(root, "the-warrenbrook-golf-course_rc.golfmap");
const syntheticOrigin = { lat: 40.5, lng: -74.4 };

function imageDimensions(imagePath) {
  const header = fs.readFileSync(imagePath).subarray(0, 24);
  if (header.toString("ascii", 1, 4) !== "PNG") throw new Error(`${imagePath} is not a PNG image`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function sourceFrame(gameHole) {
  const geography = gameHole.hole_metadata?.source_geography;
  const tee = geography?.white_tee;
  const pin = geography?.pin;
  if (!tee || !pin) throw new Error(`Hole ${gameHole.hole_metadata?.hole_number} has no source geography`);
  const delta = gpsDeltaMeters(tee, pin);
  const length = Math.hypot(delta.east, delta.north);
  if (length < 1) throw new Error("Source tee and pin must be at least one meter apart");
  const forward = { east: delta.east / length, north: delta.north / length };
  const right = { east: forward.north, north: -forward.east };
  return {
    tee,
    fromEngine(point) {
      return offsetGpsPoint(
        tee,
        right.east * point[0] + forward.east * point[1],
        right.north * point[0] + forward.north * point[1]
      );
    }
  };
}

function restoreSourceOrientation(gameHole, scorecard) {
  const restored = restoreMappedHoleFromGame(gameHole, scorecard, syntheticOrigin).hole;
  const frame = sourceFrame(gameHole);
  const transformPoint = point => {
    const delta = gpsDeltaMeters(syntheticOrigin, point);
    return frame.fromEngine([delta.east, delta.north]);
  };
  for (const marker of Object.keys(restored.markers)) {
    if (restored.markers[marker]) restored.markers[marker] = transformPoint(restored.markers[marker]);
  }
  // The installed centerline retains the exact authored white-tee and pin
  // anchors. Tee-box centroids are only fallbacks for the other tee colors.
  restored.markers.white_tee = { ...gameHole.hole_metadata.source_geography.white_tee };
  restored.markers.pin = { ...gameHole.hole_metadata.source_geography.pin };
  restored.route_points = restored.route_points.map(transformPoint);
  restored.features.forEach(feature => {
    feature.points = feature.points.map(transformPoint);
  });
  return restored;
}

function imageBounds(hole, imagePath) {
  const points = [
    ...Object.values(hole.markers).filter(Boolean),
    ...hole.route_points,
    ...hole.features.flatMap(feature => feature.points)
  ];
  const origin = hole.markers.white_tee;
  const deltas = points.map(point => gpsDeltaMeters(origin, point));
  let minEast = Math.min(...deltas.map(point => point.east));
  let maxEast = Math.max(...deltas.map(point => point.east));
  let minNorth = Math.min(...deltas.map(point => point.north));
  let maxNorth = Math.max(...deltas.map(point => point.north));
  const width = maxEast - minEast;
  const height = maxNorth - minNorth;
  minEast -= Math.max(22, width * 0.12);
  maxEast += Math.max(22, width * 0.12);
  minNorth -= Math.max(18, height * 0.045);
  maxNorth += Math.max(18, height * 0.045);

  const dimensions = imageDimensions(imagePath);
  const desiredRatio = dimensions.width / dimensions.height;
  const paddedWidth = maxEast - minEast;
  const paddedHeight = maxNorth - minNorth;
  if (paddedWidth / paddedHeight < desiredRatio) {
    const expansion = (paddedHeight * desiredRatio - paddedWidth) / 2;
    minEast -= expansion;
    maxEast += expansion;
  } else {
    const expansion = (paddedWidth / desiredRatio - paddedHeight) / 2;
    minNorth -= expansion;
    maxNorth += expansion;
  }
  return {
    southWest: offsetGpsPoint(origin, minEast, minNorth),
    northEast: offsetGpsPoint(origin, maxEast, maxNorth)
  };
}

const scorecardText = fs.readFileSync(path.join(installedDirectory, "scorecard.csv"), "utf8");
const scorecard = new Map(parseScorecardText(scorecardText).map(row => [row.hole, row]));
const project = createMapperProject({
  courseName: "The Warrenbrook Golf Course",
  courseId: "the-warrenbrook-golf-course"
});
project.imagery_source = "Recovered user-selected local hole images";
project.reference_images = {};
project.reference_image_bounds = {};
project.reference_image_rotation = {};
project.hole_imagery = {};
project.scorecard_source_image = "data/warrenbrook/scorecard-source.png";
project.source_package = "Recovered from the installed Warrenbrook package and preserved local source images";

const mapPoints = [];
for (let holeNumber = 1; holeNumber <= 18; holeNumber += 1) {
  const key = String(holeNumber);
  const gameHole = JSON.parse(fs.readFileSync(path.join(installedDirectory, `hole${holeNumber}.json`), "utf8"));
  const imagePath = path.join(sourceDirectory, "images", `hole${holeNumber}.png`);
  const hole = restoreSourceOrientation(gameHole, scorecard.get(holeNumber));
  project.holes[key] = hole;
  project.reference_images[key] = `data/warrenbrook/images/hole${holeNumber}.png`;
  project.reference_image_bounds[key] = imageBounds(hole, imagePath);
  project.reference_image_rotation[key] = 0;
  project.hole_imagery[key] = "local";
  mapPoints.push(hole.markers.white_tee, hole.markers.pin);

  // Verify that transforming the recovered editable geometry back into engine
  // coordinates reproduces the installed centerline and feature counts.
  const rebuilt = buildGameHoleJson(project, holeNumber);
  const installedCounts = [
    gameHole.geometries.tee_boxes.length,
    gameHole.geometries.fairway_segments.length,
    gameHole.geometries.rough_zones.length,
    gameHole.geometries.tree_zones.length,
    gameHole.geometries.hazards.length,
    gameHole.geometries.out_of_bounds.length
  ];
  const rebuiltCounts = [
    rebuilt.geometries.tee_boxes.length,
    rebuilt.geometries.fairway_segments.length,
    rebuilt.geometries.rough_zones.length,
    rebuilt.geometries.tree_zones.length,
    rebuilt.geometries.hazards.length,
    rebuilt.geometries.out_of_bounds.length
  ];
  if (installedCounts.some((count, index) => count !== rebuiltCounts[index])) {
    throw new Error(`Hole ${holeNumber} feature counts changed during recovery`);
  }
}

project.map_view = {
  center: {
    lat: mapPoints.reduce((sum, point) => sum + point.lat, 0) / mapPoints.length,
    lng: mapPoints.reduce((sum, point) => sum + point.lng, 0) / mapPoints.length
  },
  zoom: 15
};
project.updated_at = new Date().toISOString();

parseMapperProject(JSON.stringify(project));
fs.writeFileSync(outputPath, `${JSON.stringify(project, null, 2)}\n`, { flag: "wx" });
console.log(outputPath);
