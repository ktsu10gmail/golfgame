import { declareUnplayable as resolveUnplayableRelief, simulateFullShot } from "./packages/simulation/browser_engine.mjs?v=20260729-2";
import { scorePuttStrategy, scoreStrategy } from "./packages/simulation/browser_decision_scoring.mjs?v=20260729-2";
import { simulateGreensideShot } from "./packages/simulation/browser_greenside.mjs?v=20260729-2";
import { analyzeRoundStrategy } from "./packages/simulation/browser_round_analysis.mjs?v=20260729-1";
import { simulatePutt } from "./packages/simulation/browser_putting.mjs?v=20260722-2";
import { analyzeSidehillShot } from "./packages/simulation/browser_sidehill.mjs?v=20260729-1";
import {
  appendHoleEvent,
  buildHoleBrowserState,
  buildRoundBrowserState,
  classifyShotCompletion,
  loadRoundState,
  migrateLegacyRoundStateStorage,
  replaceHoleEvents,
  resetRoundState,
  saveRoundState
} from "./packages/simulation/round_state.mjs?v=20260729-1";

const METERS_TO_YARDS = 1.09361;
const PUTTER_RANGE_FEET = 60;
const AI_REQUEST_TIMEOUT_MS = 5000;

function bounded(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value)));
}

function normalizePuttingMakeRates(profile) {
  const supplied = profile.puttingMakeRates;
  if (supplied && [3, 6, 10].every(feet => Number.isFinite(Number(supplied[feet])))) {
    return Object.fromEntries([3, 6, 10].map(feet => [feet, Math.round(bounded(supplied[feet], 0, 100))]));
  }
  // Migrate profiles saved before distance-based putting statistics existed.
  const legacySkill = bounded(profile.putting ?? .72, 0, 1);
  return {
    3: Math.round(bounded(60 + legacySkill * 42, 0, 100)),
    6: Math.round(8 + legacySkill * 65),
    10: Math.round(legacySkill * 42)
  };
}

function normalizeProfile(profile) {
  const clubs = profile.clubs
    .filter(club => club.name !== "Putter")
    .map(club => ({ ...club }));
  clubs.push({ name: "Putter", carry: PUTTER_RANGE_FEET / 3, accuracy: 100 });
  return { ...profile, puttingMakeRates: normalizePuttingMakeRates(profile), clubs };
}

const courseCatalog = {
  meadows: {
    id: "meadows", name: "The Meadows at Middlesex", shortName: "The Meadows",
    dataPath: "data/themeadow", imagePath: "data/themeadow/images", dataVersion: "20260720-aerial-v2", scorecard: "scorecard.csv", holeFile: number => `hole${number}.json`, images: true
  },
  warrenbrook: {
    id: "warrenbrook", name: "Warrenbrook Golf Course", shortName: "Warrenbrook",
    dataPath: "data/warrenbrook", imagePath: "data/warrenbrook/images", dataVersion: "20260720-aerial-v2", scorecard: "scorecard.csv", holeFile: number => `hole${number}.json`, images: true
  },
  cranbury: {
    id: "cranbury", name: "Cranbury Golf Club", shortName: "Cranbury",
    dataPath: "data/cranbury", imagePath: "data/cranbury/images", dataVersion: "20260720-aerial-v1", scorecard: "scorecard.csv", holeFile: number => `hole${number}.json`, images: true,
    teeLabels: { Blue: "Blue", White: "White", Red: "Gold" }
  },
  gallopinghills: {
    id: "gallopinghills", name: "Galloping Hill Golf Course", shortName: "Galloping Hill",
    dataPath: "data/gallopinghills", imagePath: "data/gallopinghills/images", dataVersion: "20260729-aerial-v1", scorecard: "scorecard.csv", holeFile: number => `hole${number}.json`, images: true,
    teeLabels: { Blue: "Blue", White: "White", Red: "Gold" }
  }
};

const builtInProfiles = [
  {
    id: "80",
    name: "80+ player",
    description: "Confident ball striking and a reliable short game",
    puttingMakeRates: { 3: 94, 6: 66, 10: 40 },
    clubs: [
      ["Driver", 245, 68], ["3 Wood", 225, 72], ["5 Wood", 210, 75], ["4 Iron", 190, 76],
      ["5 Iron", 180, 78], ["6 Iron", 168, 80], ["7 Iron", 156, 82], ["8 Iron", 144, 84],
      ["9 Iron", 132, 86], ["Pitching Wedge", 118, 88], ["Gap Wedge", 102, 89],
      ["Sand Wedge", 82, 90], ["Lob Wedge", 65, 88], ["Putter", 20, 100]
    ]
  },
  {
    id: "90",
    name: "90+ player",
    description: "Balanced recreational distances with moderate dispersion",
    puttingMakeRates: { 3: 90, 6: 55, 10: 30 },
    clubs: [
      ["Driver", 220, 56], ["3 Wood", 200, 61], ["5 Wood", 185, 65], ["4 Hybrid", 175, 68],
      ["5 Iron", 165, 69], ["6 Iron", 153, 72], ["7 Iron", 142, 75], ["8 Iron", 130, 78],
      ["9 Iron", 118, 81], ["Pitching Wedge", 105, 83], ["Gap Wedge", 90, 84],
      ["Sand Wedge", 72, 85], ["Lob Wedge", 55, 82], ["Putter", 20, 100]
    ]
  },
  {
    id: "100",
    name: "100+ player",
    description: "Shorter carries and a wider, more varied shot pattern",
    puttingMakeRates: { 3: 86, 6: 48, 10: 26 },
    clubs: [
      ["Driver", 195, 43], ["3 Wood", 175, 48], ["5 Wood", 165, 52], ["5 Hybrid", 155, 56],
      ["6 Iron", 143, 58], ["7 Iron", 132, 61], ["8 Iron", 120, 65], ["9 Iron", 108, 68],
      ["Pitching Wedge", 95, 72], ["Gap Wedge", 82, 74], ["Sand Wedge", 65, 76],
      ["Lob Wedge", 48, 72], ["Putter", 20, 100]
    ]
  }
]
  .map(profile => ({ ...profile, clubs: profile.clubs.map(([name, carry, accuracy]) => ({ name, carry, accuracy })) }))
  .map(normalizeProfile);

const holeNames = [
  "Opening line", "The carry", "Left turn", "The corridor", "Thread the needle", "Short window",
  "Corner office", "The chute", "Homeward bend", "Long look", "Soft left", "The sweep",
  "No favors", "Narrow road", "Commitment", "The long lane", "Small target", "Double decision"
];

const state = {
  courseId: new URLSearchParams(window.location.search).get("course") || localStorage.getItem("golfgame-course") || "meadows",
  course: null,
  holes: [],
  scorecard: [],
  holeIndex: bounded((Number(new URLSearchParams(window.location.search).get("hole")) || 1) - 1, 0, 17),
  tee: "White",
  pinIndex: 2,
  profile: null,
  customProfiles: [],
  selectedClub: 0,
  ball: null,
  currentLie: "Tee",
  target: null,
  shots: [],
  scores: Array(18).fill(null),
  roundHistory: Array.from({ length: 18 }, () => []),
  roundState: null,
  roundSeed: null,
  holeFinished: false,
  completionType: null,
  bounds: null,
  lastShotLine: null,
  gmMessages: [],
  aiAvailable: null,
  clubAdjustment: 0,
  greenEnlarged: false,
  swingPower: 1,
  shotDraft: { club: false, target: false, power: false },
  mobileSheetState: "collapsed",
  mobileQuickPanel: null
};

function puttingMakeProbability(feet, profile = state.profile) {
  const distanceFeet = Math.max(0, Number(feet));
  const rates = normalizePuttingMakeRates(profile);
  const interpolate = (distance, startDistance, endDistance, startRate, endRate) => {
    const progress = (distance - startDistance) / (endDistance - startDistance);
    return startRate + (endRate - startRate) * progress;
  };
  let percentage;
  // Interpolate through the player's measured checkpoints. Beyond 10 feet,
  // continue the observed 6-to-10-foot decline as a bounded exponential curve.
  if (distanceFeet <= 3) percentage = interpolate(distanceFeet, 0, 3, 100, rates[3]);
  else if (distanceFeet <= 6) percentage = interpolate(distanceFeet, 3, 6, rates[3], rates[6]);
  else if (distanceFeet <= 10) percentage = interpolate(distanceFeet, 6, 10, rates[6], rates[10]);
  else if (rates[10] <= 0) percentage = 0;
  else {
    const observedDecay = rates[6] > 0 ? rates[10] / rates[6] : .7;
    const fourFootDecay = bounded(observedDecay, .35, .95);
    percentage = rates[10] * Math.pow(fourFootDecay, (distanceFeet - 10) / 4);
  }
  return bounded(percentage / 100, 0, 1);
}

function puttingConsistency(profile = state.profile) {
  const rates = normalizePuttingMakeRates(profile);
  const weightedRate = (rates[3] * .3 + rates[6] * .4 + rates[10] * .3) / 100;
  return bounded(.45 + weightedRate * .55, .45, .98);
}

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let audioContext = null;
let targetDragging = false;
let targetDragMoved = false;
let targetPointerId = null;
let targetDragStart = null;
let suppressMapClickUntil = 0;
let pendingAutoPlayHandle = null;
let mobileSheetPointerId = null;
let mobileSheetDragStartY = 0;
let mobileSheetDragStartState = "collapsed";
let mobileSheetSuppressClickUntil = 0;
let mobileShotToastHandle = null;

const MOBILE_SHEET_STATES = ["collapsed", "full"];

function ensureAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function fullscreenSupported() {
  const root = document.documentElement;
  return Boolean(root.requestFullscreen || root.webkitRequestFullscreen);
}

function updateFullscreenButton() {
  const button = $("#fullscreen-button");
  if (!button) return;
  if (!fullscreenSupported()) {
    button.hidden = false;
    button.textContent = "Immersive";
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", "Immersive mode help");
    return;
  }
  const active = Boolean(fullscreenElement());
  button.hidden = false;
  button.textContent = active ? "Exit full" : "Full screen";
  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-label", active ? "Exit full screen" : "Enter full screen");
}

function showFullscreenUnavailableMessage() {
  const title = "Full screen unavailable";
  const copy = /iPhone/i.test(navigator.userAgent)
    ? "iPhone browsers do not support true browser fullscreen here. For a bigger view, use Add to Home Screen and open the game from your home screen."
    : "This browser does not support fullscreen for this page.";
  if ($("#mobile-shot-toast")) {
    showMobileShotToast(title, copy);
    return;
  }
  window.alert(copy);
}

async function toggleFullscreen() {
  if (!fullscreenSupported()) {
    showFullscreenUnavailableMessage();
    return;
  }
  const root = document.documentElement;
  if (fullscreenElement()) {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } else if (root.requestFullscreen) {
    await root.requestFullscreen();
  } else if (root.webkitRequestFullscreen) {
    root.webkitRequestFullscreen();
  }
  updateFullscreenButton();
}

function playBallInHoleSound() {
  const context = ensureAudio();
  if (!context) return;
  const now = context.currentTime;
  const impact = context.createOscillator();
  const impactGain = context.createGain();
  impact.type = "sine";
  impact.frequency.setValueAtTime(230, now);
  impact.frequency.exponentialRampToValueAtTime(85, now + .11);
  impactGain.gain.setValueAtTime(.001, now);
  impactGain.gain.exponentialRampToValueAtTime(.26, now + .008);
  impactGain.gain.exponentialRampToValueAtTime(.001, now + .16);
  impact.connect(impactGain).connect(context.destination);
  impact.start(now);
  impact.stop(now + .17);

  [0.09, 0.17].forEach((delay, index) => {
    const rattle = context.createOscillator();
    const gain = context.createGain();
    rattle.type = "triangle";
    rattle.frequency.setValueAtTime(720 - index * 130, now + delay);
    gain.gain.setValueAtTime(.001, now + delay);
    gain.gain.exponentialRampToValueAtTime(.11 - index * .025, now + delay + .006);
    gain.gain.exponentialRampToValueAtTime(.001, now + delay + .07);
    rattle.connect(gain).connect(context.destination);
    rattle.start(now + delay);
    rattle.stop(now + delay + .08);
  });
}

function normalizeWarrenbrookHole(raw) {
  const spatial = raw.spatial_polygons;
  const centerOf = polygon => {
    const points = polygon.length > 1 && polygon[0][0] === polygon.at(-1)[0] && polygon[0][1] === polygon.at(-1)[1] ? polygon.slice(0, -1) : polygon;
    return [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
  };
  const hazards = raw.hazards_and_features.filter(feature => ["sand_trap", "water_body", "water_penalty"].includes(feature.type));
  const outOfBounds = raw.hazards_and_features.filter(feature => feature.type === "out_of_bounds");
  const pinZones = spatial.green_complex.pin_zones.map(zone => ({
    zone_id: zone.zone_id,
    center_point: centerOf(zone.coordinates),
    radius_meters: 3
  }));
  if (pinZones.length < 3) pinZones.push({ zone_id: "center_standard", center_point: centerOf(spatial.green_complex.coordinates), radius_meters: 3 });
  let elevation = 0;
  const elevationPoints = [{ y: 0, elevation_m: 0 }];
  for (const zone of raw.elevation_profile?.slope_zones || []) {
    elevation += zone.base_elevation_change || 0;
    elevationPoints.push({ y: zone.y_end, elevation_m: elevation });
  }
  return {
    hole_metadata: {
      course_name: raw.course_name,
      hole_number: raw.hole_id,
      par: raw.metadata.par,
      handicap_rating: raw.metadata.handicap,
      total_distance_meters: raw.metadata.total_distance_meters,
      layout_type: raw.metadata.layout_type
    },
    centerline_waypoints: raw.centerline_waypoints.map(waypoint => ({ ...waypoint, description: waypoint.desc })),
    geometries: {
      tee_boxes: [{ id: "tee_white", lie_catalog_id: "lie_tee", polygon: spatial.tee_complex.coordinates }],
      fairway_segments: spatial.fairway_segments.map(segment => ({ ...segment, polygon: segment.coordinates })),
      rough_zones: (spatial.rough_zones || spatial.rough_patches || []).map(zone => ({ ...zone, id: zone.zone_id || zone.patch_id, polygon: zone.coordinates })),
      hazards: hazards.map(feature => ({
        id: feature.feature_id,
        lie_catalog_id: feature.type.startsWith("water") ? "lie_hazard_water" : "lie_hazard_sand",
        polygon: feature.coordinates,
        description: feature.gameplay_impact || titleCase(feature.feature_id)
      })),
      green_complex: { id: "green_primary", lie_catalog_id: "lie_green", polygon: spatial.green_complex.coordinates, pin_zones: pinZones },
      out_of_bounds: outOfBounds.map(feature => ({ id: feature.feature_id, lie_catalog_id: "lie_ob_hazard", polygon: feature.coordinates, description: feature.gameplay_impact }))
    },
    elevation_profile: { points: elevationPoints, description: "Elevation derived from Warrenbrook slope zones." }
  };
}

function storageKey(type) { return `golfgame-${state.courseId}-${type}`; }

function persistLegacyRound() {
  localStorage.setItem(storageKey("history"), JSON.stringify(state.roundHistory));
  localStorage.setItem(storageKey("scores"), JSON.stringify(state.scores));
}

function persistRoundState() {
  if (!state.roundState) return null;
  state.roundState = saveRoundState(localStorage, state.roundState);
  return state.roundState;
}

function commitRoundEvent(event) {
  if (!state.roundState) return null;
  state.roundState = appendHoleEvent(state.roundState, state.holeIndex, event);
  return persistRoundState();
}

function syncActiveHoleStateFromRoundState() {
  const teeBall = teePoint();
  const holeState = buildHoleBrowserState(state.roundState, state.holeIndex, {
    ball: teeBall,
    lie: "Tee",
    remaining_distance_yards: distance(teeBall, pin().center_point)
  });
  state.shots = holeState.shots;
  state.ball = holeState.ball ?? teeBall;
  state.currentLie = holeState.lie ?? lieAt(state.ball).type;
  state.holeFinished = holeState.hole_finished;
  state.completionType = holeState.completion_type;
  state.lastShotLine = holeState.last_shot_line;
}

function currentLieType() {
  return state.currentLie || lieAt(state.ball).type;
}

function lieTypeForPoint(point) {
  if (point === state.ball || (Array.isArray(point) && state.ball &&
    Math.abs(point[0] - state.ball[0]) <= 1e-9 &&
    Math.abs(point[1] - state.ball[1]) <= 1e-9)) {
    return currentLieType();
  }
  return lieAt(point).type;
}

function syncRoundStateCaches() {
  if (!state.roundState) return;
  const initialStates = state.scorecard.map((_, holeIndex) => {
    const selectedTee = state.roundState.tee;
    const whiteMeters = state.scorecard[holeIndex].Yards_White / METERS_TO_YARDS;
    const selectedMeters = state.scorecard[holeIndex][`Yards_${selectedTee}`] / METERS_TO_YARDS;
    const delta = whiteMeters - selectedMeters;
    const p0 = state.holes[holeIndex].centerline_waypoints[0].point;
    const p1 = state.holes[holeIndex].centerline_waypoints[1].point;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    const teeBall = [p0[0] + ((p1[0] - p0[0]) / len) * delta, p0[1] + ((p1[1] - p0[1]) / len) * delta];
    const pinPoint = state.holes[holeIndex].geometries.green_complex.pin_zones[state.pinIndex]?.center_point
      || state.holes[holeIndex].geometries.green_complex.pin_zones[2]?.center_point
      || state.holes[holeIndex].geometries.green_complex.pin_zones[0]?.center_point
      || teeBall;
    return {
      ball: teeBall,
      lie: "Tee",
      remaining_distance_yards: distance(teeBall, pinPoint)
    };
  });
  const browserState = buildRoundBrowserState(state.roundState, initialStates);
  state.scores = browserState.scores;
  state.roundHistory = browserState.round_history;
  syncActiveHoleStateFromRoundState();
  persistLegacyRound();
}

function newRoundSeed() {
  const values = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(values);
  else values[0] = Date.now() >>> 0;
  return values[0] || 1;
}

async function loadData(courseId = state.courseId) {
  state.courseId = courseId;
  state.course = courseCatalog[courseId] || courseCatalog.meadows;
  const [scoreText, ...holes] = await Promise.all([
    fetch(`${state.course.dataPath}/${state.course.scorecard}?v=${state.course.dataVersion}`).then(r => r.text()),
    ...Array.from({ length: 18 }, (_, i) => fetch(`${state.course.dataPath}/${state.course.holeFile(i + 1)}?v=${state.course.dataVersion}`).then(r => r.json()))
  ]);
  const lines = scoreText.trim().split(/\r?\n/);
  const headers = lines.shift().split(",");
  state.scorecard = lines.map(line => Object.fromEntries(line.split(",").map((value, i) => [headers[i], value])))
    .filter(row => /^\d+$/.test(row.Hole))
    .map(row => ({
      Hole: Number(row.Hole), Par: Number(row.Par), Handicap: Number(row.Handicap),
      Yards_Blue: Number(row.Yards_Blue ?? row.Blue_Yards),
      Yards_White: Number(row.Yards_White ?? row.White_Yards),
      Yards_Red: Number(row.Yards_Red ?? row.Red_Yards)
    }));
  state.holes = holes.map(raw => raw.hole_metadata ? raw : normalizeWarrenbrookHole(raw));
  state.customProfiles = JSON.parse(localStorage.getItem("middlesex-custom-profiles") || "[]").map(normalizeProfile);
  const legacyHistory = courseId === "meadows" ? localStorage.getItem("middlesex-round-history") : null;
  const legacyScores = courseId === "meadows" ? localStorage.getItem("middlesex-scores") : null;
  state.roundHistory = JSON.parse(localStorage.getItem(storageKey("history")) || legacyHistory || "null") || Array.from({ length: 18 }, () => []);
  state.scores = JSON.parse(localStorage.getItem(storageKey("scores")) || legacyScores || "null") || Array(18).fill(null);
  state.roundSeed = Number(localStorage.getItem(storageKey("round-seed"))) || newRoundSeed();
  localStorage.setItem(storageKey("round-seed"), String(state.roundSeed));
  migrateLegacyRoundStateStorage(localStorage, {
    courseId: state.courseId,
    roundSeed: state.roundSeed,
    tee: state.tee,
    roundHistory: state.roundHistory,
    scores: state.scores
  });
  state.roundState = loadRoundState(localStorage, state.courseId);
  state.tee = state.roundState?.tee || "White";
  syncRoundStateCaches();
  const savedId = localStorage.getItem("middlesex-profile") || "90";
  state.profile = [...builtInProfiles, ...state.customProfiles].find(p => p.id === savedId) || builtInProfiles[1];
}

function centerOfPolygon(polygon) {
  const points = polygon.length > 1 && polygon[0][0] === polygon.at(-1)[0] && polygon[0][1] === polygon.at(-1)[1]
    ? polygon.slice(0, -1)
    : polygon;
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length
  ];
}

function validCenterPoint(value) {
  return Array.isArray(value) && value.length === 2 && value.every(coordinate => Number.isFinite(coordinate));
}

function hole() { return state.holes[state.holeIndex]; }
function card() { return state.scorecard[state.holeIndex]; }
function teeYards() { return card()[`Yards_${state.tee}`]; }
function pin() {
  const zones = hole().geometries.green_complex.pin_zones || [];
  return zones.find((zone, index) => index === state.pinIndex && validCenterPoint(zone?.center_point))
    || zones.find(zone => validCenterPoint(zone?.center_point))
    || { center_point: centerOfPolygon(hole().geometries.green_complex.polygon) };
}
function pinPoint() { return pointArray(pin().center_point); }
function fmtScore(value) { return value === 0 ? "E" : value > 0 ? `+${value}` : `${value}`; }
function titleCase(value) { return value.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase()); }
function formatInches(value) { return `${value} ${Number(value) === 1 ? "inch" : "inches"}`; }
function formatFeet(value) { return `${value} ${Number(value) === 1 ? "foot" : "feet"}`; }
function formatPuttDistance(feet) {
  return feet < 1 ? formatInches(Math.max(1, Math.round(feet * 12))) : formatFeet(Math.round(feet));
}

function teePoint() {
  const whiteMeters = card().Yards_White / METERS_TO_YARDS;
  const selectedMeters = teeYards() / METERS_TO_YARDS;
  const delta = whiteMeters - selectedMeters;
  const p0 = hole().centerline_waypoints[0].point;
  const p1 = hole().centerline_waypoints[1].point;
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
  return [p0[0] + ((p1[0] - p0[0]) / len) * delta, p0[1] + ((p1[1] - p0[1]) / len) * delta];
}

function resetHole() {
  clearPendingAutoPlay();
  const driverIndex = state.profile?.clubs.findIndex(club => club.name === "Driver") ?? 0;
  state.selectedClub = driverIndex >= 0 ? driverIndex : 0;
  state.target = null;
  state.clubAdjustment = 0;
  state.swingPower = 1;
  state.shotDraft = { club: false, target: false, power: false };
  state.mobileSheetState = "collapsed";
  state.gmMessages = [];
  syncActiveHoleStateFromRoundState();
  if (!state.holeFinished) recommendClub();
  $("#putt-analysis")?.setAttribute("hidden", "");
  closeEnlargedGreen();
  updateAll();
}

function resetCurrentHole() {
  if (!state.roundState) {
    resetHole();
    return;
  }
  const hasHoleProgress = state.shots.length > 0 || state.scores[state.holeIndex] != null || state.holeFinished;
  if (hasHoleProgress && !window.confirm(`Reset Hole ${state.holeIndex + 1}? This will clear its score and shot history.`)) {
    return;
  }
  state.roundState = replaceHoleEvents(state.roundState, state.holeIndex, []);
  persistRoundState();
  syncRoundStateCaches();
  resetHole();
}

function collectPoints() {
  const g = hole().geometries;
  const polygons = [
    ...g.tee_boxes.map(x => x.polygon), ...g.fairway_segments.map(x => x.polygon),
    ...(g.rough_zones || []).map(x => x.polygon), ...g.hazards.map(x => x.polygon),
    ...(g.out_of_bounds || []).map(x => x.polygon), g.green_complex.polygon
  ];
  return [...polygons.flat(), teePoint(), ...hole().centerline_waypoints.map(x => x.point)];
}

function mapViewMode() {
  const lie = currentLieType();
  if (lie === "Green") return "putting";
  if (distance(state.ball, pin().center_point) <= 210) return "approach";
  return "full";
}

function calculateBounds() {
  const viewMode = mapViewMode();
  if (state.greenEnlarged) {
    const green = hole().geometries.green_complex.polygon;
    const xs = green.map(point => point[0]);
    const ys = green.map(point => point[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 12);
    const pad = span * .16;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    state.bounds = {
      minX: centerX - span / 2 - pad,
      maxX: centerX + span / 2 + pad,
      minY: centerY - span / 2 - pad,
      maxY: centerY + span / 2 + pad
    };
    return state.bounds;
  }
  if (viewMode === "putting") {
    const g = hole().geometries;
    const nearby = [
      ...g.green_complex.polygon,
      ...g.hazards
        .filter(hazard => hazard.polygon.some(point => rawYards(point, pin().center_point) < 45))
        .flatMap(hazard => hazard.polygon)
    ];
    const xs = nearby.map(p => p[0]), ys = nearby.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 18);
    const pad = span * .55;
    state.bounds = {
      minX: (minX + maxX) / 2 - span / 2 - pad,
      maxX: (minX + maxX) / 2 + span / 2 + pad,
      minY: (minY + maxY) / 2 - span / 2 - pad,
      maxY: (minY + maxY) / 2 + span / 2 + pad
    };
    return state.bounds;
  }
  if (viewMode === "approach") {
    const g = hole().geometries;
    const ball = state.ball;
    const target = pin().center_point;
    const corridorDistance = rawYards(ball, target);
    const nearbyFeatures = [
      ...g.hazards,
      ...(g.rough_zones || []),
      ...g.fairway_segments
    ].filter(feature => feature.polygon.some(point =>
      rawYards(point, target) < 85 || rawYards(point, ball) < 55
    ));
    const points = [
      ball,
      target,
      ...g.green_complex.polygon,
      ...nearbyFeatures.flatMap(feature => feature.polygon)
    ];
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const xPad = Math.max(18, (maxX - minX) * .28, corridorDistance / METERS_TO_YARDS * .08);
    const yPad = Math.max(15, (maxY - minY) * .12);
    state.bounds = {
      minX: minX - xPad,
      maxX: maxX + xPad,
      minY: minY - yPad,
      maxY: maxY + yPad
    };
    return state.bounds;
  }
  const points = collectPoints();
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const xPad = Math.max(22, (maxX - minX) * .12);
  const yPad = Math.max(18, (maxY - minY) * .045);
  state.bounds = { minX: minX - xPad, maxX: maxX + xPad, minY: minY - yPad, maxY: maxY + yPad };
  return state.bounds;
}

function mapFrame() {
  return state.greenEnlarged
    ? { left: 55, right: 945, top: 55, bottom: 945 }
    : { left: 100, right: 900, top: 50, bottom: 950 };
}

function sx(x) {
  const b = state.bounds;
  const frame = mapFrame();
  return frame.left + ((x - b.minX) / (b.maxX - b.minX)) * (frame.right - frame.left);
}
function sy(y) {
  const b = state.bounds;
  const frame = mapFrame();
  return frame.bottom - ((y - b.minY) / (b.maxY - b.minY)) * (frame.bottom - frame.top);
}
function coursePoint(screenX, screenY) {
  const b = state.bounds;
  const frame = mapFrame();
  return [
    b.minX + ((screenX - frame.left) / (frame.right - frame.left)) * (b.maxX - b.minX),
    b.minY + ((frame.bottom - screenY) / (frame.bottom - frame.top)) * (b.maxY - b.minY)
  ];
}
function pointsAttr(poly) { return poly.map(([x, y]) => `${sx(x)},${sy(y)}`).join(" "); }

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    const intersect = ((yi > point[1]) !== (yj > point[1])) &&
      (point[0] < (xj - xi) * (point[1] - yi) / ((yj - yi) || .00001) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function lieAt(point) {
  const g = hole().geometries;
  if ((g.out_of_bounds || []).some(x => pointInPolygon(point, x.polygon))) return { type: "Out of bounds", penalty: true, color: "#b5523e" };
  const hazard = g.hazards.find(x => pointInPolygon(point, x.polygon));
  if (hazard) {
    const water = hazard.lie_catalog_id.includes("water");
    return { type: water ? "Water" : "Bunker", penalty: water, color: water ? "#75aeb3" : "#d8bd79" };
  }
  if (pointInPolygon(point, g.green_complex.polygon)) return { type: "Green", color: "#c3da83" };
  if (g.tee_boxes.some(x => pointInPolygon(point, x.polygon))) return { type: "Tee", color: "#f1eedf" };
  if (g.fairway_segments.some(x => pointInPolygon(point, x.polygon))) return { type: "Fairway", color: "#8ebd77" };
  const rough = (g.rough_zones || []).find(x => pointInPolygon(point, x.polygon));
  if (rough) return { type: rough.lie_catalog_id.includes("heavy") ? "Heavy rough" : "Rough", color: "#4f7a54" };
  return { type: "Rough", color: "#4f7a54" };
}

function strategyText() {
  const g = hole().geometries;
  const hazards = g.hazards.map(h => h.description).filter(Boolean);
  const rough = (g.rough_zones || []).map(r => r.description).filter(Boolean);
  return hazards[0] || rough[0] || `${hole().hole_metadata.layout_type}. Favor the center of the available landing area.`;
}

function renderMap() {
  calculateBounds();
  const g = hole().geometries;
  const viewMode = mapViewMode();
  const poly = (items, cls) => items.map(item => `<polygon class="${cls}" points="${pointsAttr(item.polygon)}"><title>${item.description || item.id || item.segment_id || cls}</title></polygon>`).join("");
  const pinPoint = pin().center_point;
  const ball = state.ball || teePoint();
  const target = state.target;
  const targetDistanceText = target
    ? (mapViewMode() === "putting" ? `${Math.round(distance(ball, target) * 3)} ft` : `${Math.round(distance(ball, target))} yd`)
    : "";
  const shotLine = state.lastShotLine;
  const targetAngle = target ? Math.atan2(sy(target[1]) - sy(ball[1]), sx(target[0]) - sx(ball[0])) * 180 / Math.PI : 0;
  const uncertainty = 100 - currentClub().accuracy;
  const pixelsPerMeter = (Math.abs(sx(1) - sx(0)) + Math.abs(sy(1) - sy(0))) / 2;
  const outerLateral = Math.max(14, uncertainty * .27 * pixelsPerMeter);
  const outerLongitudinal = Math.max(20, outerLateral * 1.45);
  const likelyLateral = Math.max(8, outerLateral * .48);
  const likelyLongitudinal = Math.max(12, outerLongitudinal * .48);
  const elevationContours = hole().elevation_profile.points
    .filter((_, i) => i > 0 && i < hole().elevation_profile.points.length - 1)
    .map(p => `<line class="contour" x1="80" y1="${sy(p.y)}" x2="920" y2="${sy(p.y)}" />`).join("");

  const greenView = viewMode === "putting";
  const enlargedGreenView = state.greenEnlarged;
  const closeView = viewMode !== "full";
  const yardageMarkers = closeView ? [] : markerPointsFromPin([200, 150, 100]);
  $("#course-map").innerHTML = `
    <svg viewBox="0 0 1000 1000" role="img" aria-label="${enlargedGreenView ? "Enlarged green aiming view" : greenView ? "Close-up putting view" : "Top-down map"} of hole ${state.holeIndex + 1}">
      <defs>
        <filter id="soft-shadow"><feDropShadow dx="0" dy="5" stdDeviation="6" flood-opacity=".18"/></filter>
        <pattern id="rough-pattern" width="18" height="18" patternUnits="userSpaceOnUse">
          <path d="M2 15l4-5m5 6l3-7m1-5l2-3" stroke="rgba(255,255,255,.16)" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="1000" height="1000" fill="#355f3d"/>
      ${closeView ? "" : poly(g.out_of_bounds || [], "out-of-bounds")}
      ${greenView ? "" : poly(g.rough_zones || [], "rough-zone")}
      ${greenView ? "" : poly(g.fairway_segments, "fairway-segment")}
      ${closeView ? "" : poly(g.tee_boxes, "tee-box")}
      ${poly(g.hazards.filter(h => h.lie_catalog_id.includes("water")), "water-hazard")}
      <polygon class="green-complex" points="${pointsAttr(g.green_complex.polygon)}"/>
      ${poly(g.hazards.filter(h => !h.lie_catalog_id.includes("water")), "sand-hazard")}
      ${closeView ? "" : elevationContours}
      ${closeView ? "" : `<polyline class="centerline" points="${pointsAttr(hole().centerline_waypoints.map(w => w.point))}"/>`}
      ${yardageMarkers.map(marker => `
        <g class="yardage-marker ${marker.className}" transform="translate(${sx(marker.point[0])},${sy(marker.point[1])})">
          <circle r="13"/>
        </g>`).join("")}
      ${shotLine ? `<path class="played-shot" d="M ${sx(shotLine[0][0])} ${sy(shotLine[0][1])} Q ${(sx(shotLine[0][0]) + sx(shotLine[1][0])) / 2 + 35} ${(sy(shotLine[0][1]) + sy(shotLine[1][1])) / 2 - 55} ${sx(shotLine[1][0])} ${sy(shotLine[1][1])}"/>` : ""}
      ${target ? `<line class="aim-line" x1="${sx(ball[0])}" y1="${sy(ball[1])}" x2="${sx(target[0])}" y2="${sy(target[1])}"/>
        <g class="coverage-pattern" transform="translate(${sx(target[0])},${sy(target[1])}) rotate(${targetAngle})">
          <ellipse class="coverage-outer" rx="${outerLongitudinal}" ry="${outerLateral}"><title>Larger-miss coverage area</title></ellipse>
          <ellipse class="coverage-likely" rx="${likelyLongitudinal}" ry="${likelyLateral}"><title>Likely landing area</title></ellipse>
        </g>
        <g class="target-distance-label" transform="translate(${sx(target[0])},${sy(target[1]) - 34})">
          <rect x="-29" y="-11" width="58" height="22" rx="4"/><text text-anchor="middle" dominant-baseline="central">${targetDistanceText}</text>
        </g>
        <g class="target-mark ${targetDragging ? "dragging" : ""}" transform="translate(${sx(target[0])},${sy(target[1])})">
          <circle class="target-hit" r="30"/><circle class="target-core" r="12"/><path d="M-20 0h40M0-20v40"/>
        </g>` : ""}
      <g class="pin-mark" transform="translate(${sx(pinPoint[0])},${sy(pinPoint[1])})">
        <path d="M0 18V-26" /><path class="flag" d="M1-26l26 8-26 9z"/>
      </g>
      <g class="ball-mark" filter="url(#soft-shadow)" transform="translate(${sx(ball[0])},${sy(ball[1])})">
        <circle r="13"/><circle class="ball-core" r="6"/>
      </g>
    </svg>
    <style>
      .rough-zone{fill:#4f7a54;stroke:#315a3b;stroke-width:2}
      .fairway-segment{fill:#8ebd77;stroke:#a9cb8f;stroke-width:2}
      .tee-box{fill:#d4dea7;stroke:#f1eedf;stroke-width:2}
      .water-hazard{fill:#75aeb3;stroke:#b2d5d4;stroke-width:3}
      .sand-hazard{fill:#d8bd79;stroke:#efd89d;stroke-width:2}
      .green-complex{fill:#c3da83;stroke:#e0edac;stroke-width:3}
      .out-of-bounds{fill:#294a31;stroke:#f1eedf;stroke-width:2;stroke-dasharray:8 9;opacity:.82}
      .contour{stroke:rgba(241,238,223,.18);stroke-width:1;stroke-dasharray:4 12}
      .centerline{fill:none;stroke:rgba(241,238,223,.4);stroke-width:2;stroke-dasharray:5 10}
      .yardage-marker circle{stroke:#fffdf3;stroke-width:2.5;filter:url(#soft-shadow)}
      .yardage-marker.y200 circle{fill:#3f6685}
      .yardage-marker.y150 circle{fill:#f1eedf;stroke:#183126}
      .yardage-marker.y100 circle{fill:#b5523e}
      .aim-line{stroke:#f1eedf;stroke-width:2;stroke-dasharray:6 8}
      .coverage-outer{fill:rgba(241,238,223,.12);stroke:rgba(241,238,223,.72);stroke-width:2;stroke-dasharray:7 7}
      .coverage-likely{fill:rgba(241,238,223,.25);stroke:#f1eedf;stroke-width:2}
      .target-mark{cursor:grab;touch-action:none}.target-mark.dragging{cursor:grabbing}.target-mark .target-hit{fill:transparent;stroke:none;pointer-events:all}.target-mark .target-core{fill:#b5523e;stroke:#f1eedf;stroke-width:3}.target-mark path{stroke:#f1eedf;stroke-width:2;pointer-events:none}
      .target-distance-label rect{fill:#fffdf3;stroke:#183126;stroke-width:1.5}.target-distance-label text{fill:#183126;font:600 14px var(--font-system)}
      .pin-mark path{stroke:#183126;stroke-width:3}.pin-mark .flag{fill:#f1eedf;stroke:none}
      .ball-mark>circle{fill:#fffdf3;stroke:#183126;stroke-width:3}.ball-mark .ball-core{fill:#183126;stroke:none;opacity:.18}
      .played-shot{fill:none;stroke:#fff8d6;stroke-width:4;stroke-linecap:round;stroke-dasharray:12 7}
    </style>`;

  $("#course-map svg").addEventListener("click", onMapClick);
  $("#course-map svg").addEventListener("pointerup", onMapPointerUp);
  $("#course-map svg").addEventListener("pointerdown", onTargetPointerDown);
}

function currentClub() { return state.profile.clubs[state.selectedClub] || state.profile.clubs[0]; }
function rawYards(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]) * METERS_TO_YARDS; }
function gameplayScale() {
  const drawnTeeToPin = rawYards(teePoint(), pin().center_point);
  return teeYards() / Math.max(drawnTeeToPin, 1);
}
function distance(a, b) { return rawYards(a, b) * gameplayScale(); }
function liePenalty() {
  const lie = currentLieType();
  return { "Fairway": 1, "Tee": 1, "Rough": .9, "Heavy rough": .8, "Bunker": .72, "Green": 1 }[lie] || .9;
}

function resolveIntentTarget(start, linePoint, club = currentClub(), power = state.swingPower) {
  if (!linePoint) return null;
  const dx = linePoint[0] - start[0];
  const dy = linePoint[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) return [...linePoint];
  const isPutt = club.name === "Putter" && lieTypeForPoint(start) === "Green";
  const intentDistance = isPutt
    ? distance(start, pin().center_point)
    : Math.max(1, club.carry * liePenalty() * power);
  return [
    start[0] + dx / length * intentDistance / (METERS_TO_YARDS * gameplayScale()),
    start[1] + dy / length * intentDistance / (METERS_TO_YARDS * gameplayScale())
  ];
}

const SURFACE_PRIORITIES = { out_of_bounds: 100, water: 90, bunker: 80, green: 70, tee: 60, native: 50, fairway: 40, rough: 20 };

function canonicalPoint(point) {
  const scale = finiteScale();
  return { x: point[0] * scale, y: point[1] * scale };
}

function coursePointFromCanonical(point) {
  const scale = finiteScale();
  return [point.x / scale, point.y / scale];
}

function pointArray(point) {
  if (Array.isArray(point) && point.length === 2 && point.every(value => Number.isFinite(value))) {
    return [point[0], point[1]];
  }
  if (point && typeof point === "object" && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    return [point.x, point.y];
  }
  throw new Error(`point must be finite [x, y] or {x, y}; received ${JSON.stringify(point)}`);
}

function courseUnitsPerYard() {
  return 1 / (METERS_TO_YARDS * gameplayScale());
}

function yardsToCourseUnits(yards) {
  return yards * courseUnitsPerYard();
}

function pointAlongPolylineFromEnd(points, distanceYards) {
  if (!points.length) return null;
  let remaining = distanceYards;
  for (let index = points.length - 1; index > 0; index--) {
    const end = points[index];
    const start = points[index - 1];
    const segmentYards = distance(start, end);
    if (segmentYards <= 0) continue;
    if (remaining <= segmentYards) {
      const ratio = remaining / segmentYards;
      return [
        end[0] + (start[0] - end[0]) * ratio,
        end[1] + (start[1] - end[1]) * ratio
      ];
    }
    remaining -= segmentYards;
  }
  return points[0];
}

function markerPointsFromPin(markerYards) {
  const waypoints = hole().centerline_waypoints.map(waypoint => waypoint.point);
  return markerYards.map(yards => {
    const point = pointAlongPolylineFromEnd(waypoints, yards);
    if (!point) return null;
    return { point, className: `y${yards}` };
  }).filter(Boolean);
}

function projectPointToward(start, target, distanceYards) {
  const dx = target[0] - start[0];
  const dy = target[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) return [...start];
  const scale = yardsToCourseUnits(distanceYards) / length;
  return [start[0] + dx * scale, start[1] + dy * scale];
}

function offsetPointPerpendicular(start, target, point, lateralYards) {
  const dx = target[0] - start[0];
  const dy = target[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) return [...point];
  const rightX = dy / length;
  const rightY = -dx / length;
  const offset = yardsToCourseUnits(lateralYards);
  return [point[0] + rightX * offset, point[1] + rightY * offset];
}

function finitePointOrNull(point) {
  try {
    return pointArray(point);
  } catch {
    return null;
  }
}

function puttTargetFromCup(offsetInches = 0) {
  const cup = finitePointOrNull(pin().center_point);
  const offset = Number(offsetInches);
  if (!cup || !Number.isFinite(offset)) return null;
  return [cup[0] + offset * .0254, cup[1]];
}

function finiteScale() {
  const scale = METERS_TO_YARDS * gameplayScale();
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("course scale is invalid for the current hole state");
  }
  return scale;
}

function canonicalSurfaces() {
  const g = hole().geometries;
  const region = (surface, polygon, regionId) => ({
    surface,
    polygon: polygon.map(canonicalPoint),
    priority: SURFACE_PRIORITIES[surface],
    region_id: regionId
  });
  return [
    ...(g.out_of_bounds || []).map((item, index) => region("out_of_bounds", item.polygon, item.id || `out_of_bounds_${index}`)),
    ...g.hazards.map((item, index) => region(item.lie_catalog_id.includes("water") ? "water" : "bunker", item.polygon, item.id || `hazard_${index}`)),
    region("green", g.green_complex.polygon, g.green_complex.id || "green_primary"),
    ...g.tee_boxes.map((item, index) => region("tee", item.polygon, item.id || `tee_${index}`)),
    ...g.fairway_segments.map((item, index) => region("fairway", item.polygon, item.segment_id || item.id || `fairway_${index}`)),
    ...(g.rough_zones || []).map((item, index) => region("rough", item.polygon, item.id || item.zone_id || `rough_${index}`))
  ];
}

function authoritativeClub(club) {
  const uncertainty = bounded((100 - club.accuracy) / 100, 0, 1);
  const name = club.name.toLowerCase();
  const roll = name.includes("driver") ? 18 : name.includes("wood") ? 12 : name.includes("hybrid") ? 9 : name.includes("wedge") ? 3 : 5;
  return {
    club_id: name.replaceAll(" ", "_"),
    carry_mean: club.carry,
    carry_sd: Math.max(1.5, club.carry * (.025 + uncertainty * .12)),
    roll_mean: roll,
    lateral_sd: Math.max(1, club.carry * (.015 + uncertainty * .2)),
    directional_bias: (100 - club.accuracy) * .08,
    mishit_probability: bounded((100 - club.accuracy) / 220, .03, .45)
  };
}

function authoritativeLie(type, lateralBiasYards = 0) {
  const modifiers = {
    Tee: [1, 1, .85, "tee_standard"], Fairway: [1, 1, 1, "fairway_clean"],
    Rough: [.9, .9, 1.1, "rough_light"], "Heavy rough": [.7, .65, 2.5, "rough_deep"],
    Bunker: [.8, .5, 2, "bunker_fairway"]
  }[type] || [.85, .8, 1.5, "rough_medium"];
  return {
    lie_type: modifiers[3], carry_multiplier: modifiers[0], roll_multiplier: modifiers[1],
    mishit_multiplier: modifiers[2], lateral_bias_yards: lateralBiasYards, version: "2026.07.2"
  };
}

function resultLieFromSurface(surface) {
  return {
    out_of_bounds: { type: "Out of bounds", penalty: true, color: "#b5523e" },
    water: { type: "Water", penalty: true, color: "#75aeb3" },
    bunker: { type: "Bunker", color: "#d8bd79" }, green: { type: "Green", color: "#c3da83" },
    fairway: { type: "Fairway", color: "#8ebd77" }, tee: { type: "Tee", color: "#f1eedf" },
    rough: { type: "Rough", color: "#4f7a54" }, native: { type: "Heavy rough", color: "#315a3b" }
  }[surface] || { type: "Rough", color: "#4f7a54" };
}

function authoritativeFullShot(start, target, club, power, sidehill) {
  const conditions = shotConditions(start);
  const elevationMultiplier = bounded(1 - conditions.elevationFeet / Math.max(club.carry * 3, 1), .8, 1.2);
  const context = {
    start: canonicalPoint(start), target: canonicalPoint(target), pin: canonicalPoint(pin().center_point),
    club: authoritativeClub(club), lie: authoritativeLie(lieTypeForPoint(start), sidehill.expected_curve_yards),
    environment: {
      wind_forward_yards: 0, wind_lateral_yards: 0, wind_roll_multiplier: 1,
      elevation_carry_multiplier: elevationMultiplier,
      slope_mishit_multiplier: conditions.stance === "a fairly level stance" ? 1 : 1.1,
      surface_roll_multiplier: 1
    },
    intent: { distance_multiplier: power, complexity_multiplier: 1, label: power === 1 ? "stock" : "partial" },
    surfaces: canonicalSurfaces(), default_surface: "rough", profile_version: `browser-profile-${state.profile.id}`
  };
  const identity = {
    roundSeed: state.roundSeed, holeNumber: state.holeIndex + 1, strokeIndex: state.shots.length + 1
  };
  return { packet: simulateFullShot(context, identity), request: { context, identity } };
}

function authoritativeGreensideShot(start, target, club, power, strokeIndex) {
  const conditions = shotConditions();
  const contourSeed = (state.holeIndex + 1) * 17 + state.pinIndex * 11;
  const lie = authoritativeLie(lieTypeForPoint(start));
  const context = {
    start: canonicalPoint(start),
    target: canonicalPoint(target),
    pin: canonicalPoint(pin().center_point),
    club_id: authoritativeClub(club).club_id,
    accuracy: bounded(club.accuracy / 100, 0, 1),
    lie_type: lie.lie_type,
    power,
    roll_slope_factor: conditions.slope === "uphill" ? 0.78 : conditions.slope === "downhill" ? 1.18 : 1,
    break_direction: contourSeed % 2 === 0 ? "right" : "left",
    contour_modifier: (contourSeed % 5) - 2,
    surfaces: canonicalSurfaces(),
    default_surface: "rough",
    profile_version: `browser-profile-${state.profile.id}`,
    lie_version: lie.version
  };
  const identity = {
    roundSeed: state.roundSeed,
    holeNumber: state.holeIndex + 1,
    strokeIndex
  };
  return {
    packet: simulateGreensideShot(context, identity),
    request: { engine: "greenside", context, identity }
  };
}

function lineSamplePoints(start, target, count = 48) {
  return Array.from({ length: count }, (_, index) => {
    const progress = index / Math.max(count - 1, 1);
    return [
      start[0] + (target[0] - start[0]) * progress,
      start[1] + (target[1] - start[1]) * progress
    ];
  });
}

function lineHazardSummary(start, target) {
  const g = hole().geometries;
  const samples = lineSamplePoints(start, target);
  const waterSamples = samples.filter(point => g.hazards.some(item => item.lie_catalog_id.includes("water") && pointInPolygon(point, item.polygon)));
  const bunkerHits = new Set(
    g.hazards
      .filter(item => !item.lie_catalog_id.includes("water") && samples.some(point => pointInPolygon(point, item.polygon)))
      .map(item => item.id || item.description || JSON.stringify(item.polygon[0]))
  );
  const outOfBoundsInPlay = samples.some(point => (g.out_of_bounds || []).some(item => pointInPolygon(point, item.polygon)));
  const waterInPlay = waterSamples.length > 0;
  const forcedCarryYards = waterInPlay
    ? Math.round(distance(start, waterSamples.at(-1)))
    : 0;
  return {
    waterInPlay,
    outOfBoundsInPlay,
    hazardCount: bunkerHits.size + (waterInPlay ? 1 : 0) + (outOfBoundsInPlay ? 1 : 0),
    forcedCarryYards
  };
}

function pinRiskLevel(intendedTarget) {
  if (lieAt(intendedTarget).type !== "Green") return 0;
  const yardsFromPin = distance(intendedTarget, pin().center_point);
  if (yardsFromPin <= 4) return 2;
  if (yardsFromPin <= 10) return 1;
  return 0;
}

function inferStrategicShotType({ strokeIndex, startLieType, targetAggression, forcedCarryYards, recoveryRequired, targetDistanceYards, distanceToPinYards }) {
  if (strokeIndex === 1) return targetAggression >= 0.55 ? "tee_attack" : "tee_positioning";
  if (startLieType === "Bunker") return "bunker_escape";
  if (recoveryRequired) return targetAggression <= 0.35 ? "recovery_escape" : "recovery_advancing";
  if (forcedCarryYards > 0) return "approach_forced_carry";
  if (distanceToPinYards - targetDistanceYards > 35 && targetAggression <= 0.35) return "layup_positioning";
  if (targetDistanceYards <= 40) return "chip_pitch_standard";
  return "approach_standard";
}

function buildStrategyContext(start, intendedTarget, club, plannedRisk, strokeIndex, sidehill = null) {
  const startLie = lieAt(start);
  const targetDistanceYards = distance(start, intendedTarget);
  const distanceToPinYards = distance(start, pin().center_point);
  const hazards = lineHazardSummary(start, intendedTarget);
  const recoveryRequired = strokeIndex > 1 && (
    startLie.type === "Heavy rough" ||
    startLie.type === "Bunker" ||
    state.shots.at(-1)?.penalty > 0
  );
  return {
    hole_number: state.holeIndex + 1,
    stroke_number: strokeIndex,
    distance_to_target_yards: targetDistanceYards,
    lie_type: authoritativeLie(startLie.type).lie_type,
    shot_type: inferStrategicShotType({
      strokeIndex,
      startLieType: startLie.type,
      targetAggression: bounded(plannedRisk / 100, 0, 1),
      forcedCarryYards: hazards.forcedCarryYards,
      recoveryRequired,
      targetDistanceYards,
      distanceToPinYards
    }),
    selected_club: authoritativeClub(club),
    target_aggression: bounded(plannedRisk / 100, 0, 1),
    hazard_count: hazards.hazardCount,
    water_in_play: hazards.waterInPlay,
    out_of_bounds_in_play: hazards.outOfBoundsInPlay,
    forced_carry_yards: hazards.forcedCarryYards,
    pin_risk_level: pinRiskLevel(intendedTarget),
    recovery_required: recoveryRequired,
    preferred_miss: "none_declared",
    strategy_notes: state.shots.at(-1)?.penalty > 0 ? ["penalty"] : [],
    stance_type: sidehill?.stance || "level",
    sidehill_bias_yards: sidehill?.expected_curve_yards || 0,
    aim_compensation_yards: sidehill?.player_aim_yards || 0,
    sidehill_compensation: sidehill?.compensation || "not_required"
  };
}

function authoritativePutt(start, target, paceScale) {
  const safeStart = pointArray(start);
  const safeTarget = pointArray(target);
  const safePin = pinPoint();
  if (!Number.isFinite(paceScale)) throw new Error("putt pace must be finite");
  const read = puttingRead(start);
  const context = {
    start: canonicalPoint(safeStart),
    target: canonicalPoint(safeTarget),
    pin: canonicalPoint(safePin),
    profile: {
      make_rate_3ft: puttingMakeProbability(3),
      make_rate_6ft: puttingMakeProbability(6),
      make_rate_10ft: puttingMakeProbability(10),
      putter_range_feet: PUTTER_RANGE_FEET
    },
    read: {
      feet: read.feet,
      direction: read.direction,
      start_direction: read.startDirection,
      break_inches: read.breakInches
    },
    pace_scale: paceScale,
    profile_version: `browser-profile-${state.profile.id}`
  };
  const identity = {
    roundSeed: state.roundSeed, holeNumber: state.holeIndex + 1, strokeIndex: state.shots.length + 1
  };
  const packet = simulatePutt(context, identity);
  if (!Number.isFinite(packet?.landing?.x) || !Number.isFinite(packet?.landing?.y)) {
    throw new Error("putting simulation returned a non-finite landing point");
  }
  return { packet, request: { context, identity } };
}

function elevationAt(point) {
  const points = hole().elevation_profile.points;
  if (point[1] <= points[0].y) return points[0].elevation_m;
  for (let i = 1; i < points.length; i++) {
    if (point[1] <= points[i].y) {
      const a = points[i - 1], b = points[i];
      const ratio = (point[1] - a.y) / Math.max(b.y - a.y, .001);
      return a.elevation_m + (b.elevation_m - a.elevation_m) * ratio;
    }
  }
  return points.at(-1).elevation_m;
}

function centerlineRelation(point) {
  const points = hole().centerline_waypoints.map(waypoint => waypoint.point);
  let best = null;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 1e-9) continue;
    const progress = bounded(
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
      0,
      1
    );
    const projection = [start[0] + dx * progress, start[1] + dy * progress];
    const separation = Math.hypot(point[0] - projection[0], point[1] - projection[1]);
    if (best && separation >= best.separation) continue;
    const length = Math.sqrt(lengthSquared);
    const rightX = dy / length;
    const rightY = -dx / length;
    const signedCourseUnits = (point[0] - projection[0]) * rightX + (point[1] - projection[1]) * rightY;
    best = { separation, signedLateralYards: signedCourseUnits * finiteScale() };
  }
  return best || { separation: 0, signedLateralYards: 0 };
}

function shotConditions(from = state.ball) {
  const remaining = distance(from, pin().center_point);
  const elevationFeet = (elevationAt(pin().center_point) - elevationAt(from)) * 3.28084;
  const relation = centerlineRelation(from);
  const stanceType = Math.abs(relation.signedLateralYards) < 5
    ? "level"
    : relation.signedLateralYards > 0 ? "ball_above_feet" : "ball_below_feet";
  const stance = stanceType === "level"
    ? "a fairly level stance"
    : stanceType === "ball_above_feet" ? "the ball above your feet" : "the ball below your feet";
  const slope = elevationFeet > 4 ? "uphill" : elevationFeet < -4 ? "downhill" : "playing nearly level";
  return {
    remaining,
    elevationFeet,
    stance,
    stanceType,
    lateralDistanceYards: Math.abs(relation.signedLateralYards),
    slope,
    lie: lieTypeForPoint(from)
  };
}

function signedAimOffsetYards(start, reference, target) {
  const dx = reference[0] - start[0];
  const dy = reference[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) return 0;
  const rightX = dy / length;
  const rightY = -dx / length;
  return ((target[0] - reference[0]) * rightX + (target[1] - reference[1]) * rightY) * finiteScale();
}

function normalShotTarget(start) {
  return distance(start, pin().center_point) <= 210
    ? pinPoint()
    : (fairwayCenterTarget() || pinPoint());
}

function sidehillShotPlan(start, intendedTarget) {
  const conditions = shotConditions(start);
  const referenceTarget = normalShotTarget(start);
  return analyzeSidehillShot({
    stance: conditions.stanceType,
    lateralDistanceYards: conditions.lateralDistanceYards,
    shotDistanceYards: distance(start, intendedTarget),
    playerAimYards: signedAimOffsetYards(start, referenceTarget, intendedTarget)
  });
}

function puttingRead(from = state.ball) {
  const feet = distance(from, pin().center_point) * 3;
  // Deterministic synthetic contour: distance sets the base read first.
  // Hole/pin seed only nudges the amount inside a narrow band so the read
  // still feels distance-driven instead of arbitrary.
  const seed = (state.holeIndex + 1) * 17 + state.pinIndex * 11;
  const direction = seed % 2 === 0 ? "right" : "left";
  const contourModifier = (seed % 5) - 2;
  let baseBreakInches;
  if (feet <= 3) {
    baseBreakInches = feet * 0.15;
  } else if (feet <= 8) {
    baseBreakInches = 0.75 + (feet - 3) * 0.35;
  } else if (feet <= 15) {
    baseBreakInches = 2.5 + (feet - 8) * 0.55;
  } else {
    baseBreakInches = 6.5 + (feet - 15) * 0.5;
  }
  const contourAdjustment = feet <= 8
    ? contourModifier * 0.25
    : feet <= 15
      ? contourModifier * 0.6
      : contourModifier * 1.0;
  let breakInches = Math.round(baseBreakInches + contourAdjustment);
  if (feet <= 3) breakInches = Math.min(2, Math.max(0, breakInches));
  else if (feet <= 8) breakInches = Math.min(4, Math.max(1, breakInches));
  else if (feet <= 15) breakInches = Math.min(8, Math.max(3, breakInches));
  else breakInches = Math.min(16, Math.max(8, breakInches));
  const startDirection = direction === "right" ? "left" : "right";
  return { feet, direction, startDirection, breakInches };
}

function isGreensideChip(start = state.ball, club = currentClub()) {
  const lie = lieTypeForPoint(start);
  const distanceToCup = distance(start, pin().center_point);
  return club.name !== "Putter" &&
    ["Rough", "Heavy rough", "Fairway"].includes(lie) &&
    distanceToCup <= 30;
}

function chipRollRatio(clubName) {
  const name = clubName.toLowerCase();
  if (name.includes("lob wedge")) return 0.8;
  if (name.includes("sand wedge")) return 1.0;
  if (name.includes("gap wedge")) return 1.5;
  if (name.includes("pitching wedge")) return 2.0;
  if (name.includes("9 iron")) return 3.0;
  if (name.includes("8 iron")) return 4.0;
  if (name.includes("7 iron")) return 5.0;
  if (name.includes("6 iron")) return 6.0;
  return 2.5;
}

function recommendedChipPlan(start = state.ball) {
  const lie = currentLieType();
  const totalYards = distance(start, pin().center_point);
  if (!["Rough", "Heavy rough", "Fairway"].includes(lie) || totalYards > 30) return null;
  const desiredCarryFraction = lie === "Heavy rough" ? 0.58 : lie === "Rough" ? 0.48 : 0.38;
  const eligible = state.profile.clubs.filter(club => club.name !== "Driver" && club.name !== "3 Wood" && club.name !== "5 Wood" && club.name !== "4 Iron" && club.name !== "5 Iron" && club.name !== "Putter");
  const club = eligible
    .map(candidate => {
      const ratio = chipRollRatio(candidate.name);
      const carryFraction = 1 / (1 + ratio);
      return { candidate, difference: Math.abs(carryFraction - desiredCarryFraction), ratio };
    })
    .sort((a, b) => a.difference - b.difference)[0];
  if (!club) return null;
  const carryYards = totalYards / (1 + club.ratio);
  const read = puttingRead(projectPointToward(start, pin().center_point, carryYards));
  const lateralOffsetYards = (read.breakInches / 36) * 0.8 * (read.startDirection === "right" ? 1 : -1);
  const centerLanding = projectPointToward(start, pin().center_point, carryYards);
  const landingPoint = offsetPointPerpendicular(start, pin().center_point, centerLanding, lateralOffsetYards);
  return {
    clubIndex: state.profile.clubs.findIndex(item => item.name === club.candidate.name),
    clubName: club.candidate.name,
    carryYards,
    rollYards: Math.max(0, totalYards - carryYards),
    landingPoint,
    breakInches: read.breakInches,
    startDirection: read.startDirection,
    recommendedPower: 90
  };
}

function gameMasterBriefing() {
  const c = shotConditions();
  if (c.lie === "Green") {
    const read = puttingRead();
    const profileChance = Math.round(puttingMakeProbability(read.feet) * 100);
    const rangeWarning = read.feet > PUTTER_RANGE_FEET
      ? ` This is beyond the ${PUTTER_RANGE_FEET}-foot modeled putter range; treat it as a lag putt and expect another putt.`
      : "";
    return `You have ${formatPuttDistance(read.feet)} to the cup with about a ${profileChance}% profile make rate. This simulated putt breaks about ${formatInches(read.breakInches)} to the ${read.direction}; a neutral read starts roughly ${formatInches(read.breakInches)} ${read.startDirection} of the cup. The putt is ${c.slope}.${rangeWarning}`;
  }
  const chipPlan = isGreensideChip() ? recommendedChipPlan() : null;
  if (chipPlan) {
    return `You have ${Math.round(c.remaining)} yards from ${c.lie.toLowerCase()} just off the green. Treat the target as a landing spot, not the cup. A ${chipPlan.clubName} should land about ${Math.round(chipPlan.carryYards)} yards on, then release the rest. Favor the ${chipPlan.startDirection} side by about ${formatInches(chipPlan.breakInches)}.`;
  }
  const unit = `${Math.round(c.remaining)} yards`;
  const sidehill = sidehillShotPlan(state.ball, normalShotTarget(state.ball));
  const sidehillAdvice = sidehill.stance === "level"
    ? ""
    : sidehill.stance === "ball_below_feet"
      ? ` Expect about ${Math.round(Math.abs(sidehill.expected_curve_yards) * 10) / 10} yards of movement right; aim roughly ${Math.round(Math.abs(sidehill.recommended_aim_yards) * 10) / 10} yards left.`
      : ` Expect about ${Math.round(Math.abs(sidehill.expected_curve_yards) * 10) / 10} yards of movement left; aim roughly ${Math.round(Math.abs(sidehill.recommended_aim_yards) * 10) / 10} yards right.`;
  return `You have ${unit} to the pin from ${c.lie.toLowerCase()}. The stance has ${c.stance}, and the shot is ${c.slope}${Math.abs(c.elevationFeet) >= 4 ? ` by about ${Math.abs(Math.round(c.elevationFeet))} feet` : ""}.${sidehillAdvice}`;
}

function addGmMessage(text, role = "gm") {
  state.gmMessages.push({ text, role });
  renderGmConversation();
}

function clearPendingAutoPlay() {
  if (pendingAutoPlayHandle !== null) {
    window.clearTimeout(pendingAutoPlayHandle);
    pendingAutoPlayHandle = null;
  }
}

function showMobileShotToast(title, copy) {
  const toast = $("#mobile-shot-toast");
  if (!toast) return;
  $("#mobile-shot-toast-title").textContent = title;
  $("#mobile-shot-toast-copy").textContent = copy;
  toast.hidden = false;
  if (mobileShotToastHandle !== null) window.clearTimeout(mobileShotToastHandle);
  mobileShotToastHandle = window.setTimeout(() => {
    toast.hidden = true;
    mobileShotToastHandle = null;
  }, 3200);
}

function queueAutoPlay() {
  clearPendingAutoPlay();
  const queued = {
    holeIndex: state.holeIndex,
    shotCount: state.shots.length,
    target: state.target ? [...state.target] : null,
    selectedClub: state.selectedClub,
    swingPower: state.swingPower
  };
  pendingAutoPlayHandle = window.setTimeout(() => {
    pendingAutoPlayHandle = null;
    try {
      const sameHole = state.holeIndex === queued.holeIndex;
      const sameShotCount = state.shots.length === queued.shotCount;
      const sameClub = state.selectedClub === queued.selectedClub;
      const samePower = Math.abs(state.swingPower - queued.swingPower) <= 1e-9;
      const sameTarget = Boolean(state.target && queued.target) &&
        Math.hypot(state.target[0] - queued.target[0], state.target[1] - queued.target[1]) <= 1e-9;
      if (!sameHole || !sameShotCount || state.holeFinished || !sameClub || !samePower || !sameTarget) {
        addGmMessage("The queued shot was not played because the shot setup changed before execution. Try the command again or press Play shot.");
        return;
      }
      playShot();
    } catch (error) {
      console.error(error);
      addGmMessage(`The shot could not be played because of an internal error: ${error?.message || error}.`);
    }
  }, 180);
}

async function postAiJson(path, payload) {
  if (state.aiAvailable === false) return null;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      state.aiAvailable = false;
      return null;
    }
    state.aiAvailable = true;
    return await response.json();
  } catch {
    state.aiAvailable = false;
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function packetAssessment(shot) {
  if (shot?.strategyPacket) {
    const decisionAssessment = ["excellent", "sound", "acceptable"].includes(shot.strategyPacket.decision.label) ? "sound" : "review";
    const executionAssessment = shot.strategyPacket.execution?.score >= 70 ? "on_plan" : "missed";
    const overallAssessment = decisionAssessment === "sound" && executionAssessment === "on_plan" ? "good" : "bad";
    return {
      decision_assessment: decisionAssessment,
      execution_assessment: executionAssessment,
      overall_assessment: overallAssessment,
      decision_risk: null,
      risk_label: null
    };
  }
  return shot?.resultPacket?.assessment || shot?.puttPacket?.assessment || null;
}

function strategyPacketForShot(shot) {
  return shot?.strategyPacket || null;
}

function formatPreferredMiss(preferredMiss) {
  return (preferredMiss || "none_declared")
    .replaceAll("_", " ")
    .replace(/\bob\b/g, "OB")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function formatStrategyReason(reason) {
  return reason
    .replaceAll("_", " ")
    .replace(/\bob\b/g, "OB")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function formatStrategyCategory(category) {
  return formatStrategyReason(category || "no pattern yet");
}

function strategySummary(shot) {
  const packet = strategyPacketForShot(shot);
  if (!packet) return null;
  return {
    score: packet.decision.score,
    label: packet.decision.label,
    shotType: packet.shot_type,
    isPutt: packet.shot_type === "putt_lag" || packet.shot_type === "putt_make_attempt",
    preferredMiss: formatPreferredMiss(packet.preferred_miss),
    preferredMissInferred: packet.preferred_miss_inferred,
    reasons: packet.decision.reasons.slice(0, 3).map(formatStrategyReason)
  };
}

function decisionQualityFromAssessment(assessment, fallbackQuality = null) {
  if (assessment?.decision_assessment === "sound") return "good";
  if (assessment?.decision_assessment === "review") return "review";
  return fallbackQuality === "good" ? "good" : "review";
}

function executionQualityFromAssessment(assessment, fallbackQuality = null) {
  if (assessment?.execution_assessment === "on_plan") return "good";
  if (assessment?.execution_assessment === "missed") return "review";
  return fallbackQuality === "good" ? "good" : "review";
}

function overallQualityFromAssessment(assessment, fallbackQuality = null) {
  if (assessment?.overall_assessment === "good") return "good";
  if (assessment?.overall_assessment === "bad") return "bad";
  return fallbackQuality === "good" ? "good" : "bad";
}

function aiShotPayload({ shotRecord, puttingEvaluation, plannedRisk, remaining, completionType, resultLie, intendedTarget }) {
  const assessment = packetAssessment(shotRecord);
  return {
    course: { id: state.courseId, name: state.course.name },
    hole: { number: state.holeIndex + 1, par: card().Par, handicap: card().Handicap, layout_type: hole().hole_metadata.layout_type },
    player: { profile_id: state.profile.id, profile_name: state.profile.name },
    stroke: {
      index: state.shots.length + 1,
      club: shotRecord.club,
      power_percent: shotRecord.power,
      start: shotRecord.start,
      intended_target: intendedTarget,
      intended_lie: shotRecord.intendedLie,
      landing: shotRecord.landing,
      resolved_ball: shotRecord.resolvedBall,
      landing_lie: shotRecord.landingLie,
      resolved_lie: resultLie.type,
      remaining_yards: Math.round(remaining * 100) / 100,
      penalty_strokes: shotRecord.penalty,
      relief: shotRecord.relief,
      completion_type: completionType,
      decision_assessment: assessment?.decision_assessment ?? null,
      execution_assessment: assessment?.execution_assessment ?? null,
      overall_assessment: assessment?.overall_assessment ?? null,
      decision_risk: assessment?.decision_risk ?? plannedRisk,
      risk_label: assessment?.risk_label ?? null,
      result_packet: shotRecord.resultPacket,
      strategy_packet: shotRecord.strategyPacket,
      putt_packet: shotRecord.puttPacket,
      putt_analysis: puttingEvaluation ? {
        distance_feet: Math.round(puttingEvaluation.read.feet * 100) / 100,
        make_probability: puttingEvaluation.makeProbability,
        aim_error_inches: puttingEvaluation.aimErrorInches,
        power_error_points: puttingEvaluation.powerErrorPoints,
        aim_correct: puttingEvaluation.aimCorrect,
        pace_correct: puttingEvaluation.paceCorrect,
        correct_decision: puttingEvaluation.correctDecision,
      } : null
    },
    hole_score_after_stroke: completionType ? state.scores[state.holeIndex] : null,
    round_score_to_par: state.scores.reduce((sum, score, index) => score == null ? sum : sum + score - state.scorecard[index].Par, 0)
  };
}

async function requestAiShotNarration(payload) {
  const response = await postAiJson("/api/ai/shot", payload);
  if (!response?.summary) return;
  addGmMessage(response.summary);
  if (response.next_play) addGmMessage(response.next_play);
}

function aiRoundPayload() {
  const strategyAnalysis = analyzeRoundStrategy(state.roundHistory);
  return {
    course: { id: state.courseId, name: state.course.name },
    player: { profile_id: state.profile.id, profile_name: state.profile.name },
    round: {
      score_to_par: state.scores.reduce((sum, score, index) => score == null ? sum : sum + score - state.scorecard[index].Par, 0),
      completed_holes: state.scores.filter(score => score != null).length,
      scores: state.scores
    },
    strategy_analysis: strategyAnalysis,
    holes: state.roundHistory.map((holeShots, index) => ({
      hole_number: index + 1,
      par: state.scorecard[index].Par,
      score: state.scores[index],
      review_shots: holeShots.filter(shot => {
        const assessment = packetAssessment(shot);
        return overallQualityFromAssessment(assessment, shot.quality) === "bad" ||
          decisionQualityFromAssessment(assessment, shot.quality) === "review" ||
          executionQualityFromAssessment(assessment, shot.quality) === "review";
      }).length,
      shots: holeShots.map(shot => ({
        assessment: packetAssessment(shot),
        club: shot.club,
        power: shot.power,
        lie: shot.lie,
        intended_lie: shot.intendedLie,
        quality: overallQualityFromAssessment(packetAssessment(shot), shot.quality),
        decision_quality: decisionQualityFromAssessment(packetAssessment(shot), shot.quality),
        execution_quality: executionQualityFromAssessment(packetAssessment(shot), shot.quality),
        penalty: shot.penalty,
        remaining: shot.remaining,
        strategy_packet: shot.strategyPacket || null
      }))
    }))
  };
}

async function requestAiRoundReview() {
  const response = await postAiJson("/api/ai/review", aiRoundPayload());
  if (!response?.verdict) return;
  const verdict = $("#round-review-summary .review-verdict p");
  if (verdict) verdict.textContent = response.verdict;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function renderGmConversation() {
  if (!state.gmMessages.length) state.gmMessages.push({ text: gameMasterBriefing(), role: "gm" });
  $("#gm-conversation").innerHTML = state.gmMessages
    .map(message => `<p class="gm-message ${message.role === "player" ? "player" : ""}">${escapeHtml(message.text)}</p>`)
    .join("");
  $("#gm-conversation").scrollTop = $("#gm-conversation").scrollHeight;
  renderMobileGmHistory();
}

function recommendedAdjustment() {
  const c = shotConditions();
  return c.elevationFeet > 4 ? 1 : c.elevationFeet < -4 ? -1 : 0;
}

function includesPhrase(text, phrase) {
  return new RegExp(`(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$|[,.;])`, "i").test(text);
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

function hasApproxWord(text, expected, tolerance = 1) {
  const words = text.match(/[a-z]+/g) || [];
  return words.some(word => word === expected || (word.length >= 3 && editDistance(word, expected) <= tolerance));
}

const golfSpellingCorrections = {
  ping: "pin", pinn: "pin", cupm: "cup", cupp: "cup",
  fareway: "fairway", fairwey: "fairway", fariway: "fairway",
  centre: "center", ceter: "center", cneter: "center",
  put: "putt", puting: "putting", puter: "putter",
  drver: "driver", dirver: "driver", irion: "iron",
  swng: "swing", percet: "percent", precent: "percent"
};

function spellingSuggestion(value) {
  let changed = false;
  let corrected = value.replace(/[a-z]+/gi, word => {
    const replacement = golfSpellingCorrections[word.toLowerCase()];
    if (!replacement) return word;
    changed = true;
    return /^[A-Z]/.test(word) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
  });
  corrected = corrected.replace(/\bi(?=\s*(?:inch|inches|in)\b)/gi, () => {
    changed = true;
    return "1";
  });
  return changed ? corrected : "";
}

function updateSpellingHint() {
  const input = $("#gm-input");
  const hint = $("#gm-spell-hint");
  const suggestion = spellingSuggestion(input.value);
  hint.hidden = !suggestion;
  hint.dataset.suggestion = suggestion;
  hint.textContent = suggestion ? `Check spelling: Did you mean “${suggestion}”?` : "";
}

function fairwayCenterTarget() {
  const fairways = hole().geometries.fairway_segments;
  const reachable = currentClub().carry * liePenalty();
  const currentPinDistance = distance(state.ball, pin().center_point);
  const toPin = [pin().center_point[0] - state.ball[0], pin().center_point[1] - state.ball[1]];
  const polygonCenters = fairways.map(segment => {
    const center = segment.polygon.reduce(
      (sum, point) => [sum[0] + point[0] / segment.polygon.length, sum[1] + point[1] / segment.polygon.length],
      [0, 0]
    );
    return center;
  });
  const waypoints = hole().centerline_waypoints.map(waypoint => waypoint.point);
  const centerlineSamples = [];
  for (let i = 1; i < waypoints.length; i++) {
    const start = waypoints[i - 1], end = waypoints[i];
    for (let step = 0; step <= 24; step++) {
      const ratio = step / 24;
      const point = [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
      if (lieAt(point).type === "Fairway") centerlineSamples.push(point);
    }
  }
  const candidates = [...polygonCenters, ...centerlineSamples].map(center => {
    const fromBall = [center[0] - state.ball[0], center[1] - state.ball[1]];
    const forwardDot = fromBall[0] * toPin[0] + fromBall[1] * toPin[1];
    const pinDistance = distance(center, pin().center_point);
    return {
      center,
      pinDistance,
      forward: forwardDot > 0 && pinDistance < currentPinDistance - 5,
      difference: Math.abs(distance(state.ball, center) - reachable)
    };
  }).filter(candidate => candidate.forward);
  return candidates.sort((a, b) => a.difference - b.difference)[0]?.center || null;
}

function interpretGmInstruction(text) {
  addGmMessage(text, "player");
  const normalized = text.toLowerCase().replaceAll("-", " ").replace(/\bi(?=\s*(?:inch|inches|in)\b)/g, "1");
  const isQuestion = normalized.includes("recommend") || normalized.includes("what should") || normalized.endsWith("?");
  if (isQuestion) {
    if (mapViewMode() === "putting") {
      const exactFeet = distance(state.ball, pin().center_point) * 3;
      const feet = Math.round(exactFeet);
      const read = puttingRead();
      const pace = feet <= 4
        ? "firm enough to finish just beyond the cup"
        : feet <= 12
          ? "with controlled pace, trying to finish within two feet if it misses"
          : "as a lag putt, prioritizing distance control";
      const recommendedPace = Math.max(5, Math.min(100, Math.round(exactFeet / PUTTER_RANGE_FEET * 100)));
      const rangeAdvice = exactFeet > PUTTER_RANGE_FEET
        ? `The cup is beyond the ${PUTTER_RANGE_FEET}-foot modeled putter range, so use 100% as a lag putt and prioritize the next putt.`
        : `Use about ${recommendedPace}% pace, ${pace}.`;
      addGmMessage(`You have ${formatPuttDistance(exactFeet)} to the cup. It is simulated to break about ${formatInches(read.breakInches)} to the ${read.direction}, so start near ${formatInches(read.breakInches)} ${read.startDirection} of the cup. ${rangeAdvice}`);
      return;
    }
    const chipPlan = recommendedChipPlan();
    if (chipPlan) {
      state.selectedClub = chipPlan.clubIndex;
      state.target = chipPlan.landingPoint;
      state.swingPower = chipPlan.recommendedPower / 100;
      state.shotDraft = { club: true, target: true, power: true };
      updateAll();
      addGmMessage(`I like ${chipPlan.clubName}. Land it about ${Math.round(chipPlan.carryYards)} yards onto the green, then let it release about ${Math.round(chipPlan.rollYards)} yards. Favor the ${chipPlan.startDirection} side by about ${formatInches(chipPlan.breakInches)}.`);
      return;
    }
    if (currentClub().name === "Putter") {
      recommendClub();
    }
    const adjustment = recommendedAdjustment();
    const club = currentClub();
    const targetAdvice = mapViewMode() === "putting"
      ? "Aim at the cup."
      : distance(state.ball, pin().center_point) <= 210
        ? "Aim at the pin, or favor the safe side of the green."
        : "Aim for the center of a reachable fairway or layup area.";
    addGmMessage(`I like ${club.name}${adjustment > 0 ? " with one club more for the uphill shot" : adjustment < 0 ? " with one club less for the downhill shot" : " at its normal yardage"}. ${targetAdvice}`);
    return;
  }

  const namedClub = state.profile.clubs.findIndex(club => {
    const name = club.name.toLowerCase();
    const aliases = [
      name,
      name.replace("pitching wedge", "pitch"),
      name.replace("pitching wedge", "pw"),
      name.replace("sand wedge", "sw"),
      name.replace("gap wedge", "gw"),
      name.replace("lob wedge", "lw")
    ];
    if (club.name === "Putter") aliases.push("putt", "putting");
    return [...new Set(aliases)].some(alias => includesPhrase(normalized, alias));
  });
  if (namedClub >= 0) {
    state.selectedClub = namedClub;
    state.shotDraft.club = true;
  }

  // On the green, pace and cup-target language unambiguously imply Putter.
  if (mapViewMode() === "putting" && namedClub < 0) {
    const putterIndex = state.profile.clubs.findIndex(club => club.name === "Putter");
    if (putterIndex >= 0) {
      state.selectedClub = putterIndex;
      state.shotDraft.club = true;
    }
  }

  // Never let a putter left over from a previous green silently execute a
  // normal tee, fairway, or approach instruction.
  const explicitlyRequestedPutter = namedClub >= 0 && state.profile.clubs[namedClub].name === "Putter";
  if (mapViewMode() !== "putting" && currentClub().name === "Putter" && !explicitlyRequestedPutter) {
    recommendClub();
  }

  const percentageMatch = normalized.match(/(\d{1,3})\s*%/);
  if (percentageMatch) {
    state.swingPower = Math.max(.05, Math.min(1, Number(percentageMatch[1]) / 100));
    state.shotDraft.power = true;
  } else if (normalized.includes("full swing")) {
    state.swingPower = 1;
    state.shotDraft.power = true;
  }

  let adjustment = 0;
  if (normalized.includes("one club up") || normalized.includes("club more") || normalized.includes("extra club")) adjustment = 1;
  if (normalized.includes("one club down") || normalized.includes("club less") || normalized.includes("less club")) adjustment = -1;
  if (adjustment && !state.shotDraft.club && namedClub < 0) {
    addGmMessage(`Which club should I adjust from? For example, say “7 Iron, one club up.”`);
    return;
  }
  if (adjustment) {
    state.selectedClub = Math.max(0, Math.min(state.profile.clubs.length - 1, state.selectedClub - adjustment));
    state.clubAdjustment = adjustment;
    state.shotDraft.club = true;
  }
  let targetDescription = "";
  const inchOffset = normalized.match(/(\d+(?:\.\d+)?)\s*(?:inch|inches|in)\s+(?:(?:to\s+the\s+)?(right|left)|(?:to\s+)?(right|left)\s+of)/);
  const cupEdge = normalized.match(/(?:aim\s+)?(?:at\s+|the\s+)?(left|right)\s+edge\s+of\s+(?:the\s+)?(?:cup|pin)/);
  const lateralAim = normalized.match(/(?:aim\s+)?(?:(\d+(?:\.\d+)?)\s*yards?\s+|slightly\s+)(left|right)(?:\s+of\s+(?:the\s+)?(?:pin|target|flag))?/);
  if (mapViewMode() === "putting" && cupEdge) {
    const edgeDirection = cupEdge[1];
    const cupRadiusInches = 2.125;
    state.target = puttTargetFromCup(edgeDirection === "right" ? cupRadiusInches : -cupRadiusInches);
    if (!state.target) {
      addGmMessage("I could not resolve the cup position for that putt line. Aim at the cup again or click a line on the green.");
      return;
    }
    targetDescription = `the ${edgeDirection} edge of the cup`;
    state.shotDraft.target = true;
  } else if (mapViewMode() === "putting" && inchOffset) {
    const offsetDirection = inchOffset[2] || inchOffset[3];
    const signedOffset = Number(inchOffset[1]) * (offsetDirection === "right" ? 1 : -1);
    state.target = puttTargetFromCup(signedOffset);
    if (!state.target) {
      addGmMessage("I could not resolve that putting line. Try the read again or click a line on the green.");
      return;
    }
    targetDescription = `${formatInches(inchOffset[1])} ${offsetDirection} of the cup`;
    state.shotDraft.target = true;
  } else if (mapViewMode() !== "putting" && lateralAim) {
    const direction = lateralAim[2];
    const referenceTarget = normalShotTarget(state.ball);
    const preview = sidehillShotPlan(state.ball, referenceTarget);
    const requestedYards = lateralAim[1]
      ? Number(lateralAim[1])
      : preview.stance !== "level"
        ? Math.abs(preview.recommended_aim_yards)
        : 3;
    state.target = offsetPointPerpendicular(
      state.ball,
      referenceTarget,
      referenceTarget,
      requestedYards * (direction === "right" ? 1 : -1)
    );
    targetDescription = `${Math.round(requestedYards * 10) / 10} yards ${direction} of the normal target`;
    state.shotDraft.target = true;
  } else if (
    hasApproxWord(normalized, "fairway") &&
    (hasApproxWord(normalized, "center") || hasApproxWord(normalized, "centre"))
  ) {
    state.target = fairwayCenterTarget();
    targetDescription = state.target ? "the center of the fairway" : "";
    state.shotDraft.target = Boolean(state.target);
    if (!state.target) {
      addGmMessage("There is no useful fairway-center line ahead from this position. Click a line on the map, or ask for a recommendation before playing.");
    }
  } else if (
    hasApproxWord(normalized, "green") &&
    (hasApproxWord(normalized, "center") || hasApproxWord(normalized, "centre") || hasApproxWord(normalized, "middle"))
  ) {
    state.target = pinPoint();
    targetDescription = "the center of the green";
    state.shotDraft.target = true;
  } else if (
    hasApproxWord(normalized, "aim") &&
    (hasApproxWord(normalized, "pin") || hasApproxWord(normalized, "cup") || hasApproxWord(normalized, "flag"))
  ) {
    state.target = pinPoint();
    targetDescription = "the pin";
    state.shotDraft.target = true;
  }

  const club = currentClub();
  const c = shotConditions();
  const sidehill = state.target && mapViewMode() !== "putting"
    ? sidehillShotPlan(state.ball, resolveIntentTarget(state.ball, state.target, club, state.swingPower) || state.target)
    : null;
  const agreement = adjustment === recommendedAdjustment() && adjustment !== 0
    ? ` That matches the ${c.slope} adjustment.`
    : adjustment && adjustment !== recommendedAdjustment()
      ? ` I’ve set it, though the shot is ${c.slope}; check the expected range before committing.`
      : "";
  const sidehillAgreement = sidehill?.compensation === "correct"
    ? ` That correctly compensates for ${c.stance}.`
    : sidehill?.compensation === "wrong_direction"
      ? ` Warning: that aim moves with the expected sidehill curve rather than against it.`
      : sidehill?.compensation === "overcompensated"
        ? ` That is wider than the recommended sidehill allowance.`
        : sidehill?.compensation === "missing"
          ? ` ${c.stance[0].toUpperCase() + c.stance.slice(1)} still calls for about ${Math.round(Math.abs(sidehill.recommended_aim_yards) * 10) / 10} yards ${sidehill.recommended_aim_yards > 0 ? "right" : "left"} of compensation.`
          : "";
  const swing = percentageMatch
    ? ` at ${Math.round(state.swingPower * 100)}% ${club.name === "Putter" && mapViewMode() === "putting" ? "pace" : "swing"}`
    : normalized.includes("full swing") ? " at full swing" : "";
  const targetConfirmation = targetDescription
    ? ` You are aimed at ${targetDescription}.`
    : state.target
      ? " Your existing aim line is unchanged."
      : " Now click an aim line on the map.";
  const shotCommand = namedClub >= 0 ||
    percentageMatch !== null ||
    Boolean(targetDescription) ||
    normalized.includes("full swing") ||
    normalized.includes("aim ") ||
    normalized.includes("play") ||
    normalized.includes("hit it") ||
    normalized.includes("take the shot") ||
    adjustment !== 0;
  const clubDescription = club.name === "Putter" && mapViewMode() === "putting"
    ? `${Math.round(distance(state.ball, pin().center_point) * 3)}-foot putt`
    : `${club.name}, ${club.carry} yards`;
  const missing = [];
  if (!state.shotDraft.club) missing.push("club");
  if (!state.shotDraft.target) missing.push("aim line");
  if (!state.shotDraft.power) missing.push(club.name === "Putter" ? "pace percentage" : "swing percentage");
  const completeShot = shotCommand && missing.length === 0 && state.target;
  const clarification = shotCommand && missing.length
    ? ` Before I play, I still need ${missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`}.`
    : "";
  addGmMessage(`Understood: ${clubDescription}${swing}.${agreement}${targetConfirmation}${sidehillAgreement}${clarification}${completeShot ? " Playing now." : ""}`);
  updateAll();
  if (completeShot && !state.holeFinished) {
    queueAutoPlay();
  }
}

function shotRisk() {
  if (!state.target) return { value: 0, label: "Select a line", copy: "Click an aim line on the course to preview the shot." };
  const club = currentClub();
  if (club.name === "Putter" && mapViewMode() === "putting") {
    const feet = puttingRead().feet;
    const makePercentage = Math.round(puttingMakeProbability(feet) * 100);
    const risk = 100 - makePercentage;
    const label = makePercentage >= 70 ? "Strong make chance" : makePercentage >= 35 ? "Makeable" : "Lag range";
    return {
      value: risk,
      label,
      copy: `${Math.round(feet)} ft · ${makePercentage}% profile make rate with a sound read and pace.`
    };
  }
  const intentTarget = resolveIntentTarget(state.ball, state.target, club, state.swingPower) || state.target;
  const aim = distance(state.ball, intentTarget);
  const expected = club.carry * liePenalty();
  const targetLie = lieAt(intentTarget);
  const uncertainty = 100 - club.accuracy;
  const pattern = club.accuracy >= 86 ? "Tight" : club.accuracy >= 72 ? "Moderate" : club.accuracy >= 56 ? "Wide" : "Very wide";
  const likelyMiss = Math.max(1, Math.round(uncertainty * .11 * gameplayScale()));
  const largerMiss = Math.max(likelyMiss + 1, Math.round(uncertainty * .27 * METERS_TO_YARDS * gameplayScale()));
  let risk = Math.abs(aim - expected) / Math.max(expected, 1) * 70 + (100 - club.accuracy) * .45;
  if (targetLie.penalty) risk += 35;
  if (targetLie.type === "Bunker" || targetLie.type.includes("rough")) risk += 15;
  risk = Math.round(Math.min(100, risk));
  const label = risk < 30 ? "Conservative" : risk < 58 ? "Measured risk" : "High risk";
  const copy = targetLie.penalty
    ? `Your intended line finishes through ${targetLie.type.toLowerCase()}. Misses there are likely to cost a stroke.`
    : aim > expected * 1.12 ? `This asks for more than your usual ${club.carry}-yard carry.`
    : club.name === "Putter"
      ? `Your line starts on the ${targetLie.type.toLowerCase()}. Pace and the simulated break determine the result.`
      : `${pattern} shot pattern · ${club.accuracy}% club accuracy. A common miss is about ${likelyMiss} yards left or right; a larger miss can reach roughly ${largerMiss} yards. Favor space away from trouble.`;
  return { value: risk, label, copy };
}

function svgPointFromPointer(event, svg) {
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return [point.x, point.y];
}

function setTargetFromPointer(event, announce = false) {
  const svg = $("#course-map svg");
  const point = svgPointFromPointer(event, svg);
  if (!point) return false;
  const [screenX, screenY] = point;
  if (screenX < 60 || screenX > 940 || screenY < 25 || screenY > 975) return;
  state.target = coursePoint(screenX, screenY);
  state.shotDraft.target = true;
  renderMap();
  updateShotDesk();
  if (announce) {
    const lineDistance = distance(state.ball, state.target);
    const lineDistanceLabel = mapViewMode() === "putting"
      ? `${Math.round(lineDistance * 3)} feet`
      : `${Math.round(lineDistance)} yards`;
    $("#distance-badge").hidden = true;
    addGmMessage(`Aim line set at ${lineDistanceLabel}. Drag the marker or use the one-yard arrows to refine the line, then tell me the club and ${mapViewMode() === "putting" ? "pace" : "swing"} percentage.`);
  }
  return true;
}

function onMapClick(event) {
  if (state.holeFinished || targetDragging || performance.now() < suppressMapClickUntil) return;
  setTargetFromPointer(event, true);
}

function onMapPointerUp(event) {
  if (event.pointerType === "mouse") return;
  if (state.holeFinished || targetDragging || performance.now() < suppressMapClickUntil) return;
  if (event.target.closest(".target-mark")) return;
  setTargetFromPointer(event, true);
}

function onTargetPointerDown(event) {
  if (state.holeFinished || !event.target.closest(".target-mark")) return;
  event.preventDefault();
  targetDragging = true;
  targetDragMoved = false;
  targetPointerId = event.pointerId;
  targetDragStart = [event.clientX, event.clientY];
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function onTargetPointerMove(event) {
  if (!targetDragging || event.pointerId !== targetPointerId) return;
  event.preventDefault();
  if (targetDragStart && Math.hypot(event.clientX - targetDragStart[0], event.clientY - targetDragStart[1]) > 3) {
    targetDragMoved = true;
  }
  setTargetFromPointer(event);
}

function onTargetPointerUp(event) {
  if (!targetDragging || event.pointerId !== targetPointerId) return;
  if (targetDragMoved) {
    suppressMapClickUntil = performance.now() + 350;
    const targetDistance = distance(state.ball, state.target);
    const unit = mapViewMode() === "putting" ? "feet" : "yards";
    const amount = mapViewMode() === "putting" ? Math.round(targetDistance * 3) : Math.round(targetDistance);
    addGmMessage(`Aim line refined to ${amount} ${unit}. Use the arrows for final adjustment or play the shot.`);
  }
  targetDragging = false;
  targetDragMoved = false;
  targetPointerId = null;
  targetDragStart = null;
  renderMap();
}

function recommendClub() {
  const targetDistance = distance(state.ball, pin().center_point);
  if (currentLieType() === "Green") {
    state.selectedClub = state.profile.clubs.findIndex(club => club.name === "Putter");
    return;
  }
  const chipPlan = recommendedChipPlan();
  if (chipPlan) {
    state.selectedClub = chipPlan.clubIndex;
    return;
  }
  const index = state.profile.clubs
    .map((club, i) => ({ i, diff: Math.abs(club.carry * liePenalty() - Math.min(targetDistance, state.profile.clubs[0].carry)) }))
    .sort((a, b) => a.diff - b.diff)[0].i;
  state.selectedClub = index;
}

function autoSelectClubForLie() {
  if (currentLieType() !== "Green") return;
  const putterIndex = state.profile.clubs.findIndex(club => club.name === "Putter");
  if (putterIndex >= 0) state.selectedClub = putterIndex;
}

function playShot() {
  if (!state.target || state.holeFinished) return;
  $("#putt-analysis").hidden = true;
  const strokeIndex = state.shots.length + 1;
  const start = [...state.ball];
  const linePoint = finitePointOrNull(state.target);
  if (!linePoint) {
    state.target = null;
    state.shotDraft.target = false;
    addGmMessage("The aim line became invalid before the shot was played. Set the line again and retry the shot.");
    renderMap();
    updateShotDesk();
    return;
  }
  const club = currentClub();
  const usedPower = state.swingPower;
  const isPutt = club.name === "Putter" && currentLieType() === "Green";
  const isGreenside = !isPutt && isGreensideChip(start, club);
  const intendedTarget = isPutt
    ? pointArray(linePoint)
    : isGreenside
      ? pointArray(linePoint)
      : (resolveIntentTarget(start, linePoint, club, usedPower) || linePoint);
  const intendedLie = lieAt(intendedTarget).type;
  const plannedRisk = shotRisk().value;
  const sidehill = !isPutt && !isGreenside
    ? sidehillShotPlan(start, intendedTarget)
    : null;
  let resultPacket = null;
  let resultRequest = null;
  let strategyPacket = null;
  let puttPacket = null;
  let puttRequest = null;
  let landing;
  let puttingEvaluation = null;
  if (isPutt) {
    const authoritative = authoritativePutt(start, intendedTarget, usedPower);
    puttPacket = authoritative.packet;
    puttRequest = authoritative.request;
    strategyPacket = scorePuttStrategy(puttPacket);
    landing = coursePointFromCanonical(puttPacket.landing);
    puttingEvaluation = {
      made: puttPacket.made,
      correctDecision: puttPacket.correct_decision,
      aimCorrect: puttPacket.aim_correct,
      paceCorrect: puttPacket.pace_correct,
      aimErrorInches: puttPacket.aim_error_inches,
      powerErrorPoints: puttPacket.power_error_points,
      makeProbability: puttPacket.make_probability,
      read: {
        feet: puttPacket.read.feet,
        direction: puttPacket.read.direction,
        startDirection: puttPacket.read.start_direction,
        breakInches: puttPacket.read.break_inches
      },
      requiredPower: puttPacket.read.feet / PUTTER_RANGE_FEET,
      usedPower,
      playerOffsetInches: puttPacket.player_offset_inches,
      playerOffsetDirection: puttPacket.player_offset_direction
    };
  } else {
    const authoritative = isGreenside
      ? authoritativeGreensideShot(start, intendedTarget, club, usedPower, strokeIndex)
      : authoritativeFullShot(start, intendedTarget, club, usedPower, sidehill);
    resultPacket = authoritative.packet;
    resultRequest = authoritative.request;
    strategyPacket = scoreStrategy(
      buildStrategyContext(start, intendedTarget, club, plannedRisk, strokeIndex, sidehill),
      resultPacket
    );
    landing = coursePointFromCanonical(resultPacket.resolved_ball || resultPacket.landing);
  }

  landing = pointArray(landing);
  const authoritativeLanding = resultPacket
    ? pointArray(coursePointFromCanonical(resultPacket.landing))
    : pointArray(landing);
  const landingLie = resultPacket ? resultLieFromSurface(resultPacket.landing_surface) : { type: "Green", color: "#c3da83" };
  const relief = resultPacket?.relief || null;
  const penalty = relief?.penalty_strokes || 0;
  if (relief) landing = pointArray(coursePointFromCanonical(relief.ball_position));
  const resultLie = relief
    ? resultLieFromSurface(relief.resulting_surface)
    : lieAt(landing);

  const shotDistanceYards = distance(start, landing);
  const shotRecord = {
    start,
    landing: resultPacket ? pointArray(authoritativeLanding) : pointArray(landing),
    resolvedBall: pointArray(landing),
    club: club.name,
    power: Math.round(usedPower * 100),
    yards: Math.round(resultPacket?.total_yards ?? shotDistanceYards),
    feet: Math.round((resultPacket?.total_yards ?? shotDistanceYards) * 3),
    intendedLie,
    landingLie: landingLie.type,
    lie: resultLie.type,
    penalty,
    relief,
    resultPacket,
    strategyPacket,
    resultRequest,
    puttPacket,
    puttRequest,
    sidehillPlan: sidehill
  };
  state.target = null;
  state.swingPower = 1;
  state.shotDraft = { club: false, target: false, power: false };
  $("#distance-badge").hidden = true;

  const remaining = resultPacket ? resultPacket.remaining_distance_yards : puttPacket ? puttPacket.remaining_distance_yards : distance(landing, pin().center_point);
  if (puttingEvaluation) {
    shotRecord.puttAnalysis = {
      distanceFeet: Math.round(puttingEvaluation.read.feet),
      recommendedRead: `${puttingEvaluation.read.breakInches} inches ${puttingEvaluation.read.startDirection}`,
      playerRead: `${Math.round(puttingEvaluation.playerOffsetInches)} inches ${puttingEvaluation.playerOffsetDirection}`,
      recommendedPace: Math.round(puttingEvaluation.requiredPower * 100),
      playerPace: Math.round(puttingEvaluation.usedPower * 100),
      makeProbability: Math.round(puttingEvaluation.makeProbability * 100)
    };
    shotRecord.decisionQuality = decisionQualityFromAssessment(puttPacket?.assessment);
    shotRecord.executionQuality = executionQualityFromAssessment(puttPacket?.assessment);
    shotRecord.quality = overallQualityFromAssessment(puttPacket?.assessment);
    shotRecord.lesson = puttingEvaluation.made
      ? `Made the putt with ${shotRecord.power}% pace and the correct break compensation.`
      : puttingEvaluation.correctDecision
        ? `The read and pace were sound; the profile-based ${Math.round(puttingEvaluation.makeProbability * 100)}% make chance produced a miss.`
        : `Missed the read by ${formatInches(Math.round(puttingEvaluation.aimErrorInches))} and the pace by ${Math.round(puttingEvaluation.powerErrorPoints)} percentage points.`;
  } else {
    const costly = penalty > 0 || ["Bunker", "Heavy rough", "Water", "Out of bounds"].includes(landingLie.type);
    shotRecord.decisionQuality = decisionQualityFromAssessment(resultPacket?.assessment);
    shotRecord.executionQuality = executionQualityFromAssessment(resultPacket?.assessment);
    shotRecord.risk = resultPacket?.assessment?.decision_risk ?? plannedRisk;
    shotRecord.quality = overallQualityFromAssessment(resultPacket?.assessment);
    shotRecord.lesson = relief
      ? `${club.name} at ${shotRecord.power}% finished in ${landingLie.type.toLowerCase()}; ${relief.relief_type.replaceAll("_", " ")} added one penalty stroke.`
      : landingLie.type === intendedLie
      ? `${club.name} at ${shotRecord.power}% found the intended ${intendedLie.toLowerCase()}.`
      : `${club.name} at ${shotRecord.power}% missed the intended ${intendedLie.toLowerCase()} and finished in ${landingLie.type.toLowerCase()}${costly ? ", costing position or a penalty" : ""}.`;
    if (sidehill?.compensation === "correct") {
      shotRecord.lesson = `Correct sidehill adjustment: you aimed ${Math.abs(sidehill.player_aim_yards)} yards ${sidehill.player_aim_yards > 0 ? "right" : "left"} to counter the expected curve. ${shotRecord.lesson}`;
    } else if (sidehill && sidehill.compensation !== "not_required") {
      shotRecord.lesson = `Sidehill adjustment needs work: aim about ${Math.abs(sidehill.recommended_aim_yards)} yards ${sidehill.recommended_aim_yards > 0 ? "right" : "left"}. ${shotRecord.lesson}`;
    }
  }
  shotRecord.remaining = Math.round(remaining);
  const completionType = classifyShotCompletion(remaining);
  let completionStrokeDelta = 0;
  if (completionType === "gimme") {
    completionStrokeDelta = 1;
  }
  const priorScore = state.shots.reduce((sum, shot) => sum + 1 + shot.penalty, 0);
  const eventScore = completionType
    ? priorScore + 1 + penalty + completionStrokeDelta
    : null;
  commitRoundEvent({
    event_type: "shot_committed",
    stroke_index: strokeIndex,
    stroke_count_delta: 1 + completionStrokeDelta,
    penalty_strokes: penalty,
    hole_finished: completionType !== null,
    completion_type: completionType,
    score: eventScore,
    remaining_distance_yards: remaining,
    resolved_lie: resultLie.type,
    resolved_ball: pointArray(landing),
    payload: { shot: shotRecord }
  });
  syncRoundStateCaches();
  if (completionType === "holed") {
    finishHole(0, "holed");
  } else if (completionType === "gimme") {
    finishHole(1, "gimme");
  } else {
    state.ball = pointArray(landing);
    state.currentLie = resultLie.type;
    autoSelectClubForLie();
    const missDistance = distance(authoritativeLanding, intendedTarget);
    const costlyMiss = penalty > 0 || ["Bunker", "Heavy rough", "Water", "Out of bounds"].includes(resultLie.type);
    const greenLeave = resultLie.type === "Green" && !state.holeFinished
      ? ` The ball finished ${formatPuttDistance(remaining * 3)} from the cup.`
      : "";
    const penaltyOutcome = relief?.reason === "water"
      ? `The shot entered the water. One penalty stroke was added and the ball was dropped near its last boundary crossing.`
      : relief?.reason === "out_of_bounds"
        ? `The shot finished out of bounds. One penalty stroke was added and stroke-and-distance returned you to the previous position.`
        : null;
    const outcome = puttingEvaluation
      ? puttingEvaluation.correctDecision
        ? `That was the right read and pace, but the ${Math.round(puttingEvaluation.makeProbability * 100)}% profile-based make chance did not fall this time. The ball finished ${formatPuttDistance(remaining * 3)} from the cup.`
        : `That putt missed because the decision was off by about ${formatInches(Math.round(puttingEvaluation.aimErrorInches))} of starting line and ${Math.round(puttingEvaluation.powerErrorPoints)} percentage points of pace. You have ${formatPuttDistance(remaining * 3)} left.`
      : penaltyOutcome
        ? penaltyOutcome
      : resultLie.type === intendedLie
      ? `Good shot. You held the ${resultLie.type.toLowerCase()} and finished about ${Math.round(missDistance)} yards from your intended landing point.${greenLeave}`
      : costlyMiss
        ? `That was a costly miss. You aimed for ${intendedLie.toLowerCase()}, but the shot dispersed about ${Math.round(missDistance)} yards and finished in ${resultLie.type.toLowerCase()}.${greenLeave}`
        : `That shot missed your intended ${intendedLie.toLowerCase()}. It dispersed about ${Math.round(missDistance)} yards and finished in ${resultLie.type.toLowerCase()}.${greenLeave}`;
    if (sidehill?.compensation === "correct") {
      addGmMessage(`Correct sidehill decision: your ${Math.abs(sidehill.player_aim_yards)}-yard ${sidehill.player_aim_yards > 0 ? "right" : "left"} adjustment opposed the expected ${Math.abs(sidehill.expected_curve_yards)}-yard curve.`);
    } else if (sidehill && sidehill.compensation !== "not_required") {
      addGmMessage(`Sidehill review: with ${shotConditions(start).stance}, the recommended aim was about ${Math.abs(sidehill.recommended_aim_yards)} yards ${sidehill.recommended_aim_yards > 0 ? "right" : "left"}.`);
    }
    addGmMessage(outcome);
    addGmMessage(gameMasterBriefing());
  }
  void requestAiShotNarration(aiShotPayload({
    shotRecord,
    puttingEvaluation,
    plannedRisk,
    remaining,
    completionType,
    resultLie,
    intendedTarget
  }));
  renderMap();
  updateAll(false);
  showResult(resultLie, remaining, penalty);
  if (puttingEvaluation) renderPuttAnalysis(puttingEvaluation, remaining);
  if (state.holeFinished && state.holeIndex === 17) {
    window.setTimeout(openRoundReview, 650);
  }
}

function finishHole(extraStroke = 0, completionType = "holed") {
  const strokes = state.scores[state.holeIndex] ?? (state.shots.reduce((sum, shot) => sum + 1 + shot.penalty, 0) + extraStroke);
  if (completionType === "holed") playBallInHoleSound();
  addGmMessage(holeCompletionMessage(strokes));
}

function openHoleCompleteDialog() {
  const dialog = $("#hole-complete-dialog");
  if (!dialog) return;
  const strokes = state.scores[state.holeIndex] ?? state.shots.reduce((sum, shot) => sum + 1 + shot.penalty, 0);
  const relative = strokes - card().Par;
  const nextButton = $("#hole-complete-next");
  $("#hole-complete-title").textContent = state.completionType === "gimme"
    ? "Inside two feet"
    : "Holed";
  $("#hole-complete-copy").textContent = state.completionType === "gimme"
    ? `That finished inside two feet, so the next putt is conceded. You completed Hole ${state.holeIndex + 1} in ${strokes} strokes for ${golfScoreName(relative)}.`
    : `It is holed. You completed Hole ${state.holeIndex + 1} in ${strokes} strokes for ${golfScoreName(relative)}.`;
  nextButton.textContent = state.holeIndex < 17 ? `Play Hole ${state.holeIndex + 2}` : "Review round";
  dialog.showModal();
}

function golfScoreName(relative) {
  if (relative <= -3) return "albatross";
  if (relative === -2) return "eagle";
  if (relative === -1) return "birdie";
  if (relative === 0) return "par";
  if (relative === 1) return "bogey";
  if (relative === 2) return "double bogey";
  if (relative === 3) return "triple bogey";
  return `${relative} over par`;
}

function holeCompletionMessage(strokes) {
  const relative = strokes - card().Par;
  const scoreName = golfScoreName(relative);
  const puttLead = state.completionType === "gimme"
    ? "That finished inside two feet, so the next putt is conceded as a gimme. "
    : state.shots.at(-1)?.club === "Putter" ? "Good putt! " : "";
  const next = state.holeIndex < 17
    ? `Hole complete. You finished in ${strokes} strokes for ${scoreName}. Move on to Hole ${state.holeIndex + 2} when you’re ready.`
    : `Round complete. You finished the 18th in ${strokes} strokes for ${scoreName}. Open the scorecard to review your round.`;
  return `${puttLead}${next}`;
}

function showResult(lie, remaining, penalty) {
  const last = state.shots.at(-1);
  $("#shot-result").hidden = false;
  const resultDistance = last.club === "Putter"
    ? formatPuttDistance((last.puttPacket?.total_yards ?? 0) * 3)
    : `${last.yards} yards`;
  $("#result-title").textContent = state.holeFinished
    ? `${state.completionType === "gimme" ? "Gimme · complete" : "Holed"} in ${state.scores[state.holeIndex]}`
    : last.relief
      ? `${resultDistance} · ${last.landingLie} → ${lie.type}`
      : `${resultDistance} · ${lie.type}`;
  const reliefCopy = last.relief?.reason === "water"
    ? " One penalty stroke; relief taken near the last water crossing."
    : last.relief?.reason === "out_of_bounds"
      ? " One penalty stroke; stroke-and-distance applied."
      : last.relief?.reason === "unplayable"
        ? " One penalty stroke; unplayable-ball relief applied."
        : penalty ? " One penalty stroke added." : "";
  $("#result-copy").textContent = state.holeFinished
    ? `${fmtScore(state.scores[state.holeIndex] - card().Par)} on the hole. ${state.holeIndex < 17 ? "Move to the next tee when ready." : "Your round is complete."}`
    : last.club === "Putter"
      ? `${formatPuttDistance(remaining * 3)} remain.${reliefCopy}`
      : `${Math.round(remaining)} yards remain.${reliefCopy}`;
  showMobileShotToast($("#result-title").textContent, $("#result-copy").textContent);
  $("#declare-unplayable").hidden = !(
    last.resultPacket && last.resultRequest && last.resultRequest.engine !== "greenside" &&
    !last.resultPacket.relief && !state.holeFinished &&
    !["green", "tee", "water", "out_of_bounds"].includes(last.resultPacket.landing_surface)
  );
  if (state.holeFinished) openHoleCompleteDialog();
}

function declareLastShotUnplayable() {
  const shot = state.shots.at(-1);
  if (!shot?.resultPacket || shot.resultRequest?.engine === "greenside" ||
    shot.resultPacket.relief || state.holeFinished) return;
  const context = shot.resultRequest.context;
  const relief = resolveUnplayableRelief(context, shot.resultPacket);
  const resolvedLie = resultLieFromSurface(relief.resulting_surface).type;
  const remaining = Math.round(Math.hypot(
    relief.ball_position.x - context.pin.x,
    relief.ball_position.y - context.pin.y
  ) * 100) / 100;
  shot.resultPacket = { ...shot.resultPacket, relief, remaining_distance_yards: remaining };
  commitRoundEvent({
    event_type: "declare_unplayable",
    stroke_index: state.shots.length,
    penalty_strokes: relief.penalty_strokes,
    remaining_distance_yards: remaining,
    resolved_lie: resolvedLie,
    resolved_ball: coursePointFromCanonical(relief.ball_position),
    payload: {
      relief,
      shot_index: state.shots.length
    }
  });
  syncRoundStateCaches();
  addGmMessage(`You declared the ball unplayable. One penalty stroke was added and the ball was moved back on the playing line to ${resolvedLie.toLowerCase()}.`);
  autoSelectClubForLie();
  renderMap();
  updateAll(false);
  showResult(resultLieFromSurface(relief.resulting_surface), remaining, relief.penalty_strokes);
}

function renderPuttAnalysis(evaluation, remainingYards) {
  const recommendedRead = `${formatInches(evaluation.read.breakInches)} ${evaluation.read.startDirection}`;
  const playerRead = evaluation.playerOffsetInches < .5
    ? "At the cup"
    : `${formatInches(Math.round(evaluation.playerOffsetInches))} ${evaluation.playerOffsetDirection}`;
  const recommendedPace = Math.round(evaluation.requiredPower * 100);
  const playerPace = Math.round(evaluation.usedPower * 100);
  const result = evaluation.made ? "Holed" : `${formatPuttDistance(remainingYards * 3)} from the cup`;
  let lesson;
  if (evaluation.made) lesson = "The starting line and pace produced a made putt.";
  else if (evaluation.aimCorrect && evaluation.paceCorrect) lesson = "The decision was sound. Profile-based execution produced a miss; repeat the same process.";
  else if (!evaluation.aimCorrect && !evaluation.paceCorrect) lesson = `Adjust both parts: start closer to ${recommendedRead} and use about ${recommendedPace}% pace.`;
  else if (!evaluation.aimCorrect) lesson = `Your pace was suitable. Change only the starting line toward ${recommendedRead}.`;
  else lesson = `Your read was suitable. Keep that line and change pace toward ${recommendedPace}%.`;

  $("#putt-analysis-distance").textContent = formatPuttDistance(evaluation.read.feet);
  $("#putt-read-recommended").textContent = recommendedRead;
  $("#putt-read-player").textContent = `${playerRead} ${evaluation.aimCorrect ? "✓" : "✕"}`;
  $("#putt-read-player").className = evaluation.aimCorrect ? "correct" : "incorrect";
  $("#putt-pace-recommended").textContent = `${recommendedPace}%`;
  $("#putt-pace-player").textContent = `${playerPace}% ${evaluation.paceCorrect ? "✓" : "✕"}`;
  $("#putt-pace-player").className = evaluation.paceCorrect ? "correct" : "incorrect";
  $("#putt-probability").textContent = `${Math.round(evaluation.makeProbability * 100)}%`;
  $("#putt-analysis-result").textContent = result;
  $("#putt-analysis-lesson").textContent = lesson;
  $("#putt-analysis").hidden = false;
}

function roundCardMarkup() {
  const row = (label, start) => `<div class="round-card-row">
    <span class="round-nine-label">${label}</span>
    ${state.scorecard.slice(start, start + 9).map((entry, offset) => {
      const index = start + offset;
      const score = state.scores[index];
      const relative = score == null ? "" : fmtScore(score - entry.Par);
      return `<button type="button" class="round-hole ${score == null ? "" : "complete"} ${index === state.holeIndex ? "active" : ""}" data-round-hole="${index}" aria-label="Go to hole ${index + 1}${score == null ? "" : `, score ${relative}`}" ${index === state.holeIndex ? 'aria-current="step" disabled' : ""}>
        <span>${index + 1}</span><strong>${relative}</strong>
      </button>`;
    }).join("")}
  </div>`;
  return row("OUT", 0) + row("IN", 9);
}

function renderRoundNavigation() {
  const markup = roundCardMarkup();
  $("#round-card-grid").innerHTML = markup;
  $("#mobile-round-card-grid").innerHTML = markup;
  const played = state.scores.reduce((total, score, index) => score == null ? total : total + score - state.scorecard[index].Par, 0);
  $("#round-card-score").textContent = fmtScore(played);
}

function updateHoleBrief() {
  const h = hole().hole_metadata;
  $("#brand-course-name").textContent = state.course.shortName;
  $("#course-select").value = state.courseId;
  $("#scorecard-course-name").textContent = state.course.name;
  $("#reference-image-button").hidden = !state.course.images;
  $("#enlarged-reference-image-button").hidden = !state.course.images || !state.greenEnlarged;
  $("#header-hole").textContent = state.holeIndex + 1;
  $("#hole-number").textContent = String(state.holeIndex + 1).padStart(2, "0");
  $("#hole-name").textContent = state.courseId === "meadows" ? holeNames[state.holeIndex] : h.layout_type;
  $("#hole-layout").textContent = h.layout_type;
  $("#hole-facts").textContent = `Par ${card().Par} · HCP ${card().Handicap} · ${teeYards()} yards`;
  $("#strategy-copy").textContent = strategyText();
  const totalElevation = hole().elevation_profile.points.at(-1).elevation_m * 3.28084;
  $("#elevation-value").textContent = `${totalElevation >= 0 ? "+" : "−"}${Math.abs(Math.round(totalElevation))} ft`;
  $("#current-lie").textContent = currentLieType();
  const viewMode = mapViewMode();
  $("#enlarge-green").hidden = viewMode === "full" || state.greenEnlarged;
  $("#enlarge-green").textContent = viewMode === "putting" ? "Enlarge green" : "Enlarge line";
  $("#target-nudge").hidden = !state.target;
  $("#nudge-label").textContent = viewMode === "putting" ? "Adjust line · 1 in" : "Adjust line · 1 yd";
  $(".map-hint").innerHTML = viewMode === "putting"
    ? "<i></i> Putting view · click to set line · drag to refine"
    : viewMode === "approach"
      ? "<i></i> Approach view · click to set line · drag to refine"
      : "<i></i> Click to set line · drag to refine";
  $("#previous-hole").disabled = state.holeIndex === 0;
  $("#next-hole").disabled = state.holeIndex === 17;
  syncMobileSheetUI();
  renderRoundNavigation();
  $$(".tee-switch button").forEach(button => {
    button.classList.toggle("active", button.dataset.tee === state.tee);
    button.textContent = state.course.teeLabels?.[button.dataset.tee] || button.dataset.tee;
  });
  $("#pin-select").innerHTML = hole().geometries.green_complex.pin_zones.map((p, i) =>
    `<option value="${i}" ${i === state.pinIndex ? "selected" : ""}>${titleCase(p.zone_id)}</option>`).join("");
}

function openEnlargedGreen() {
  if (mapViewMode() === "full") return;
  state.greenEnlarged = true;
  $(".course-stage").classList.add("enlarged-green");
  document.body.classList.add("green-view-open");
  $("#close-enlarged-green").hidden = false;
  $("#enlarged-reference-image-button").hidden = !state.course.images;
  $("#enlarge-green").hidden = true;
  renderMap();
}

function nudgeTarget(xDirection, yDirection) {
  if (!state.target) return;
  const stepMeters = mapViewMode() === "putting" ? .0254 : 1 / METERS_TO_YARDS / gameplayScale();
  state.target = [state.target[0] + xDirection * stepMeters, state.target[1] + yDirection * stepMeters];
  state.shotDraft.target = true;
  renderMap();
  updateShotDesk();
}

function closeEnlargedGreen() {
  const wasOpen = state.greenEnlarged;
  state.greenEnlarged = false;
  $(".course-stage")?.classList.remove("enlarged-green");
  document.body.classList.remove("green-view-open");
  const closeButton = $("#close-enlarged-green");
  if (closeButton) closeButton.hidden = true;
  const referenceButton = $("#enlarged-reference-image-button");
  if (referenceButton) referenceButton.hidden = true;
  if (wasOpen && state.holes.length) {
    $("#enlarge-green").hidden = mapViewMode() === "full";
    renderMap();
  }
}

function updateProfileUI() {
  $("#profile-monogram").textContent = state.profile.id.startsWith("custom") ? "C" : state.profile.id[0];
  $("#profile-button-name").textContent = state.profile.name;
  $("#club-select").innerHTML = state.profile.clubs.map((club, i) => `<option value="${i}" ${i === state.selectedClub ? "selected" : ""}>${club.name}${club.name === "Putter" ? ` · ${PUTTER_RANGE_FEET} ft` : ` · ${club.carry} yd`}</option>`).join("");
  $("#club-carry").textContent = `${currentClub().carry} yd carry`;
  renderMobileClubCarousel();
  renderMobileQuickClubCarousel();
}

function setSelectedClub(index) {
  state.selectedClub = Number(index);
  state.shotDraft.club = true;
  renderMobileClubCarousel();
  renderMobileQuickClubCarousel();
  renderMap();
  updateShotDesk();
}

function renderMobileClubCarousel() {
  const container = $("#mobile-club-carousel");
  if (!container || !state.profile) return;
  container.innerHTML = state.profile.clubs.map((club, index) => `
    <button type="button" class="mobile-club-card ${index === state.selectedClub ? "active" : ""}" data-mobile-club="${index}">
      <strong>${club.name}</strong>
      <span>${club.name === "Putter" ? `${PUTTER_RANGE_FEET} ft range` : `${club.carry} yd carry`}</span>
      <span>${club.accuracy}% accuracy</span>
    </button>
  `).join("");
  $$("[data-mobile-club]").forEach(button => button.addEventListener("click", () => {
    setSelectedClub(button.dataset.mobileClub);
    button.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }));
}

function renderMobileQuickClubCarousel() {
  const container = $("#mobile-quick-club-carousel");
  if (!container || !state.profile) return;
  container.innerHTML = state.profile.clubs.map((club, index) => `
    <button type="button" class="mobile-quick-club-card ${index === state.selectedClub ? "active" : ""}" data-mobile-quick-club="${index}">
      <strong>${club.name}</strong>
      <span>${club.name === "Putter" ? `${PUTTER_RANGE_FEET} ft` : `${club.carry} yd`}</span>
    </button>
  `).join("");
  $$("[data-mobile-quick-club]").forEach(button => button.addEventListener("click", () => {
    setSelectedClub(button.dataset.mobileQuickClub);
    setMobileQuickPanel(null);
    button.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }));
}

function updateMobileCaddie() {
  const label = $("#mobile-caddie-label");
  if (!label) return;
  label.textContent = currentLieType() === "Green"
    ? "Break and pace"
    : currentLieType().includes("rough") || currentLieType() === "Bunker"
      ? "Lie and strike"
      : "Hole briefing";
}

function renderMobileGmHistory() {
  const history = $("#mobile-gm-history");
  if (!history) return;
  if (!state.gmMessages.length) state.gmMessages.push({ text: gameMasterBriefing(), role: "gm" });
  const wasNearBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 24;
  history.innerHTML = state.gmMessages
    .map(message => `<p class="gm-message ${message.role === "player" ? "player" : ""}">${escapeHtml(message.text)}</p>`)
    .join("");
  if (wasNearBottom) history.scrollTop = history.scrollHeight;
}

function plannerMarkerDistance(remaining, markerYards) {
  if (remaining <= markerYards - 5) return "Passed";
  if (Math.abs(remaining - markerYards) < 5) return "At mark";
  return `${Math.round(remaining - markerYards)} yd`;
}

function openMobileShotSetup() {
  setMobileSheetState("full");
}

function returnToMobileMap() {
  setMobileQuickPanel(null);
  setMobileSheetState("collapsed");
}

function acceptCurrentShotSetup() {
  state.shotDraft.club = true;
  state.shotDraft.power = true;
  if (state.target) state.shotDraft.target = true;
}

function syncMobileSheetUI() {
  const sheet = $("#mobile-shot-sheet");
  const handle = $("#mobile-sheet-handle");
  if (!sheet || !handle) return;
  sheet.dataset.sheetState = state.mobileSheetState;
  handle.setAttribute("aria-expanded", String(state.mobileSheetState !== "collapsed"));
  syncMobileQuickControls();
}

function syncMobileQuickControls() {
  const controls = $("#mobile-quick-controls");
  if (!controls) return;
  const activePanel = state.mobileSheetState === "collapsed" ? state.mobileQuickPanel : null;
  controls.hidden = !activePanel;
  controls.dataset.activePanel = activePanel || "";
  ["club", "target", "power"].forEach(panel => {
    const trigger = $(`#mobile-summary-${panel}-button`);
    const section = $(`#mobile-quick-${panel}`);
    const isActive = activePanel === panel;
    if (trigger) {
      trigger.classList.toggle("active", isActive);
      trigger.setAttribute("aria-expanded", String(isActive));
    }
    if (section) section.hidden = !isActive;
  });
}

function setMobileQuickPanel(panel) {
  const normalized = ["club", "target", "power"].includes(panel) ? panel : null;
  state.mobileQuickPanel = normalized;
  syncMobileQuickControls();
}

function toggleMobileQuickPanel(panel) {
  if (state.mobileSheetState !== "collapsed") {
    setMobileSheetState("collapsed");
  }
  setMobileQuickPanel(state.mobileQuickPanel === panel ? null : panel);
}

function setMobileSheetState(nextState) {
  if (!MOBILE_SHEET_STATES.includes(nextState)) return;
  state.mobileSheetState = nextState;
  if (nextState !== "collapsed") state.mobileQuickPanel = null;
  syncMobileSheetUI();
}

function cycleMobileSheetState() {
  if (state.mobileSheetState === "collapsed") {
    setMobileSheetState("full");
    return;
  }
  if (state.mobileSheetState === "full") {
    setMobileSheetState("collapsed");
    return;
  }
  setMobileSheetState("full");
}

function onMobileSheetPointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  mobileSheetPointerId = event.pointerId;
  mobileSheetDragStartY = event.clientY;
  mobileSheetDragStartState = state.mobileSheetState;
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function onMobileSheetPointerUp(event) {
  if (event.pointerId !== mobileSheetPointerId) return;
  const deltaY = event.clientY - mobileSheetDragStartY;
  mobileSheetPointerId = null;
  mobileSheetSuppressClickUntil = performance.now() + 250;
  if (Math.abs(deltaY) < 18) {
    cycleMobileSheetState();
    return;
  }
  if (deltaY < -60) {
    setMobileSheetState("full");
    return;
  }
  if (deltaY > 60) {
    setMobileSheetState("collapsed");
  }
}

function onMobileSheetClick() {
  if (performance.now() < mobileSheetSuppressClickUntil) return;
  cycleMobileSheetState();
}

function setSwingPowerFromMobile(percentage) {
  state.swingPower = Math.max(.05, Math.min(1, Number(percentage) / 100));
  state.shotDraft.power = true;
  renderMap();
  updateShotDesk();
}

function suggestedMobileTarget() {
  if (mapViewMode() === "putting") return pinPoint();
  if (distance(state.ball, pin().center_point) <= 210) return pinPoint();
  return fairwayCenterTarget() || pinPoint();
}

function playCurrentShotFromMobile() {
  ensureAudio();
  if (state.holeFinished) return;
  if (!state.target) {
    const target = suggestedMobileTarget();
    if (!target) {
      addGmMessage("Set the target on the map first, then play the shot.");
      setMobileSheetState("full");
      return;
    }
    state.target = target;
    state.shotDraft.target = true;
    addGmMessage("No target was selected, so I used the recommended line for this shot.");
  }
  state.shotDraft.club = true;
  state.shotDraft.target = true;
  state.shotDraft.power = true;
  renderMap();
  updateShotDesk();
  addGmMessage(`${currentClub().name} selected at ${Math.round(state.swingPower * 100)}% ${mapViewMode() === "putting" ? "pace" : "swing"}.`);
  try {
    playShot();
  } catch (error) {
    console.error(error);
    showMobileShotToast("Shot could not be played", "The mobile shot action hit an error. Try setting the line again.");
    return;
  }
  if (!state.holeFinished) {
    setMobileQuickPanel(null);
    setMobileSheetState("collapsed");
  }
}

function updateShotDesk() {
  const remaining = distance(state.ball, pin().center_point);
  const club = currentClub();
  const expected = Math.round(club.carry * liePenalty());
  const putting = currentLieType() === "Green";
  const displayDistance = yards => putting ? `${Math.round(yards * 3)} ft` : `${Math.round(yards)} yd`;
  $("#shot-number").textContent = state.shots.length + 1;
  const puttingFeet = remaining * 3;
  $("#yards-left").textContent = putting ? (puttingFeet < 1 ? Math.max(1, Math.round(puttingFeet * 12)) : Math.round(puttingFeet)) : Math.round(remaining);
  $(".yards-left span").textContent = putting ? (puttingFeet < 1 ? "in to cup" : "ft to cup") : "yd left";
  $("#club-select").value = String(state.selectedClub);
  $("#club-carry").textContent = club.name === "Putter" ? `${PUTTER_RANGE_FEET} ft range` : `${club.carry} yd carry`;
  $("#desktop-shot-lie").textContent = currentLieType();
  $("#aim-distance").textContent = state.target
    ? (putting ? displayDistance(distance(state.ball, state.target)) : "Set")
    : "—";
  const risk = shotRisk();
  $("#risk-copy").textContent = risk.copy;
  $("#desktop-shot-expected").textContent = putting
    ? `${Math.round(puttingMakeProbability(puttingFeet) * 100)}% make`
    : `${Math.round(expected)} yd carry`;
  $("#desktop-shot-risk").textContent = state.target ? `${risk.label} · ${risk.value}%` : "Set line";
  $("#desktop-plan-200").textContent = putting ? "—" : plannerMarkerDistance(remaining, 200);
  $("#desktop-power-readout").textContent = `${Math.round(state.swingPower * 100)}%`;
  $("#desktop-power-slider").value = String(Math.round(state.swingPower * 100));
  const score = state.scores[state.holeIndex];
  $("#hole-score").textContent = score == null ? (state.shots.length || "—") : score;
  const played = state.scores.map((s, i) => s == null ? 0 : s - state.scorecard[i].Par).reduce((a, b) => a + b, 0);
  $("#round-score").textContent = fmtScore(played);
  $("#header-score").textContent = fmtScore(played);
  $("#mobile-previous-hole").disabled = state.holeIndex === 0;
  $("#mobile-next-hole").disabled = state.holeIndex === 17;
  $("#mobile-previous-hole").setAttribute("aria-label", state.holeIndex === 0 ? "Previous hole unavailable" : `Go to hole ${state.holeIndex}`);
  $("#mobile-next-hole").setAttribute("aria-label", state.holeIndex === 17 ? "Next hole unavailable" : `Go to hole ${state.holeIndex + 2}`);
  $("#mobile-round-current strong").textContent = `Hole ${state.holeIndex + 1} of 18`;
  $("#mobile-round-current small").textContent = `Round ${fmtScore(played)} · open card`;
  $("#mobile-hole-label").textContent = `Hole ${state.holeIndex + 1}`;
  $("#mobile-hole-facts").textContent = `Par ${card().Par} · ${teeYards()} yd`;
  $("#mobile-score-chip").textContent = fmtScore(played);
  $("#mobile-plan-shot-label").textContent = `Shot ${state.shots.length + 1} planner`;
  $("#mobile-plan-pin").textContent = displayDistance(remaining);
  $("#mobile-plan-200").textContent = putting ? "—" : plannerMarkerDistance(remaining, 200);
  $("#mobile-plan-line").textContent = state.target ? displayDistance(distance(state.ball, state.target)) : "Tap map";
  $("#mobile-plan-copy").textContent = state.target
    ? "Target set on the map. Open the shot page when you are ready to choose club and swing."
    : "Tap the map to place the target line, then open the shot page to choose club and swing.";
  $("#mobile-shot-number").textContent = `Shot ${state.shots.length + 1}`;
  $("#mobile-sheet-distance").textContent = displayDistance(remaining);
  $("#mobile-sheet-distance-label").textContent = putting ? "to cup" : "remaining";
  $("#mobile-sheet-lie").textContent = currentLieType();
  $("#mobile-sheet-expected").textContent = putting
    ? `${Math.round(puttingMakeProbability(puttingFeet) * 100)}% make`
    : `${Math.round(expected)} yd carry`;
  $("#mobile-sheet-risk").textContent = state.target ? `${risk.label} · ${risk.value}%` : "Set line";
  $("#mobile-risk-copy").textContent = risk.copy;
  updateMobileCaddie();
  renderMobileGmHistory();
  $("#mobile-club-summary").textContent = club.name;
  $("#mobile-power-readout").textContent = `${Math.round(state.swingPower * 100)}%`;
  $("#mobile-power-slider").value = String(Math.round(state.swingPower * 100));
  const mobilePlayBlocked = state.holeFinished;
  $("#mobile-plan-next").disabled = false;
  $("#mobile-plan-next").setAttribute("aria-disabled", String(mobilePlayBlocked));
  syncMobileSheetUI();
  updateGmSuggestions();
}

function updateGmSuggestions() {
  const button = $("#gm-target-suggestion");
  const input = $("#gm-input");
  const help = $("#gm-command-help");
  const mobileInput = $("#mobile-gm-input");
  const mobileHelp = $("#mobile-gm-help");
  const viewMode = mapViewMode();
  const remaining = distance(state.ball, pin().center_point);
  const conditions = shotConditions();
  const stanceNote = conditions.stance !== "a fairly level stance" || conditions.slope !== "playing nearly level"
    ? ` Current adjustment: ${conditions.stance}; ${conditions.slope}.`
    : "";
  if (viewMode === "putting") {
    const read = puttingRead();
    button.textContent = "Aim at cup";
    button.dataset.gmSuggestion = "Aim at the pin";
    input.placeholder = `Aim at cup, optional lie adjustment`;
    help.innerHTML = `Aim at <strong>cup</strong> before play shot. Optional <strong>lie adjustment</strong>. Simulated break: <strong>${read.breakInches} in ${read.direction}</strong>.`;
    if (mobileInput) mobileInput.placeholder = `Aim ${read.breakInches} in ${read.startDirection} of cup`;
    if (mobileHelp) mobileHelp.textContent = `Examples: aim ${read.breakInches} in ${read.startDirection} of cup, ball below feet.`;
  } else if (remaining <= 210) {
    button.textContent = "Aim at pin";
    button.dataset.gmSuggestion = "Aim at the pin";
    input.placeholder = "Aim at pin, optional lie adjustment";
    help.innerHTML = `Aim at <strong>pin</strong> before play shot. Optional <strong>lie adjustment</strong>.${stanceNote}`;
    if (mobileInput) mobileInput.placeholder = "Aim at pin, ball below feet";
    if (mobileHelp) mobileHelp.textContent = `Examples: aim slightly right of cup, aim at pin, ball below feet.${stanceNote}`;
  } else {
    button.textContent = card().Par === 5 && remaining < teeYards() * .62 ? "Layup center" : "Fairway center";
    button.dataset.gmSuggestion = "Aim fairway center";
    input.placeholder = "Aim at target, optional lie adjustment";
    help.innerHTML = `Aim at <strong>target</strong> before play shot. Optional <strong>lie adjustment</strong>.${stanceNote}`;
    if (mobileInput) mobileInput.placeholder = "Fairway center, ball above feet";
    if (mobileHelp) mobileHelp.textContent = `Examples: fairway center, aim at pin, ball above feet.${stanceNote}`;
  }
}

function updateAll(redraw = true) {
  updateHoleBrief();
  updateProfileUI();
  updateShotDesk();
  renderGmConversation();
  updateFullscreenButton();
  if (redraw) renderMap();
}

function changeHole(index) {
  clearPendingAutoPlay();
  state.holeIndex = Math.max(0, Math.min(17, index));
  state.pinIndex = 2;
  resetHole();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetGame() {
  state.roundSeed = newRoundSeed();
  localStorage.removeItem(storageKey("scores"));
  localStorage.removeItem(storageKey("history"));
  localStorage.setItem(storageKey("round-seed"), String(state.roundSeed));
  state.holeIndex = 0;
  state.tee = "White";
  if (state.roundState) {
    state.roundState = resetRoundState(state.roundState, { roundSeed: state.roundSeed, tee: state.tee });
    persistRoundState();
    syncRoundStateCaches();
  }
  state.pinIndex = 2;
  state.selectedClub = 0;
  resetHole();
  updateAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderProfileDialog() {
  const profiles = [...builtInProfiles, ...state.customProfiles];
  $("#profile-list").innerHTML = profiles.map(profile => `
    <button type="button" class="profile-option ${profile.id === state.profile.id ? "selected" : ""}" data-profile="${profile.id}">
      <span class="profile-badge">${profile.id.startsWith("custom") ? "C" : profile.id[0]}</span>
      <span><strong>${profile.name}</strong><small>${profile.description || "Your custom club distances"}</small></span>
      <span class="profile-driver">${profile.clubs[0].carry} yd driver</span>
    </button>`).join("");
  $$(".profile-option").forEach(button => button.addEventListener("click", () => {
    state.profile = profiles.find(p => p.id === button.dataset.profile);
    state.selectedClub = 0;
    localStorage.setItem("middlesex-profile", state.profile.id);
    renderProfileDialog();
    updateAll();
  }));
}

function openCustomizer() {
  const clone = structuredClone(state.profile);
  const fullSwingClubs = clone.clubs.filter(club => club.name !== "Putter");
  const puttingRates = normalizePuttingMakeRates(clone);
  $("#custom-name").value = state.profile.id.startsWith("custom") ? state.profile.name : `${state.profile.name} custom`;
  $("#club-editor").innerHTML = fullSwingClubs.map((club, i) => `
    <div class="club-row" data-index="${i}">
      <strong>${club.name}</strong>
      <input data-profile-field="carry" type="number" inputmode="numeric" min="5" max="350" step="1" value="${club.carry}" aria-label="${club.name} carry yards" required>
      <div class="percent-field">
        <input data-profile-field="accuracy" type="number" inputmode="numeric" min="0" max="100" step="1" value="${club.accuracy}" aria-label="${club.name} accuracy percentage" required>
        <span aria-hidden="true">%</span>
      </div>
    </div>`).join("");
  $$('[data-putting-distance]').forEach(input => {
    input.value = puttingRates[input.dataset.puttingDistance];
  });
  $("#profile-dialog").close();
  $("#custom-dialog").showModal();
}

function saveCustomProfile(event) {
  event.preventDefault();
  const fullSwingClubs = state.profile.clubs.filter(club => club.name !== "Putter");
  const clubs = $$(".club-row").map((row, i) => ({
    name: fullSwingClubs[i].name,
    carry: Number(row.querySelector('[data-profile-field="carry"]').value),
    accuracy: Number(row.querySelector('[data-profile-field="accuracy"]').value)
  }));
  clubs.push({ name: "Putter", carry: PUTTER_RANGE_FEET / 3, accuracy: 100 });
  const puttingMakeRates = Object.fromEntries($$('[data-putting-distance]').map(input => [
    Number(input.dataset.puttingDistance),
    Number(input.value)
  ]));
  const profile = normalizeProfile({
    id: `custom-${Date.now()}`,
    name: $("#custom-name").value.trim(),
    description: `Based on ${state.profile.name}`,
    puttingMakeRates,
    clubs
  });
  state.customProfiles.push(profile);
  state.profile = profile;
  state.selectedClub = 0;
  localStorage.setItem("middlesex-custom-profiles", JSON.stringify(state.customProfiles));
  localStorage.setItem("middlesex-profile", profile.id);
  $("#custom-dialog").close();
  renderProfileDialog();
  updateAll();
}

function renderScorecard() {
  const front = state.scorecard.slice(0, 9), back = state.scorecard.slice(9);
  const row = (label, data, value, totalClass = "") =>
    `<tr><th>${label}</th>${data.map((x, i) => `<td>${value(x, i)}</td>`).join("")}<td class="total ${totalClass}">${data.reduce((sum, x, i) => sum + (Number(value(x, i)) || 0), 0)}</td></tr>`;
  const section = (data, offset, label) => `
    <table class="score-table">
      <thead><tr><th>${label}</th>${data.map(x => `<th>${x.Hole}</th>`).join("")}<th class="total">${label === "Out" ? "OUT" : "IN"}</th></tr></thead>
      <tbody>
        ${row("Par", data, x => x.Par)}
        ${row("Yards", data, x => x[`Yards_${state.tee}`])}
        ${row("Score", data, (_, i) => state.scores[i + offset] ?? "—")}
      </tbody>
    </table>`;
  $("#scorecard-grid").innerHTML = section(front, 0, "Out") + section(back, 9, "In");
}

function openRoundReview() {
  const shots = state.roundHistory.flat();
  const decisionGood = shots.filter(shot => decisionQualityFromAssessment(packetAssessment(shot), shot.quality) === "good").length;
  const executionGood = shots.filter(shot => executionQualityFromAssessment(packetAssessment(shot), shot.quality) === "good").length;
  const strategyAnalysis = analyzeRoundStrategy(state.roundHistory);
  const playedScore = state.scores.reduce((sum, score, index) => score == null ? sum : sum + score - state.scorecard[index].Par, 0);
  const strength = strategyAnalysis ? formatStrategyCategory(strategyAnalysis.top_strength) : "No pattern yet";
  const priority = strategyAnalysis ? formatStrategyCategory(strategyAnalysis.top_priority) : "No pattern yet";
  const keyMomentCount = strategyAnalysis?.top_costly_decisions.length ?? 0;
  const verdict = strategyAnalysis
    ? `Your deterministic strategy score was ${strategyAnalysis.strategy_score}. ${strength} was the strongest category; ${priority} is the first priority. ${strategyAnalysis.pattern_summary}`
    : shots.length
      ? "This saved round predates strategy packets, so its shots remain visible but are not assigned a strategy score."
    : "Play a new shot to begin your caddie report. Rounds completed before shot tracking do not contain enough detail for coaching.";

  $("#round-review-summary").innerHTML = `
    <section class="review-verdict">
      <span class="eyebrow">Game Master verdict</span>
      <p>${verdict}</p>
    </section>
    <div class="review-stat review-score"><span>Round</span><strong>${fmtScore(playedScore)}</strong></div>
    <div class="review-stat"><span>Strategy score</span><strong>${strategyAnalysis?.strategy_score ?? "—"}</strong><small>${strategyAnalysis ? `${strategyAnalysis.scored_shots} scored decisions` : "No strategy packets yet"}</small></div>
    <div class="review-stat"><span>Decision quality</span><strong>${shots.length ? `${Math.round(decisionGood / shots.length * 100)}%` : "—"}</strong><small>${decisionGood} sound choices</small></div>
    <div class="review-stat"><span>Execution quality</span><strong>${shots.length ? `${Math.round(executionGood / shots.length * 100)}%` : "—"}</strong><small>${executionGood} shots on plan</small></div>
    <div class="review-stat review-focus"><span>Practice next</span><strong>${priority}</strong><small>${keyMomentCount} key decision ${keyMomentCount === 1 ? "moment" : "moments"}</small></div>`;

  const priorityHoles = strategyAnalysis
    ? [...strategyAnalysis.holes]
      .sort((a, b) => a.strategy_score - b.strategy_score || a.hole_number - b.hole_number)
      .slice(0, 3)
      .map(item => item.hole_number - 1)
    : [];

  $("#round-review-list").innerHTML = shots.length ? state.roundHistory.map((holeShots, index) => {
    if (!holeShots.length) return "";
    const score = state.scores[index];
    const relative = score == null ? "Incomplete" : golfScoreName(score - state.scorecard[index].Par);
    const reviews = holeShots.filter(shot =>
      overallQualityFromAssessment(packetAssessment(shot), shot.quality) === "bad" ||
      decisionQualityFromAssessment(packetAssessment(shot), shot.quality) === "review" ||
      executionQualityFromAssessment(packetAssessment(shot), shot.quality) === "review"
    ).length;
    return `<details class="review-hole" ${priorityHoles.includes(index) ? "open" : ""}>
      <summary><span><strong>Hole ${index + 1}</strong><small>${score ?? "—"} strokes · ${relative}</small></span><span class="hole-review-count">${reviews ? `${reviews} to review` : "Clean hole"}</span></summary>
      ${holeShots.map((shot, shotIndex) => {
        const assessment = packetAssessment(shot);
        const quality = overallQualityFromAssessment(assessment, shot.quality);
        const decisionQuality = decisionQualityFromAssessment(assessment, shot.quality);
        const executionQuality = executionQualityFromAssessment(assessment, shot.quality);
        const strategy = strategySummary(shot);
        return `<div class="review-shot ${quality}">
        <div class="shot-verdict"><b>Shot ${shotIndex + 1}</b><strong>${shot.club} · ${shot.power}%</strong></div>
        <div class="shot-judgments">
          <span class="${decisionQuality}">Decision <b>${decisionQuality === "good" ? "Sound" : "Review"}</b></span>
          <span class="${executionQuality}">Execution <b>${executionQuality === "good" ? "On plan" : "Missed"}</b></span>
        </div>
        ${strategy ? `<div class="shot-strategy">
          <span class="strategy-score ${strategy.label}">Strategy <b>${strategy.score}</b></span>
          ${strategy.isPutt
            ? `<span class="strategy-miss">Plan <b>${formatStrategyCategory(strategy.shotType)}</b></span>`
            : `<span class="strategy-miss">Preferred miss <b>${strategy.preferredMiss}${strategy.preferredMissInferred ? " (Inferred)" : ""}</b></span>`}
        </div>` : ""}
        ${shot.puttAnalysis
          ? `<div class="shot-path"><span>${shot.puttAnalysis.playerRead} · ${shot.puttAnalysis.playerPace}%</span><i>→</i><strong>Ideal ${shot.puttAnalysis.recommendedRead} · ${shot.puttAnalysis.recommendedPace}%</strong></div>`
          : `<div class="shot-path"><span>${shot.intendedLie || "Target"}</span><i>→</i><strong>${shot.lie}</strong></div>`}
        ${strategy?.reasons?.length ? `<div class="shot-reasons">${strategy.reasons.map(reason => `<span>${reason}</span>`).join("")}</div>` : ""}
        <p>${shot.lesson}</p>
      </div>`;
      }).join("")}
      <button class="replay-hole-button" type="button" data-replay-hole="${index}">Reset & replay Hole ${index + 1}</button>
    </details>`;
  }).join("") : `<div class="review-shot"><p>No shot history has been recorded for this round yet. Play a new shot to begin the learning report. Scores from rounds played before this feature do not contain shot details.</p></div>`;
  $("#round-review-list").insertAdjacentHTML("beforeend", `<div class="review-actions"><button class="secondary-action" type="button" data-review-scorecard>View scorecard</button><button class="secondary-action" type="button" data-review-new-round>Start new round</button><button class="primary-action" type="button" data-review-back>Back to game</button></div>`);
  $$('[data-replay-hole]').forEach(button => button.addEventListener("click", () => {
    const holeIndex = Number(button.dataset.replayHole);
    const confirmed = window.confirm(`Reset Hole ${holeIndex + 1}? This will clear its score and shot history before replaying it.`);
    if (!confirmed) return;
    $("#round-review-dialog").close();
    if (state.roundState) {
      state.roundState = replaceHoleEvents(state.roundState, holeIndex, []);
      persistRoundState();
      syncRoundStateCaches();
    }
    changeHole(holeIndex);
  }));
  $("[data-review-scorecard]").addEventListener("click", () => {
    $("#round-review-dialog").close();
    renderScorecard();
    $("#scorecard-dialog").showModal();
  });
  $("[data-review-new-round]").addEventListener("click", () => {
    $("#round-review-dialog").close();
    $("#reset-game-dialog").showModal();
  });
  $("[data-review-back]").addEventListener("click", () => {
    $("#round-review-dialog").close();
  });
  void requestAiRoundReview();
  $("#round-review-dialog").showModal();
}

function bindEvents() {
  $("#course-select").addEventListener("change", async event => {
    const nextCourse = event.target.value;
    if (nextCourse === state.courseId) return;
    const hasActiveRound = state.scores.some(score => score != null) || state.shots.length > 0;
    if (hasActiveRound && !window.confirm(`Switch to ${courseCatalog[nextCourse].name}? Your current course progress will be saved.`)) {
      event.target.value = state.courseId;
      return;
    }
    await loadData(nextCourse);
    localStorage.setItem("golfgame-course", nextCourse);
    state.holeIndex = 0;
    state.pinIndex = 2;
    resetHole();
  });
  $$(".tee-switch button").forEach(button => button.addEventListener("click", () => {
    state.tee = button.dataset.tee;
    if (state.roundState) {
      state.roundState = { ...state.roundState, tee: state.tee };
      persistRoundState();
    }
    resetHole();
  }));
  $("#pin-select").addEventListener("change", event => {
    state.pinIndex = Number(event.target.value);
    state.target = null;
    state.shotDraft.target = false;
    updateAll();
  });
  $("#club-select").addEventListener("change", event => {
    setSelectedClub(event.target.value);
  });
  $("#mobile-plan-next").addEventListener("click", openMobileShotSetup);
  $("#mobile-back-to-map").addEventListener("click", returnToMobileMap);
  $("#mobile-sheet-handle").addEventListener("click", onMobileSheetClick);
  $("#mobile-sheet-handle").addEventListener("pointerdown", onMobileSheetPointerDown);
  $("#mobile-sheet-handle").addEventListener("pointerup", onMobileSheetPointerUp);
  $("#desktop-power-slider").addEventListener("input", event => {
    setSwingPowerFromMobile(event.target.value);
  });
  $("#mobile-power-slider").addEventListener("input", event => {
    setSwingPowerFromMobile(event.target.value);
  });
  $("#mobile-gm-form").addEventListener("submit", event => {
    event.preventDefault();
    ensureAudio();
    acceptCurrentShotSetup();
    const input = $("#mobile-gm-input");
    const text = input.value.trim();
    if (!text) {
      playCurrentShotFromMobile();
      return;
    }
    input.value = "";
    interpretGmInstruction(text);
    setMobileSheetState("full");
  });
  $("#mobile-scorecard-chip").addEventListener("click", () => {
    renderScorecard();
    $("#scorecard-dialog").showModal();
  });
  $("#mobile-scorecard-button").addEventListener("click", () => {
    renderScorecard();
    $("#scorecard-dialog").showModal();
  });
  $("#mobile-review-button").addEventListener("click", openRoundReview);
  $("#reset-view").addEventListener("click", resetCurrentHole);
  $("#enlarge-green").addEventListener("click", openEnlargedGreen);
  $("#close-enlarged-green").addEventListener("click", closeEnlargedGreen);
  $$('[data-nudge]').forEach(button => button.addEventListener("click", () => {
    const [x, y] = button.dataset.nudge.split(",").map(Number);
    nudgeTarget(x, y);
  }));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.greenEnlarged) closeEnlargedGreen();
  });
  window.addEventListener("pointermove", onTargetPointerMove, { passive: false });
  window.addEventListener("pointerup", onTargetPointerUp);
  window.addEventListener("pointercancel", onTargetPointerUp);
  $("#previous-hole").addEventListener("click", () => changeHole(state.holeIndex - 1));
  $("#next-hole").addEventListener("click", () => changeHole(state.holeIndex + 1));
  $("#mobile-previous-hole").addEventListener("click", () => changeHole(state.holeIndex - 1));
  $("#mobile-next-hole").addEventListener("click", () => changeHole(state.holeIndex + 1));
  $("#mobile-round-current").addEventListener("click", () => {
    renderRoundNavigation();
    $("#round-nav-dialog").showModal();
  });
  document.addEventListener("click", event => {
    const button = event.target.closest("[data-round-hole]");
    if (!button) return;
    if ($("#round-nav-dialog").open) $("#round-nav-dialog").close();
    changeHole(Number(button.dataset.roundHole));
  });
  $("#fullscreen-button").addEventListener("click", () => {
    toggleFullscreen().catch(error => console.error("Fullscreen toggle failed", error));
  });
  document.addEventListener("fullscreenchange", updateFullscreenButton);
  document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
  $("#profile-button").addEventListener("click", () => { renderProfileDialog(); $("#profile-dialog").showModal(); });
  $("#customize-profile").addEventListener("click", openCustomizer);
  $("#custom-form").addEventListener("submit", saveCustomProfile);
  $$("[data-close-custom]").forEach(button => button.addEventListener("click", () => $("#custom-dialog").close()));
  $("#scorecard-button").addEventListener("click", () => { renderScorecard(); $("#scorecard-dialog").showModal(); });
  $$('[data-reference-image]').forEach(button => button.addEventListener("click", () => {
    $("#reference-image-title").textContent = `${state.course.shortName} · Hole ${state.holeIndex + 1}`;
    $("#reference-hole-image").src = `${state.course.imagePath}/hole${state.holeIndex + 1}.png?v=${state.course.dataVersion}`;
    $("#reference-image-dialog").showModal();
  }));
  $("#round-review-button").addEventListener("click", openRoundReview);
  $("#reset-game-button").addEventListener("click", () => $("#reset-game-dialog").showModal());
  $("#declare-unplayable").addEventListener("click", declareLastShotUnplayable);
  $("#reset-game-dialog").addEventListener("close", () => {
    if ($("#reset-game-dialog").returnValue === "confirm") resetGame();
  });
  $("#hole-complete-dialog").addEventListener("close", () => {
    const dialog = $("#hole-complete-dialog");
    if (dialog.returnValue !== "next") return;
    if (state.holeIndex < 17) changeHole(state.holeIndex + 1);
    else openRoundReview();
  });
  $("#gm-form").addEventListener("submit", event => {
    event.preventDefault();
    ensureAudio();
    acceptCurrentShotSetup();
    const input = $("#gm-input");
    const suggestion = spellingSuggestion(input.value);
    if (suggestion) {
      input.value = suggestion;
      const hint = $("#gm-spell-hint");
      hint.hidden = false;
      hint.dataset.suggestion = "";
      hint.textContent = "Spelling corrected. Review the instruction, then press Play shot again.";
      input.focus();
      return;
    }
    const text = input.value.trim();
    if (!text) {
      playCurrentShotFromMobile();
      return;
    }
    input.value = "";
    interpretGmInstruction(text);
  });
  $("#gm-input").addEventListener("input", updateSpellingHint);
  $("#gm-spell-hint").addEventListener("click", event => {
    const suggestion = event.currentTarget.dataset.suggestion;
    if (!suggestion) return;
    $("#gm-input").value = suggestion;
    event.currentTarget.hidden = true;
    $("#gm-input").focus();
  });
  $$("[data-gm-suggestion]").forEach(button => button.addEventListener("click", () => {
    ensureAudio();
    interpretGmInstruction(button.dataset.gmSuggestion);
  }));
}

async function init() {
  try {
    await loadData();
    resetHole();
    bindEvents();
    updateAll();
    $("#app").hidden = false;
    $("#loading").style.opacity = 0;
    setTimeout(() => $("#loading").remove(), 500);
  } catch (error) {
    $("#loading").innerHTML = `<div class="loading-mark">!</div><p>Course data could not be loaded.<br>Run this app through a local web server.</p>`;
    console.error(error);
  }
}

export { normalizeProfile, puttingMakeProbability };

init();
