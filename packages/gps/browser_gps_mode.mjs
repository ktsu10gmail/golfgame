const EARTH_RADIUS_METERS = 6371008.8;
const YARDS_PER_METER = 1.09361;

function finiteGps(point, label = "GPS point") {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    throw new Error(`${label} is unavailable`);
  }
  return point;
}

function gpsDeltaMeters(origin, point) {
  finiteGps(origin, "GPS calibration origin");
  finiteGps(point);
  const meanLatitude = (origin.lat + point.lat) / 2 * Math.PI / 180;
  return {
    east: (point.lng - origin.lng) * Math.PI / 180 * EARTH_RADIUS_METERS * Math.cos(meanLatitude),
    north: (point.lat - origin.lat) * Math.PI / 180 * EARTH_RADIUS_METERS
  };
}

function offsetGpsPoint(origin, eastMeters, northMeters) {
  finiteGps(origin, "GPS calibration origin");
  const latitudeRadians = origin.lat * Math.PI / 180;
  return {
    lat: origin.lat + northMeters / EARTH_RADIUS_METERS * 180 / Math.PI,
    lng: origin.lng + eastMeters / (EARTH_RADIUS_METERS * Math.cos(latitudeRadians)) * 180 / Math.PI
  };
}

export function gpsToCoursePoint(calibration, gpsPoint) {
  const origin = finiteGps(calibration?.origin, "GPS calibration origin");
  const matrix = calibration?.matrix;
  if (!matrix) throw new Error("This hole has not been GPS calibrated");
  const eastX = Number(matrix.east_meters_per_course_x);
  const eastY = Number(matrix.east_meters_per_course_y);
  const northX = Number(matrix.north_meters_per_course_x);
  const northY = Number(matrix.north_meters_per_course_y);
  const determinant = eastX * northY - eastY * northX;
  if (![eastX, eastY, northX, northY, determinant].every(Number.isFinite) || Math.abs(determinant) < 1e-8) {
    throw new Error("This hole's GPS calibration is invalid");
  }
  const delta = gpsDeltaMeters(origin, gpsPoint);
  return [
    (northY * delta.east - eastY * delta.north) / determinant,
    (-northX * delta.east + eastX * delta.north) / determinant
  ];
}

export function coursePointToGps(calibration, point) {
  const origin = finiteGps(calibration?.origin, "GPS calibration origin");
  const matrix = calibration?.matrix;
  if (!matrix || !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) {
    throw new Error("A calibrated hole and finite course point are required");
  }
  return offsetGpsPoint(
    origin,
    matrix.east_meters_per_course_x * point[0] + matrix.east_meters_per_course_y * point[1],
    matrix.north_meters_per_course_x * point[0] + matrix.north_meters_per_course_y * point[1]
  );
}

export function gpsDistanceYards(first, second) {
  const delta = gpsDeltaMeters(finiteGps(first), finiteGps(second));
  return Math.hypot(delta.east, delta.north) * YARDS_PER_METER;
}

export function createGpsRoundId() {
  const randomId = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  return `gps-${randomId}`;
}

export function createGpsRound(courseId, holeCount = 18) {
  return {
    version: "on-course-gps-round-v1",
    round_id: createGpsRoundId(),
    revision: 0,
    course_id: courseId,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    holes: Array.from({ length: holeCount }, (_, index) => ({
      hole_number: index + 1,
      tee: null,
      shots: [],
      putts: 0,
      final_stroke: false,
      finished: false,
      pending_strategy: null
    }))
  };
}

export function gpsHoleScore(holeState) {
  return (holeState?.shots?.length || 0) + (Number(holeState?.putts) || 0) + (holeState?.final_stroke ? 1 : 0);
}

export function gpsRoundScore(round) {
  return (round?.holes || []).reduce((total, holeState) => total + gpsHoleScore(holeState), 0);
}

export function gpsRoundComplete(round) {
  return Array.isArray(round?.holes) && round.holes.length > 0
    && round.holes.every(holeState => holeState?.finished === true);
}

export function completeGpsHole(holeState) {
  if (!holeState?.tee || holeState.finished) return false;
  holeState.finished = true;
  // Retained in the round schema for older saves. New GPS rounds record every
  // putt explicitly, so completing a hole must never add another stroke.
  holeState.final_stroke = false;
  holeState.pending_strategy = null;
  return true;
}

export function holeOutGpsHole(holeState) {
  const currentFix = holeState?.shots?.at(-1)?.end || holeState?.tee;
  if (currentFix?.lie !== "Green" || holeState.finished) return false;
  holeState.putts = Math.max(0, Number(holeState.putts) || 0) + 1;
  return completeGpsHole(holeState);
}

export function firstUnfinishedGpsHoleIndex(round) {
  return Array.isArray(round?.holes)
    ? round.holes.findIndex(holeState => holeState?.finished !== true)
    : -1;
}

export function nextGpsHoleIndex(currentHoleIndex, holeCount = 18) {
  const count = Math.max(1, Math.trunc(Number(holeCount)) || 18);
  const current = Math.max(0, Math.min(count - 1, Math.trunc(Number(currentHoleIndex)) || 0));
  return (current + 1) % count;
}

export function gpsRoundReviewAction(round, currentHoleIndex) {
  const holeCount = Array.isArray(round?.holes) && round.holes.length ? round.holes.length : 18;
  const current = Math.max(0, Math.min(holeCount - 1, Math.trunc(Number(currentHoleIndex)) || 0));
  if (current < holeCount - 1) {
    return { kind: "next", holeIndex: current + 1 };
  }
  const unfinished = firstUnfinishedGpsHoleIndex(round);
  return unfinished < 0
    ? { kind: "complete", holeIndex: current }
    : { kind: "unfinished", holeIndex: unfinished };
}

export function latestCompletedGpsHoleIndex(round, currentHoleIndex = 0) {
  if (!Array.isArray(round?.holes) || !round.holes.length) return -1;
  const current = Math.max(0, Math.min(round.holes.length - 1, Number(currentHoleIndex) || 0));
  for (let index = current; index >= 0; index -= 1) {
    if (round.holes[index]?.finished === true) return index;
  }
  for (let index = round.holes.length - 1; index > current; index -= 1) {
    if (round.holes[index]?.finished === true) return index;
  }
  return -1;
}

export function gpsHoleReview(holeState, par) {
  const normalizedPar = Math.max(3, Math.round(Number(par) || 4));
  const shots = Array.isArray(holeState?.shots) ? holeState.shots : [];
  const greenShotIndex = shots.findIndex(shot => shot?.end?.lie === "Green");
  const recordedPutts = Math.max(0, Number(holeState?.putts) || 0) + (holeState?.final_stroke ? 1 : 0);
  return {
    par: normalizedPar,
    score: gpsHoleScore(holeState),
    putts: recordedPutts,
    green_in_regulation: greenShotIndex >= 0 && greenShotIndex + 1 <= normalizedPar - 2,
    green_reached_in: greenShotIndex >= 0 ? greenShotIndex + 1 : null,
    shots: shots.map((shot, index) => ({
      number: index + 1,
      label: index === 0 ? "Tee shot" : `${index + 1}${({ 2: "nd", 3: "rd" })[index + 1] || "th"} shot`,
      club_name: shot?.strategy?.club_name || "No shot selected",
      power: Number.isFinite(Number(shot?.strategy?.power)) ? Number(shot.strategy.power) : null,
      distance_yards: Math.max(0, Math.round(Number(shot?.distance_yards) || 0)),
      lie: shot?.evidence_snapshot?.situation?.lie || shot?.start?.lie || (index === 0 ? "Tee" : null),
      conditions: shot?.evidence_snapshot?.situation?.conditions || shot?.start?.conditions || shot?.strategy?.ball_conditions || null,
      target: shot?.evidence_snapshot?.intent || (finiteCoursePoint(shot?.strategy?.target_course_point) ? {
        target_label: shot.strategy.target_label || "Selected map target",
        target_course_point: [...shot.strategy.target_course_point],
        target_distance_yards: null,
        target_source: shot.strategy.target_source || null
      } : null)
    }))
  };
}

export function correctGpsRecordedShot(holeState, shotIndex, choice, correctedAt = new Date().toISOString()) {
  if (!holeState?.finished || !Array.isArray(holeState.shots)) {
    throw new Error("only completed-hole shots can be corrected");
  }
  const index = Number(shotIndex);
  const shot = Number.isInteger(index) ? holeState.shots[index] : null;
  if (!shot) throw new Error("recorded shot was not found");
  shot.strategy = manualGpsStrategy(shot.strategy, choice);
  shot.strategy.corrected_in_review_at = correctedAt;
  return shot.strategy;
}

export function deleteGpsRecordedShot(holeState, shotIndex) {
  if (!Array.isArray(holeState?.shots)) throw new Error("recorded shots are unavailable");
  const index = Number(shotIndex);
  const shot = Number.isInteger(index) ? holeState.shots[index] : null;
  if (!shot) throw new Error("recorded shot was not found");
  return holeState.shots.splice(index, 1)[0];
}

export function deleteLastGpsPutt(holeState) {
  if (!holeState || !Number.isInteger(holeState.putts) || holeState.putts < 0) {
    throw new Error("recorded putts are unavailable");
  }
  if (holeState.putts > 0) {
    holeState.putts -= 1;
    return true;
  }
  if (holeState.final_stroke === true) {
    holeState.final_stroke = false;
    return true;
  }
  throw new Error("there is no recorded putt to delete");
}

const GPS_STANCES = new Set(["tbd", "level", "above_feet", "below_feet"]);
const GPS_SLOPES = new Set(["tbd", "level", "uphill", "downhill"]);
const GPS_ROUGH_DEPTHS = new Set(["tbd", "light", "mild", "deep"]);

export function normalizeGpsBallConditions(conditions, lie) {
  const rough = lie === "Rough" || lie === "Heavy rough";
  return {
    stance: GPS_STANCES.has(conditions?.stance) ? conditions.stance : "level",
    slope: GPS_SLOPES.has(conditions?.slope) ? conditions.slope : "level",
    rough_depth: rough && GPS_ROUGH_DEPTHS.has(conditions?.rough_depth)
      ? conditions.rough_depth
      : rough ? "light" : null
  };
}

function finiteCoursePoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
}

export function createGpsShotEvidenceSnapshot(start, strategy, capturedAt = null) {
  const lie = start?.lie || null;
  const sourceConditions = start?.conditions || strategy?.ball_conditions || null;
  const conditions = sourceConditions ? normalizeGpsBallConditions(sourceConditions, lie) : null;
  const targetPoint = finiteCoursePoint(strategy?.target_course_point)
    ? [...strategy.target_course_point]
    : null;
  const startPoint = finiteCoursePoint(start?.course_point) ? start.course_point : null;
  const targetDistance = startPoint && targetPoint
    ? Math.round(Math.hypot(targetPoint[0] - startPoint[0], targetPoint[1] - startPoint[1]))
    : null;
  const targetLabel = targetPoint ? strategy?.target_label || "Selected map target" : null;
  return {
    version: "gps-shot-evidence-v1",
    captured_at: capturedAt || null,
    situation: {
      lie,
      conditions
    },
    intent: targetPoint ? {
      target_type: strategy?.target_type || strategy?.id || "map_target",
      target_label: targetLabel,
      target_course_point: targetPoint,
      target_x: targetPoint[0],
      target_y: targetPoint[1],
      target_distance_yards: targetDistance,
      target_source: strategy?.target_source || "player_selected_caddie_option"
    } : null,
    decision: {
      club: strategy?.club_name || null,
      swing_effort_percent: Number.isFinite(Number(strategy?.power)) ? Number(strategy.power) : null,
      choice_source: strategy?.id === "manual-choice" ? "player_choice" : strategy?.id ? "selected_plan" : null
    }
  };
}

export function recommendGpsClub(clubs, targetYards, { lie = "Fairway", distanceMultiplier = 1 } = {}) {
  const yards = Number(targetYards);
  const multiplier = Number(distanceMultiplier);
  if (!Array.isArray(clubs) || !Number.isFinite(yards) || yards <= 0 || !Number.isFinite(multiplier) || multiplier <= 0) {
    return null;
  }
  const candidates = clubs
    .map((club, clubIndex) => ({ ...club, clubIndex }))
    .filter(club => club.name !== "Putter" && Number.isFinite(Number(club.carry)) && Number(club.carry) > 0)
    .filter(club => lie === "Tee" || club.name !== "Driver");
  if (!candidates.length) return null;

  const swingPowers = [100, 75, 50, 25];
  const matches = candidates.flatMap(club => swingPowers.map(power => {
    const expectedYards = Number(club.carry) * multiplier * power / 100;
    const partialSwingPenalty = (100 - power) * .08;
    const accuracyCredit = Math.max(0, Math.min(100, Number(club.accuracy) || 0)) * .01;
    return {
      clubIndex: club.clubIndex,
      clubName: club.name,
      carry: Number(club.carry),
      accuracy: Number(club.accuracy) || 0,
      power,
      expectedYards,
      score: Math.abs(expectedYards - yards) + partialSwingPenalty - accuracyCredit
    };
  }));
  matches.sort((first, second) => first.score - second.score
    || second.power - first.power
    || second.accuracy - first.accuracy
    || first.carry - second.carry);
  return matches[0] || null;
}

export function manualGpsStrategy(previousStrategy, { clubName, clubIndex, power }) {
  const normalizedPower = Math.max(25, Math.min(100, Math.round(Number(power) / 25) * 25));
  if (!clubName || !Number.isInteger(clubIndex) || !Number.isFinite(normalizedPower)) {
    throw new Error("a club and power are required for a player choice");
  }
  const considered = previousStrategy?.id === "manual-choice"
    ? previousStrategy.considered_strategy || null
    : previousStrategy
      ? {
          id: previousStrategy.id,
          title: previousStrategy.title,
          club_name: previousStrategy.club_name,
          club_index: previousStrategy.club_index,
          power: previousStrategy.power,
          target_label: previousStrategy.target_label,
          target_type: previousStrategy.target_type,
          target_source: previousStrategy.target_source,
          target_course_point: finiteCoursePoint(previousStrategy.target_course_point)
            ? [...previousStrategy.target_course_point]
            : null,
          hybrid_outlook: previousStrategy.hybrid_outlook,
          probability_score: previousStrategy.probability_score
        }
      : null;
  const retainedTarget = finiteCoursePoint(previousStrategy?.target_course_point)
    ? [...previousStrategy.target_course_point]
    : finiteCoursePoint(considered?.target_course_point)
      ? [...considered.target_course_point]
      : null;
  return {
    id: "manual-choice",
    title: "Player choice",
    club_name: clubName,
    club_index: clubIndex,
    power: normalizedPower,
    target_label: retainedTarget ? previousStrategy?.target_label || considered?.target_label || "Selected map target" : null,
    target_type: retainedTarget ? previousStrategy?.target_type || considered?.target_type || "map_target" : null,
    target_source: retainedTarget ? previousStrategy?.target_source || considered?.target_source || "player_selected_caddie_option" : null,
    target_course_point: retainedTarget,
    considered_strategy: considered
  };
}

export function gpsStrategyWithSelectedTarget(previousStrategy, { coursePoint, label }) {
  if (!finiteCoursePoint(coursePoint)) throw new Error("a valid map target is required");
  if (!previousStrategy?.club_name || !Number.isInteger(previousStrategy?.club_index)) {
    throw new Error("choose a club before selecting a target");
  }
  const manual = manualGpsStrategy(previousStrategy, {
    clubName: previousStrategy.club_name,
    clubIndex: previousStrategy.club_index,
    power: previousStrategy.power
  });
  return {
    ...manual,
    ball_conditions: previousStrategy.ball_conditions || null,
    club_snapshot: previousStrategy.club_snapshot || null,
    expected_yards: previousStrategy.expected_yards ?? null,
    target_label: label || "Player-selected target",
    target_type: "player_map_target",
    target_source: "player_selected_live_map",
    target_course_point: [...coursePoint]
  };
}

export function undoGpsHoleAction(holeState) {
  if (holeState.finished) {
    holeState.finished = false;
    holeState.final_stroke = false;
    return "hole completion";
  }
  if (holeState.putts > 0) {
    holeState.putts -= 1;
    return "putt";
  }
  if (holeState.shots.length) {
    holeState.shots.pop();
    holeState.pending_strategy = null;
    return "ball location";
  }
  if (holeState.tee) {
    holeState.tee = null;
    holeState.pending_strategy = null;
    return "tee location";
  }
  return null;
}
