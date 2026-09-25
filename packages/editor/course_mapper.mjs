export const MAPPER_PROJECT_VERSION = "golf-course-map-v1";
export const GAME_PACKAGE_VERSION = "golf-game-course-package-v1";
export const EARTH_RADIUS_METERS = 6371008.8;
export const YARDS_PER_METER = 1.09361;
export const MAPPER_COURSE_STRUCTURES = Object.freeze({
  STANDARD: "standard_18",
  THREE_NINES: "three_nines"
});
export const MAPPER_NINE_LOOPS = Object.freeze([
  { id: "central", name: "Central", start: 1, end: 9 },
  { id: "north", name: "North", start: 10, end: 18 },
  { id: "south", name: "South", start: 19, end: 27 }
]);

export function mapperNineLoops(project) {
  return MAPPER_NINE_LOOPS.map(loop => ({
    ...loop,
    name: String(project?.nine_loops?.find(item => item?.id === loop.id)?.name || loop.name).trim() || loop.name
  }));
}

const FEATURE_TYPES = new Set([
  "tee_blue",
  "tee_white",
  "tee_forward",
  "fairway",
  "rough",
  "bunker",
  "green",
  "water",
  "penalty_area_unknown",
  "hole_outline",
  "cart_path",
  "trees",
  "out_of_bounds"
]);

function finiteCoordinate(point, label = "point") {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    throw new Error(`${label} must have finite lat and lng values`);
  }
  return point;
}

function cleanId(value, fallback = "course") {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || fallback;
}

function round(value, places = 3) {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function emptyMappedHole(holeNumber) {
  return {
    hole_number: holeNumber,
    par: 4,
    handicap: holeNumber,
    layout_type: "Mostly Straight",
    elevation_change_meters: 0,
    yardages: { blue: 0, white: 0, forward: 0 },
    markers: {
      blue_tee: null,
      white_tee: null,
      forward_tee: null,
      pin: null
    },
    route_points: [],
    features: []
  };
}

export function createMapperProject({
  courseName = "New golf course",
  courseId,
  address = "",
  courseStructure = MAPPER_COURSE_STRUCTURES.STANDARD
} = {}) {
  const threeNines = courseStructure === MAPPER_COURSE_STRUCTURES.THREE_NINES;
  const holeCount = threeNines ? 27 : 18;
  return {
    version: MAPPER_PROJECT_VERSION,
    course_name: courseName,
    course_id: cleanId(courseId || courseName),
    address,
    updated_at: new Date().toISOString(),
    imagery_source: "User-selected local hole images",
    map_view: null,
    course_structure: threeNines ? MAPPER_COURSE_STRUCTURES.THREE_NINES : MAPPER_COURSE_STRUCTURES.STANDARD,
    nine_loops: MAPPER_NINE_LOOPS.map(loop => ({ id: loop.id, name: loop.name })),
    holes: Object.fromEntries(
      Array.from({ length: holeCount }, (_, index) => {
        const holeNumber = index + 1;
        const hole = emptyMappedHole(holeNumber);
        if (threeNines) hole.handicap = index % 9 + 1;
        return [String(holeNumber), hole];
      })
    )
  };
}

export function mapperHoleCount(project) {
  return project?.course_structure === MAPPER_COURSE_STRUCTURES.THREE_NINES ? 27 : 18;
}

export function configureMapperCourseStructure(project, structure) {
  if (!project || typeof project !== "object") throw new Error("mapping project must be an object");
  const normalized = structure === MAPPER_COURSE_STRUCTURES.THREE_NINES
    ? MAPPER_COURSE_STRUCTURES.THREE_NINES
    : MAPPER_COURSE_STRUCTURES.STANDARD;
  project.course_structure = normalized;
  project.nine_loops = MAPPER_NINE_LOOPS.map(loop => ({
    id: loop.id,
    name: project.nine_loops?.find(item => item?.id === loop.id)?.name || loop.name
  }));
  const holeCount = normalized === MAPPER_COURSE_STRUCTURES.THREE_NINES ? 27 : 18;
  for (let holeNumber = 1; holeNumber <= holeCount; holeNumber += 1) {
    if (!project.holes?.[String(holeNumber)]) {
      project.holes ||= {};
      const hole = emptyMappedHole(holeNumber);
      if (normalized === MAPPER_COURSE_STRUCTURES.THREE_NINES) hole.handicap = (holeNumber - 1) % 9 + 1;
      project.holes[String(holeNumber)] = hole;
    }
  }
  return project;
}

function gamePointToLocalGps(origin, point) {
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) {
    throw new Error("game geometry points must contain finite x and y values");
  }
  return offsetGpsPoint(origin, point[0], point[1]);
}

function gamePolygonToLocalGps(origin, points, label) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error(`${label} must contain at least three points`);
  }
  return points.map(point => gamePointToLocalGps(origin, point));
}

function polygonCenter(points) {
  return points.reduce((center, point) => ({
    lat: center.lat + point.lat / points.length,
    lng: center.lng + point.lng / points.length
  }), { lat: 0, lng: 0 });
}

export function parseGpsCoordinatePair(value) {
  const normalized = String(value || "").trim().replace(/[()]/g, "");
  const decimalMatch = normalized.match(/^([+-]?\d+(?:\.\d+)?)\s*[,\s]\s*([+-]?\d+(?:\.\d+)?)$/);
  let point;
  if (decimalMatch) {
    point = { lat: Number(decimalMatch[1]), lng: Number(decimalMatch[2]) };
  } else {
    const parts = [...normalized.matchAll(
      /(\d{1,3})\s*°\s*(\d{1,2})\s*['′’]\s*(\d+(?:\.\d+)?)\s*(?:["″”])?\s*([NSEW])/gi
    )];
    if (parts.length !== 2) {
      throw new Error("paste Google Earth coordinates or enter decimal latitude, longitude");
    }
    const coordinate = (match, latitude) => {
      const degrees = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = Number(match[3]);
      const direction = match[4].toUpperCase();
      const expectedDirections = latitude ? new Set(["N", "S"]) : new Set(["E", "W"]);
      if (!expectedDirections.has(direction)) throw new Error(latitude ? "latitude must use N or S" : "longitude must use E or W");
      if (minutes >= 60 || seconds >= 60) throw new Error("GPS minutes and seconds must be below 60");
      const magnitude = degrees + minutes / 60 + seconds / 3600;
      return ["S", "W"].includes(direction) ? -magnitude : magnitude;
    };
    point = { lat: coordinate(parts[0], true), lng: coordinate(parts[1], false) };
  }
  if (!Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90) {
    throw new Error("latitude must be between -90 and 90");
  }
  if (!Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180) {
    throw new Error("longitude must be between -180 and 180");
  }
  return point;
}

function solveGpsAffineTransform(coursePoints, gpsPoints) {
  const [courseOrigin, courseGreen, courseBunker] = coursePoints;
  const [gpsOrigin, gpsGreen, gpsBunker] = gpsPoints;
  const localA = { x: courseGreen[0] - courseOrigin[0], y: courseGreen[1] - courseOrigin[1] };
  const localB = { x: courseBunker[0] - courseOrigin[0], y: courseBunker[1] - courseOrigin[1] };
  const gpsA = gpsDeltaMeters(gpsOrigin, gpsGreen);
  const gpsB = gpsDeltaMeters(gpsOrigin, gpsBunker);
  const localDeterminant = localA.x * localB.y - localB.x * localA.y;
  const gpsDeterminant = gpsA.east * gpsB.north - gpsB.east * gpsA.north;
  const localScale = Math.hypot(localA.x, localA.y) * Math.hypot(localB.x, localB.y);
  const gpsScale = Math.hypot(gpsA.east, gpsA.north) * Math.hypot(gpsB.east, gpsB.north);
  if (localScale < 100 || Math.abs(localDeterminant) / localScale < .025) {
    throw new Error("choose a bunker farther to one side; the three mapped anchors are nearly in a straight line");
  }
  if (gpsScale < 100 || Math.abs(gpsDeterminant) / gpsScale < .025) {
    throw new Error("the Google Earth anchors are too close together or nearly in a straight line");
  }
  const inverse00 = localB.y / localDeterminant;
  const inverse01 = -localB.x / localDeterminant;
  const inverse10 = -localA.y / localDeterminant;
  const inverse11 = localA.x / localDeterminant;
  return {
    east: [
      gpsA.east * inverse00 + gpsB.east * inverse10,
      gpsA.east * inverse01 + gpsB.east * inverse11
    ],
    north: [
      gpsA.north * inverse00 + gpsB.north * inverse10,
      gpsA.north * inverse01 + gpsB.north * inverse11
    ]
  };
}

export function buildHoleGpsCalibration(hole) {
  const controls = hole?.gps_control_points;
  if (!controls) throw new Error("enter all three Google Earth coordinates");
  const whiteTee = finiteCoordinate(hole?.markers?.white_tee, "white tee marker");
  const green = (hole.features || []).find(feature => feature.type === "green");
  if (!green) throw new Error("add a green shape before GPS calibration");
  const bunker = (hole.features || []).find(feature =>
    feature.type === "bunker" && feature.id === controls.bunker_feature_id
  );
  if (!bunker) throw new Error("select a mapped bunker for the third GPS anchor");
  const gpsAnchors = ["white_tee", "green_center", "bunker_center"].map(key =>
    finiteCoordinate(controls[key], `${key.replaceAll("_", " ")} GPS coordinate`)
  );
  const transformToGame = createEngineTransform(whiteTee, hole.markers.pin || polygonCenter(green.points));
  const editorAnchors = [whiteTee, polygonCenter(green.points), polygonCenter(bunker.points)];
  const courseAnchors = editorAnchors.map(transformToGame);
  const matrix = solveGpsAffineTransform(courseAnchors, gpsAnchors);
  const teeToGreenMeters = distanceMeters(gpsAnchors[0], gpsAnchors[1]);
  const mappedTeeToGreenMeters = Math.hypot(
    courseAnchors[1][0] - courseAnchors[0][0],
    courseAnchors[1][1] - courseAnchors[0][1]
  );
  const scaleRatio = teeToGreenMeters / mappedTeeToGreenMeters;
  if (scaleRatio < .65 || scaleRatio > 1.45) {
    throw new Error("GPS tee-to-green distance does not match the mapped hole; check the coordinates and image scale");
  }
  return {
    version: "gps-affine-v1",
    origin: { ...gpsAnchors[0] },
    matrix: {
      east_meters_per_course_x: round(matrix.east[0], 8),
      east_meters_per_course_y: round(matrix.east[1], 8),
      north_meters_per_course_x: round(matrix.north[0], 8),
      north_meters_per_course_y: round(matrix.north[1], 8)
    },
    anchors: {
      white_tee: { course_point: courseAnchors[0], gps: gpsAnchors[0] },
      green_center: { course_point: courseAnchors[1], gps: gpsAnchors[1] },
      bunker_center: {
        course_point: courseAnchors[2],
        gps: gpsAnchors[2],
        feature_id: `bunker_h${hole.hole_number}_${featuresOf(hole, "bunker").indexOf(bunker) + 1}`,
        source_feature_id: bunker.id
      }
    },
    check: {
      tee_to_green_meters: round(teeToGreenMeters, 1),
      mapped_tee_to_green_meters: round(mappedTeeToGreenMeters, 1),
      scale_ratio: round(scaleRatio, 4)
    }
  };
}

export function coursePointToGps(calibration, point) {
  if (!calibration?.origin || !calibration?.matrix || !Array.isArray(point) || point.length !== 2) {
    throw new Error("a valid GPS calibration and [x, y] course point are required");
  }
  const matrix = calibration.matrix;
  return offsetGpsPoint(
    calibration.origin,
    matrix.east_meters_per_course_x * point[0] + matrix.east_meters_per_course_y * point[1],
    matrix.north_meters_per_course_x * point[0] + matrix.north_meters_per_course_y * point[1]
  );
}

/**
 * Restores installed game geometry to the editor's local-image coordinate space.
 * The synthetic GPS origin intentionally points the hole toward screen north so a
 * tee-at-bottom illustrated image and its calculation polygons remain registered.
 */
export function restoreMappedHoleFromGame(gameHole, scorecard = {}, origin = { lat: 40.5, lng: -74.4 }) {
  finiteCoordinate(origin, "editor origin");
  const metadata = gameHole?.hole_metadata;
  const geometries = gameHole?.geometries;
  if (!metadata || !geometries) throw new Error("installed game hole geometry is incomplete");
  const holeNumber = Number(metadata.hole_number);
  if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
    throw new Error("installed game hole number must be between 1 and 18");
  }

  const feature = (type, source, index, fallbackLabel) => {
    const id = source.id || source.segment_id || `restored-${type}-${holeNumber}-${index + 1}`;
    return {
      id,
      type,
      label: source.description || fallbackLabel,
      source: "installed_game",
      points: gamePolygonToLocalGps(origin, source.polygon, `${fallbackLabel} polygon`)
    };
  };
  const teeType = source => {
    const identity = String(source.id || "").toLowerCase();
    if (identity.includes("blue")) return "tee_blue";
    if (identity.includes("red") || identity.includes("forward") || identity.includes("gold")) return "tee_forward";
    return "tee_white";
  };
  const teeFeatures = (geometries.tee_boxes || []).map((source, index) => {
    const type = teeType(source);
    return feature(type, source, index, `${type.replaceAll("_", " ")} ${index + 1}`);
  });
  const hazards = (geometries.hazards || []).map((source, index) => {
    const type = String(source.lie_catalog_id || "").includes("water") ? "water" : "bunker";
    return feature(type, source, index, `${type === "water" ? "Water" : "Sand bunker"} ${index + 1}`);
  });
  const green = feature("green", geometries.green_complex, 0, "Green");
  const features = [
    ...teeFeatures,
    ...(geometries.fairway_segments || []).map((source, index) => feature("fairway", source, index, `Fairway ${index + 1}`)),
    ...(geometries.rough_zones || []).map((source, index) => feature("rough", source, index, `Rough ${index + 1}`)),
    ...(geometries.tree_zones || []).map((source, index) => feature("trees", source, index, `Trees ${index + 1}`)),
    ...(geometries.cart_paths || []).map((source, index) => feature("cart_path", source, index, `Cart path ${index + 1}`)),
    ...hazards,
    green,
    ...(geometries.out_of_bounds || []).map((source, index) => feature("out_of_bounds", source, index, `Out of bounds ${index + 1}`))
  ];
  const centerline = (gameHole.centerline_waypoints || []).map(item => gamePointToLocalGps(origin, item.point));
  if (centerline.length < 2) throw new Error("installed game hole needs tee and pin centerline points");
  const pinPoint = geometries.green_complex?.pin_zones?.[0]?.center_point || gameHole.centerline_waypoints.at(-1)?.point;
  const markers = {
    blue_tee: null,
    white_tee: centerline[0],
    forward_tee: null,
    pin: gamePointToLocalGps(origin, pinPoint)
  };
  teeFeatures.forEach(item => {
    const key = item.type === "tee_blue" ? "blue_tee" : item.type === "tee_forward" ? "forward_tee" : "white_tee";
    markers[key] = polygonCenter(item.points);
  });

  const enginePoints = [
    ...(gameHole.centerline_waypoints || []).map(item => item.point),
    ...(geometries.tee_boxes || []).flatMap(item => item.polygon || []),
    ...(geometries.fairway_segments || []).flatMap(item => item.polygon || []),
    ...(geometries.rough_zones || []).flatMap(item => item.polygon || []),
    ...(geometries.tree_zones || []).flatMap(item => item.polygon || []),
    ...(geometries.cart_paths || []).flatMap(item => item.polygon || []),
    ...(geometries.hazards || []).flatMap(item => item.polygon || []),
    ...(geometries.out_of_bounds || []).flatMap(item => item.polygon || []),
    ...(geometries.green_complex?.polygon || [])
  ];
  const xs = enginePoints.map(point => point[0]);
  const ys = enginePoints.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const xPad = Math.max(22, (maxX - minX) * .12);
  const yPad = Math.max(18, (maxY - minY) * .045);

  return {
    hole: {
      hole_number: holeNumber,
      par: Number(scorecard.par || metadata.par) || 4,
      handicap: Number(scorecard.handicap || metadata.handicap_rating) || holeNumber,
      layout_type: metadata.layout_type || "Mapped from local hole image",
      elevation_change_meters: Number(gameHole.elevation_profile?.points?.at(-1)?.elevation_m) || 0,
      yardages: {
        blue: Number(scorecard.blue) || 0,
        white: Number(scorecard.white) || 0,
        forward: Number(scorecard.forward) || 0
      },
      markers,
      route_points: centerline.slice(1, -1),
      features,
      local_image_calibration: metadata.geometry_calibration?.local_image_calibration || null,
      gps_control_points: metadata.gps_calibration?.anchors ? {
        white_tee: metadata.gps_calibration.anchors.white_tee?.gps || null,
        green_center: metadata.gps_calibration.anchors.green_center?.gps || null,
        bunker_center: metadata.gps_calibration.anchors.bunker_center?.gps || null,
        bunker_feature_id: metadata.gps_calibration.anchors.bunker_center?.feature_id || null
      } : null
    },
    imageBounds: {
      southWest: offsetGpsPoint(origin, minX - xPad, minY - yPad),
      northEast: offsetGpsPoint(origin, maxX + xPad, maxY + yPad)
    }
  };
}

export function validateMapperProject(project) {
  if (!project || typeof project !== "object") throw new Error("mapping project must be an object");
  if (project.version !== MAPPER_PROJECT_VERSION) {
    throw new Error(`unsupported mapping project version: ${project.version || "missing"}`);
  }
  if (typeof project.course_name !== "string" || !project.course_name.trim()) {
    throw new Error("course name is required");
  }
  configureMapperCourseStructure(project, project.course_structure);
  if (project.course_structure === MAPPER_COURSE_STRUCTURES.THREE_NINES) {
    const loopNames = mapperNineLoops(project).map(loop => loop.name.toLocaleLowerCase());
    if (new Set(loopNames).size !== loopNames.length) {
      throw new Error("the three nine-hole courses must have different names");
    }
  }
  if (!project.holes || typeof project.holes !== "object") throw new Error("project holes are missing");
  for (let holeNumber = 1; holeNumber <= mapperHoleCount(project); holeNumber += 1) {
    const hole = project.holes[String(holeNumber)];
    if (!hole || typeof hole !== "object") throw new Error(`Hole ${holeNumber} is missing`);
    if (!Array.isArray(hole.features) || !Array.isArray(hole.route_points)) {
      throw new Error(`Hole ${holeNumber} has invalid mapped features`);
    }
    for (const feature of hole.features) {
      if (!FEATURE_TYPES.has(feature.type)) throw new Error(`unsupported feature type: ${feature.type}`);
      if (!Array.isArray(feature.points) || feature.points.length < 3) {
        throw new Error(`${feature.type} must contain at least three points`);
      }
      feature.points.forEach((point, index) => finiteCoordinate(point, `${feature.type} point ${index + 1}`));
    }
  }
  return project;
}

export function parseMapperProject(text) {
  let project;
  try {
    project = JSON.parse(text);
  } catch (error) {
    throw new Error("mapping project is not valid JSON", { cause: error });
  }
  return validateMapperProject(project);
}

export function offsetGpsPoint(center, eastMeters, northMeters) {
  finiteCoordinate(center, "center");
  const latRadians = center.lat * Math.PI / 180;
  return {
    lat: center.lat + northMeters / EARTH_RADIUS_METERS * 180 / Math.PI,
    lng: center.lng + eastMeters / (EARTH_RADIUS_METERS * Math.cos(latRadians)) * 180 / Math.PI
  };
}

export function gpsDeltaMeters(origin, point) {
  finiteCoordinate(origin, "origin");
  finiteCoordinate(point);
  const meanLatitude = (origin.lat + point.lat) / 2 * Math.PI / 180;
  return {
    east: (point.lng - origin.lng) * Math.PI / 180 * EARTH_RADIUS_METERS * Math.cos(meanLatitude),
    north: (point.lat - origin.lat) * Math.PI / 180 * EARTH_RADIUS_METERS
  };
}

export function roundedGpsRectangle(center, widthMeters, lengthMeters, cornerRatio = .2) {
  finiteCoordinate(center, "rounded rectangle center");
  if (![widthMeters, lengthMeters, cornerRatio].every(Number.isFinite) ||
      widthMeters <= 0 || lengthMeters <= 0 || cornerRatio <= 0 || cornerRatio > .5) {
    throw new Error("rounded rectangle dimensions and corner ratio must be positive and finite");
  }
  const halfWidth = widthMeters / 2;
  const halfLength = lengthMeters / 2;
  const radius = Math.min(halfWidth, halfLength) * cornerRatio * 2;
  const corners = [
    { east: halfWidth - radius, north: halfLength - radius, start: 0 },
    { east: -halfWidth + radius, north: halfLength - radius, start: 90 },
    { east: -halfWidth + radius, north: -halfLength + radius, start: 180 },
    { east: halfWidth - radius, north: -halfLength + radius, start: 270 }
  ];
  return corners.flatMap(corner => [0, 45, 90].map(offset => {
    const angle = (corner.start + offset) * Math.PI / 180;
    return offsetGpsPoint(
      center,
      corner.east + Math.cos(angle) * radius,
      corner.north + Math.sin(angle) * radius
    );
  }));
}

export function roundedGpsBounds(points, cornerRatio = .2) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error("rounded bounds require at least three points");
  }
  points.forEach((point, index) => finiteCoordinate(point, `rounded bounds point ${index + 1}`));
  const origin = points[0];
  const offsets = points.map(point => gpsDeltaMeters(origin, point));
  const east = offsets.map(point => point.east);
  const north = offsets.map(point => point.north);
  const minEast = Math.min(...east), maxEast = Math.max(...east);
  const minNorth = Math.min(...north), maxNorth = Math.max(...north);
  const width = Math.max(2, maxEast - minEast);
  const length = Math.max(2, maxNorth - minNorth);
  const center = offsetGpsPoint(origin, (minEast + maxEast) / 2, (minNorth + maxNorth) / 2);
  return roundedGpsRectangle(center, width, length, cornerRatio);
}

export function scaleGpsPointAround(origin, point, scale) {
  finiteCoordinate(origin, "scale origin");
  finiteCoordinate(point, "scaled point");
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("scale must be a positive finite number");
  const delta = gpsDeltaMeters(origin, point);
  return offsetGpsPoint(origin, delta.east * scale, delta.north * scale);
}

export function scaleGpsPolygon(points, scale) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error("scaling requires a polygon with at least three points");
  }
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("scale must be a positive finite number");
  points.forEach((point, index) => finiteCoordinate(point, `scaling point ${index + 1}`));
  const center = polygonCenter(points);
  return points.map(point => scaleGpsPointAround(center, point, scale));
}

export function quarterTurnGpsBounds(bounds) {
  finiteCoordinate(bounds?.southWest, "image south-west bound");
  finiteCoordinate(bounds?.northEast, "image north-east bound");
  const center = {
    lat: (bounds.southWest.lat + bounds.northEast.lat) / 2,
    lng: (bounds.southWest.lng + bounds.northEast.lng) / 2
  };
  const northEast = gpsDeltaMeters(center, bounds.northEast);
  const halfEast = Math.abs(northEast.north);
  const halfNorth = Math.abs(northEast.east);
  return {
    southWest: offsetGpsPoint(center, -halfEast, -halfNorth),
    northEast: offsetGpsPoint(center, halfEast, halfNorth)
  };
}

export function distanceMeters(first, second) {
  const delta = gpsDeltaMeters(first, second);
  return Math.hypot(delta.east, delta.north);
}

export function rotateGpsPolygon(points, degrees) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error("rotation requires a polygon with at least three points");
  }
  if (!Number.isFinite(degrees)) throw new Error("rotation angle must be finite");
  points.forEach((point, index) => finiteCoordinate(point, `rotation point ${index + 1}`));
  const center = points.reduce((total, point) => ({
    lat: total.lat + point.lat / points.length,
    lng: total.lng + point.lng / points.length
  }), { lat: 0, lng: 0 });
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return points.map(point => {
    const delta = gpsDeltaMeters(center, point);
    return offsetGpsPoint(
      center,
      delta.east * cosine - delta.north * sine,
      delta.east * sine + delta.north * cosine
    );
  });
}

export function resampleGpsPolygon(points, targetCount) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new Error("resampling requires a polygon with at least three points");
  }
  if (!Number.isInteger(targetCount) || targetCount < 3) {
    throw new Error("resampled polygon point count must be at least three");
  }
  points.forEach((point, index) => finiteCoordinate(point, `resampling point ${index + 1}`));
  const segments = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return { point, delta: gpsDeltaMeters(point, next), length: distanceMeters(point, next) };
  });
  const perimeter = segments.reduce((total, segment) => total + segment.length, 0);
  if (perimeter < 1) throw new Error("polygon perimeter is too small to resample");
  const result = [];
  let segmentIndex = 0;
  let segmentStart = 0;
  for (let index = 0; index < targetCount; index += 1) {
    const targetDistance = perimeter * index / targetCount;
    while (segmentIndex < segments.length - 1 &&
      segmentStart + segments[segmentIndex].length < targetDistance) {
      segmentStart += segments[segmentIndex].length;
      segmentIndex += 1;
    }
    const segment = segments[segmentIndex];
    const amount = segment.length ? (targetDistance - segmentStart) / segment.length : 0;
    result.push(offsetGpsPoint(
      segment.point,
      segment.delta.east * amount,
      segment.delta.north * amount
    ));
  }
  return result;
}

function routeDirection(first, second) {
  const delta = gpsDeltaMeters(first, second);
  const length = Math.hypot(delta.east, delta.north);
  if (length < 1) throw new Error("route points must be at least one meter apart");
  return { east: delta.east / length, north: delta.north / length };
}

function moveAlong(point, direction, forwardMeters, rightMeters = 0) {
  return offsetGpsPoint(
    point,
    direction.east * forwardMeters + direction.north * rightMeters,
    direction.north * forwardMeters - direction.east * rightMeters
  );
}

function orientedOval(center, direction, lengthMeters, widthMeters, pointCount = 12) {
  return Array.from({ length: pointCount }, (_, index) => {
    const angle = index / pointCount * Math.PI * 2;
    return moveAlong(
      center,
      direction,
      Math.cos(angle) * lengthMeters / 2,
      Math.sin(angle) * widthMeters / 2
    );
  });
}

function orientedBox(center, direction, lengthMeters, widthMeters) {
  const halfLength = lengthMeters / 2;
  const halfWidth = widthMeters / 2;
  return [
    moveAlong(center, direction, -halfLength, -halfWidth),
    moveAlong(center, direction, halfLength, -halfWidth),
    moveAlong(center, direction, halfLength, halfWidth),
    moveAlong(center, direction, -halfLength, halfWidth)
  ];
}

export function alignSecondaryTeesFromWhite(hole) {
  const markers = hole?.markers;
  const features = hole?.features;
  const yardages = hole?.yardages;
  const whiteTee = markers?.white_tee;
  const pin = markers?.pin;
  const whiteBox = Array.isArray(features)
    ? features.filter(feature => feature.type === "tee_white" && Array.isArray(feature.points) && feature.points.length >= 3).at(-1)
    : null;
  if (!whiteTee || !pin || !whiteBox) return { aligned: [], reason: "white tee box, white tee marker, and pin are required" };

  if (distanceMeters(whiteTee, pin) < 1) return { aligned: [], reason: "white tee and pin must be distinct" };
  const direction = routeDirection(whiteTee, pin);
  const whiteYards = Number(yardages?.white);
  if (!Number.isFinite(whiteYards) || whiteYards <= 0) return { aligned: [], reason: "white yardage is required" };

  const definitions = [
    { key: "blue_tee", type: "tee_blue", name: "Blue", yards: Number(yardages?.blue), offset: yards => -(yards - whiteYards) * .9144, valid: yards => yards > whiteYards },
    { key: "forward_tee", type: "tee_forward", name: "Forward", yards: Number(yardages?.forward), offset: yards => (whiteYards - yards) * .9144, valid: yards => yards > 0 && yards < whiteYards }
  ];
  const aligned = [];
  definitions.forEach(definition => {
    if (!Number.isFinite(definition.yards) || !definition.valid(definition.yards)) return;
    const target = moveAlong(whiteTee, direction, definition.offset(definition.yards));
    const latDelta = target.lat - whiteTee.lat;
    const lngDelta = target.lng - whiteTee.lng;
    const existing = features.find(feature => feature.type === definition.type);
    const alignedFeature = {
      ...(existing || {}),
      id: existing?.id || `aligned-${definition.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: definition.type,
      label: existing?.label || `${definition.name} tee box`,
      source: existing?.source || "scorecard_tee_alignment",
      points: whiteBox.points.map(point => ({ lat: point.lat + latDelta, lng: point.lng + lngDelta }))
    };
    hole.features = hole.features.filter(feature => feature.type !== definition.type);
    hole.features.push(alignedFeature);
    hole.markers[definition.key] = target;
    aligned.push(definition.name.toLowerCase());
  });
  return { aligned };
}

export function buildTreeBrushPolygon(inputPoints, radiusMeters, maxPoints = 48) {
  if (!Array.isArray(inputPoints) || !inputPoints.length) throw new Error("tree brush requires at least one point");
  if (!Number.isFinite(radiusMeters) || radiusMeters < 1) throw new Error("tree brush radius must be at least one meter");
  const origin = finiteCoordinate(inputPoints[0], "tree brush point");
  const centers = inputPoints.map(point => {
    const delta = gpsDeltaMeters(origin, finiteCoordinate(point, "tree brush point"));
    return [delta.east, delta.north];
  }).filter((point, index, points) => index === 0 || Math.hypot(point[0] - points[index - 1][0], point[1] - points[index - 1][1]) > .15);
  const toGps = point => offsetGpsPoint(origin, point[0], point[1]);
  if (centers.length === 1) {
    return Array.from({ length: 20 }, (_, index) => {
      const angle = index / 20 * Math.PI * 2;
      return toGps([Math.cos(angle) * radiusMeters, Math.sin(angle) * radiusMeters]);
    });
  }

  const directions = centers.map((point, index) => {
    const first = centers[Math.max(0, index - 1)];
    const second = centers[Math.min(centers.length - 1, index + 1)];
    const length = Math.hypot(second[0] - first[0], second[1] - first[1]) || 1;
    return [(second[0] - first[0]) / length, (second[1] - first[1]) / length];
  });
  const left = centers.map((point, index) => [
    point[0] - directions[index][1] * radiusMeters,
    point[1] + directions[index][0] * radiusMeters
  ]);
  const right = centers.map((point, index) => [
    point[0] + directions[index][1] * radiusMeters,
    point[1] - directions[index][0] * radiusMeters
  ]);
  const cap = (center, startAngle) => Array.from({ length: 9 }, (_, index) => {
    const angle = startAngle - index / 8 * Math.PI;
    return [center[0] + Math.cos(angle) * radiusMeters, center[1] + Math.sin(angle) * radiusMeters];
  });
  const endLeftAngle = Math.atan2(left.at(-1)[1] - centers.at(-1)[1], left.at(-1)[0] - centers.at(-1)[0]);
  const startRightAngle = Math.atan2(right[0][1] - centers[0][1], right[0][0] - centers[0][0]);
  const polygon = [
    ...left,
    ...cap(centers.at(-1), endLeftAngle).slice(1),
    ...right.slice().reverse().slice(1),
    ...cap(centers[0], startRightAngle).slice(1)
  ].map(toGps);
  return polygon.length > maxPoints ? resampleGpsPolygon(polygon, maxPoints) : polygon;
}

function corridorPolygon(points, halfWidthMeters) {
  const directions = points.map((point, index) => {
    if (index === 0) return routeDirection(point, points[1]);
    if (index === points.length - 1) return routeDirection(points[index - 1], point);
    return routeDirection(points[index - 1], points[index + 1]);
  });
  return [
    ...points.map((point, index) => moveAlong(point, directions[index], 0, -halfWidthMeters)),
    ...points.map((point, index) => moveAlong(point, directions[index], 0, halfWidthMeters)).reverse()
  ];
}

function sliceRoute(points, startMeters, endMeters) {
  const result = [];
  let traveled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const first = points[index - 1];
    const second = points[index];
    const segmentLength = distanceMeters(first, second);
    const segmentStart = traveled;
    const segmentEnd = traveled + segmentLength;
    if (segmentEnd >= startMeters && segmentStart <= endMeters) {
      const direction = routeDirection(first, second);
      const localStart = Math.max(0, startMeters - segmentStart);
      const localEnd = Math.min(segmentLength, endMeters - segmentStart);
      const startPoint = moveAlong(first, direction, localStart);
      const endPoint = moveAlong(first, direction, localEnd);
      if (!result.length || distanceMeters(result.at(-1), startPoint) > .2) result.push(startPoint);
      if (distanceMeters(result.at(-1), endPoint) > .2) result.push(endPoint);
    }
    traveled = segmentEnd;
  }
  return result;
}

export function buildAutoDraft(hole) {
  const whiteTee = finiteCoordinate(hole?.markers?.white_tee, "white tee");
  const pin = finiteCoordinate(hole?.markers?.pin, "pin");
  const route = [whiteTee, ...(hole.route_points || []), pin].filter(
    (point, index, points) => index === 0 || distanceMeters(points[index - 1], point) >= 1
  );
  if (route.length < 2) throw new Error("mark the white tee and pin at different locations");

  const totalMeters = route.slice(1).reduce(
    (total, point, index) => total + distanceMeters(route[index], point),
    0
  );
  if (totalMeters < 45) throw new Error("the white tee and pin are too close to draft a hole");

  const firstDirection = routeDirection(route[0], route[1]);
  const finalDirection = routeDirection(route.at(-2), route.at(-1));
  const markers = { ...hole.markers };
  const whiteYards = Number(hole.yardages?.white) || 0;
  if (!markers.blue_tee && whiteYards && Number(hole.yardages?.blue) > whiteYards) {
    markers.blue_tee = moveAlong(whiteTee, firstDirection, -(Number(hole.yardages.blue) - whiteYards) * .9144);
  }
  if (!markers.forward_tee && whiteYards && Number(hole.yardages?.forward) > 0 && Number(hole.yardages.forward) < whiteYards) {
    markers.forward_tee = moveAlong(whiteTee, firstDirection, (whiteYards - Number(hole.yardages.forward)) * .9144);
  }

  const timestamp = Date.now();
  const generated = [];
  const addFeature = (type, label, points) => generated.push({
    id: `auto-${type}-${timestamp}-${generated.length + 1}`,
    type,
    label,
    source: "auto_draft",
    points
  });

  addFeature("rough", "Auto-draft playing corridor", corridorPolygon(route, Number(hole.par) === 3 ? 27 : 40));
  if (Number(hole.par) !== 3) {
    const startGap = Math.min(42, totalMeters * .18);
    const endGap = Math.min(28, totalMeters * .13);
    const fairwayRoute = sliceRoute(route, startGap, totalMeters - endGap);
    if (fairwayRoute.length >= 2) {
      addFeature("fairway", "Auto-draft fairway", corridorPolygon(fairwayRoute, 19));
    }
  }
  addFeature("green", "Auto-draft green", orientedOval(pin, finalDirection, 30, 24));

  const teeDefinitions = [
    ["blue", markers.blue_tee],
    ["white", markers.white_tee],
    ["forward", markers.forward_tee]
  ];
  teeDefinitions.forEach(([tee, marker]) => {
    if (marker) addFeature(`tee_${tee}`, `Auto-draft ${tee} tee box`, orientedBox(marker, firstDirection, 14, 8));
  });

  const manualFeatures = (hole.features || []).filter(feature =>
    feature.source !== "auto_draft" && !(Number(hole.par) === 3 && feature.type === "fairway")
  );
  const manualTypes = new Set(manualFeatures.map(feature => feature.type));
  const preserved = manualFeatures;
  const accepted = generated.filter(feature => !manualTypes.has(feature.type));
  const result = {
    markers,
    features: [...preserved, ...accepted],
    generatedCount: accepted.length,
    skippedTypes: [...new Set(generated.filter(feature => manualTypes.has(feature.type)).map(feature => feature.type))]
  };
  const alignedDraft = { ...hole, markers: result.markers, features: result.features };
  alignSecondaryTeesFromWhite(alignedDraft);
  result.markers = alignedDraft.markers;
  result.features = alignedDraft.features;
  return result;
}

export function createEngineTransform(whiteTee, pin) {
  const forwardDelta = gpsDeltaMeters(whiteTee, pin);
  const length = Math.hypot(forwardDelta.east, forwardDelta.north);
  if (length < 1) throw new Error("white tee and pin must be at least one meter apart");
  const forward = {
    east: forwardDelta.east / length,
    north: forwardDelta.north / length
  };
  const right = { east: forward.north, north: -forward.east };
  return point => {
    const delta = gpsDeltaMeters(whiteTee, point);
    return [
      round(delta.east * right.east + delta.north * right.north),
      round(delta.east * forward.east + delta.north * forward.north)
    ];
  };
}

export function uprightHoleViewTarget(hole) {
  return hole?.route_points?.[0] || hole?.markers?.pin || null;
}

export function createUprightGpsViewTransform(whiteTee, orientationTarget) {
  const tee = finiteCoordinate(whiteTee, "upright view white tee");
  const target = finiteCoordinate(orientationTarget, "upright view first-leg target");
  const forwardDelta = gpsDeltaMeters(tee, target);
  const length = Math.hypot(forwardDelta.east, forwardDelta.north);
  if (length < 1) throw new Error("white tee and first-leg target must be at least one meter apart");
  const forward = {
    east: forwardDelta.east / length,
    north: forwardDelta.north / length
  };
  const right = { east: forward.north, north: -forward.east };
  const toView = point => {
    const delta = gpsDeltaMeters(tee, finiteCoordinate(point, "upright view point"));
    return offsetGpsPoint(
      tee,
      delta.east * right.east + delta.north * right.north,
      delta.east * forward.east + delta.north * forward.north
    );
  };
  const fromView = point => {
    const delta = gpsDeltaMeters(tee, finiteCoordinate(point, "upright display point"));
    return offsetGpsPoint(
      tee,
      delta.east * right.east + delta.north * forward.east,
      delta.east * right.north + delta.north * forward.north
    );
  };
  return {
    bearing_degrees: Math.atan2(forward.east, forward.north) * 180 / Math.PI,
    toView,
    fromView
  };
}

function routeDistance(points) {
  return points.slice(1).reduce(
    (total, point, index) => total + Math.hypot(
      point[0] - points[index][0],
      point[1] - points[index][1]
    ),
    0
  );
}

function polygon(feature, transform) {
  return feature.points.map(transform);
}

function featureDescription(feature) {
  if (feature.label) return feature.label;
  return {
    tee_blue: "Blue tee box.",
    tee_white: "White tee box.",
    tee_forward: "Forward tee box.",
    fairway: "Mapped fairway segment.",
    rough: "Mapped primary rough.",
    bunker: "Mapped sand bunker.",
    green: "Mapped putting green.",
    water: "Mapped water hazard.",
    penalty_area_unknown: "Imported penalty area awaiting classification.",
    hole_outline: "Mapped hole outline.",
    trees: "Mapped wooded area.",
    out_of_bounds: "Mapped out-of-bounds area."
  }[feature.type];
}

function featuresOf(hole, type) {
  return hole.features.filter(feature => feature.type === type);
}

function pointInPolygon(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;

  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crossesLatitude = (currentPoint.lat > point.lat) !== (previousPoint.lat > point.lat);
    const longitudeAtLatitude =
      ((previousPoint.lng - currentPoint.lng) * (point.lat - currentPoint.lat)) /
        (previousPoint.lat - currentPoint.lat || Number.EPSILON) +
      currentPoint.lng;
    if (crossesLatitude && point.lng < longitudeAtLatitude) inside = !inside;
  }
  return inside;
}

function orientation(first, second, third) {
  const value = (second.lng - first.lng) * (third.lat - first.lat) -
    (second.lat - first.lat) * (third.lng - first.lng);
  return Math.abs(value) < 1e-12 ? 0 : Math.sign(value);
}

function segmentsIntersect(first, second, third, fourth) {
  return orientation(first, second, third) !== orientation(first, second, fourth) &&
    orientation(third, fourth, first) !== orientation(third, fourth, second);
}

export function polygonsOverlap(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second) || first.length < 3 || second.length < 3) return false;
  if (first.some(point => pointInPolygon(point, second)) || second.some(point => pointInPolygon(point, first))) return true;
  return first.some((point, index) => {
    const next = first[(index + 1) % first.length];
    return second.some((other, otherIndex) => segmentsIntersect(
      point,
      next,
      other,
      second[(otherIndex + 1) % second.length]
    ));
  });
}

function mappedHoleValidation(project, holeNumber) {
  const hole = project.holes[String(holeNumber)];
  const problems = [];
  if (!hole.markers.blue_tee) problems.push("mark the blue tee");
  if (!hole.markers.white_tee) problems.push("mark the white tee");
  if (!hole.markers.forward_tee) problems.push("mark the forward tee");
  if (!hole.markers.pin) problems.push("mark the pin");
  if (!featuresOf(hole, "tee_blue").length) problems.push("add a blue tee box");
  if (!featuresOf(hole, "tee_white").length) problems.push("add a white tee box");
  if (!featuresOf(hole, "tee_forward").length) problems.push("add a forward tee box");
  if (!featuresOf(hole, "rough").length) problems.push("add rough");
  if (!featuresOf(hole, "green").length) problems.push("add a green");
  if (!featuresOf(hole, "fairway").length && Number(hole.par) > 3) problems.push("add a fairway");
  if (!Number(hole.yardages.blue)) problems.push("enter blue tee yardage");
  if (!Number(hole.yardages.white)) problems.push("enter white tee yardage");
  if (!Number(hole.yardages.forward)) problems.push("enter forward tee yardage");
  if (featuresOf(hole, "penalty_area_unknown").length) {
    problems.push("classify each imported penalty area as water or remove it");
  }

  for (const tee of ["blue", "white", "forward"]) {
    const marker = hole.markers[`${tee}_tee`];
    const teeBoxes = featuresOf(hole, `tee_${tee}`);
    if (marker && teeBoxes.length && !teeBoxes.some(feature => pointInPolygon(marker, feature.points))) {
      problems.push(`place the ${tee} tee marker inside its tee box`);
    }
  }
  const greens = featuresOf(hole, "green");
  if (hole.markers.pin && greens.length && !greens.some(feature => pointInPolygon(hole.markers.pin, feature.points))) {
    problems.push("place the pin inside the green");
  }
  return problems;
}

export function holeMappingStatus(project, holeNumber) {
  validateMapperProject(project);
  const problems = mappedHoleValidation(project, holeNumber);
  return { ready: problems.length === 0, problems };
}

export function buildGameHoleJson(project, holeNumber) {
  validateMapperProject(project);
  const holeCount = mapperHoleCount(project);
  if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > holeCount) {
    throw new Error(`holeNumber must be between 1 and ${holeCount}`);
  }
  const hole = project.holes[String(holeNumber)];
  const problems = mappedHoleValidation(project, holeNumber);
  if (problems.length) throw new Error(`Hole ${holeNumber}: ${problems.join(", ")}`);

  const transform = createEngineTransform(hole.markers.white_tee, hole.markers.pin);
  const routeGps = [hole.markers.white_tee, ...hole.route_points, hole.markers.pin];
  const route = routeGps.map(transform).filter(
    (point, index, points) => index === 0 || Math.hypot(
      point[0] - points[index - 1][0],
      point[1] - points[index - 1][1]
    ) > .2
  );
  const totalMeters = routeDistance(route);
  const allTeeFeatures = [
    ...featuresOf(hole, "tee_blue"),
    ...featuresOf(hole, "tee_white"),
    ...featuresOf(hole, "tee_forward")
  ];
  const teeNames = { tee_blue: "blue", tee_white: "white", tee_forward: "red" };
  const fairways = Number(hole.par) === 3 ? [] : featuresOf(hole, "fairway");
  const rough = featuresOf(hole, "rough");
  const bunkers = featuresOf(hole, "bunker");
  const waters = featuresOf(hole, "water");
  const unknownPenaltyAreas = featuresOf(hole, "penalty_area_unknown");
  const holeOutlines = featuresOf(hole, "hole_outline");
  const cartPaths = featuresOf(hole, "cart_path");
  const trees = featuresOf(hole, "trees");
  const green = featuresOf(hole, "green")[0];
  const outOfBounds = featuresOf(hole, "out_of_bounds");
  const elevationChange = Number(hole.elevation_change_meters) || 0;

  return {
    hole_metadata: {
      course_name: project.course_name,
      hole_number: holeNumber,
      par: Number(hole.par),
      handicap_rating: Number(hole.handicap),
      total_distance_meters: round(totalMeters),
      layout_type: hole.layout_type || "Mapped from local hole image",
      coordinate_system: {
        origin: "White tee marker (0, 0)",
        unit: "meters",
        axes: {
          y: "Forward progress toward mapped pin",
          x: "Golfer-relative lateral displacement"
        }
      },
      geometry_calibration: {
        version: `${project.course_id}-aerial-map-v1`,
        source_image: project.hole_imagery?.[String(holeNumber)] === "local"
          ? `Local image for Hole ${holeNumber}`
          : null,
        imagery_source: project.imagery_source || "Legacy mapper source not recorded",
        method: "User-aligned local hole artwork transformed from mapped coordinates",
        hazards_authored_at_game_scale: true,
        local_image_calibration: hole.local_image_calibration || null
      },
      source_geography: {
        address: project.address || null,
        white_tee: hole.markers.white_tee,
        pin: hole.markers.pin
      },
      gps_calibration: hole.gps_control_points ? buildHoleGpsCalibration(hole) : null
    },
    centerline_waypoints: route.map((point, index) => ({
      index,
      point,
      description: index === 0
        ? "White tee marker"
        : index === route.length - 1
          ? "Mapped pin"
          : `Route control ${index}`
    })),
    geometries: {
      tee_boxes: allTeeFeatures.map((feature, index) => ({
        id: `tee_${teeNames[feature.type]}_h${holeNumber}_${index + 1}`,
        lie_catalog_id: "lie_tee",
        elevation_m: 0,
        polygon: polygon(feature, transform)
      })),
      fairway_segments: fairways.map((feature, index) => ({
        segment_id: `fairway_h${holeNumber}_segment_${index + 1}`,
        lie_catalog_id: "lie_fairway",
        polygon: polygon(feature, transform),
        description: featureDescription(feature)
      })),
      rough_zones: rough.map((feature, index) => ({
        id: `rough_h${holeNumber}_${index + 1}`,
        lie_catalog_id: "lie_rough_medium",
        polygon: polygon(feature, transform),
        description: featureDescription(feature)
      })),
      tree_zones: trees.map((feature, index) => ({
        id: `trees_h${holeNumber}_${index + 1}`,
        polygon: polygon(feature, transform),
        description: featureDescription(feature),
        gameplay_effect: "decorative_only"
      })),
      cart_paths: cartPaths.map((feature, index) => ({
        id: `cart_path_h${holeNumber}_${index + 1}`,
        lie_catalog_id: "lie_cart_path",
        polygon: polygon(feature, transform),
        description: featureDescription(feature),
        gameplay_effect: "free_relief_reference"
      })),
      hazards: [
        ...bunkers.map((feature, index) => ({
          id: `bunker_h${holeNumber}_${index + 1}`,
          lie_catalog_id: "lie_hazard_sand",
          polygon: polygon(feature, transform),
          description: featureDescription(feature)
        })),
        ...waters.map((feature, index) => ({
          id: `water_h${holeNumber}_${index + 1}`,
          lie_catalog_id: "lie_hazard_water",
          polygon: polygon(feature, transform),
          description: featureDescription(feature)
        })),
        ...unknownPenaltyAreas.map((feature, index) => ({
          id: `penalty_unknown_h${holeNumber}_${index + 1}`,
          lie_catalog_id: "lie_hazard_water",
          polygon: polygon(feature, transform),
          description: featureDescription(feature),
          requires_review: true
        }))
      ],
      hole_bounds: holeOutlines.map((feature, index) => ({
        id: `hole_bounds_h${holeNumber}_${index + 1}`,
        polygon: polygon(feature, transform),
        description: featureDescription(feature)
      })),
      green_complex: {
        id: `green_primary_h${holeNumber}`,
        lie_catalog_id: "lie_green",
        polygon: polygon(green, transform),
        pin_zones: [{
          zone_id: "center_standard",
          center_point: transform(hole.markers.pin),
          radius_meters: 3
        }]
      },
      out_of_bounds: outOfBounds.map((feature, index) => ({
        id: `ob_h${holeNumber}_${index + 1}`,
        lie_catalog_id: "lie_ob_hazard",
        polygon: polygon(feature, transform),
        description: featureDescription(feature)
      }))
    },
    elevation_profile: {
      sampling_interval_meters: round(Math.max(1, totalMeters / 4), 2),
      points: [0, .25, .5, .75, 1].map(fraction => ({
        y: round(totalMeters * fraction),
        elevation_m: round(elevationChange * fraction)
      })),
      description: "Linear elevation profile from the mapper's entered tee-to-green change."
    }
  };
}

export function buildScorecardCsv(project) {
  validateMapperProject(project);
  const rows = ["Hole,Par,Handicap,Yards_Blue,Yards_White,Yards_Red"];
  for (let holeNumber = 1; holeNumber <= 18; holeNumber += 1) {
    const hole = project.holes[String(holeNumber)];
    rows.push([
      holeNumber,
      Number(hole.par) || 4,
      Number(hole.handicap) || holeNumber,
      Number(hole.yardages.blue) || 0,
      Number(hole.yardages.white) || 0,
      Number(hole.yardages.forward) || 0
    ].join(","));
  }
  return `${rows.join("\n")}\n`;
}

function scorecardCells(line) {
  const trimmed = line.trim();
  if (!trimmed) return [];
  if (/[\t,;|]/.test(trimmed)) return trimmed.split(/[\t,;|]+/).map(cell => cell.trim()).filter(Boolean);
  return trimmed.split(/\s+/).filter(Boolean);
}

function normalizedScorecardText(text) {
  return String(text || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*tr\s*>/gi, "\n")
    .replace(/<\/\s*(td|th)\s*>/gi, "\t")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "");
}

function scorecardKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function scorecardNumber(value) {
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

const SCORECARD_COLUMNS = {
  hole: new Set(["hole", "holenumber", "no", "number"]),
  par: new Set(["par", "menspar", "menpar"]),
  handicap: new Set(["handicap", "hcp", "hdcp", "menshandicap", "menhandicap"]),
  blue: new Set(["blue", "blueyards", "yardsblue", "bluetees", "black", "blackyards", "championship"]),
  white: new Set(["white", "whiteyards", "yardswhite", "whitetees", "member", "members"]),
  forward: new Set(["red", "redyards", "yardsred", "redtees", "gold", "goldyards", "yardsgold", "forward", "forwardyards", "yardsforward"])
};

function columnKind(value) {
  const key = scorecardKey(value);
  return Object.entries(SCORECARD_COLUMNS).find(([, aliases]) => aliases.has(key))?.[0] || null;
}

function validateScorecardRows(rows, holeCount = 18) {
  if (![9, 18].includes(holeCount)) throw new Error("scorecard hole count must be 9 or 18");
  if (rows.length !== holeCount) throw new Error(`found ${rows.length} holes; exactly ${holeCount} are required`);
  const byHole = new Map();
  rows.forEach(row => {
    const hole = Number(row.hole);
    if (!Number.isInteger(hole) || hole < 1 || hole > holeCount) throw new Error(`invalid hole number: ${row.hole}`);
    if (byHole.has(hole)) throw new Error(`hole ${hole} appears more than once`);
    const par = Number(row.par);
    const handicap = Number(row.handicap);
    if (!Number.isInteger(par) || par < 3 || par > 6) throw new Error(`Hole ${hole} has invalid par`);
    if (!Number.isInteger(handicap) || handicap < 1 || handicap > 18) throw new Error(`Hole ${hole} has invalid handicap`);
    for (const tee of ["blue", "white", "forward"]) {
      const yards = Number(row[tee]);
      if (!Number.isFinite(yards) || yards < 50 || yards > 800) throw new Error(`Hole ${hole} has invalid ${tee} yardage`);
    }
    byHole.set(hole, { hole, par, handicap, blue: Number(row.blue), white: Number(row.white), forward: Number(row.forward) });
  });
  for (let hole = 1; hole <= holeCount; hole += 1) {
    if (!byHole.has(hole)) throw new Error(`hole ${hole} is missing`);
  }
  return [...byHole.values()].sort((first, second) => first.hole - second.hole);
}

function parseScorecardColumns(lines, holeCount) {
  const headerIndex = lines.findIndex(line => {
    const kinds = new Set(scorecardCells(line).map(columnKind).filter(Boolean));
    return ["hole", "par", "handicap", "blue", "white", "forward"].every(kind => kinds.has(kind));
  });
  if (headerIndex < 0) return null;
  const headers = scorecardCells(lines[headerIndex]).map(columnKind);
  const indexes = Object.fromEntries(headers.map((kind, index) => [kind, index]).filter(([kind]) => kind));
  const rows = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = scorecardCells(line);
    if (!cells.length) continue;
    const hole = scorecardNumber(cells[indexes.hole]);
    if (!Number.isInteger(hole) || hole < 1 || hole > holeCount) continue;
    rows.push(Object.fromEntries(
      ["hole", "par", "handicap", "blue", "white", "forward"].map(kind => [kind, scorecardNumber(cells[indexes[kind]])])
    ));
  }
  return validateScorecardRows(rows, holeCount);
}

function findScorecardMatrixRow(lines, wantedKind) {
  for (const line of lines) {
    const cells = scorecardCells(line);
    const kindIndex = cells.findIndex(cell => columnKind(cell) === wantedKind);
    if (kindIndex >= 0) return { cells, kindIndex };
  }
  return null;
}

function parseScorecardMatrix(lines, holeCount) {
  const holeRow = findScorecardMatrixRow(lines, "hole");
  if (!holeRow) return null;
  const positions = [];
  holeRow.cells.forEach((cell, index) => {
    const hole = scorecardNumber(cell);
    if (Number.isInteger(hole) && hole >= 1 && hole <= holeCount && !positions.some(entry => entry.hole === hole)) {
      positions.push({ hole, index });
    }
  });
  if (positions.length !== holeCount) return null;

  const matrixRows = Object.fromEntries(
    ["par", "handicap", "blue", "white", "forward"].map(kind => [kind, findScorecardMatrixRow(lines, kind)])
  );
  if (Object.values(matrixRows).some(row => !row)) return null;
  const rows = positions.map(({ hole, index }) => {
    const result = { hole };
    for (const [kind, row] of Object.entries(matrixRows)) {
      const adjustedIndex = index - holeRow.kindIndex + row.kindIndex;
      result[kind] = scorecardNumber(row.cells[adjustedIndex]);
    }
    return result;
  });
  return validateScorecardRows(rows, holeCount);
}

export function parseScorecardText(text, { holeCount = 18 } = {}) {
  const expectedHoleCount = Number(holeCount);
  if (![9, 18].includes(expectedHoleCount)) throw new Error("scorecard hole count must be 9 or 18");
  const lines = normalizedScorecardText(text).split("\n").map(line => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error("paste a scorecard first");
  try {
    const columns = parseScorecardColumns(lines, expectedHoleCount);
    if (columns) return columns;
  } catch (error) {
    throw error;
  }
  const matrix = parseScorecardMatrix(lines, expectedHoleCount);
  if (matrix) return matrix;
  throw new Error("could not identify Hole, Par, Handicap, Blue, White, and Red/Gold/Forward values");
}

export function buildGameCoursePackage(project) {
  validateMapperProject(project);
  return buildRoutedGameCoursePackage(project, {
    courseId: cleanId(project.course_id),
    courseName: project.course_name,
    sourceHoles: Array.from({ length: 18 }, (_, index) => index + 1),
    exportedAt: new Date().toISOString()
  });
}

function routedScorecardCsv(project, sourceHoles) {
  const rows = ["Hole,Par,Handicap,Yards_Blue,Yards_White,Yards_Red"];
  sourceHoles.forEach((sourceHoleNumber, index) => {
    const hole = project.holes[String(sourceHoleNumber)];
    rows.push([
      index + 1,
      Number(hole.par) || 4,
      Number(hole.handicap) || index + 1,
      Number(hole.yardages.blue) || 0,
      Number(hole.yardages.white) || 0,
      Number(hole.yardages.forward) || 0
    ].join(","));
  });
  return `${rows.join("\n")}\n`;
}

function buildRoutedGameCoursePackage(project, { courseId, courseName, sourceHoles, exportedAt }) {
  const holes = {};
  const errors = {};
  sourceHoles.forEach((sourceHoleNumber, index) => {
    const gameHoleNumber = index + 1;
    try {
      const gameHole = buildGameHoleJson(project, sourceHoleNumber);
      gameHole.hole_metadata = {
        ...gameHole.hole_metadata,
        course_name: courseName,
        hole_number: gameHoleNumber,
        facility_hole_number: sourceHoleNumber
      };
      holes[String(gameHoleNumber)] = gameHole;
    } catch (error) {
      errors[String(gameHoleNumber)] = error.message;
    }
  });
  if (!Object.keys(holes).length) throw new Error("No holes are ready to export");
  return {
    version: GAME_PACKAGE_VERSION,
    course_id: cleanId(courseId),
    course_name: courseName,
    facility_id: cleanId(project.course_id),
    exported_at: exportedAt,
    scorecard_csv: routedScorecardCsv(project, sourceHoles),
    holes,
    gps_calibrated_holes: Object.values(holes).filter(hole => hole.hole_metadata?.gps_calibration).length,
    incomplete_holes: errors,
    source_holes: [...sourceHoles]
  };
}

function routedCourseId(baseId, firstId, secondId) {
  const suffix = `-${firstId}-${secondId}`;
  const base = cleanId(baseId).slice(0, Math.max(1, 63 - suffix.length)).replace(/-+$/g, "");
  return `${base}${suffix}`;
}

export function buildGameCoursePackages(project) {
  validateMapperProject(project);
  if (project.course_structure !== MAPPER_COURSE_STRUCTURES.THREE_NINES) {
    return [buildGameCoursePackage(project)];
  }
  const exportedAt = new Date().toISOString();
  const loops = mapperNineLoops(project);
  const combinations = loops.flatMap(first => loops
    .filter(second => second.id !== first.id)
    .map(second => [first, second]));
  return combinations.map(([first, second]) => {
    const sourceHoles = [first, second].flatMap(loop =>
      Array.from({ length: 9 }, (_, index) => loop.start + index)
    );
    return buildRoutedGameCoursePackage(project, {
      courseId: routedCourseId(project.course_id, first.id, second.id),
      courseName: `${project.course_name} · ${first.name} + ${second.name}`,
      sourceHoles,
      exportedAt
    });
  });
}
