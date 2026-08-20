export const TREE_CONDITION_VERSION = "tree-conditions-v1";

export const TREE_CONDITION_INVENTORY = Object.freeze({
  ball_surface: Object.freeze(["light_rough", "mild_rough", "deep_rough"]),
  tree_position: Object.freeze(["edge_of_trees", "under_canopy", "deep_in_trees"]),
  pin_line: Object.freeze(["clear", "partially_blocked", "blocked"]),
  canopy: Object.freeze(["high_branches", "medium_branches", "low_branches"]),
  swing_room: Object.freeze(["three_quarter_swing", "half_swing", "punch_only"]),
  escape_direction: Object.freeze(["left", "right", "forward", "backward"]),
  escape_quality: Object.freeze(["wide", "moderate", "narrow"]),
  escape_destination: Object.freeze(["fairway", "clear_area"])
});

function pointInPolygon(point, polygon) {
  let inside = false;
  let previous = polygon.at(-1);
  for (const current of polygon) {
    if ((current[1] > point[1]) !== (previous[1] > point[1]) &&
        point[0] < (previous[0] - current[0]) * (point[1] - current[1]) /
          (previous[1] - current[1]) + current[0]) inside = !inside;
    previous = current;
  }
  return inside;
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const progress = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared
  ));
  return Math.hypot(point[0] - start[0] - dx * progress, point[1] - start[1] - dy * progress);
}

function distanceToBoundary(point, polygon) {
  return Math.min(...polygon.map((end, index) =>
    distanceToSegment(point, polygon[index === 0 ? polygon.length - 1 : index - 1], end)
  ));
}

function pointAt(start, direction, yards, yardsPerUnit) {
  const units = yards / yardsPerUnit;
  return [start[0] + direction[0] * units, start[1] + direction[1] * units];
}

function insideAny(point, polygons) {
  return polygons.some(polygon => pointInPolygon(point, polygon));
}

function escapeCandidates({ ball, pin, trees, fairways, yardsPerUnit, pinLine }) {
  const dx = pin[0] - ball[0], dy = pin[1] - ball[1];
  const length = Math.hypot(dx, dy) || 1;
  const forward = [dx / length, dy / length];
  const directions = [
    { direction: "left", vector: [-forward[1], forward[0]], preference: 0 },
    { direction: "right", vector: [forward[1], -forward[0]], preference: 0 },
    { direction: "backward", vector: [-forward[0], -forward[1]], preference: 8 },
    { direction: "forward", vector: forward, preference: pinLine === "blocked" ? 24 : 4 }
  ];
  return directions.map(candidate => {
    let clearYards = null;
    let fairwayEntryYards = null;
    let fairwayEndYards = null;
    for (let yards = 1; yards <= 120; yards += 1) {
      const point = pointAt(ball, candidate.vector, yards, yardsPerUnit);
      if (clearYards === null && !insideAny(point, trees)) clearYards = yards;
      const onFairway = clearYards !== null && !insideAny(point, trees) && insideAny(point, fairways);
      if (fairwayEntryYards === null && onFairway) fairwayEntryYards = yards;
      if (fairwayEntryYards !== null) {
        if (onFairway) fairwayEndYards = yards;
        else if (fairwayEndYards !== null) {
          fairwayEndYards = yards;
          break;
        }
      }
    }
    const escapeYards = fairwayEntryYards ?? clearYards;
    const targetYards = fairwayEntryYards !== null && fairwayEndYards !== null
      ? (fairwayEntryYards + fairwayEndYards) / 2
      : escapeYards;
    return escapeYards === null ? null : {
      direction: candidate.direction,
      vector: candidate.vector,
      distance_yards: escapeYards,
      target_yards: targetYards,
      target: pointAt(ball, candidate.vector, targetYards, yardsPerUnit),
      destination: fairwayEntryYards === null ? "clear_area" : "fairway",
      fairway_entry_yards: fairwayEntryYards,
      fairway_end_yards: fairwayEndYards,
      score: (fairwayEntryYards === null ? 70 : 0) + escapeYards + candidate.preference
    };
  }).filter(Boolean).sort((first, second) => first.score - second.score);
}

export function evaluateTreeCondition({
  ball, pin, treeZones = [], fairways = [], protectedZones = [], yardsPerUnit = 1, fringeYards = 4
}) {
  if (!Array.isArray(ball) || !Array.isArray(pin) || !Number.isFinite(yardsPerUnit) || yardsPerUnit <= 0) {
    throw new Error("tree conditions require finite ball, pin, and scale values");
  }
  const zones = treeZones
    .map((zone, index) => ({ id: zone.id || `trees_${index + 1}`, polygon: zone.polygon || zone }))
    .filter(zone => Array.isArray(zone.polygon) && zone.polygon.length >= 3);
  const protectedPolygons = protectedZones
    .map(zone => zone.polygon || zone)
    .filter(polygon => Array.isArray(polygon) && polygon.length >= 3);
  if (insideAny(ball, protectedPolygons)) return null;
  const containing = zones.filter(zone => pointInPolygon(ball, zone.polygon) ||
    distanceToBoundary(ball, zone.polygon) * yardsPerUnit <= fringeYards);
  if (!containing.length) return null;
  const treePolygons = zones.map(zone => zone.polygon);
  const fairwayPolygons = fairways.map(item => item.polygon || item).filter(polygon => Array.isArray(polygon) && polygon.length >= 3);
  const insideMappedCanopy = containing.some(zone => pointInPolygon(ball, zone.polygon));
  const depthYards = insideMappedCanopy
    ? Math.min(...containing.filter(zone => pointInPolygon(ball, zone.polygon)).map(zone => distanceToBoundary(ball, zone.polygon))) * yardsPerUnit
    : 0;
  const treePosition = !insideMappedCanopy || depthYards <= 2 ? "edge_of_trees" : depthYards <= 8 ? "under_canopy" : "deep_in_trees";
  const ballSurface = treePosition === "edge_of_trees" ? "light_rough" : treePosition === "under_canopy" ? "mild_rough" : "deep_rough";
  const canopy = treePosition === "edge_of_trees" ? "high_branches" : treePosition === "under_canopy" ? "medium_branches" : "low_branches";
  const swingRoom = treePosition === "edge_of_trees" ? "three_quarter_swing" : treePosition === "under_canopy" ? "half_swing" : "punch_only";
  const pinDistance = Math.hypot(pin[0] - ball[0], pin[1] - ball[1]) * yardsPerUnit;
  let treeLineYards = 0;
  const sampleLimit = Math.min(pinDistance, 60);
  for (let yards = 1; yards <= sampleLimit; yards += 1) {
    const progress = yards / Math.max(pinDistance, 1e-9);
    const point = [ball[0] + (pin[0] - ball[0]) * progress, ball[1] + (pin[1] - ball[1]) * progress];
    if (insideAny(point, treePolygons)) treeLineYards += 1;
  }
  const pinLine = treeLineYards > 8 || treePosition === "deep_in_trees"
    ? "blocked"
    : treeLineYards > 0 || insideMappedCanopy ? "partially_blocked" : "clear";
  const escape = pinLine === "clear"
    ? { direction: "forward", distance_yards: 0, destination: "clear_area" }
    : escapeCandidates({
        ball, pin, trees: treePolygons, fairways: fairwayPolygons, yardsPerUnit, pinLine
      })[0] || { direction: "backward", distance_yards: Math.max(1, Math.ceil(depthYards)), destination: "clear_area" };
  const escapeQuality = escape.distance_yards <= 10 ? "wide" : escape.distance_yards <= 22 ? "moderate" : "narrow";
  const directionAngle = { forward: 0, right: 90, backward: 180, left: -90 }[escape.direction];
  const directionClock = { forward: 12, right: 3, backward: 6, left: 9 }[escape.direction];
  const code = [
    "TREE", ballSurface, treePosition, pinLine, canopy, swingRoom,
    `escape_${escape.direction}`, escapeQuality, escape.destination
  ].map(value => value.replaceAll("_", "-").toUpperCase()).join("_");
  return {
    version: TREE_CONDITION_VERSION,
    code,
    zone_ids: containing.map(zone => zone.id),
    ball_surface: ballSurface,
    tree_position: treePosition,
    pin_line: pinLine,
    canopy,
    swing_room: swingRoom,
    escape_direction: escape.direction,
    escape_quality: escapeQuality,
    escape_destination: escape.destination,
    escape_distance_yards: Math.round(escape.distance_yards),
    recovery_target: Array.isArray(escape.target) ? escape.target.map(value => Math.round(value * 10000) / 10000) : null,
    recovery_target_yards: Number.isFinite(escape.target_yards) ? Math.round(escape.target_yards) : null,
    recovery_angle_degrees: directionAngle,
    recovery_clock: directionClock,
    fairway_entry_yards: Number.isFinite(escape.fairway_entry_yards) ? Math.round(escape.fairway_entry_yards) : null,
    fairway_end_yards: Number.isFinite(escape.fairway_end_yards) ? Math.round(escape.fairway_end_yards) : null,
    depth_yards: Math.round(depthYards * 10) / 10,
    tree_line_yards: treeLineYards,
    inside_mapped_canopy: insideMappedCanopy
  };
}

const WORDING = Object.freeze({
  ball_surface: { light_rough: "light rough", mild_rough: "mild rough", deep_rough: "deep rough" },
  tree_position: { edge_of_trees: "at the edge of the trees", under_canopy: "under the tree canopy", deep_in_trees: "deep in the trees" },
  pin_line: { clear: "clear", partially_blocked: "partially blocked", blocked: "blocked" },
  canopy: { high_branches: "higher branches", medium_branches: "mid-height branches", low_branches: "low branches" },
  swing_room: { three_quarter_swing: "approximately a three-quarter swing", half_swing: "approximately a half swing", punch_only: "a restricted punch swing" },
  escape_destination: { fairway: "fairway", clear_area: "clear area" }
});

export function treeConditionMessage(condition, { includeDistance = true } = {}) {
  if (!condition) return "";
  const distanceLead = includeDistance && Number.isFinite(condition.remaining_yards)
    ? `You have ${Math.round(condition.remaining_yards)} yards to the pin. `
    : "";
  const obstruction = condition.pin_line === "clear"
    ? "The direct line to the pin is clear of the mapped canopy."
    : `The direct line to the pin is ${WORDING.pin_line[condition.pin_line]} by ${WORDING.canopy[condition.canopy]}.`;
  const direction = condition.escape_direction === "left" || condition.escape_direction === "right"
    ? `to the ${condition.escape_direction} of the pin line`
    : condition.escape_direction === "forward"
      ? "forward along the pin line"
      : "backward away from the pin";
  const angle = Number.isFinite(condition.recovery_angle_degrees)
    ? condition.recovery_angle_degrees === 0
      ? "along the pin line"
      : condition.recovery_angle_degrees === 180
        ? "away from the pin line"
        : `${Math.abs(condition.recovery_angle_degrees)}° ${condition.recovery_angle_degrees < 0 ? "left" : "right"} of the pin line`
    : direction;
  const clock = Number.isFinite(condition.recovery_clock)
    ? `—about ${condition.recovery_clock} o'clock when facing the pin`
    : "";
  const targetYards = condition.recovery_target_yards ?? condition.escape_distance_yards;
  const entryYards = condition.fairway_entry_yards ?? condition.escape_distance_yards;
  const beforeMargin = Math.max(0, targetYards - entryYards);
  const afterMargin = Number.isFinite(condition.fairway_end_yards)
    ? Math.max(0, condition.fairway_end_yards - targetYards)
    : null;
  const recovery = condition.pin_line === "clear"
    ? ""
    : condition.escape_destination === "fairway"
      ? ` Punch out toward the marked recovery target about ${targetYards} yards from your ball, ${angle}${clock}. The fairway begins at about ${entryYards} yards${Number.isFinite(condition.fairway_end_yards) ? ` and its far edge is about ${condition.fairway_end_yards} yards away, leaving roughly ${beforeMargin} yards before the target and ${afterMargin} yards beyond it` : ""}.`
      : ` Punch out toward the marked recovery target about ${targetYards} yards from your ball, ${angle}${clock}.`;
  return `${distanceLead}Your ball is ${WORDING.tree_position[condition.tree_position]} in ${WORDING.ball_surface[condition.ball_surface]}. ` +
    `${obstruction} You have room for ${WORDING.swing_room[condition.swing_room]}.${recovery}`;
}
