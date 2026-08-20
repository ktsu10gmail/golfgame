import {
  declareUnplayable as resolveUnplayableRelief,
  segmentPolygonEntryProgress,
  simulateFullShot
} from "./packages/simulation/browser_engine.mjs?v=20260815-4";
import { scorePuttStrategy, scoreStrategy } from "./packages/simulation/browser_decision_scoring.mjs?v=20260729-2";
import { simulateGreensideShot } from "./packages/simulation/browser_greenside.mjs?v=20260816-3";
import { analyzeRoundStrategy } from "./packages/simulation/browser_round_analysis.mjs?v=20260729-1";
import { simulatePutt } from "./packages/simulation/browser_putting.mjs?v=20260820-6";
import {
  buildGreenCaddieRead,
  greenPlayerViewYawDegrees,
  greenQuarterTurnYawDegrees
} from "./packages/simulation/browser_green_caddie_read.mjs?v=20260815-2";
import { parsePuttAimInstruction } from "./packages/simulation/browser_putt_command.mjs?v=20260807-1";
import { parseShotTargetInstruction } from "./packages/simulation/browser_shot_command.mjs?v=20260816-1";
import { expandSandHazards, sandHazardScaleForCourse } from "./packages/simulation/browser_course_geometry.mjs?v=20260810-2";
import { ensureHazardFreePinZones, generatedGreenHole } from "./packages/simulation/browser_green_generator.mjs?v=20260810-2";
import { projectPuttPath, puttMotionTiming, puttRollDurationMs } from "./packages/simulation/browser_putt_animation.mjs?v=20260808-3";
import {
  closestProjectedPolygonPoint,
  enlargedGreenFocusBounds,
  projectedPairCenterOffset
} from "./packages/simulation/browser_green_relief_interaction.mjs?v=20260815-3";
import {
  closestProjectedTerrainPoint,
  createHoleTerrainProjection,
  fullShotAnimationDurationMs,
  projectedBallFlight
} from "./packages/simulation/browser_hole_terrain.mjs?v=20260820-4";
import {
  contourPuttStrength,
  contourPuttRead,
  greenElevationColor,
  greenContourTransform,
  sampleCourseGreenContour
} from "./packages/simulation/browser_green_contour.mjs?v=20260807-5";
import { analyzeSidehillShot } from "./packages/simulation/browser_sidehill.mjs?v=20260729-1";
import { gradeAdjustmentReward } from "./packages/simulation/browser_adjustment_reward.mjs?v=20260809-1";
import { buildStrategyChoices } from "./packages/simulation/browser_strategy_choices.mjs?v=20260816-24";
import { evaluateTreeCondition, treeConditionMessage } from "./packages/simulation/browser_tree_conditions.mjs?v=20260817-1";
import {
  evaluateShotCandidates,
  stableAnalysisSeed
} from "./packages/simulation/browser_multi_run_evaluator.mjs?v=20260811-2";
import {
  CompetitionPhase,
  ParticipantType,
  appendStrategistResult,
  competitionRoundSummary,
  competitionTotals,
  continueCompetition,
  createCompetitionRound,
  expectedScoreCost,
  loadCompetition,
  lockCompetitionDecision,
  markGameMasterDeciding,
  recoverInterruptedCompetition,
  resolveCompetitionTurn,
  recordCompetitionHoleSummary,
  saveCompetition,
  selectSmartExpectedScore,
  strategistHoleState,
  validateSameGameplayProfile
} from "./packages/simulation/competition.mjs?v=20260820-2";
import {
  appendHoleEvent,
  buildHoleBrowserState,
  buildRoundBrowserState,
  classifyShotCompletion,
  createRoundState,
  loadRoundState,
  migrateLegacyRoundStateStorage,
  replaceHoleEvents,
  resetRoundState,
  saveRoundState
} from "./packages/simulation/round_state.mjs?v=20260804-2";
import {
  createRoundSave,
  parseRoundSave,
  roundSaveFilename
} from "./packages/simulation/round_save.mjs?v=20260730-1";
import { createSupabaseAuth } from "./packages/accounts/browser_supabase_auth.mjs?v=20260804-1";
import { personalizeCustomProfile, playerProfileName } from "./packages/accounts/browser_profile_naming.mjs?v=20260804-1";
import { createUniformMapProjector, imageViewportForWorldBounds } from "./packages/editor/map_projection.mjs?v=20260812-1";
import {
  coursePointToGps as gpsCoursePointToGps,
  completeGpsHole,
  createGpsRoundId,
  createGpsRound,
  firstUnfinishedGpsHoleIndex,
  gpsDistanceYards,
  gpsHoleReview,
  gpsHoleScore,
  gpsRoundComplete,
  gpsRoundScore,
  gpsToCoursePoint,
  latestCompletedGpsHoleIndex,
  manualGpsStrategy,
  normalizeGpsBallConditions,
  recommendGpsClub,
  undoGpsHoleAction
} from "./packages/gps/browser_gps_mode.mjs?v=20260817-5";

const METERS_TO_YARDS = 1.09361;
const PUTTER_RANGE_FEET = 60;
const AI_REQUEST_TIMEOUT_MS = 65000;
const SHOW_GEOMETRY_DEBUG = new URLSearchParams(window.location.search).get("debugGeometry") === "1";
let authConfig = { provider: "local" };
let supabaseAuth = null;
let authRecoveryMode = false;

function bounded(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value)));
}

const FULL_SWING_LEVELS = [.25, .5, .75, 1];

function nearestSwingPower(value) {
  return FULL_SWING_LEVELS.reduce((nearest, level) =>
    Math.abs(level - value) < Math.abs(nearest - value) ? level : nearest
  );
}

function swingLengthLabel(power) {
  return ({ 25: "¼ swing", 50: "½ swing", 75: "¾ swing", 100: "Full swing" })[Math.round(Number(power) * 100)] || "Full swing";
}

function shotPowerLabel(powerPercent, clubName = "") {
  return clubName === "Putter" ? `${Math.round(powerPercent)}% pace` : swingLengthLabel(Number(powerPercent) / 100);
}

function finePaceControl() {
  return currentClub()?.name === "Putter" && currentLieType() === "Green";
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
    dataPath: "data/themeadow", imagePath: "data/themeadow/images", dataVersion: "20260720-aerial-v2", mapUpdatedAt: "2026-07-20", scorecard: "scorecard.csv", holeFile: number => `hole${number}.json`, images: true
  },
  warrenbrook: {
    id: "warrenbrook", name: "Warrenbrook Golf Course", shortName: "Warrenbrook",
    dataPath: "data/warrenbrook", imagePath: "data/warrenbrook/images", dataVersion: "20260720-aerial-v2", mapUpdatedAt: "2026-07-20", scorecard: "scorecard.csv", holeFile: number => `hole${number}.json`, images: true
  },
  gallopinghills: {
    id: "gallopinghills", name: "Galloping Hill Golf Course", shortName: "Galloping Hill",
    dataPath: "data/gallopinghills", imagePath: "data/gallopinghills/images", dataVersion: "20260729-aerial-v1", mapUpdatedAt: "2026-07-29", scorecard: "scorecard.csv", holeFile: number => `hole${number}.json`, images: true,
    teeLabels: { Blue: "Blue", White: "White", Red: "Gold" }
  }
};

const legacyCourseReplacements = {
  meadows: "the-meadow-at-middlesex-golf-course",
  warrenbrook: "the-warrenbrook-golf-course",
  cranbury: "cranbury-golf-club",
  gallopinghills: "galloping-hills-golf-course",
  "galloping-hills-golf-coourse": "galloping-hills-golf-course"
};
const retiredCourseIds = new Set(["gallopinghills"]);

function preferredCourseId(courseId) {
  const replacement = legacyCourseReplacements[courseId];
  if (replacement && courseCatalog[replacement]) return replacement;
  if (retiredCourseIds.has(courseId)) {
    return courseCatalog["the-meadow-at-middlesex-golf-course"]
      ? "the-meadow-at-middlesex-golf-course"
      : "meadows";
  }
  return courseId;
}

function visibleCourses() {
  return Object.values(courseCatalog).filter(course => preferredCourseId(course.id) === course.id);
}

function courseIllustrationPath() {
  const course = courseCatalog[state.courseId];
  if (course?.illustrations && course.illustrationPath) {
    const extension = course.illustrationExtension || "jpg";
    return `${course.illustrationPath}/hole${state.holeIndex + 1}.${extension}?v=${encodeURIComponent(course.dataVersion)}`;
  }
  return null;
}

async function loadMappedCourseCatalog() {
  try {
    const response = await fetch("data/mapped_courses.json", { cache: "no-store" });
    if (!response.ok) return;
    const mappedCourses = await response.json();
    if (!Array.isArray(mappedCourses)) return;
    for (const mapped of mappedCourses) {
      if (
        !mapped ||
        !/^[a-z0-9][a-z0-9-]{0,62}$/.test(mapped.id) ||
        typeof mapped.name !== "string" ||
        typeof mapped.dataPath !== "string"
      ) {
        continue;
      }
      courseCatalog[mapped.id] = {
        id: mapped.id,
        name: mapped.name,
        shortName: mapped.shortName || mapped.name,
        dataPath: mapped.dataPath,
        imagePath: mapped.imagePath || "",
        dataVersion: mapped.dataVersion || "mapped-v1",
        scorecard: mapped.scorecard || "scorecard.csv",
        holeFile: number => `hole${number}.json`,
        images: mapped.images === true,
        illustrations: mapped.illustrations === true,
        illustrationPath: mapped.illustrationPath || "",
        illustrationExtension: mapped.illustrationExtension || "jpg",
        isCustomMap: true,
        mapUpdatedAt: mapped.mapUpdatedAt || mapped.dataVersion,
        teeLabels: mapped.teeLabels || { Blue: "Blue", White: "White", Red: "Forward" }
      };
    }
    $("#course-select").innerHTML = visibleCourses()
      .map(course => `<option value="${course.id}">${escapeHtml(course.name)}</option>`)
      .join("");
  } catch (error) {
    console.warn("Mapped course catalog could not be loaded.", error);
  }
}

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
  player: null,
  playerLearning: null,
  feedbackData: { rating: null, items: [], unread_count: 0 },
  feedbackTab: "send",
  feedbackRatingDraft: 0,
  onCourseClubStats: null,
  onCourseClubStatsLoading: false,
  onCourseClubStatsError: "",
  courseId: new URLSearchParams(window.location.search).get("course") || "meadows",
  course: null,
  holes: [],
  scorecard: [],
  holeIndex: bounded((Number(new URLSearchParams(window.location.search).get("hole")) || 1) - 1, 0, 17),
  tee: "White",
  pinIndex: 0,
  profile: null,
  customProfiles: [],
  selectedClub: 0,
  ball: null,
  currentLie: "Tee",
  target: null,
  manualTargetPreview: false,
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
  greenZoom: 1,
  greenViewMode: "top",
  greenViewYaw: -18,
  greenViewTilt: 52,
  greenCaddieRead: null,
  puttAnimation: null,
  terrainViewYaw: 0,
  terrainViewTilt: 50,
  flightAnimation: null,
  swingPower: 1,
  shotDraft: { club: false, target: false, power: false },
  structuredShot: { aim: "", adjustment: "none", offset: 1, selectedTarget: null },
  pendingPlayerInstructions: [],
  pendingPlayerNote: "",
  gmVoiceEnabled: false,
  strategySelectedId: null,
  desktopCaddieExpanded: false,
  mobileSheetState: "carousel",
  mobileQuickPanel: null,
  liveGpsView: false,
  liveGpsRound: null,
  liveGpsFollowHole: true,
  liveGpsLoading: false,
  liveGpsLastRefresh: null,
  liveGpsStatus: "Choose On Course Live to load your GPS round.",
  gpsPageView: "actual",
  gpsCaddieExpanded: false,
  livePanelDock: ["top", "bottom"].includes(localStorage.getItem("golf-live-panel-dock"))
    ? localStorage.getItem("golf-live-panel-dock")
    : "bottom",
  livePanelPosition: localStorage.getItem("golf-live-panel-position"),
  livePanelCollapsed: localStorage.getItem("golf-live-panel-collapsed") === "true",
  mobileMapPlanTop: null,
  mobileCarouselPage: 0,
  competition: null,
  competitionPendingTurn: null,
  competitionComparisonOpen: false,
  competitionComparisonTurnId: null,
  competitionBusy: false,
  competitionPlayback: null,
  competitionRecoveryMessage: null,
  mobileCarouselDock: ["top", "bottom"].includes(localStorage.getItem("golf-mobile-carousel-dock"))
    ? localStorage.getItem("golf-mobile-carousel-dock")
    : "bottom"
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
let gpsRound = null;
let gpsSyncTimer = null;
let gpsSyncPromise = Promise.resolve();
let gpsCompletingRound = false;
let gpsSyncDisplay = { text: "On phone", tone: "local" };
const gpsHoleAiCache = new Map();
const gpsHoleAiPending = new Map();
let liveGpsPollTimer = null;
let livePanelDrag = null;
let greenAimPanelDrag = null;
let pendingAutoPlayHandle = null;
let gmShotUpdateSequence = 0;
let mobileMapPlanDrag = null;
let mobileCarouselSwipe = null;
let mobileCarouselWheelUntil = 0;
let mobileShotToastHandle = null;
let mapViewportResizeFrame = null;
let lastMapViewportWidth = window.innerWidth;

const MOBILE_CAROUSEL_SECTIONS = ["plan", "game-master", "club-power", "caddie", "adjustment"];
const MOBILE_CAROUSEL_DOCKS = ["top", "bottom"];
const LIVE_GPS_POLL_MS = 5000;

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

function withoutParThreeFairway(holeData, par = holeData?.hole_metadata?.par) {
  if (Number(par) === 3 && holeData?.geometries) holeData.geometries.fairway_segments = [];
  return holeData;
}

function playerStorageKey(type) {
  return state.player ? `golfgame-player-${state.player.id}-${type}` : `golfgame-${type}`;
}

function storageKey(type) { return playerStorageKey(`${state.courseId}-${type}`); }
function profileStorageKey() { return playerStorageKey("profile"); }
function customProfilesStorageKey() { return playerStorageKey("custom-profiles"); }

let roundSyncTimer = null;
let roundSyncPromise = Promise.resolve();

function setAccountSyncStatus(title, message, tone = "saved") {
  const card = document.querySelector(".account-sync-card");
  if (card) card.dataset.tone = tone;
  const titleNode = $("#account-sync-title");
  const statusNode = $("#account-sync-status");
  if (titleNode) titleNode.textContent = title;
  if (statusNode) statusNode.textContent = message;
}

function currentRoundSave() {
  if (!state.roundState || !state.profile) return null;
  return createRoundSave({
    roundState: state.roundState,
    currentHoleIndex: state.holeIndex,
    pinIndex: state.pinIndex,
    playerProfile: state.profile,
    roundSummary: currentRoundSummary()
  });
}

function currentRoundSummary() {
  const completedIndexes = state.scores
    .map((score, index) => Number.isInteger(score) ? index : null)
    .filter(index => index != null);
  const totalStrokes = completedIndexes.reduce((sum, index) => sum + state.scores[index], 0);
  const totalPar = completedIndexes.reduce((sum, index) => sum + (state.scorecard[index]?.Par || 0), 0);
  const analysis = analyzeRoundStrategy(state.roundHistory);
  return {
    course_name: state.course?.name || state.courseId,
    tee: state.tee,
    holes_completed: completedIndexes.length,
    total_strokes: totalStrokes,
    total_par: totalPar,
    score_to_par: totalStrokes - totalPar,
    strategy_score: analysis?.strategy_score ?? null,
    execution_score: analysis?.execution_score ?? null,
    scored_shots: analysis?.scored_shots ?? null
  };
}

async function syncPlayerRound() {
  const round = currentRoundSave();
  if (!state.player || !round) return;
  setAccountSyncStatus("Saving round…", "Keeping this hole ready on your other devices.", "saving");
  const result = await playerApi("/api/player/active-round", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ round })
  });
  setAccountSyncStatus(
    result.complete ? "Round complete" : "Round saved",
    result.complete
      ? "This finished round will not replace your next unfinished round."
      : `${state.course?.shortName || "This course"}, hole ${state.holeIndex + 1}, is ready to resume.`
  );
  if (result.newly_archived) await restorePlayerLearning();
}

function schedulePlayerRoundSync(delay = 250) {
  if (!state.player) return;
  window.clearTimeout(roundSyncTimer);
  roundSyncTimer = window.setTimeout(() => {
    roundSyncPromise = roundSyncPromise
      .catch(() => {})
      .then(syncPlayerRound)
      .catch(error => {
        console.error("Could not sync player round", error);
        setAccountSyncStatus("Saved on this device", "The server could not be reached. Your browser copy is still safe.", "error");
      });
  }, delay);
}

function persistLegacyRound() {
  localStorage.setItem(storageKey("history"), JSON.stringify(state.roundHistory));
  localStorage.setItem(storageKey("scores"), JSON.stringify(state.scores));
}

function persistRoundState() {
  if (!state.roundState) return null;
  if (state.competition) {
    state.competition.human_round = structuredClone(state.roundState);
    saveCompetition(localStorage, state.competition, state.player?.id);
    return state.roundState;
  }
  state.roundState = saveRoundState(localStorage, state.roundState, state.player?.id);
  schedulePlayerRoundSync();
  return state.roundState;
}

function roundHasProgress(roundState) {
  return Boolean(roundState?.holes?.some(hole => hole.events.length > 0 || hole.score != null));
}

function setRoundFileStatus(message, tone = "neutral") {
  const status = $("#round-file-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function downloadRoundFile(file, filename) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportRoundFile() {
  if (!state.roundState || !state.profile) {
    setRoundFileStatus("The round is not ready to save yet.", "error");
    return;
  }
  const portableSave = createRoundSave({
    roundState: state.roundState,
    currentHoleIndex: state.holeIndex,
    pinIndex: state.pinIndex,
    playerProfile: state.profile,
    roundSummary: currentRoundSummary()
  });
  const filename = roundSaveFilename(portableSave);
  const file = new File(
    [JSON.stringify(portableSave, null, 2)],
    filename,
    { type: "application/json" }
  );
  const touchDevice = navigator.maxTouchPoints > 0;
  if (touchDevice && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: "Save golf round",
        text: `${state.course.shortName}, Hole ${state.holeIndex + 1}`
      });
      setRoundFileStatus("Round file shared. Keep it in Files or cloud storage.", "success");
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        setRoundFileStatus("Save canceled. Your in-browser round is unchanged.");
        return;
      }
      console.warn("Round sharing was unavailable; using a download instead.", error);
    }
  }
  downloadRoundFile(file, filename);
  setRoundFileStatus(`Saved ${filename} to your downloads.`, "success");
}

function storeImportedProfile(profile) {
  const builtIn = builtInProfiles.find(candidate => candidate.id === profile.id);
  if (builtIn) return builtIn.id;
  const imported = personalizeCustomProfile(
    normalizeProfile(structuredClone(profile)),
    state.player?.name
  );
  const profiles = JSON.parse(localStorage.getItem(customProfilesStorageKey()) || "[]");
  const existingIndex = profiles.findIndex(candidate => candidate.id === imported.id);
  if (existingIndex >= 0) profiles[existingIndex] = imported;
  else profiles.push(imported);
  localStorage.setItem(customProfilesStorageKey(), JSON.stringify(profiles));
  return imported.id;
}

async function importRoundFile(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    setRoundFileStatus("That file is too large to be a round save.", "error");
    return;
  }
  try {
    const portableSave = parseRoundSave(await file.text());
    if (!courseCatalog[portableSave.course_id]) {
      throw new Error(`course “${portableSave.course_id}” is not installed`);
    }
    const existingRound = loadRoundState(localStorage, portableSave.course_id, state.player?.id);
    if (
      roundHasProgress(existingRound) &&
      !window.confirm(
        `Load this ${courseCatalog[portableSave.course_id].shortName} round? ` +
        "It will replace the saved round for that course on this device."
      )
    ) {
      setRoundFileStatus("Load canceled. Your current round is unchanged.");
      return;
    }

    const profileId = storeImportedProfile(portableSave.player_profile);
    saveRoundState(localStorage, portableSave.round_state, state.player?.id);
    localStorage.setItem(
      playerStorageKey(`${portableSave.course_id}-round-seed`),
      String(portableSave.round_state.round_seed)
    );
    localStorage.setItem(playerStorageKey("course"), portableSave.course_id);
    localStorage.setItem(profileStorageKey(), profileId);

    await loadData(portableSave.course_id);
    state.holeIndex = portableSave.current_hole_index;
    const pinCount = hole().geometries.green_complex.pin_zones.length;
    state.pinIndex = Math.min(portableSave.pin_index, Math.max(0, pinCount - 1));
    $("#course-select").value = state.courseId;
    resetHole();
    renderScorecard();
    setRoundFileStatus(
      `Loaded ${state.course.shortName}, Hole ${state.holeIndex + 1}.`,
      "success"
    );
    schedulePlayerRoundSync(0);
  } catch (error) {
    console.error(error);
    setRoundFileStatus(`Could not load this round: ${error.message}.`, "error");
  }
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
  // Course geometry is authoritative when resuming. This also migrates a ball
  // that was saved against the older visual-only green into the generated
  // green, while hazards retain their higher surface priority.
  state.currentLie = lieAt(state.ball).type;
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
    const pinZones = state.holes[holeIndex].geometries.green_complex.pin_zones;
    const selectedPinIndex = holeIndex === state.holeIndex
      ? state.pinIndex
      : rotatingPinIndex(holeIndex, pinZones.length);
    const pinPoint = pinZones[selectedPinIndex]?.center_point
      || pinZones[2]?.center_point
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
  state.holes = holes
    .map(raw => raw.hole_metadata ? raw : normalizeWarrenbrookHole(raw))
    .map((holeData, index) => withoutParThreeFairway(holeData, state.scorecard[index]?.Par))
    .map(holeData => expandSandHazards(holeData, sandHazardScaleForCourse(state.course, holeData)));
  state.holes = state.holes.map((holeData, index) => generatedGreenHole(holeData, {
    courseId: state.courseId,
    holeNumber: index + 1,
    targetWidthYards: 40,
    courseUnitsPerYard: 1 / METERS_TO_YARDS
  }));
  state.holes.forEach(ensurePlayablePinZones);
  state.holes = state.holes.map(holeData => ensureHazardFreePinZones(holeData));
  state.pinIndex = rotatingPinIndex(state.holeIndex, hole().geometries.green_complex.pin_zones.length);
  state.customProfiles = JSON.parse(localStorage.getItem(customProfilesStorageKey()) || "[]")
    .map(normalizeProfile)
    .map(profile => personalizeCustomProfile(profile, state.player?.name));
  localStorage.setItem(customProfilesStorageKey(), JSON.stringify(state.customProfiles));
  state.roundHistory = JSON.parse(localStorage.getItem(storageKey("history")) || "null") || Array.from({ length: 18 }, () => []);
  state.scores = JSON.parse(localStorage.getItem(storageKey("scores")) || "null") || Array(18).fill(null);
  state.roundSeed = Number(localStorage.getItem(storageKey("round-seed"))) || newRoundSeed();
  state.roundState = loadRoundState(localStorage, state.courseId, state.player?.id);
  if (!state.roundState) {
    state.roundState = state.player
      ? createRoundState({ courseId: state.courseId, roundSeed: state.roundSeed, tee: state.tee })
      : migrateLegacyRoundStateStorage(localStorage, {
        courseId: state.courseId,
        roundSeed: state.roundSeed,
        tee: state.tee,
        roundHistory: state.roundHistory,
        scores: state.scores
      });
    saveRoundState(localStorage, state.roundState, state.player?.id);
  }
  state.roundSeed = state.roundState.round_seed;
  localStorage.setItem(storageKey("round-seed"), String(state.roundSeed));
  state.tee = state.roundState?.tee || "White";
  syncRoundStateCaches();
  const savedId = localStorage.getItem(profileStorageKey()) || "90";
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

function safeInteriorPinPoint(origin, desired, polygon) {
  for (const progress of [1, .85, .7, .55, .4, .25]) {
    const candidate = [
      origin[0] + (desired[0] - origin[0]) * progress,
      origin[1] + (desired[1] - origin[1]) * progress
    ];
    if (pointInPolygon(candidate, polygon)) return candidate;
  }
  return [...origin];
}

function ensurePlayablePinZones(mappedHole) {
  const green = mappedHole?.geometries?.green_complex;
  if (!green || (green.pin_zones || []).length >= 3) return;
  const polygon = green.polygon;
  const mappedPin = green.pin_zones?.find(zone => validCenterPoint(zone.center_point))?.center_point;
  const center = mappedPin && pointInPolygon(mappedPin, polygon) ? mappedPin : centerOfPolygon(polygon);
  const xs = polygon.map(point => point[0]);
  const ys = polygon.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const desired = [
    [centerX, minY + (maxY - minY) * .22],
    [centerX, maxY - (maxY - minY) * .22],
    [minX + (maxX - minX) * .23, centerY],
    [maxX - (maxX - minX) * .23, centerY]
  ];
  green.pin_zones = [
    { zone_id: "front", center_point: safeInteriorPinPoint(center, desired[0], polygon), radius_meters: 2.5 },
    { zone_id: "back", center_point: safeInteriorPinPoint(center, desired[1], polygon), radius_meters: 2.5 },
    { zone_id: "left", center_point: safeInteriorPinPoint(center, desired[2], polygon), radius_meters: 2.5 },
    { zone_id: "right", center_point: safeInteriorPinPoint(center, desired[3], polygon), radius_meters: 2.5 },
    { zone_id: "center", center_point: [...center], radius_meters: 3 }
  ];
}

function rotatingPinIndex(holeIndex, pinCount) {
  return pinCount > 0 ? Math.max(0, holeIndex) % pinCount : 0;
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

function scoreNotation(relative) {
  if (relative <= -2) return { className: "eagle", label: relative <= -3 ? "Albatross or better" : "Eagle" };
  if (relative === -1) return { className: "birdie", label: "Birdie" };
  if (relative === 0) return { className: "par", label: "Par" };
  if (relative === 1) return { className: "bogey", label: "Bogey" };
  return { className: "double-bogey", label: relative === 2 ? "Double bogey" : `${relative} over par` };
}

function scoreMarkMarkup(score, par, display = score) {
  if (!Number.isInteger(score)) return `<span class="score-mark unplayed" aria-label="Not played">—</span>`;
  const notation = scoreNotation(score - Number(par));
  return `<span class="score-mark ${notation.className}" title="${notation.label}" aria-label="${score}, ${notation.label}">${display}</span>`;
}

function scoreTallyMarkup() {
  const counts = { eagle: 0, birdie: 0, par: 0, bogey: 0, "double-bogey": 0 };
  state.scores.forEach((score, index) => {
    if (!Number.isInteger(score)) return;
    counts[scoreNotation(score - Number(state.scorecard[index].Par)).className] += 1;
  });
  const items = [
    ["eagle", "−2", "Eagle+"],
    ["birdie", "−1", "Birdie"],
    ["par", "E", "Par"],
    ["bogey", "+1", "Bogey"],
    ["double-bogey", "+2", "Double+"]
  ];
  return `<div class="scorecard-tally" aria-label="Score result totals">
    ${items.map(([className, example, label]) => `<div class="scorecard-tally-item">
      ${scoreMarkMarkup(
        className === "eagle" ? 2 : className === "birdie" ? 3 : className === "par" ? 4 : className === "bogey" ? 5 : 6,
        4,
        example
      ).replace(/aria-label="[^"]+"/, `aria-label="${label} symbol"`)}
      <strong>${counts[className]}</strong><small>${label}</small>
    </div>`).join("")}
  </div>`;
}
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
  clearPuttAnimation();
  clearFlightAnimation();
  const driverIndex = state.profile?.clubs.findIndex(club => club.name === "Driver") ?? 0;
  state.selectedClub = driverIndex >= 0 ? driverIndex : 0;
  state.target = null;
  state.manualTargetPreview = false;
  state.clubAdjustment = 0;
  state.swingPower = 1;
  state.shotDraft = { club: false, target: false, power: false };
  state.structuredShot = { aim: "", adjustment: "none", offset: 1, selectedTarget: null };
  state.pendingPlayerInstructions = [];
  state.pendingPlayerNote = "";
  state.strategySelectedId = null;
  state.desktopCaddieExpanded = false;
  state.greenCaddieRead = null;
  state.mobileSheetState = "carousel";
  state.mobileCarouselPage = 0;
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
  state.roundState = replaceHoleEvents(state.roundState, state.holeIndex, []);
  persistRoundState();
  syncRoundStateCaches();
  resetHole();
}

function openResetHoleDialog() {
  if (state.liveGpsView) return;
  const holeNumber = state.holeIndex + 1;
  $("#reset-hole-title").textContent = `Reset Hole ${holeNumber}?`;
  $("#reset-hole-copy").textContent = `This clears every shot, score, target, and message for Hole ${holeNumber}. Other holes and your player profile will be kept.`;
  $("#reset-hole-dialog").showModal();
}

function collectPoints() {
  const g = hole().geometries;
  const polygons = [
    ...g.tee_boxes.map(x => x.polygon), ...g.fairway_segments.map(x => x.polygon),
    ...(g.rough_zones || []).map(x => x.polygon), ...g.hazards.map(x => x.polygon),
    ...(g.tree_zones || []).map(x => x.polygon),
    ...(g.cart_paths || []).map(x => x.polygon),
    ...(g.out_of_bounds || []).map(x => x.polygon), g.green_complex.polygon
  ];
  return [...polygons.flat(), teePoint(), ...hole().centerline_waypoints.map(x => x.point)];
}

function fullCourseBounds() {
  const points = collectPoints();
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const xPad = Math.max(22, (maxX - minX) * .12);
  const yPad = Math.max(18, (maxY - minY) * .045);
  return { minX: minX - xPad, maxX: maxX + xPad, minY: minY - yPad, maxY: maxY + yPad };
}

function courseIllustrationViewport(fullBounds) {
  return imageViewportForWorldBounds(fullBounds, currentMapProjector());
}

function mapViewMode() {
  const lie = currentLieType();
  if (lie === "Green") return "putting";
  if (distance(state.ball, pin().center_point) <= 210) return "approach";
  return "full";
}

function greenContourIsVisible(viewMode = mapViewMode()) {
  return state.greenEnlarged || viewMode === "putting" || (
    viewMode === "approach" &&
    distance(state.ball, pin().center_point) <= 35
  );
}

function calculateBounds() {
  if (state.liveGpsView) {
    state.bounds = fullCourseBounds();
    return state.bounds;
  }
  const viewMode = mapViewMode();
  if (state.greenEnlarged) {
    const green = greenContourDisplayPolygon(hole().geometries.green_complex.polygon);
    const focus = enlargedGreenFocusBounds({
      greenPolygon: green,
      ball: state.ball,
      pin: pin().center_point,
      zoom: state.greenZoom
    });
    state.bounds = {
      minX: focus.minX,
      maxX: focus.maxX,
      minY: focus.minY,
      maxY: focus.maxY
    };
    return state.bounds;
  }
  if (viewMode === "putting" || automaticGreenReliefActive()) {
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
      ...(g.tree_zones || []),
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
  state.bounds = fullCourseBounds();
  return state.bounds;
}

function mobileTallMapActive() {
  return !state.greenEnlarged &&
    state.terrainViewMode !== "3d" &&
    mapViewMode() !== "putting" &&
    window.matchMedia?.("(max-width: 760px)").matches;
}

function mapSvgViewport() {
  if (!mobileTallMapActive()) return { width: 1000, height: 1000 };
  const surface = $("#course-map");
  const width = Number(surface?.clientWidth || window.innerWidth || 390);
  const height = Number(surface?.clientHeight || window.innerHeight || 740);
  return {
    width: bounded(1000 * width / Math.max(height, 1), 480, 720),
    height: 1000
  };
}

function refreshMapAfterViewportWidthChange() {
  const nextWidth = window.innerWidth;
  if (Math.abs(nextWidth - lastMapViewportWidth) < 2) return;
  lastMapViewportWidth = nextWidth;
  if (mapViewportResizeFrame !== null) cancelAnimationFrame(mapViewportResizeFrame);
  mapViewportResizeFrame = requestAnimationFrame(() => {
    mapViewportResizeFrame = null;
    renderMap();
  });
}

function mapFrame() {
  if (state.greenEnlarged) return { left: 55, right: 945, top: 55, bottom: 945 };
  if (mobileTallMapActive()) {
    const viewport = mapSvgViewport();
    const side = Math.max(36, viewport.width * .075);
    return { left: side, right: viewport.width - side, top: 118, bottom: 970 };
  }
  return { left: 100, right: 900, top: 50, bottom: 950 };
}

function currentMapProjector() {
  return createUniformMapProjector(state.bounds, mapFrame());
}

function sx(x) {
  return currentMapProjector().x(x);
}
function sy(y) {
  return currentMapProjector().y(y);
}
function coursePoint(screenX, screenY) {
  return currentMapProjector().unproject(screenX, screenY);
}
function pointsAttr(poly) { return poly.map(([x, y]) => `${sx(x)},${sy(y)}`).join(" "); }

function scaledDisplayPolygon(points, factor = .7) {
  if (!Array.isArray(points) || !points.length) return [];
  const center = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0])
    .map(value => value / points.length);
  return points.map(point => [
    center[0] + (point[0] - center[0]) * factor,
    center[1] + (point[1] - center[1]) * factor
  ]);
}

function roundedSvgPath(points, cornerRatio = .18) {
  if (!Array.isArray(points) || points.length < 3) return "";
  const ratio = bounded(cornerRatio, 0, .35);
  const toward = (from, to) => [
    from[0] + (to[0] - from[0]) * ratio,
    from[1] + (to[1] - from[1]) * ratio
  ];
  const format = point => `${point[0].toFixed(2)},${point[1].toFixed(2)}`;
  const start = toward(points[0], points[1]);
  const commands = [`M${format(start)}`];
  for (let index = 1; index <= points.length; index += 1) {
    const previous = points[(index - 1) % points.length];
    const current = points[index % points.length];
    const next = points[(index + 1) % points.length];
    commands.push(`L${format(toward(current, previous))}`);
    commands.push(`Q${format(current)} ${format(toward(current, next))}`);
  }
  commands.push("Z");
  return commands.join(" ");
}

function roundedCoursePath(polygon, cornerRatio = .18) {
  return roundedSvgPath(polygon.map(([x, y]) => [sx(x), sy(y)]), cornerRatio);
}

function smoothClosedSvgPoints(points, samplesPerSegment = 8, tension = .82) {
  if (!Array.isArray(points) || points.length < 3) return points || [];
  const samples = Math.max(2, Math.round(samplesPerSegment));
  const curve = [];
  for (let index = 0; index < points.length; index += 1) {
    const p0 = points[(index - 1 + points.length) % points.length];
    const p1 = points[index];
    const p2 = points[(index + 1) % points.length];
    const p3 = points[(index + 2) % points.length];
    const tangent1 = [(p2[0] - p0[0]) * tension / 2, (p2[1] - p0[1]) * tension / 2];
    const tangent2 = [(p3[0] - p1[0]) * tension / 2, (p3[1] - p1[1]) * tension / 2];
    for (let sample = 0; sample < samples; sample += 1) {
      const t = sample / samples;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      curve.push([
        h00 * p1[0] + h10 * tangent1[0] + h01 * p2[0] + h11 * tangent2[0],
        h00 * p1[1] + h10 * tangent1[1] + h01 * p2[1] + h11 * tangent2[1]
      ]);
    }
  }
  return curve;
}

function closedSvgPath(points) {
  if (!Array.isArray(points) || points.length < 3) return "";
  return `${points.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(" ")} Z`;
}

function smoothClosedSvgPath(points, samplesPerSegment = 8, tension = .82) {
  return closedSvgPath(smoothClosedSvgPoints(points, samplesPerSegment, tension));
}

function smoothCoursePath(polygon) {
  return smoothClosedSvgPath(polygon.map(([x, y]) => [sx(x), sy(y)]));
}

function greenContourDisplayPolygon(greenPolygon, targetWidthYards = 40) {
  void targetWidthYards;
  return greenPolygon.map(point => [...point]);
}

function greenContourKey() {
  const generated = hole().geometries.green_complex.generated;
  return `${state.courseId}:hole-${state.holeIndex + 1}:${generated?.version || "mapped-green"}`;
}

function greenElevationGrid(greenPolygon, columns, rows, contourPolygon = greenPolygon) {
  const xs = greenPolygon.map(point => point[0]);
  const ys = greenPolygon.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const points = Array.from({ length: rows + 1 }, (_, row) =>
    Array.from({ length: columns + 1 }, (_, column) => {
      const point = [
        minX + column / columns * (maxX - minX),
        minY + row / rows * (maxY - minY)
      ];
      return { point, height: sampleCourseGreenContour(point, contourPolygon, greenContourKey()).height };
    })
  );
  const insideHeights = points.flat()
    .filter(sample => pointInPolygon(sample.point, greenPolygon))
    .map(sample => sample.height);
  const minimum = Math.min(...insideHeights);
  const maximum = Math.max(...insideHeights);
  const levels = Array.from({ length: 5 }, (_, index) => minimum + (index + 1) / 6 * (maximum - minimum));
  return { minX, maxX, minY, maxY, columns, rows, points, minimum, maximum, levels };
}

function greenElevationSegments(grid) {
  const segments = [];
  const crossing = (a, b, level) => {
    const differenceA = a.height - level;
    const differenceB = b.height - level;
    if (differenceA === 0 && differenceB === 0) return null;
    if ((differenceA > 0) === (differenceB > 0)) return null;
    const progress = (level - a.height) / (b.height - a.height);
    return [
      a.point[0] + (b.point[0] - a.point[0]) * progress,
      a.point[1] + (b.point[1] - a.point[1]) * progress
    ];
  };
  grid.levels.forEach((level, levelIndex) => {
    for (let row = 0; row < grid.rows; row += 1) {
      for (let column = 0; column < grid.columns; column += 1) {
        const corners = [
          grid.points[row][column],
          grid.points[row][column + 1],
          grid.points[row + 1][column + 1],
          grid.points[row + 1][column]
        ];
        const crossings = [
          crossing(corners[0], corners[1], level),
          crossing(corners[1], corners[2], level),
          crossing(corners[2], corners[3], level),
          crossing(corners[3], corners[0], level)
        ].filter(Boolean);
        if (crossings.length === 2) segments.push({ level, levelIndex, start: crossings[0], end: crossings[1] });
        if (crossings.length === 4) {
          segments.push({ level, levelIndex, start: crossings[0], end: crossings[1] });
          segments.push({ level, levelIndex, start: crossings[2], end: crossings[3] });
        }
      }
    }
  });
  return segments;
}

function greenContourOverlay(greenPolygon, contourPolygon = greenPolygon) {
  const showSlopeArrows = currentLieType() === "Green";
  const columns = 24;
  const rows = 24;
  const elevationGrid = greenElevationGrid(greenPolygon, columns, rows, contourPolygon);
  const { minX, maxX, minY, maxY, minimum, maximum } = elevationGrid;
  const cellWidth = (maxX - minX) / columns;
  const cellHeight = (maxY - minY) / rows;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = minX + column * cellWidth;
      const y0 = minY + row * cellHeight;
      const x1 = x0 + cellWidth;
      const y1 = y0 + cellHeight;
      const center = [(x0 + x1) / 2, (y0 + y1) / 2];
      const sample = sampleCourseGreenContour(center, contourPolygon, greenContourKey());
      cells.push(`<polygon class="green-elevation-cell" points="${pointsAttr([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])}" fill="${greenElevationColor(sample.height, minimum, maximum)}"/>`);
    }
  }
  const elevationLines = greenElevationSegments(elevationGrid).map(segment =>
    `<line class="green-elevation-line level-${segment.levelIndex + 1}" x1="${sx(segment.start[0])}" y1="${sy(segment.start[1])}" x2="${sx(segment.end[0])}" y2="${sy(segment.end[1])}"/>`
  ).join("");
  const arrows = [];
  const arrowColumns = 8;
  const arrowRows = 8;
  for (let row = 0; showSlopeArrows && row < arrowRows; row += 1) {
    for (let column = 0; column < arrowColumns; column += 1) {
      const point = [
        minX + (column + .5) / arrowColumns * (maxX - minX),
        minY + (row + .5) / arrowRows * (maxY - minY)
      ];
      if (!pointInPolygon(point, greenPolygon)) continue;
      const sample = sampleCourseGreenContour(point, contourPolygon, greenContourKey());
      const end = [
        point[0] + sample.downhill_course_x,
        point[1] + sample.downhill_course_y
      ];
      const screenAngle = Math.atan2(sy(end[1]) - sy(point[1]), sx(end[0]) - sx(point[0])) * 180 / Math.PI;
      const length = 8 + sample.slope_degrees * 1.25;
      arrows.push(`
        <g class="green-slope-arrow" transform="translate(${sx(point[0])},${sy(point[1])}) rotate(${screenAngle})">
          <path d="M${-length},0H${length}M${length - 2.5},-2L${length},0 ${length - 2.5},2"/>
        </g>`);
    }
  }
  const transform = greenContourTransform(greenContourKey());
  const mirrorLabel = transform.mirrored ? " · mirrored" : "";
  return `
    <g class="green-contour-field" clip-path="url(#green-contour-clip)">
      <g class="green-contour-bands">${cells.join("")}</g>
      <g class="green-elevation-lines">${elevationLines}</g>
      ${showSlopeArrows ? `<g class="green-slope-arrows">${arrows.join("")}</g>` : ""}
    </g>
    <path class="green-contour-edge" d="${smoothCoursePath(greenPolygon)}"/>
    <g class="green-contour-key" transform="translate(72,77)">
      <rect class="green-contour-key-bg" width="284" height="62" rx="10"/>
      <text class="green-contour-title" x="14" y="20">GREEN ELEVATION · ${transform.rotation_degrees}°${mirrorLabel}</text>
      <text class="green-contour-caption" x="14" y="43">Low</text>
      ${Array.from({ length: 6 }, (_, index) => `<rect class="green-contour-swatch" x="51" y="31" width="28" height="13" transform="translate(${index * 28},0)" fill="${greenElevationColor(minimum + index / 5 * (maximum - minimum), minimum, maximum)}"/>`).join("")}
      <text class="green-contour-caption" x="230" y="43">High</text>
    </g>`;
}

let puttAnimationTimer = null;
let flightAnimationTimer = null;

function clearPuttAnimation() {
  if (puttAnimationTimer !== null) window.clearTimeout(puttAnimationTimer);
  puttAnimationTimer = null;
  state.puttAnimation = null;
}

function clearFlightAnimation() {
  if (flightAnimationTimer !== null) window.clearTimeout(flightAnimationTimer);
  flightAnimationTimer = null;
  state.flightAnimation = null;
}

function beginPuttAnimation(puttPacket, strokeIndex, replayShot = null, participant = "human") {
  clearPuttAnimation();
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;
  if (!Array.isArray(puttPacket?.path) || puttPacket.path.length < 2) return null;
  const animation = {
    holeIndex: state.holeIndex,
    strokeIndex,
    shot: replayShot,
    participant,
    startedAt: performance.now(),
    durationMs: puttRollDurationMs(puttPacket.total_yards)
  };
  state.puttAnimation = animation;
  return animation;
}

function activePuttAnimation() {
  const animation = state.puttAnimation;
  const shot = animation?.shot || state.shots.at(-1);
  if (!animation || !shot?.puttPacket || animation.holeIndex !== state.holeIndex ||
      (!animation.shot && animation.strokeIndex !== state.shots.length)) return null;
  return {
    ...animation,
    elapsedSeconds: Math.min(animation.durationMs, Math.max(0, performance.now() - animation.startedAt)) / 1000,
    durationSeconds: animation.durationMs / 1000
  };
}

function beginFlightAnimation(resultPacket, strokeIndex, bounds = null, cameraStart = null, replayShot = null, participant = "human") {
  clearFlightAnimation();
  if (state.greenEnlarged) return null;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;
  if (!Array.isArray(resultPacket?.path) || resultPacket.path.length < 2) return null;
  const animation = {
    holeIndex: state.holeIndex,
    strokeIndex,
    shot: replayShot,
    participant,
    startedAt: performance.now(),
    durationMs: fullShotAnimationDurationMs(resultPacket.total_yards, {
      compact: window.matchMedia?.("(max-width: 760px)").matches === true
    }),
    bounds: bounds ? { ...bounds } : null,
    cameraStart: cameraStart ? [...cameraStart] : null
  };
  state.flightAnimation = animation;
  return animation;
}

function activeFlightAnimation() {
  const animation = state.flightAnimation;
  const shot = animation?.shot || state.shots.at(-1);
  if (!animation || !shot?.resultPacket || animation.holeIndex !== state.holeIndex ||
      (!animation.shot && animation.strokeIndex !== state.shots.length)) return null;
  return {
    ...animation,
    elapsedSeconds: Math.min(animation.durationMs, Math.max(0, performance.now() - animation.startedAt)) / 1000,
    durationSeconds: animation.durationMs / 1000
  };
}

function animatedPuttMarkup(path, animation, classNames = {}) {
  if (!animation || !Array.isArray(path) || path.length < 2) return "";
  const pathData = path.map((point, index) => `${index ? "L" : "M"}${point[0]},${point[1]}`).join(" ");
  const timing = puttMotionTiming(path);
  const begin = `-${animation.elapsedSeconds.toFixed(3)}s`;
  const gameMaster = animation.participant === "gm";
  const roleClass = gameMaster ? " gm-animation" : "";
  const traceClass = `${classNames.trace || "putt-roll-trace"}${roleClass}`;
  const ballClass = `${classNames.ball || "putt-rolling-ball"}${roleClass}`;
  const ballMarkup = gameMaster
    ? `<path class="gm-animation-ball" d="M0-11L11 0 0 11-11 0Z"/><circle class="gm-animation-core" r="4"/><text class="gm-animation-label" x="0" y="-17" text-anchor="middle">GM</text>`
    : classNames.relief
      ? `<ellipse class="ball-shadow" cy="3" rx="15" ry="6"/><circle class="ball-halo" cy="-6" r="18"/><circle class="ball-body" cy="-6" r="11"/><circle class="ball-shine" cx="-3" cy="-9" r="3"/>`
      : `<circle class="putt-ball-halo" r="13"/><circle class="putt-ball-body" r="7"/><circle class="putt-ball-shine" cx="-2" cy="-2" r="2"/>`;
  return `
    <path class="${traceClass}" d="${pathData}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1">
      <animate attributeName="stroke-dashoffset" from="1" to="0" dur="${animation.durationSeconds}s" begin="${begin}" fill="freeze"/>
    </path>
    <g class="${ballClass}">
      <g class="animated-ball-glyph">${ballMarkup}</g>
      <animateMotion path="${pathData}" dur="${animation.durationSeconds}s" begin="${begin}" fill="freeze" calcMode="linear" keyPoints="${timing.keyPoints}" keyTimes="${timing.keyTimes}"/>
    </g>`;
}

function greenReliefProjection() {
  const g = hole().geometries;
  const contourPolygon = g.green_complex.polygon;
  const greenPolygon = greenContourDisplayPolygon(contourPolygon);
  const xs = greenPolygon.map(point => point[0]);
  const ys = greenPolygon.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const centerX = state.greenEnlarged ? (state.bounds.minX + state.bounds.maxX) / 2 : (minX + maxX) / 2;
  const centerY = state.greenEnlarged ? (state.bounds.minY + state.bounds.maxY) / 2 : (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const scale = currentMapProjector().scale;
  // Keep the 3D read visible without turning the green into a thick terrain slab.
  // This is 50% thinner than the previous setting (12.5% of the original height).
  const heightScale = span * scale * .01625;
  const yaw = state.greenViewYaw * Math.PI / 180;
  const tilt = state.greenViewTilt * Math.PI / 180;
  const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
  const cosTilt = Math.cos(tilt), sinTilt = Math.sin(tilt);

  const projectBase = (point, explicitHeight = null) => {
    const dx = Number(point[0]) - centerX;
    const dy = Number(point[1]) - centerY;
    const rotatedX = dx * cosYaw - dy * sinYaw;
    const rotatedY = dx * sinYaw + dy * cosYaw;
    const sample = sampleCourseGreenContour(point, contourPolygon, greenContourKey());
    const height = explicitHeight == null ? sample.height : explicitHeight;
    const perspective = bounded(1 - rotatedY / span * .055, .91, 1.09);
    return [
      500 + rotatedX * scale * perspective,
      545 - rotatedY * scale * cosTilt - height * heightScale * sinTilt
    ];
  };
  const focusOffset = state.greenEnlarged && Array.isArray(state.ball)
    ? projectedPairCenterOffset(projectBase(state.ball), projectBase(pin().center_point))
    : [0, 0];
  const project = (point, explicitHeight = null) => {
    const projected = projectBase(point, explicitHeight);
    return [projected[0] + focusOffset[0], projected[1] + focusOffset[1]];
  };
  return { g, contourPolygon, greenPolygon, minX, maxX, minY, maxY, span, project };
}

function automaticGreenReliefActive() {
  const lie = currentLieType();
  const greenside = Array.isArray(state.ball) &&
    ["Green", "Bunker", "Rough", "Heavy rough", "Fairway"].includes(lie) &&
    distance(state.ball, pin().center_point) <= 35;
  return !state.greenEnlarged &&
    state.terrainViewMode === "3d" &&
    greenside &&
    !activeFlightAnimation();
}

function greenReliefInteractionActive() {
  return (state.greenEnlarged && state.greenViewMode === "3d") || automaticGreenReliefActive();
}

function greenReliefMarkup() {
  const { g, contourPolygon, greenPolygon, minX, maxX, minY, maxY, span, project } = greenReliefProjection();
  const projectedPoints = points => points.map(point => project(point).join(",")).join(" ");
  const boundarySamples = greenPolygon.map(point => sampleCourseGreenContour(point, contourPolygon, greenContourKey()).height);
  const baseHeight = Math.min(...boundarySamples) - .32;
  const topBoundaryPoints = smoothClosedSvgPoints(greenPolygon.map(point => project(point)));
  const baseBoundaryPoints = smoothClosedSvgPoints(greenPolygon.map(point => project(point, baseHeight)));
  const topBoundaryPath = closedSvgPath(topBoundaryPoints);
  const baseBoundaryPath = closedSvgPath(baseBoundaryPoints);
  const sideWalls = topBoundaryPoints.map((topA, index) => {
    const topB = topBoundaryPoints[(index + 1) % topBoundaryPoints.length];
    const baseA = baseBoundaryPoints[index], baseB = baseBoundaryPoints[(index + 1) % baseBoundaryPoints.length];
    return `<polygon class="relief-wall" points="${topA.join(",")} ${topB.join(",")} ${baseB.join(",")} ${baseA.join(",")}"/>`;
  }).join("");

  const columns = 44;
  const rows = 44;
  const elevationGrid = greenElevationGrid(greenPolygon, columns, rows, contourPolygon);
  const cellWidth = (maxX - minX) / columns;
  const cellHeight = (maxY - minY) / rows;
  const cells = [];
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = minX + column * cellWidth;
      const y0 = minY + row * cellHeight;
      const x1 = x0 + cellWidth;
      const y1 = y0 + cellHeight;
      const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const center = [(x0 + x1) / 2, (y0 + y1) / 2];
      if (!pointInPolygon(center, greenPolygon) && !corners.some(point => pointInPolygon(point, greenPolygon))) continue;
      const sample = sampleCourseGreenContour(center, contourPolygon, greenContourKey());
      cells.push(`<polygon class="relief-cell" points="${projectedPoints(corners)}" fill="${greenElevationColor(sample.height, elevationGrid.minimum, elevationGrid.maximum)}"/>`);
    }
  }
  const elevationLines = greenElevationSegments(elevationGrid).map(segment => {
    const start = project(segment.start), end = project(segment.end);
    return `<line class="relief-contour level-${segment.levelIndex + 1}" x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}"/>`;
  }).join("");

  const showSlopeArrows = currentLieType() === "Green";
  const arrows = [];
  for (let row = 0; showSlopeArrows && row < 6; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      const point = [
        minX + (column + .5) / 6 * (maxX - minX),
        minY + (row + .5) / 6 * (maxY - minY)
      ];
      if (!pointInPolygon(point, greenPolygon)) continue;
      const sample = sampleCourseGreenContour(point, contourPolygon, greenContourKey());
      const arrowLength = span * .035;
      const end = [
        point[0] + sample.downhill_course_x * arrowLength,
        point[1] + sample.downhill_course_y * arrowLength
      ];
      const startScreen = project(point), endScreen = project(end);
      arrows.push(`<line class="relief-arrow" x1="${startScreen[0]}" y1="${startScreen[1]}" x2="${endScreen[0]}" y2="${endScreen[1]}" marker-end="url(#relief-arrowhead)"/>`);
    }
  }

  const nearbyHazards = (water, className, heightOffset) => g.hazards.filter(hazard =>
    hazard.lie_catalog_id.includes("water") === water &&
    hazard.polygon.some(point => rawYards(point, pin().center_point) < 65)
  ).map(hazard => {
    const points = hazard.polygon.map(point => {
      const height = sampleCourseGreenContour(point, contourPolygon, greenContourKey()).height - .22;
      return project(point, height + heightOffset);
    });
    return `<path class="${className}" d="${smoothClosedSvgPath(points)}"/>`;
  }).join("");
  const nearbyWater = nearbyHazards(true, "relief-water", -.08);
  const nearbySand = nearbyHazards(false, "relief-bunker", 0);

  const pinScreen = project(pin().center_point);
  const caddieRead = activeGreenCaddieRead();
  const caddiePath = caddieRead ? projectPuttPath(caddieRead.path, project) : [];
  const caddiePathData = caddiePath.map((point, index) => `${index ? "L" : "M"}${point[0]},${point[1]}`).join(" ");
  const caddieBallScreen = caddieRead ? project(state.ball) : null;
  const caddieTargetScreen = caddieRead ? project(caddieRead.target) : null;
  const caddieFinishScreen = caddieRead ? project(caddieRead.landing) : null;
  const caddieFinishX = caddieRead ? project([caddieRead.landing[0] + caddieRead.finishRadiusCourse, caddieRead.landing[1]]) : null;
  const caddieFinishY = caddieRead ? project([caddieRead.landing[0], caddieRead.landing[1] + caddieRead.finishRadiusCourse]) : null;
  const caddieFinishRadii = caddieRead ? [
    Math.max(12, Math.hypot(caddieFinishX[0] - caddieFinishScreen[0], caddieFinishX[1] - caddieFinishScreen[1])),
    Math.max(7, Math.hypot(caddieFinishY[0] - caddieFinishScreen[0], caddieFinishY[1] - caddieFinishScreen[1]))
  ] : null;
  const targetOnGreen = state.target && pointInPolygon(state.target, greenPolygon);
  const targetScreen = targetOnGreen ? project(state.target) : null;
  // Top view always shows the current ball, including around the edge of the
  // enlarged 40-yard display green. Project the same ball in 3D and let the SVG
  // viewport naturally hide it only when it is genuinely outside the scene.
  const ballScreen = state.ball ? project(state.ball) : null;
  const puttAnimation = activePuttAnimation();
  const puttPath = puttAnimation
    ? projectPuttPath(playedShotVisual()?.roll, project)
    : null;
  const animatedPutt = animatedPuttMarkup(puttPath, puttAnimation, {
    trace: "relief-putt-trace",
    ball: "relief-putt-ball",
    relief: true
  });
  const transform = greenContourTransform(greenContourKey());
  return `<svg class="green-relief-map" viewBox="0 0 1000 1000" role="img" aria-label="Interactive 3D green relief for hole ${state.holeIndex + 1}">
    <defs>
      <linearGradient id="relief-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#263e31"/><stop offset="1" stop-color="#4c7050"/></linearGradient>
      <filter id="relief-shadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="24" stdDeviation="24" flood-color="#10251a" flood-opacity=".52"/></filter>
      <clipPath id="relief-green-clip"><path d="${topBoundaryPath}"/></clipPath>
      <marker id="relief-arrowhead" markerWidth="3.5" markerHeight="3.5" refX="2.5" refY="1.75" orient="auto"><path d="M0,0L3.5,1.75L0,3.5z" fill="rgba(255,253,243,.88)"/></marker>
    </defs>
    <rect width="1000" height="1000" fill="url(#relief-ground)"/>
    <ellipse class="relief-shadow" cx="500" cy="675" rx="345" ry="105"/>
    <g filter="url(#relief-shadow)"><path class="relief-base" d="${baseBoundaryPath}"/>${sideWalls}</g>
    <g clip-path="url(#relief-green-clip)">${cells.join("")}</g>
    <g clip-path="url(#relief-green-clip)">${elevationLines}</g>
    <path class="relief-rim" d="${topBoundaryPath}"/>
    ${nearbyWater}${nearbySand}
    ${showSlopeArrows ? `<g>${arrows.join("")}</g>` : ""}
    ${caddieRead ? `<g class="green-caddie-guide" clip-path="url(#relief-green-clip)">
      <ellipse class="green-caddie-finish-zone" cx="${caddieFinishScreen[0]}" cy="${caddieFinishScreen[1]}" rx="${caddieFinishRadii[0]}" ry="${caddieFinishRadii[1]}"/>
      <line class="green-caddie-start-line" x1="${caddieBallScreen[0]}" y1="${caddieBallScreen[1]}" x2="${caddieTargetScreen[0]}" y2="${caddieTargetScreen[1]}"/>
      <path class="green-caddie-ghost-trace" d="${caddiePathData}"/>
      <g class="green-caddie-aim-mark" transform="translate(${caddieTargetScreen[0]},${caddieTargetScreen[1]})"><path d="M0-10L10 0 0 10-10 0Z"/></g>
    </g>` : ""}
    <g class="relief-putt-surface" clip-path="url(#relief-green-clip)">${animatedPutt}</g>
    ${ballScreen && targetScreen ? `<line class="relief-aim" x1="${ballScreen[0]}" y1="${ballScreen[1]}" x2="${targetScreen[0]}" y2="${targetScreen[1]}"/>` : ""}
    ${targetScreen ? `<g class="relief-target" transform="translate(${targetScreen[0]},${targetScreen[1]})"><ellipse rx="15" ry="8"/><path d="M-22 0h44M0-14v28"/></g>` : ""}
    <g class="relief-pin" transform="translate(${pinScreen[0]},${pinScreen[1]})"><ellipse rx="9" ry="4"/><path d="M0 0V-72"/><path class="flag" d="M1-72l36 12-36 13z"/></g>
    ${ballScreen && (!puttAnimation || puttAnimation.participant === "gm") ? `<g class="relief-ball" transform="translate(${ballScreen[0]},${ballScreen[1]})"><title>Your ball</title><ellipse class="ball-shadow" cy="3" rx="15" ry="6"/><circle class="ball-halo" cy="-6" r="18"/><circle class="ball-body" cy="-6" r="11"/><circle class="ball-shine" cx="-3" cy="-9" r="3"/></g>` : ""}
    <g class="relief-title" transform="translate(42,900)"><text>3D ELEVATION · HOLE ${state.holeIndex + 1}</text><text y="25">EQUAL-HEIGHT LINES · ${transform.rotation_degrees}°</text></g>
    <g class="relief-height-key" transform="translate(700,895)">
      <text x="0" y="13">LOW</text>
      ${Array.from({ length: 6 }, (_, index) => `<rect x="40" y="2" width="28" height="15" transform="translate(${index * 28},0)" fill="${greenElevationColor(elevationGrid.minimum + index / 5 * (elevationGrid.maximum - elevationGrid.minimum), elevationGrid.minimum, elevationGrid.maximum)}"/>`).join("")}
      <text x="218" y="13">HIGH</text>
    </g>
    <style>
      .relief-shadow{fill:rgba(9,24,15,.34)}
      .relief-water{fill:#4f8791;stroke:#b7dad7;stroke-width:4;opacity:.92}
      .relief-bunker{fill:#d8bd79;stroke:#f0d99e;stroke-width:4;opacity:.9}
      .relief-base{fill:#284b32;stroke:#dce8b1;stroke-width:3}
      .relief-wall{fill:#426d45;stroke:rgba(18,48,28,.5);stroke-width:2}
      .relief-cell{stroke:rgba(245,240,220,.12);stroke-width:.55}
      .relief-contour{stroke:rgba(255,253,243,.82);stroke-width:2.4;stroke-linecap:round}
      .relief-contour.level-3{stroke-width:3.4}
      .relief-rim{fill:none;stroke:#fff9dc;stroke-width:6;stroke-linejoin:round}
      .relief-arrow{stroke:rgba(255,253,243,.88);stroke-width:3;stroke-linecap:round}
      .green-caddie-finish-zone{fill:rgba(216,189,121,.18);stroke:#f1d27e;stroke-width:3;stroke-dasharray:7 6}
      .green-caddie-start-line{stroke:rgba(255,250,218,.72);stroke-width:3;stroke-dasharray:3 9;stroke-linecap:round}
      .green-caddie-ghost-trace{fill:none;stroke:#f1d27e;stroke-width:6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:10 8}
      .green-caddie-aim-mark path{fill:#f1d27e;stroke:#183126;stroke-width:2}
      .relief-pin ellipse{fill:#162f22;opacity:.5}.relief-pin path{stroke:#fffdf3;stroke-width:5}.relief-pin .flag{fill:#b5523e;stroke:none}
      .relief-target ellipse{fill:rgba(181,82,62,.18);stroke:#fffdf3;stroke-width:4}.relief-target path{stroke:#fffdf3;stroke-width:3}
      .relief-ball .ball-shadow{fill:rgba(12,31,20,.42)}
      .relief-ball .ball-halo{fill:rgba(255,253,243,.3);stroke:none}
      .relief-ball .ball-body{fill:#fffdf3;stroke:#183126;stroke-width:3}
      .relief-ball .ball-shine{fill:#fff;stroke:none;opacity:.85}
      .relief-putt-trace{fill:none;stroke:#f59d45;stroke-width:6;stroke-linecap:round;stroke-linejoin:round}
      .relief-putt-ball .ball-shadow{fill:rgba(12,31,20,.42)}
      .relief-putt-ball .ball-halo{fill:rgba(255,253,243,.3);stroke:none}
      .relief-putt-ball .ball-body{fill:#fffdf3;stroke:#183126;stroke-width:3}
      .relief-putt-ball .ball-shine{fill:#fff;stroke:none;opacity:.85}
      .relief-aim{stroke:#fffdf3;stroke-width:3;stroke-dasharray:7 10}
      .relief-title text{fill:rgba(255,253,243,.86);font:700 17px var(--font-system);letter-spacing:1.5px}.relief-title text+text{font-size:12px;opacity:.72}
      .relief-height-key text{fill:rgba(255,253,243,.82);font:700 11px var(--font-system);letter-spacing:1px}.relief-height-key rect{stroke:rgba(24,49,38,.3);stroke-width:1}
    </style>
  </svg>`;
}

let greenOrbitDrag = null;
let greenOrbitFrame = null;

function setGreenTargetFromPointer(event) {
  if (state.holeFinished || !greenReliefInteractionActive()) return false;
  const svg = $("#course-map svg");
  const screenPoint = svgPointFromPointer(event, svg);
  if (!screenPoint) return false;
  const projection = greenReliefProjection();
  const target = closestProjectedPolygonPoint(screenPoint, projection.greenPolygon, projection.project);
  if (!target) return false;

  clearStrategyPlan();
  state.target = target;
  state.manualTargetPreview = false;
  state.shotDraft.target = true;
  rememberStructuredTarget(state.target);
  renderMap();
  updateShotDesk();
  updateEnlargedPuttControls();

  const lineDistance = distance(state.ball, state.target);
  const putting = currentLieType() === "Green";
  addGmMessage(`3D aim point set at ${putting ? Math.round(lineDistance * 3) + " feet" : Math.round(lineDistance) + " yards"}. Click another contour point to adjust it, or set the pace and play.`);
  return true;
}

function onGreenOrbitPointerDown(event) {
  if (!greenReliefInteractionActive()) return;
  event.preventDefault();
  hideMapDistancePreview();
  greenOrbitDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    moved: false
  };
}

function onGreenOrbitPointerMove(event) {
  if (!greenOrbitDrag || event.pointerId !== greenOrbitDrag.pointerId || !greenReliefInteractionActive()) return;
  event.preventDefault();
  const totalMovement = Math.hypot(event.clientX - greenOrbitDrag.startX, event.clientY - greenOrbitDrag.startY);
  if (!greenOrbitDrag.moved && totalMovement <= 6) return;
  const dx = event.clientX - greenOrbitDrag.x;
  const dy = event.clientY - greenOrbitDrag.y;
  greenOrbitDrag.x = event.clientX;
  greenOrbitDrag.y = event.clientY;
  greenOrbitDrag.moved = true;
  state.greenViewYaw = (state.greenViewYaw + dx * .32 + 540) % 360 - 180;
  state.greenViewTilt = bounded(state.greenViewTilt + dy * .22, 30, 70);
  if (greenOrbitFrame != null) return;
  greenOrbitFrame = window.requestAnimationFrame(() => {
    greenOrbitFrame = null;
    renderMap();
  });
}

function onGreenOrbitPointerUp(event) {
  if (!greenOrbitDrag || event.pointerId !== greenOrbitDrag.pointerId) return;
  const wasClick = !greenOrbitDrag.moved && event.type !== "pointercancel";
  greenOrbitDrag = null;
  if (wasClick) setGreenTargetFromPointer(event);
}

function holeTerrainProjection(bounds = state.bounds, cameraStart = state.ball || teePoint()) {
  return createHoleTerrainProjection({
    bounds,
    elevationAt,
    cameraStart,
    cameraTarget: pin().center_point,
    yawDegrees: state.terrainViewYaw,
    tiltDegrees: state.terrainViewTilt
  });
}

function terrainReliefMarkup() {
  const g = hole().geometries;
  const treeCores = (g.tree_zones || []).map(item => ({ ...item, polygon: scaledDisplayPolygon(item.polygon, .7) }));
  const flightAnimation = activeFlightAnimation();
  const terrain = holeTerrainProjection(
    flightAnimation?.bounds || state.bounds,
    flightAnimation?.cameraStart || state.ball || teePoint()
  );
  const project = terrain.project;
  const points = polygon => polygon.map(point => project(point).join(",")).join(" ");
  const path = (polygon, cornerRatio = .18) => roundedSvgPath(polygon.map(point => project(point)), cornerRatio);
  const featurePath = (polygon, className) => className.includes("water") || className.includes("bunker")
    ? smoothClosedSvgPath(polygon.map(point => project(point)))
    : path(polygon);
  const groundPoints = points(terrain.corners);
  const feature = (items, className, title, decorative = false, displayPolygon = item => item.polygon) => (items || []).map(item =>
    decorative
      ? `<path class="${className}" d="${featurePath(displayPolygon(item), className)}" aria-hidden="true"/>`
      : `<path class="${className}" d="${featurePath(displayPolygon(item), className)}"><title>${escapeHtml(item.description || item.id || item.segment_id || title)}</title></path>`
  ).join("");
  const geometryFeature = (items, surface) => (items || []).map(item =>
    `<polygon data-surface="${surface}" points="${points(item.polygon)}"/>`
  ).join("");
  const greenPolygon = g.green_complex.polygon;
  const pinScreen = project(pin().center_point);
  const ballScreen = project(state.ball || teePoint());
  const targetScreen = state.target ? project(state.target) : null;
  const ballMarkerScale = bounded(.72 + terrain.perspectiveAt(state.ball || teePoint()) * .35, .78, 1.08);
  const pinMarkerScale = bounded(.72 + terrain.perspectiveAt(pin().center_point) * .35, .72, 1);
  const targetMarkerScale = state.target
    ? bounded(.72 + terrain.perspectiveAt(state.target) * .35, .75, 1.04)
    : 1;
  const shotLine = playedShotVisual();
  const flightPath = flightAnimation && shotLine
    ? projectedBallFlight({
        carry: shotLine.carry,
        roll: shotLine.roll,
        project,
        clubName: flightAnimation?.shot?.club || state.shots.at(-1)?.club
      })
    : [];
  const animatedFlight = animatedPuttMarkup(flightPath, flightAnimation, {
    trace: "terrain-flight-trace",
    ball: "terrain-flight-ball",
    relief: true
  });
  const projectedLine = line => (line || []).map(point => project(point).join(",")).join(" ");
  const targetDistance = state.target ? Math.max(1, Math.round(distance(state.ball, state.target))) : null;
  const aimLine = targetScreen
    ? `<line class="terrain-aim" x1="${ballScreen[0]}" y1="${ballScreen[1]}" x2="${targetScreen[0]}" y2="${targetScreen[1]}"/>`
    : "";
  const centerline = hole().centerline_waypoints.map(waypoint => project(waypoint.point).join(",")).join(" ");
  return `<svg class="hole-terrain-map" viewBox="0 0 1000 1000" role="img" aria-label="Interactive bird’s-eye course view of hole ${state.holeIndex + 1}">
    <defs>
      <linearGradient id="terrain-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8ccbd"/><stop offset=".22" stop-color="#dbe4d2"/><stop offset=".34" stop-color="#769071"/><stop offset="1" stop-color="#24462f"/></linearGradient>
      <linearGradient id="terrain-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#376942"/><stop offset="1" stop-color="#23472f"/></linearGradient>
      <linearGradient id="terrain-water-sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#76b1b3"/><stop offset=".58" stop-color="#4f8791"/><stop offset="1" stop-color="#376d77"/></linearGradient>
      <pattern id="terrain-native-turf" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M4 31l3-6m10 9l2-5m12 1l3-7M10 12l2-5m13 8l3-6" stroke="rgba(225,238,209,.13)" stroke-width="1.3" stroke-linecap="round"/></pattern>
      <pattern id="terrain-rough-grain" width="23" height="23" patternUnits="userSpaceOnUse"><path d="M2 20l3-5m5 6l2-6m6 5l3-7M7 8l2-4" stroke="rgba(236,243,220,.15)" stroke-width="1.2" stroke-linecap="round"/></pattern>
      <pattern id="terrain-fairway-mow" width="52" height="52" patternUnits="userSpaceOnUse"><rect width="26" height="52" fill="rgba(255,255,255,.095)"/><rect x="26" width="26" height="52" fill="rgba(38,91,48,.045)"/></pattern>
      <pattern id="terrain-green-mow" width="32" height="32" patternUnits="userSpaceOnUse" patternTransform="rotate(28)"><rect width="16" height="32" fill="rgba(255,255,255,.1)"/><rect x="16" width="16" height="32" fill="rgba(57,105,48,.05)"/></pattern>
      <pattern id="terrain-sand-grain" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="4" cy="5" r="1" fill="rgba(116,86,42,.2)"/><circle cx="14" cy="12" r=".8" fill="rgba(255,250,218,.4)"/><path d="M1 16c5-3 9-3 14 0" fill="none" stroke="rgba(255,247,210,.23)" stroke-width="1"/></pattern>
      <pattern id="terrain-water-ripples" width="44" height="28" patternUnits="userSpaceOnUse"><path d="M2 8c8-4 15-4 23 0s14 4 19 0M-8 22c8-4 15-4 23 0s15 4 23 0" fill="none" stroke="rgba(225,246,241,.24)" stroke-width="1.3" stroke-linecap="round"/></pattern>
      <pattern id="terrain-trees" width="180" height="180" patternUnits="userSpaceOnUse"><image href="assets/tree-canopy-top.png?v=20260812-2" width="180" height="180" preserveAspectRatio="xMidYMid slice"/></pattern>
      <filter id="terrain-shadow" x="-40%" y="-40%" width="180%" height="200%"><feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#10251a" flood-opacity=".34"/></filter>
      <filter id="ball-flight-shadow" x="-100%" y="-100%" width="300%" height="300%"><feDropShadow dx="0" dy="9" stdDeviation="7" flood-color="#10251a" flood-opacity=".42"/></filter>
    </defs>
    <g class="terrain-illustration-layer" data-map-layer="illustration">
    <rect width="1000" height="1000" fill="url(#terrain-sky)"/>
    <polygon class="terrain-ground" points="${groundPoints}"/>
    <polygon class="terrain-native-texture" points="${groundPoints}"/>
    ${feature(g.out_of_bounds || [], "terrain-out", "Out of bounds")}
    ${feature(g.rough_zones || [], "terrain-rough", "Rough")}
    ${feature(g.rough_zones || [], "terrain-rough-texture", "Rough texture", true)}
    ${feature(g.fairway_segments, "terrain-fairway-collar", "Fairway first cut", true)}
    ${feature(g.fairway_segments, "terrain-fairway", "Fairway")}
    ${feature(g.fairway_segments, "terrain-fairway-mowing", "Fairway mowing", true)}
    <path class="terrain-green-fringe" d="${path(greenPolygon, .22)}"/>
    <path class="terrain-green-shadow" d="${path(greenPolygon, .22)}" transform="translate(0 5)"/>
    <path class="terrain-green" d="${path(greenPolygon, .22)}"/>
    <path class="terrain-green-mowing" d="${path(greenPolygon, .22)}"/>
    ${feature(g.hazards.filter(item => item.lie_catalog_id.includes("water")), "terrain-water-bank", "Water bank", true)}
    ${feature(g.hazards.filter(item => item.lie_catalog_id.includes("water")), "terrain-water", "Water")}
    ${feature(g.hazards.filter(item => item.lie_catalog_id.includes("water")), "terrain-water-ripples", "Water ripples", true)}
    ${feature(g.hazards.filter(item => !item.lie_catalog_id.includes("water")), "terrain-bunker-lip", "Bunker lip", true)}
    ${feature(g.hazards.filter(item => !item.lie_catalog_id.includes("water")), "terrain-bunker", "Bunker")}
    ${feature(g.hazards.filter(item => !item.lie_catalog_id.includes("water")), "terrain-bunker-texture", "Sand texture", true)}
    <g>${feature(g.tree_zones || [], "terrain-trees terrain-trees-edge", "Trees", true)}${feature(treeCores, "terrain-trees terrain-trees-core", "Trees", true)}</g>
    ${feature(g.tee_boxes, "terrain-tee", "Tee", false, item => scaledDisplayPolygon(item.polygon, 1.75))}
    ${feature(g.tee_boxes, "terrain-tee-mowing", "Tee mowing", true, item => scaledDisplayPolygon(item.polygon, 1.75))}
    <polyline class="terrain-centerline" points="${centerline}"/>
    </g>
    <g class="course-calculation-layer ${SHOW_GEOMETRY_DEBUG ? "is-visible" : ""}" data-map-layer="calculation" aria-hidden="true">
      ${geometryFeature(g.rough_zones || [], "rough")}
      ${geometryFeature(g.fairway_segments, "fairway")}
      ${geometryFeature(g.tee_boxes, "tee")}
      ${geometryFeature(g.hazards.filter(item => item.lie_catalog_id.includes("water")), "water")}
      ${geometryFeature(g.hazards.filter(item => !item.lie_catalog_id.includes("water")), "bunker")}
      <polygon data-surface="green" points="${points(greenPolygon)}"/>
      ${geometryFeature(g.out_of_bounds || [], "out-of-bounds")}
    </g>
    <g class="terrain-interactive-layer" data-map-layer="interactive">
    ${shotLine?.carry?.length > 1 ? `<polyline class="terrain-played-carry" points="${projectedLine(shotLine.carry)}"/>` : ""}
    ${shotLine?.roll?.length > 1 ? `<polyline class="terrain-played-roll ${shotLine.rollOnGreen ? "on-green" : ""}" points="${projectedLine(shotLine.roll)}"/>` : ""}
    ${aimLine}
    ${targetScreen ? `<g class="terrain-target" transform="translate(${targetScreen[0]},${targetScreen[1]}) scale(${targetMarkerScale})"><ellipse rx="17" ry="8"/><path d="M-24 0h48M0-16v32"/><g class="terrain-target-label" transform="translate(0,-32)"><rect x="-28" y="-11" width="56" height="22" rx="5"/><text text-anchor="middle" dominant-baseline="central">${targetDistance} yd</text></g></g>` : ""}
    <g class="terrain-pin" transform="translate(${pinScreen[0]},${pinScreen[1]}) scale(${pinMarkerScale})"><ellipse rx="8" ry="4"/><path d="M0 0V-52"/><path class="flag" d="M1-52l29 10-29 11z"/></g>
    ${animatedFlight}
    ${flightAnimation?.participant !== "human" ? `<g class="terrain-ball" transform="translate(${ballScreen[0]},${ballScreen[1]}) scale(${ballMarkerScale})"><ellipse class="ball-shadow" cy="4" rx="13" ry="5"/><circle class="ball-halo" cy="-5" r="15"/><circle class="ball-body" cy="-5" r="9"/><circle class="ball-shine" cx="-3" cy="-8" r="2.5"/></g>` : ""}
    </g>
    <g class="terrain-caption" transform="translate(42,925)"><text>BIRD’S-EYE VIEW · HOLE ${state.holeIndex + 1}</text><text y="24">BEHIND THE BALL · CLICK TO AIM · DRAG TO LOOK AROUND</text></g>
    <style>
      .course-calculation-layer{display:none;pointer-events:none}
      .course-calculation-layer.is-visible{display:block}
      .course-calculation-layer polygon{fill:rgba(255,255,255,.12);stroke:#fff;stroke-width:3;stroke-dasharray:7 6;vector-effect:non-scaling-stroke}
      .course-calculation-layer [data-surface="fairway"]{stroke:#f7f16b}.course-calculation-layer [data-surface="rough"]{stroke:#9ff58f}
      .course-calculation-layer [data-surface="green"]{stroke:#7dffda}.course-calculation-layer [data-surface="bunker"]{stroke:#ffbd59}
      .course-calculation-layer [data-surface="water"]{stroke:#62c8ff}.course-calculation-layer [data-surface="out-of-bounds"]{stroke:#ff6276}
      .terrain-ground{fill:url(#terrain-ground);stroke:rgba(225,236,208,.24);stroke-width:2}
      .terrain-native-texture{fill:url(#terrain-native-turf);stroke:none;opacity:.88;pointer-events:none}
      .terrain-out{fill:#294a31;stroke:rgba(255,253,243,.7);stroke-width:3;stroke-dasharray:8 9}
      .terrain-rough{fill:#447647;stroke:rgba(41,78,51,.42);stroke-width:2;stroke-linejoin:round}
      .terrain-rough-texture{fill:url(#terrain-rough-grain);stroke:none;pointer-events:none}
      .terrain-trees{fill:url(#terrain-trees);stroke:none;filter:none;pointer-events:none}
      .terrain-trees-edge{opacity:.5}.terrain-trees-core{opacity:1}
      .terrain-fairway-collar{fill:none;stroke:#638d50;stroke-width:16;stroke-linejoin:round;stroke-linecap:round;pointer-events:none}
      .terrain-fairway{fill:#8db967;stroke:none}
      .terrain-fairway-mowing{fill:url(#terrain-fairway-mow);stroke:none;pointer-events:none}
      .terrain-tee{fill:#b8d58a;stroke:#f1f2d4;stroke-width:3;stroke-linejoin:round}
      .terrain-tee-mowing{fill:url(#terrain-fairway-mow);stroke:none;pointer-events:none}
      .terrain-water-bank{fill:none;stroke:#2b5960;stroke-width:14;stroke-linejoin:round;filter:url(#terrain-shadow)}
      .terrain-water{fill:url(#terrain-water-sheen);stroke:#b7dad7;stroke-width:4;stroke-linejoin:round}
      .terrain-water-ripples{fill:url(#terrain-water-ripples);stroke:none;pointer-events:none}
      .terrain-green-shadow{fill:#1d422b;opacity:.55}
      .terrain-green-fringe{fill:none;stroke:#6f994d;stroke-width:18;stroke-linejoin:round;filter:url(#terrain-shadow)}
      .terrain-green{fill:#b7d77d;stroke:#eff4c8;stroke-width:4;stroke-linejoin:round}
      .terrain-green-mowing{fill:url(#terrain-green-mow);stroke:none;pointer-events:none}
      .terrain-bunker-lip{fill:none;stroke:#887348;stroke-width:12;stroke-linejoin:round;filter:url(#terrain-shadow)}
      .terrain-bunker{fill:#d8c28b;stroke:#f4dfa7;stroke-width:4;stroke-linejoin:round}
      .terrain-bunker-texture{fill:url(#terrain-sand-grain);stroke:none;pointer-events:none}
      .terrain-centerline{fill:none;stroke:rgba(255,253,243,.3);stroke-width:2;stroke-dasharray:5 11}
      .terrain-aim{stroke:#fffdf3;stroke-width:3;stroke-dasharray:7 10}
      .terrain-target ellipse{fill:rgba(181,82,62,.2);stroke:#fffdf3;stroke-width:4}.terrain-target>path{stroke:#fffdf3;stroke-width:3}
      .terrain-target-label rect{fill:#fffdf3;stroke:#183126;stroke-width:1.5}.terrain-target-label text{fill:#183126;font:700 13px var(--font-system)}
      .terrain-pin ellipse{fill:#183126;opacity:.45}.terrain-pin path{stroke:#fffdf3;stroke-width:4}.terrain-pin .flag{fill:#b5523e;stroke:none}
      .terrain-ball .ball-shadow,.terrain-flight-ball .ball-shadow{fill:rgba(12,31,20,.42)}
      .terrain-ball .ball-halo,.terrain-flight-ball .ball-halo{fill:rgba(255,253,243,.32);stroke:none}
      .terrain-ball .ball-body,.terrain-flight-ball .ball-body{fill:#fffdf3;stroke:#183126;stroke-width:3}
      .terrain-ball .ball-shine,.terrain-flight-ball .ball-shine{fill:#fff;stroke:none;opacity:.9}
      .terrain-flight-ball{filter:url(#ball-flight-shadow);pointer-events:none}
      .terrain-flight-trace{fill:none;stroke:#fffdf3;stroke-width:4;stroke-linecap:round;stroke-dasharray:5 10;opacity:.92;pointer-events:none}
      @media(max-width:700px){.terrain-flight-ball .animated-ball-glyph{transform:scale(1.45)}}
      .terrain-played-carry{fill:none;stroke:rgba(255,253,243,.78);stroke-width:3;stroke-dasharray:4 9}
      .terrain-played-roll{fill:none;stroke:#d9c995;stroke-width:5;stroke-linecap:round}.terrain-played-roll.on-green{stroke:#f59d45}
      .terrain-caption text{fill:rgba(255,253,243,.88);font:800 15px var(--font-system);letter-spacing:1.4px}.terrain-caption text+text{font-size:11px;opacity:.68}
    </style>
  </svg>`;
}

let terrainOrbitDrag = null;
let terrainOrbitFrame = null;

function setTerrainTargetFromPointer(event) {
  if (state.holeFinished || state.greenEnlarged || state.terrainViewMode !== "3d") return false;
  const svg = $("#course-map svg");
  const screenPoint = svgPointFromPointer(event, svg);
  if (!screenPoint) return false;
  const projection = holeTerrainProjection();
  const target = closestProjectedTerrainPoint(screenPoint, state.bounds, projection.project, { maxErrorPixels: 28 });
  if (!target) return false;
  clearStrategyPlan();
  state.target = target;
  state.manualTargetPreview = false;
  state.shotDraft.target = true;
  renderMap();
  updateShotDesk();
  addGmMessage(`Bird's-eye target set ${Math.round(distance(state.ball, state.target))} yards from the ball. Click again to refine it, or choose the club and swing.`);
  return true;
}

function onTerrainOrbitPointerDown(event) {
  if (state.greenEnlarged || state.terrainViewMode !== "3d") return;
  event.preventDefault();
  hideMapDistancePreview();
  terrainOrbitDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    moved: false
  };
}

function onTerrainOrbitPointerMove(event) {
  if (!terrainOrbitDrag || event.pointerId !== terrainOrbitDrag.pointerId || state.terrainViewMode !== "3d") return;
  event.preventDefault();
  const movement = Math.hypot(event.clientX - terrainOrbitDrag.startX, event.clientY - terrainOrbitDrag.startY);
  if (!terrainOrbitDrag.moved && movement <= 6) return;
  const dx = event.clientX - terrainOrbitDrag.x;
  const dy = event.clientY - terrainOrbitDrag.y;
  terrainOrbitDrag.x = event.clientX;
  terrainOrbitDrag.y = event.clientY;
  terrainOrbitDrag.moved = true;
  state.terrainViewYaw = bounded(state.terrainViewYaw + dx * .18, -55, 55);
  state.terrainViewTilt = bounded(state.terrainViewTilt + dy * .2, 32, 68);
  if (terrainOrbitFrame != null) return;
  terrainOrbitFrame = window.requestAnimationFrame(() => {
    terrainOrbitFrame = null;
    renderMap();
  });
}

function onTerrainOrbitPointerUp(event) {
  if (!terrainOrbitDrag || event.pointerId !== terrainOrbitDrag.pointerId) return;
  const wasClick = !terrainOrbitDrag.moved && event.type !== "pointercancel";
  terrainOrbitDrag = null;
  if (wasClick) setTerrainTargetFromPointer(event);
}

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
  if (g.tee_boxes.some(x => pointInPolygon(point, x.polygon))) return { type: "Tee", color: "#f1eedf" };
  if (pointInPolygon(point, g.green_complex.polygon)) return { type: "Green", color: "#c3da83" };
  if (treeConditionAt(point)) return { type: "Trees", color: "#315a3b" };
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
  const flightAnimation = activeFlightAnimation();
  calculateBounds();
  // A completed shot can switch the next view from full-hole to approach or
  // putting. Keep the view that the player used for the shot until the ball
  // finishes travelling, then allow the normal result view to take over.
  if (!state.liveGpsView && flightAnimation?.bounds && !state.greenEnlarged) {
    state.bounds = { ...flightAnimation.bounds };
  }
  if (!state.liveGpsView && state.greenEnlarged && state.greenViewMode === "3d") {
    $("#course-map").innerHTML = greenReliefMarkup();
    $("#course-map svg").addEventListener("pointerdown", onGreenOrbitPointerDown);
    $("#course-map svg").addEventListener("pointermove", onGreenDistancePreview);
    $("#course-map svg").addEventListener("pointerleave", hideMapDistancePreview);
    return;
  }
  if (!state.liveGpsView && automaticGreenReliefActive()) {
    $(".map-hint").innerHTML = "<i></i> Green 3D · click to aim · drag to read the contour";
    $("#course-map").innerHTML = greenReliefMarkup();
    $("#course-map svg").addEventListener("pointerdown", onGreenOrbitPointerDown);
    $("#course-map svg").addEventListener("pointermove", onGreenDistancePreview);
    $("#course-map svg").addEventListener("pointerleave", hideMapDistancePreview);
    return;
  }
  if (!state.liveGpsView && !state.greenEnlarged && state.terrainViewMode === "3d") {
    $("#course-map").innerHTML = terrainReliefMarkup();
    $("#course-map svg").addEventListener("pointerdown", onTerrainOrbitPointerDown);
    $("#course-map svg").addEventListener("pointermove", onTerrainDistancePreview);
    $("#course-map svg").addEventListener("pointerleave", hideMapDistancePreview);
    return;
  }
  const g = hole().geometries;
  const viewMode = state.liveGpsView ? "full" : mapViewMode();
  const poly = (items, cls, displayPolygon = item => item.polygon) => items.map(item =>
    `<path class="${cls}" d="${cls.includes("sand") || cls.includes("water")
      ? smoothCoursePath(displayPolygon(item))
      : roundedCoursePath(displayPolygon(item), cls.includes("tee") ? .12 : .18)}"><title>${escapeHtml(item.description || item.id || item.segment_id || cls)}</title></path>`
  ).join("");
  const teeClass = item => item.id?.includes("blue")
    ? "tee-blue"
    : item.id?.includes("red") || item.id?.includes("forward")
      ? "tee-forward"
      : "tee-white";
  const teeArtwork = cls => g.tee_boxes.map(item => {
    const display = scaledDisplayPolygon(item.polygon, 1.75);
    return `<path class="${cls} ${teeClass(item)}" d="${roundedCoursePath(display, .12)}"><title>${escapeHtml(item.description || item.id || "Tee")}</title></path>`;
  }).join("");
  const geometryPoly = (items, surface) => (items || []).map(item =>
    `<polygon data-surface="${surface}" points="${pointsAttr(item.polygon)}"/>`
  ).join("");
  const pinPoint = pin().center_point;
  const liveHole = liveGpsHoleState();
  const liveTee = gpsFixCoursePoint(liveHole?.tee);
  const liveBall = liveGpsBallPoint();
  const liveSegments = liveGpsShotSegments();
  const ball = state.liveGpsView ? (liveBall || liveTee || teePoint()) : (state.ball || teePoint());
  const target = state.liveGpsView ? null : state.target;
  const recoveryCondition = state.liveGpsView || viewMode === "putting" ? null : treeConditionAt(ball);
  const recoveryTarget = Array.isArray(recoveryCondition?.recovery_target)
    ? recoveryCondition.recovery_target
    : null;
  const recoveryTargetYards = recoveryTarget
    ? Math.max(1, Math.round(distance(ball, recoveryTarget)))
    : null;
  const targetDistanceText = target
    ? (mapViewMode() === "putting" ? `${Math.round(distance(ball, target) * 3)} ft` : `${Math.round(distance(ball, target))} yd`)
    : "";
  const shotLine = state.liveGpsView ? null : playedShotVisual();
  const strategistState = state.liveGpsView ? null : activeStrategistHoleState();
  const strategistBall = strategistState?.ball ? pointArray(strategistState.ball) : null;
  const strategistShotLine = state.liveGpsView ? null : strategistPlayedShotVisual();
  const puttAnimation = activePuttAnimation();
  const animatingPutt = Boolean(puttAnimation && shotLine?.isPutt && shotLine.roll?.length > 1);
  const animatingFlight = Boolean(flightAnimation && !shotLine?.isPutt && shotLine?.carry?.length > 1);
  const activeShotAnimation = puttAnimation || flightAnimation;
  const gameMasterAnimating = activeShotAnimation?.participant === "gm";
  const humanAnimating = Boolean(activeShotAnimation && !gameMasterAnimating);
  const puttPath = animatingPutt ? shotLine.roll.map(point => [sx(point[0]), sy(point[1])]) : null;
  const animatedPutt = animatedPuttMarkup(puttPath, puttAnimation);
  const flightPath = animatingFlight
    ? projectedBallFlight({
        carry: shotLine.carry,
        roll: shotLine.roll,
        project: point => [sx(point[0]), sy(point[1])],
        clubName: flightAnimation?.shot?.club || state.shots.at(-1)?.club
      })
    : null;
  const animatedFlight = animatedPuttMarkup(flightPath, flightAnimation, {
    trace: "full-shot-flight-trace",
    ball: "full-shot-flight-ball"
  });
  const rollAnimationPath = !animatingPutt && shotLine?.rollOnGreen && shotLine.roll?.length > 1
    ? shotLine.roll.map((point, index) => `${index ? "L" : "M"}${sx(point[0])},${sy(point[1])}`).join(" ")
    : "";
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
  const showGreenContour = greenContourIsVisible(viewMode);
  const contourDisplayPolygon = greenContourDisplayPolygon(g.green_complex.polygon);
  const enlargedGreenView = state.greenEnlarged;
  const greenCaddieRead = enlargedGreenView && greenView ? activeGreenCaddieRead() : null;
  const greenCaddiePath = greenCaddieRead?.path || [];
  const greenCaddiePathData = greenCaddiePath.map((point, index) => `${index ? "L" : "M"}${sx(point[0])},${sy(point[1])}`).join(" ");
  const greenCaddieFinishRadiusX = greenCaddieRead
    ? Math.max(12, Math.abs(sx(greenCaddieRead.landing[0] + greenCaddieRead.finishRadiusCourse) - sx(greenCaddieRead.landing[0])))
    : 0;
  const greenCaddieFinishRadiusY = greenCaddieRead
    ? Math.max(12, Math.abs(sy(greenCaddieRead.landing[1] + greenCaddieRead.finishRadiusCourse) - sy(greenCaddieRead.landing[1])))
    : 0;
  const closeView = viewMode !== "full";
  // Par-3 tee shots open in approach view. Keep authored tee geometry visible
  // while the ball is still on a tee instead of treating every close view as
  // a reason to hide it.
  const showTeeBoxes = !greenView && (!closeView || currentLieType() === "Tee");
  const svgViewport = mapSvgViewport();
  const yardageMarkers = closeView ? [] : markerPointsFromPin([200, 150, 100]);
  const illustratedCourseImage = state.greenEnlarged || greenView ? null : courseIllustrationPath();
  const illustrationViewport = illustratedCourseImage
    ? courseIllustrationViewport(fullCourseBounds())
    : null;
  const mappedWater = g.hazards.filter(hazard => hazard.lie_catalog_id.includes("water"));
  const mappedStreams = mappedWater.filter(hazard => /stream|ditch/i.test(String(hazard.description || "")));
  const mappedOpenWater = mappedWater.filter(hazard => !mappedStreams.includes(hazard));
  const proceduralCourseArtwork = `
    <rect width="1000" height="1000" fill="url(#course-ground)"/>
    <rect class="native-turf" width="1000" height="1000" fill="url(#native-turf)"/>
    ${closeView ? "" : poly(g.out_of_bounds || [], "out-of-bounds")}
    ${greenView ? "" : poly(g.rough_zones || [], "rough-zone")}
    ${greenView ? "" : `<g class="course-art-overlay" aria-hidden="true">${poly(g.rough_zones || [], "rough-texture")}</g>`}
    ${greenView ? "" : `<g class="course-art-overlay" aria-hidden="true">${poly(g.fairway_segments, "fairway-collar")}</g>`}
    ${greenView ? "" : poly(g.fairway_segments, "fairway-segment")}
    ${greenView ? "" : `<g class="course-art-overlay" aria-hidden="true">${poly(g.fairway_segments, "fairway-mowing")}</g>`}
    ${greenView ? "" : poly(g.cart_paths || [], "cart-path")}
    <path class="green-fringe" d="${smoothCoursePath(contourDisplayPolygon)}" aria-hidden="true"/>
    <path class="green-complex" d="${smoothCoursePath(contourDisplayPolygon)}"/>
    <path class="green-mowing" d="${smoothCoursePath(contourDisplayPolygon)}" aria-hidden="true"/>
    ${showGreenContour ? greenContourOverlay(contourDisplayPolygon, g.green_complex.polygon) : ""}
    <g class="course-art-overlay" aria-hidden="true">${poly(mappedOpenWater, "water-bank")}</g>
    ${poly(mappedOpenWater, "water-hazard")}
    <g class="course-art-overlay" aria-hidden="true">${poly(mappedStreams, "stream-bank")}</g>
    ${poly(mappedStreams, "stream-hazard")}
    <g class="course-art-overlay" aria-hidden="true">${poly(g.hazards.filter(h => !h.lie_catalog_id.includes("water")), "sand-lip")}</g>
    ${poly(g.hazards.filter(h => !h.lie_catalog_id.includes("water")), "sand-hazard")}
    <g class="course-art-overlay" aria-hidden="true">${poly(g.hazards.filter(h => !h.lie_catalog_id.includes("water")), "sand-texture")}</g>
    ${greenView ? "" : `<g class="course-art-overlay" aria-hidden="true">${poly(g.tree_zones || [], "tree-zone tree-zone-edge")}${poly(g.tree_zones || [], "tree-zone tree-zone-core", item => scaledDisplayPolygon(item.polygon, .7))}</g>`}
    ${showTeeBoxes ? `<g class="course-art-overlay" aria-hidden="true">${teeArtwork("tee-box-shadow")}</g>${teeArtwork("tee-box")}<g class="course-art-overlay" aria-hidden="true">${teeArtwork("tee-mowing")}</g>` : ""}
    ${closeView ? "" : elevationContours}`;
  $("#course-map").innerHTML = `
    <svg viewBox="0 0 ${svgViewport.width} ${svgViewport.height}" role="img" aria-label="${enlargedGreenView ? "Enlarged green aiming view" : greenView ? "Close-up putting view" : "Top-down map"} of hole ${state.holeIndex + 1}">
      <defs>
        <linearGradient id="course-ground" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#315f3b"/><stop offset=".52" stop-color="#244d33"/><stop offset="1" stop-color="#1f412c"/>
        </linearGradient>
        <linearGradient id="water-sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#73aeb2"/><stop offset=".55" stop-color="#4f8791"/><stop offset="1" stop-color="#376f7a"/>
        </linearGradient>
        <filter id="soft-shadow"><feDropShadow dx="0" dy="5" stdDeviation="6" flood-opacity=".18"/></filter>
        <filter id="course-feature-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#142d20" flood-opacity=".24"/></filter>
        ${showGreenContour ? `<clipPath id="green-contour-clip" clipPathUnits="userSpaceOnUse"><path d="${smoothCoursePath(contourDisplayPolygon)}"/></clipPath>` : ""}
        <pattern id="native-turf" width="38" height="38" patternUnits="userSpaceOnUse">
          <path d="M4 34l3-6m10 8l2-5m12 2l3-7M9 12l2-5m13 9l3-7m8 6l2-4" stroke="rgba(210,229,190,.13)" stroke-width="1.4" stroke-linecap="round"/>
          <circle cx="16" cy="21" r="1" fill="rgba(13,42,27,.14)"/><circle cx="34" cy="4" r=".8" fill="rgba(230,239,214,.13)"/>
        </pattern>
        <pattern id="rough-grain" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M2 21l3-5m5 6l2-6m6 5l3-7M6 8l2-4m7 5l2-5" stroke="rgba(236,243,220,.14)" stroke-width="1.2" stroke-linecap="round"/>
        </pattern>
        <pattern id="fairway-mow" width="58" height="58" patternUnits="userSpaceOnUse">
          <rect width="29" height="58" fill="rgba(255,255,255,.085)"/><rect x="29" width="29" height="58" fill="rgba(38,91,48,.055)"/>
          <path d="M29 0v58" stroke="rgba(255,255,255,.055)" stroke-width="1"/>
        </pattern>
        <pattern id="tee-mow" width="26" height="26" patternUnits="userSpaceOnUse">
          <rect width="13" height="26" fill="rgba(255,255,255,.14)"/><rect x="13" width="13" height="26" fill="rgba(80,113,61,.06)"/>
        </pattern>
        <pattern id="green-mow" width="34" height="34" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
          <rect width="17" height="34" fill="rgba(255,255,255,.1)"/><rect x="17" width="17" height="34" fill="rgba(66,112,51,.05)"/>
        </pattern>
        <pattern id="sand-grain" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="5" r="1.2" fill="rgba(116,86,42,.17)"/><circle cx="15" cy="12" r=".9" fill="rgba(255,250,218,.38)"/><circle cx="8" cy="19" r=".7" fill="rgba(116,86,42,.13)"/>
          <path d="M1 14c5-3 9-3 14 0" fill="none" stroke="rgba(255,247,210,.22)" stroke-width="1"/>
        </pattern>
        <pattern id="water-ripples" width="46" height="30" patternUnits="userSpaceOnUse">
          <path d="M2 8c8-4 15-4 23 0s15 4 20 0M-8 23c8-4 15-4 23 0s15 4 23 0" fill="none" stroke="rgba(225,246,241,.22)" stroke-width="1.4" stroke-linecap="round"/>
        </pattern>
        <pattern id="tree-canopy" width="180" height="180" patternUnits="userSpaceOnUse">
          <image href="assets/tree-canopy-top.png?v=20260812-2" width="180" height="180" preserveAspectRatio="xMidYMid slice"/>
        </pattern>
      </defs>
      <g class="course-illustration-layer" data-map-layer="illustration">
      ${illustratedCourseImage
        ? `<image class="course-illustration-image" href="${escapeHtml(illustratedCourseImage)}" x="${illustrationViewport.x}" y="${illustrationViewport.y}" width="${illustrationViewport.width}" height="${illustrationViewport.height}" preserveAspectRatio="none" aria-hidden="true"/>`
        : proceduralCourseArtwork}
      ${illustratedCourseImage && showTeeBoxes
        ? `<g class="course-art-overlay" aria-hidden="true">${teeArtwork("tee-box-shadow")}</g>${teeArtwork("tee-box")}<g class="course-art-overlay" aria-hidden="true">${teeArtwork("tee-mowing")}</g>`
        : ""}
      ${closeView ? "" : `<polyline class="centerline" points="${pointsAttr(hole().centerline_waypoints.map(w => w.point))}"/>`}
      </g>
      <g class="course-calculation-layer ${SHOW_GEOMETRY_DEBUG ? "is-visible" : ""}" data-map-layer="calculation" aria-hidden="true">
        ${geometryPoly(g.rough_zones || [], "rough")}
        ${geometryPoly(g.fairway_segments, "fairway")}
        ${geometryPoly(g.tee_boxes, "tee")}
        ${geometryPoly(g.hazards.filter(h => h.lie_catalog_id.includes("water")), "water")}
        ${geometryPoly(g.hazards.filter(h => !h.lie_catalog_id.includes("water")), "bunker")}
        <polygon data-surface="green" points="${pointsAttr(g.green_complex.polygon)}"/>
        ${geometryPoly(g.out_of_bounds || [], "out-of-bounds")}
      </g>
      <g class="course-interactive-layer" data-map-layer="interactive">
      ${state.liveGpsView ? liveSegments.map(segment => `
        <line class="live-gps-shot-halo" x1="${sx(segment.start[0])}" y1="${sy(segment.start[1])}" x2="${sx(segment.end[0])}" y2="${sy(segment.end[1])}"/>
        <line class="live-gps-shot" x1="${sx(segment.start[0])}" y1="${sy(segment.start[1])}" x2="${sx(segment.end[0])}" y2="${sy(segment.end[1])}"><title>Actual GPS shot ${segment.number} · ${Math.round(segment.shot.distance_yards || 0)} yards</title></line>
        <g class="live-gps-shot-number" transform="translate(${sx(segment.end[0])},${sy(segment.end[1])})"><circle r="10"/><text text-anchor="middle" dominant-baseline="central">${segment.number}</text></g>`).join("") : ""}
      ${state.liveGpsView && liveTee ? `<g class="live-gps-tee" transform="translate(${sx(liveTee[0])},${sy(liveTee[1])})"><circle r="8"><title>Recorded tee location</title></circle></g>` : ""}
      ${yardageMarkers.map(marker => `
        <g class="yardage-marker ${marker.className}" transform="translate(${sx(marker.point[0])},${sy(marker.point[1])})">
          <circle r="13"/>
        </g>`).join("")}
      ${shotLine?.carry?.length > 1 && !animatingFlight ? `<polyline class="played-carry" points="${pointsAttr(shotLine.carry)}"><title>Ball carry</title></polyline>` : ""}
      ${shotLine?.roll?.length > 1 && !animatingPutt && !animatingFlight ? `<polyline class="played-roll ${shotLine.rollOnGreen ? "on-green" : ""}" points="${pointsAttr(shotLine.roll)}"><title>Ball roll${shotLine.rollOnGreen ? " on the green" : ""}</title></polyline>` : ""}
      ${strategistShotLine?.carry?.length > 1 ? `<polyline class="gm-played-carry" points="${pointsAttr(strategistShotLine.carry)}"><title>Game Master ball carry</title></polyline>` : ""}
      ${strategistShotLine?.roll?.length > 1 ? `<polyline class="gm-played-roll ${strategistShotLine.rollOnGreen ? "on-green" : ""}" points="${pointsAttr(strategistShotLine.roll)}"><title>Game Master ball roll</title></polyline>` : ""}
      ${animatedPutt}
      ${animatedFlight}
      ${rollAnimationPath ? `<circle class="roll-tracer" r="7"><animateMotion dur="1.2s" path="${rollAnimationPath}" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".18 .72 .28 1"/></circle>` : ""}
      ${shotLine?.carryPoint && shotLine.roll?.length > 1 && !animatingFlight ? `<g class="carry-landing" transform="translate(${sx(shotLine.carryPoint[0])},${sy(shotLine.carryPoint[1])})"><circle r="7"><title>Carry landing point</title></circle></g>` : ""}
      ${greenCaddieRead ? `<g class="green-caddie-guide" clip-path="url(#green-contour-clip)">
        <ellipse class="green-caddie-finish-zone" cx="${sx(greenCaddieRead.landing[0])}" cy="${sy(greenCaddieRead.landing[1])}" rx="${greenCaddieFinishRadiusX}" ry="${greenCaddieFinishRadiusY}"/>
        <line class="green-caddie-start-line" x1="${sx(ball[0])}" y1="${sy(ball[1])}" x2="${sx(greenCaddieRead.target[0])}" y2="${sy(greenCaddieRead.target[1])}"/>
        <path class="green-caddie-ghost-trace" d="${greenCaddiePathData}"/>
        <g class="green-caddie-aim-mark" transform="translate(${sx(greenCaddieRead.target[0])},${sy(greenCaddieRead.target[1])})"><path d="M0-10L10 0 0 10-10 0Z"/></g>
      </g>` : ""}
      ${recoveryTarget ? `<g class="recovery-guide" aria-label="Marked recovery target ${recoveryTargetYards} yards from the ball">
        <line class="recovery-guide-line" x1="${sx(ball[0])}" y1="${sy(ball[1])}" x2="${sx(recoveryTarget[0])}" y2="${sy(recoveryTarget[1])}"/>
        <g class="recovery-target-label" transform="translate(${sx(recoveryTarget[0])},${sy(recoveryTarget[1]) - 29})">
          <rect x="-43" y="-12" width="86" height="24" rx="12"/><text text-anchor="middle" dominant-baseline="central">PUNCH ${recoveryTargetYards} YD</text>
        </g>
        <g class="recovery-target-mark" transform="translate(${sx(recoveryTarget[0])},${sy(recoveryTarget[1])})"><circle r="15"/><path d="M0-10L10 0 0 10-10 0Z"><title>Recommended punch-out target</title></path></g>
      </g>` : ""}
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
      ${state.liveGpsView && liveBall ? `<g class="live-gps-ball" transform="translate(${sx(liveBall[0])},${sy(liveBall[1])})"><circle class="live-ball-halo" r="17"/><circle class="live-ball-core" r="8"><title>Latest actual GPS ball location</title></circle></g>` : ""}
      ${state.liveGpsView || humanAnimating ? "" : `<g class="ball-mark" filter="url(#soft-shadow)" transform="translate(${sx(ball[0])},${sy(ball[1])})">
        <circle r="13"/><circle class="ball-core" r="6"/><text x="0" y="-19" text-anchor="middle">YOU</text>
      </g>`}
      ${competitionActive() && strategistBall && !gameMasterAnimating ? `<g class="gm-ball-mark" filter="url(#soft-shadow)" transform="translate(${sx(strategistBall[0])},${sy(strategistBall[1])})" role="img" aria-label="Game Master ball, ${escapeHtml(strategistState.lie || "tee")}">
        <path d="M0-11L11 0 0 11-11 0Z"/><circle r="4"/><text x="0" y="-18" text-anchor="middle">GM</text><title>Game Master · ${escapeHtml(strategistState.lie || "Tee")}</title>
      </g>` : ""}
      </g>
    </svg>
    <style>
      .course-calculation-layer{display:none;pointer-events:none}
      .course-calculation-layer.is-visible{display:block}
      .course-calculation-layer polygon{fill:rgba(255,255,255,.12);stroke:#fff;stroke-width:3;stroke-dasharray:7 6;vector-effect:non-scaling-stroke}
      .course-calculation-layer [data-surface="fairway"]{stroke:#f7f16b}.course-calculation-layer [data-surface="rough"]{stroke:#9ff58f}
      .course-calculation-layer [data-surface="green"]{stroke:#7dffda}.course-calculation-layer [data-surface="bunker"]{stroke:#ffbd59}
      .course-calculation-layer [data-surface="water"]{stroke:#62c8ff}.course-calculation-layer [data-surface="out-of-bounds"]{stroke:#ff6276}
      .native-turf{opacity:.88}
      .course-illustration-image{pointer-events:none}
      .course-art-overlay{pointer-events:none}
      .rough-zone{fill:#447647;stroke:rgba(41,78,51,.42);stroke-width:2;stroke-linejoin:round}
      .rough-texture{fill:url(#rough-grain);stroke:none;opacity:.9}
      .tree-zone{fill:url(#tree-canopy);stroke:none;filter:none}
      .tree-zone-edge{opacity:.5}.tree-zone-core{opacity:1}
      .fairway-collar{fill:none;stroke:#638d50;stroke-width:16;stroke-linejoin:round;stroke-linecap:round}
      .fairway-segment{fill:#8db967;stroke:none}
      .fairway-mowing{fill:url(#fairway-mow);stroke:none;opacity:.92}
      .cart-path{fill:#aaa89f;stroke:#dfddd4;stroke-width:3;stroke-linejoin:round}
      .par-three-approach polyline{fill:none;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
      .par-three-approach-collar{stroke:#638d50}
      .par-three-approach-base{stroke:#8db967}
      .par-three-approach-mowing{stroke:url(#fairway-mow);opacity:.92}
      .tee-box-shadow{fill:#31583a;stroke:#31583a;stroke-width:9;stroke-linejoin:round;opacity:.58}
      .tee-box{fill:#b8d58a;stroke:#edf1cf;stroke-width:3;stroke-linejoin:round}
      .tee-box.tee-blue{fill:#2468c9;stroke:#dcecff}.tee-box.tee-white{fill:#f3eedb;stroke:#fffdf3}.tee-box.tee-forward{fill:#e65b9a;stroke:#ffe1ef}
      .tee-mowing{fill:url(#tee-mow);stroke:none;opacity:.9}
      .water-bank{fill:none;stroke:#2b5960;stroke-width:13;stroke-linejoin:round;filter:url(#course-feature-shadow)}
      .water-hazard{fill:url(#water-sheen);stroke:#a8d2d0;stroke-width:3;stroke-linejoin:round}
      .stream-bank{fill:#4f8791;stroke:#2b5960;stroke-width:9;stroke-linejoin:round}
      .stream-hazard{fill:url(#water-sheen);stroke:#4f91a8;stroke-width:7;stroke-linejoin:round}
      .green-fringe{fill:none;stroke:#6f994d;stroke-width:18;stroke-linejoin:round;filter:url(#course-feature-shadow)}
      .green-complex{fill:#b7d77d;stroke:#e4efb9;stroke-width:3.5;stroke-linejoin:round}
      .green-mowing{fill:url(#green-mow);stroke:none;opacity:.82}
      .sand-lip{fill:none;stroke:#8a754a;stroke-width:11;stroke-linejoin:round;filter:url(#course-feature-shadow)}
      .sand-hazard{fill:#d8c28b;stroke:#f2dfa9;stroke-width:3;stroke-linejoin:round}
      .sand-texture{fill:url(#sand-grain);stroke:none}
      .green-contour-field{opacity:1}
      .green-elevation-cell{stroke:rgba(24,49,38,.12);stroke-width:.7;shape-rendering:geometricPrecision}
      .green-contour-edge{fill:none;stroke:#f5f0dc;stroke-width:5;filter:url(#soft-shadow)}
      .green-elevation-line{stroke:rgba(255,253,243,.82);stroke-width:2.2;stroke-linecap:round}
      .green-elevation-line.level-3{stroke-width:3.2}
      .green-slope-arrow path{fill:none;stroke:rgba(255,253,243,.9);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;filter:url(#soft-shadow)}
      .green-contour-key-bg{fill:rgba(24,49,38,.9);stroke:rgba(255,253,243,.28);stroke-width:1.5}
      .green-contour-title{fill:#fffdf3;font:700 13px var(--font-system);letter-spacing:1.2px}
      .green-contour-caption{fill:rgba(255,253,243,.82);font:600 11px var(--font-system)}
      .green-contour-swatch{stroke:rgba(24,49,38,.2);stroke-width:1}
      .out-of-bounds{fill:#294a31;stroke:#f1eedf;stroke-width:2;stroke-dasharray:8 9;opacity:.82}
      .contour{stroke:rgba(241,238,223,.18);stroke-width:1;stroke-dasharray:4 12}
      .centerline{fill:none;stroke:rgba(241,238,223,.4);stroke-width:2;stroke-dasharray:5 10}
      .yardage-marker circle{stroke:#fffdf3;stroke-width:2.5;filter:url(#soft-shadow)}
      .yardage-marker.y200 circle{fill:#3f6685}
      .yardage-marker.y150 circle{fill:#f1eedf;stroke:#183126}
      .yardage-marker.y100 circle{fill:#b5523e}
      .aim-line{stroke:#f1eedf;stroke-width:2;stroke-dasharray:6 8}
      .recovery-guide{pointer-events:none}
      .recovery-guide-line{stroke:#f1c75b;stroke-width:4;stroke-linecap:round;stroke-dasharray:3 9;filter:url(#soft-shadow)}
      .recovery-target-mark circle{fill:rgba(24,49,38,.7);stroke:#f1c75b;stroke-width:3;filter:url(#soft-shadow)}
      .recovery-target-mark path{fill:#f1c75b;stroke:#183126;stroke-width:2}
      .recovery-target-label rect{fill:#183126;stroke:#f1c75b;stroke-width:2;filter:url(#soft-shadow)}
      .recovery-target-label text{fill:#fff8d5;font:800 11px var(--font-system);letter-spacing:.5px}
      .coverage-outer{fill:rgba(241,238,223,.12);stroke:rgba(241,238,223,.72);stroke-width:2;stroke-dasharray:7 7}
      .coverage-likely{fill:rgba(241,238,223,.25);stroke:#f1eedf;stroke-width:2}
      .target-mark{cursor:grab;touch-action:none}.target-mark.dragging{cursor:grabbing}.target-mark .target-hit{fill:transparent;stroke:none;pointer-events:all}.target-mark .target-core{fill:#b5523e;stroke:#f1eedf;stroke-width:3}.target-mark path{stroke:#f1eedf;stroke-width:2;pointer-events:none}
      .target-distance-label rect{fill:#fffdf3;stroke:#183126;stroke-width:1.5}.target-distance-label text{fill:#183126;font:600 14px var(--font-system)}
      .pin-mark path{stroke:#183126;stroke-width:3}.pin-mark .flag{fill:#f1eedf;stroke:none}
      .ball-mark>circle{fill:#fffdf3;stroke:#183126;stroke-width:3}.ball-mark .ball-core{fill:#183126;stroke:none;opacity:.18}
      .played-carry{fill:none;stroke:#fffdf3;stroke-width:4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:3 10;filter:url(#soft-shadow)}
      .played-roll{fill:none;stroke:#d9c995;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;filter:url(#soft-shadow)}
      .played-roll.on-green{stroke:#f59d45}
      .gm-played-carry{fill:none;stroke:#d8bd79;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:10 8;filter:url(#soft-shadow)}
      .gm-played-roll{fill:none;stroke:#76a7c7;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;filter:url(#soft-shadow)}
      .ball-mark text,.gm-ball-mark text{fill:#fffdf3;stroke:#183126;stroke-width:3px;paint-order:stroke;font:800 12px var(--font-system);letter-spacing:.8px}
      .gm-ball-mark path{fill:#d8bd79;stroke:#183126;stroke-width:3}.gm-ball-mark circle{fill:#183126;stroke:none}
      .roll-tracer{fill:#fffdf3;stroke:#f59d45;stroke-width:4;filter:url(#soft-shadow);pointer-events:none}
      .putt-roll-trace{fill:none;stroke:#f59d45;stroke-width:6;stroke-linecap:round;stroke-linejoin:round;filter:url(#soft-shadow);pointer-events:none}
      .putt-rolling-ball{filter:url(#soft-shadow);pointer-events:none}
      .putt-rolling-ball .putt-ball-halo{fill:rgba(255,253,243,.34);stroke:none}
      .putt-rolling-ball .putt-ball-body{fill:#fffdf3;stroke:#183126;stroke-width:3}
      .putt-rolling-ball .putt-ball-shine{fill:#fff;stroke:none;opacity:.9}
      .green-caddie-finish-zone{fill:rgba(216,189,121,.2);stroke:#f1d27e;stroke-width:3;stroke-dasharray:7 6;filter:url(#soft-shadow);pointer-events:none}
      .green-caddie-start-line{stroke:rgba(255,250,218,.72);stroke-width:3;stroke-dasharray:3 9;stroke-linecap:round;filter:url(#soft-shadow);pointer-events:none}
      .green-caddie-ghost-trace{fill:none;stroke:#f1d27e;stroke-width:6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:10 8;filter:url(#soft-shadow);pointer-events:none}
      .green-caddie-aim-mark path{fill:#f1d27e;stroke:#183126;stroke-width:2;pointer-events:none}
      .full-shot-flight-trace{fill:none;stroke:#fffdf3;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;filter:url(#soft-shadow);pointer-events:none}
      .full-shot-flight-ball{filter:url(#soft-shadow);pointer-events:none}
      .full-shot-flight-ball .putt-ball-halo{fill:rgba(255,253,243,.4);stroke:none}
      .full-shot-flight-ball .putt-ball-body{fill:#fffdf3;stroke:#183126;stroke-width:3}
      .full-shot-flight-ball .putt-ball-shine{fill:#fff;stroke:none;opacity:.95}
      @media(max-width:700px){.full-shot-flight-ball .animated-ball-glyph{transform:scale(1.65)}}
      @media (prefers-reduced-motion:reduce){.roll-tracer{display:none}}
      .carry-landing circle{fill:#f59d45;stroke:#fffdf3;stroke-width:3;filter:url(#soft-shadow)}
    </style>`;

  $("#course-map svg").addEventListener("click", onMapClick);
  $("#course-map svg").addEventListener("pointerup", onMapPointerUp);
  $("#course-map svg").addEventListener("pointerdown", onTargetPointerDown);
  $("#course-map svg").addEventListener("pointermove", onMapDistancePreview);
  $("#course-map svg").addEventListener("pointerleave", hideMapDistancePreview);
}

function splitPlayedPath(points, fraction) {
  if (!Array.isArray(points) || points.length < 2) return { carry: points || [], roll: [] };
  const boundedFraction = bounded(fraction, 0, 1);
  const scaled = boundedFraction * (points.length - 1);
  const before = Math.min(points.length - 2, Math.floor(scaled));
  const progress = scaled - before;
  const carryPoint = [
    points[before][0] + (points[before + 1][0] - points[before][0]) * progress,
    points[before][1] + (points[before + 1][1] - points[before][1]) * progress
  ];
  return {
    carry: [...points.slice(0, before + 1), carryPoint],
    roll: [carryPoint, ...points.slice(before + 1)],
    carryPoint
  };
}

function playedShotVisual() {
  const shot = state.puttAnimation?.shot || state.flightAnimation?.shot || state.shots.at(-1);
  if (!shot) {
    return state.lastShotLine ? { carry: state.lastShotLine, roll: [], carryPoint: null, rollOnGreen: false } : null;
  }
  if (shot.puttPacket) {
    const rollPath = Array.isArray(shot.puttPacket.path)
      ? shot.puttPacket.path.map(coursePointFromCanonical).filter(point => pointArray(point))
      : [pointArray(shot.start), pointArray(shot.resolvedBall || shot.landing)];
    return {
      carry: [],
      roll: rollPath,
      carryPoint: null,
      rollOnGreen: true,
      isPutt: true
    };
  }
  const packet = shot.resultPacket;
  const canonicalPath = Array.isArray(packet?.path)
    ? packet.path.map(coursePointFromCanonical).filter(point => pointArray(point))
    : [];
  if (canonicalPath.length < 2) {
    return state.lastShotLine ? { carry: state.lastShotLine, roll: [], carryPoint: null, rollOnGreen: false } : null;
  }
  const rollYards = Math.max(0, Number(packet.roll_yards) || 0);
  if (rollYards < .1) {
    return { carry: canonicalPath, roll: [], carryPoint: null, rollOnGreen: false };
  }
  const greensidePacket = Number.isFinite(packet?.resolved_surface ? packet.carry_yards : NaN);
  const split = greensidePacket && canonicalPath.length >= 3
    ? { carry: canonicalPath.slice(0, 2), roll: canonicalPath.slice(1), carryPoint: canonicalPath[1] }
    : splitPlayedPath(canonicalPath, Number(packet.carry_yards) / Math.max(Number(packet.total_yards), .01));
  return {
    ...split,
    rollOnGreen: packet.landing_surface === "green" || packet.resolved_surface === "green",
    isPutt: false
  };
}

function strategistPlayedShotVisual() {
  const shot = activeStrategistHoleState()?.shots?.at(-1);
  if (!shot) return null;
  if (shot.puttPacket) {
    return {
      carry: [],
      roll: (shot.puttPacket.path || []).map(coursePointFromCanonical).filter(point => pointArray(point)),
      rollOnGreen: true
    };
  }
  const packet = shot.resultPacket;
  const path = (packet?.path || []).map(coursePointFromCanonical).filter(point => pointArray(point));
  if (path.length < 2) return null;
  const rollYards = Math.max(0, Number(packet.roll_yards) || 0);
  if (rollYards < .1) return { carry: path, roll: [], rollOnGreen: false };
  const split = packet.resolved_surface && path.length >= 3
    ? { carry: path.slice(0, 2), roll: path.slice(1) }
    : splitPlayedPath(path, Number(packet.carry_yards) / Math.max(Number(packet.total_yards), .01));
  return { ...split, rollOnGreen: packet.landing_surface === "green" || packet.resolved_surface === "green" };
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
  return { "Fairway": 1, "Tee": 1, "Rough": .9, "Heavy rough": .8, "Trees": .65, "Bunker": .72, "Green": 1 }[lie] || .9;
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
  return offsetPointPerpendicular(state.ball, cup, cup, offset / 36);
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

function clearStrategyPlan() {
  state.strategySelectedId = null;
}

function preferredApproachDistance() {
  const clubs = state.profile.clubs.filter(club => club.name !== "Putter");
  return clubs.find(club => club.name.toLowerCase().includes("gap wedge"))?.carry
    || clubs.find(club => club.name.toLowerCase().includes("pitching wedge"))?.carry
    || clubs.sort((first, second) => Math.abs(first.carry - 90) - Math.abs(second.carry - 90))[0]?.carry
    || 90;
}

function verifiedPlayerPatterns() {
  if (state.playerLearning?.status !== "verified_patterns_available") return [];
  return (state.playerLearning.verified_patterns || [])
    .filter(pattern => pattern?.confidence === "verified" && pattern.kind !== "preferred_distance_band")
    .map(pattern => ({
      kind: pattern.kind,
      key: pattern.key,
      confidence: "verified",
      sample_size: pattern.sample_size,
      round_count: pattern.round_count,
      decision_score: pattern.decision_score ?? null,
      success_rate: pattern.success_rate ?? null
    }));
}

function currentStrategyChoices() {
  if (!state.profile || !state.ball || state.holeFinished || currentLieType() === "Green") {
    return [];
  }
  try {
    const surfaces = canonicalSurfaces();
    return buildStrategyChoices({
      start: canonicalPoint(state.ball),
      pin: canonicalPoint(pin().center_point),
      centerline: hole().centerline_waypoints.map(waypoint => canonicalPoint(waypoint.point)),
      fairways: hole().geometries.fairway_segments.map(segment => segment.polygon.map(canonicalPoint)),
      surfaces,
      clubs: state.profile.clubs,
      lieMultiplier: liePenalty(),
      preferredApproachYards: preferredApproachDistance(),
      startSurface: currentLieType(),
      recoveryRequired: state.shots.at(-1)?.penalty > 0 || currentLieType() === "Trees"
    });
  } catch (error) {
    console.warn("Strategy choices could not be generated.", error);
    return [];
  }
}

const strategyAnalysisCache = new Map();
const strategyAnalysisPending = new Map();
const strategyWorkerRequests = new Map();
let strategyWorkerInstance = null;
let strategyWorkerRequestId = 0;

function strategyAnalysisWorker() {
  if (typeof Worker !== "function") return null;
  if (strategyWorkerInstance) return strategyWorkerInstance;
  strategyWorkerInstance = new Worker("./packages/simulation/browser_strategy_worker.mjs?v=20260816-3", { type: "module" });
  strategyWorkerInstance.addEventListener("message", event => {
    const pending = strategyWorkerRequests.get(event.data?.requestId);
    if (!pending) return;
    strategyWorkerRequests.delete(event.data.requestId);
    if (event.data.error) pending.reject(new Error(event.data.error));
    else pending.resolve(event.data.analysis);
  });
  strategyWorkerInstance.addEventListener("error", event => {
    const error = new Error(event.message || "strategy-analysis worker failed");
    for (const pending of strategyWorkerRequests.values()) pending.reject(error);
    strategyWorkerRequests.clear();
    strategyWorkerInstance?.terminate();
    strategyWorkerInstance = null;
  });
  return strategyWorkerInstance;
}

function evaluateStrategyCandidatesAsync(candidates, analysisSeed, holeNumber) {
  const worker = strategyAnalysisWorker();
  if (!worker) return Promise.resolve(evaluateShotCandidates({
    candidates,
    sampleCount: 400,
    analysisSeed,
    holeNumber,
    simulate: (candidate, identity) => candidate.engine === "greenside"
      ? simulateGreensideShot(candidate.context, identity)
      : simulateFullShot(candidate.context, identity)
  }));
  const requestId = ++strategyWorkerRequestId;
  return new Promise((resolve, reject) => {
    strategyWorkerRequests.set(requestId, { resolve, reject });
    worker.postMessage({ requestId, candidates, sampleCount: 400, analysisSeed, holeNumber });
  });
}

function strategyAnalysisKey(choices) {
  const conditions = shotConditions(state.ball);
  return JSON.stringify({
    version: "strategy-analysis-v1",
    course: state.courseId,
    hole: state.holeIndex + 1,
    stroke: state.shots.length + 1,
    roundSeed: state.roundSeed,
    pin: canonicalPoint(pin().center_point),
    ball: canonicalPoint(state.ball),
    lie: currentLieType(),
    stance: conditions.stanceType,
    elevation: Math.round(conditions.elevationFeet * 10) / 10,
    profile: state.profile.id,
    clubs: choices.map(choice => {
      const club = state.profile.clubs[choice.clubIndex];
      return { id: choice.id, club: club.name, carry: club.carry, accuracy: club.accuracy, power: choice.power, target: choice.target };
    })
  });
}

function strategySimulationCandidate(choice) {
  const start = [...state.ball];
  const club = state.profile.clubs[choice.clubIndex];
  const power = choice.power / 100;
  const lineTarget = coursePointFromCanonical(choice.target);
  const greenside = isGreensideChip(start, club);
  const intendedTarget = greenside
    ? lineTarget
    : resolveIntentTarget(start, lineTarget, club, power) || lineTarget;
  const sidehill = greenside ? null : sidehillShotPlan(start, intendedTarget);
  return {
    id: choice.id,
    engine: greenside ? "greenside" : "full",
    deterministicOutlook: choice.outlook,
    context: greenside
      ? greensideShotSimulationContext(start, intendedTarget, club, power)
      : fullShotSimulationContext(start, intendedTarget, club, power, sidehill),
    target: choice.expectedFinish || choice.target,
    targetRadiusYards: choice.mode === "approach" ? 12 : choice.mode === "recovery" ? 15 : 18,
    successSurface: choice.mode === "approach" ? "green" : null
  };
}

function runStrategyAnalysis(choices) {
  const key = strategyAnalysisKey(choices);
  if (strategyAnalysisCache.has(key)) return strategyAnalysisCache.get(key);
  const candidates = choices.map(strategySimulationCandidate);
  const analysis = evaluateShotCandidates({
    candidates,
    sampleCount: 400,
    analysisSeed: stableAnalysisSeed(key),
    holeNumber: state.holeIndex + 1,
    simulate: (candidate, identity) => candidate.engine === "greenside"
      ? simulateGreensideShot(candidate.context, identity)
      : simulateFullShot(candidate.context, identity)
  });
  strategyAnalysisCache.set(key, analysis);
  if (strategyAnalysisCache.size > 24) strategyAnalysisCache.delete(strategyAnalysisCache.keys().next().value);
  return analysis;
}

function evaluateLockedHumanShot({ start, intendedTarget, intendedLie, club, power, sidehill, greenside }) {
  const candidate = {
    id: "human-locked-shot",
    engine: greenside ? "greenside" : "full",
    deterministicOutlook: "Competitive",
    context: greenside
      ? greensideShotSimulationContext(start, intendedTarget, club, power)
      : fullShotSimulationContext(start, intendedTarget, club, power, sidehill),
    target: canonicalPoint(intendedTarget),
    targetRadiusYards: intendedLie === "Green" ? 12 : 18,
    successSurface: intendedLie === "Green" ? "green" : null
  };
  const analysisKey = JSON.stringify({
    version: "competition-human-decision-v1",
    course: state.courseId,
    hole: state.holeIndex + 1,
    stroke: state.shots.length + 1,
    roundSeed: state.roundSeed,
    ball: canonicalPoint(start),
    target: canonicalPoint(intendedTarget),
    club: club.name,
    power
  });
  const analysis = evaluateShotCandidates({
    candidates: [candidate],
    sampleCount: 400,
    analysisSeed: stableAnalysisSeed(analysisKey),
    holeNumber: state.holeIndex + 1,
    simulate: (entry, identity) => entry.engine === "greenside"
      ? simulateGreensideShot(entry.context, identity)
      : simulateFullShot(entry.context, identity)
  });
  const summary = analysis.candidates[candidate.id];
  return {
    expected_score: expectedScoreCost(summary, {
      preferredScoringRange: [Math.max(25, preferredApproachDistance() - 20), preferredApproachDistance() + 20]
    }),
    evaluation: summary,
    analysis_identity: {
      seed: analysis.analysis_seed,
      sample_count: analysis.sample_count,
      version: analysis.version
    }
  };
}

function loadStrategyAnalysis(choices) {
  const key = strategyAnalysisKey(choices);
  if (strategyAnalysisCache.has(key)) return Promise.resolve(strategyAnalysisCache.get(key));
  if (strategyAnalysisPending.has(key)) return strategyAnalysisPending.get(key);
  const candidates = choices.map(strategySimulationCandidate);
  const pending = evaluateStrategyCandidatesAsync(
    candidates,
    stableAnalysisSeed(key),
    state.holeIndex + 1
  ).catch(error => {
    console.warn("Strategy-analysis worker fell back to the main thread.", error);
    return runStrategyAnalysis(choices);
  }).then(analysis => {
    strategyAnalysisCache.set(key, analysis);
    if (strategyAnalysisCache.size > 24) strategyAnalysisCache.delete(strategyAnalysisCache.keys().next().value);
    return analysis;
  });
  strategyAnalysisPending.set(key, pending);
  void pending.then(
    () => strategyAnalysisPending.delete(key),
    () => strategyAnalysisPending.delete(key)
  );
  return pending;
}

function renderStrategyProbabilityAnalysis(analysis, choices, selectedChoice) {
  const container = $("#strategy-probability-content");
  if (!container) return;
  const rows = [
    ["Green / target", "target_percent", "%"],
    ["Playable lie", "playable_percent", "%"],
    ["Bunker", "bunker_percent", "%"],
    ["Penalty", "penalty_percent", "%"],
    ["Typical leave", "median_leave_yards", " yd"]
  ];
  const selected = analysis.candidates[selectedChoice.id];
  const recommendedChoice = choices.find(choice => choice.id === analysis.recommended_choice_id) || selectedChoice;
  const selectedLabel = selectedChoice.mode === "approach" ? "green" : "target area";
  const miss = selected.common_miss === "mixed" ? "no single dominant miss" : `${selected.common_miss} as the most common miss`;
  const clearance = selectedChoice.nearestHazard && selectedChoice.hazardClearanceYards != null
    ? ` · ${selectedChoice.hazardClearanceYards} yd from ${selectedChoice.nearestHazard.replaceAll("_", " ")}`
    : "";
  $("#strategy-explanation-outcome").textContent = `${selectedChoice.targetLabel} · ${strategyOutlookLabel(selected.hybrid_outlook, "hybrid")} · Risk index ${selectedChoice.risk}/100${clearance}`;
  renderStrategyExplanationReasons(selectedChoice, analysis);
  container.innerHTML = `
    <p><strong>${escapeHtml(recommendedChoice.title)} is the simulation-backed recommendation.</strong> It produced the strongest course-management balance across the paired outcomes${analysis.recommendation_margin <= 3 ? "; the two plans remain close" : ""}.</p>
    <div class="strategy-probability-scroll">
      <table>
        <thead><tr><th>400-shot comparison</th>${choices.map(choice => `<th>${escapeHtml(choice.title)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(([label, key, suffix]) => `<tr><th>${label}</th>${choices.map(choice => `<td>${analysis.candidates[choice.id][key]}${suffix}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
    <p><strong>${escapeHtml(selectedChoice.title)}:</strong> ${selected.target_percent}% reached the ${selectedLabel}; ${selected.playable_percent}% stayed playable. The middle result leaves ${selected.median_leave_yards} yards, with most outcomes between ${selected.leave_p10_yards} and ${selected.leave_p90_yards} yards and ${miss}.</p>`;
}

function strategyReasonsWithoutOldRanking(choice) {
  const staleRankingPhrases = [
    "calculated recommendation among",
    "close alternative among",
    "ranks ",
    "better deterministic scoring outlook",
    "trades a higher modeled cost",
    "before paired simulation"
  ];
  return choice.reasons.filter(reason =>
    !staleRankingPhrases.some(phrase => reason.toLowerCase().includes(phrase))
  );
}

function renderStrategyExplanationReasons(choice, analysis = null) {
  const probability = analysis?.candidates?.[choice.id] || null;
  const reasons = probability
    ? [
        probability.hybrid_outlook === "Best"
          ? `This plan produced the best course-management balance across ${analysis.sample_count} paired simulations.`
          : `This plan ranked ${probability.probability_rank} of ${Object.keys(analysis.candidates).length} across ${analysis.sample_count} paired simulations.`,
        ...strategyReasonsWithoutOldRanking(choice)
      ]
    : choice.reasons;
  $("#strategy-explanation-reasons").innerHTML = reasons
    .filter(Boolean)
    .map(reason => `<li>${escapeHtml(reason)}</li>`)
    .join("");
}

function strategyOutcome(choice) {
  const landing = choice.leavesYards <= 8 ? "green target" : `${choice.leavesYards} yd left`;
  return `${choice.clubName} · ${shotPowerLabel(choice.power, choice.clubName)} · ${landing}`;
}

function strategyOutlookLabel(outlook, source = "deterministic") {
  return {
    Best: source === "hybrid" ? "Best over 400 simulations" : "Calculated recommendation",
    Competitive: "Close alternative",
    "Higher risk": "Higher-risk alternative"
  }[outlook] || "Calculated option";
}

function strategyChoiceMarkup(choice, analysis = null) {
  const selected = state.strategySelectedId === choice.id;
  const probability = analysis?.candidates?.[choice.id] || null;
  const outlook = probability?.hybrid_outlook || choice.outlook;
  const source = probability ? "hybrid" : "deterministic";
  return `
    <article class="strategy-choice ${selected ? "selected" : ""}">
      <div class="strategy-choice-head">
        <span>${escapeHtml(choice.objective)}</span>
        <button class="strategy-help" type="button" data-strategy-help="${choice.id}" aria-label="Explain ${escapeHtml(choice.title)} strategy">?</button>
      </div>
      <button class="strategy-choice-main" type="button" data-strategy-choice="${choice.id}" aria-pressed="${selected}">
        <strong>${escapeHtml(choice.title)}</strong>
        <span>${escapeHtml(choice.clubName)} · ${shotPowerLabel(choice.power, choice.clubName)} · ${choice.mode === "approach" && choice.leavesYards <= 8 ? `${choice.rollYards} yd roll` : choice.leavesYards <= 8 ? "green" : `${choice.leavesYards} yd left`}</span>
        <small>${escapeHtml(choice.targetLabel)} · ${strategyOutlookLabel(outlook, source)}</small>
      </button>
    </article>`;
}

function renderStrategyChoices() {
  const choices = currentStrategyChoices();
  const available = choices.length >= 1;
  const analysisKey = available ? strategyAnalysisKey(choices) : null;
  const analysis = analysisKey ? strategyAnalysisCache.get(analysisKey) || null : null;
  for (const prefix of ["desktop", "mobile"]) {
    const planner = $(`#${prefix}-strategy-planner`);
    const container = $(`#${prefix}-strategy-choices`);
    if (!planner || !container) continue;
    if (prefix === "desktop") {
      const toggle = $("#desktop-caddie-toggle");
      const count = $("#desktop-caddie-count");
      toggle.disabled = !available;
      toggle.setAttribute("aria-expanded", String(available && state.desktopCaddieExpanded));
      count.textContent = available
        ? `${choices.length} ${choices.length === 1 ? "option" : "options"}`
        : "Unavailable";
      planner.hidden = !available || !state.desktopCaddieExpanded;
    }
    if (!available) {
      container.innerHTML = prefix === "mobile"
        ? `<p class="mobile-carousel-empty">No separate caddie route is needed here. Use Club & Swing, then make your adjustment.</p>`
        : "";
      continue;
    }
    container.dataset.count = String(choices.length);
    container.innerHTML = choices.map(choice => strategyChoiceMarkup(choice, analysis)).join("");
    const title = $(`#${prefix}-strategy-title`);
    const hint = planner.querySelector(".strategy-planner-heading small");
    if (title) title.textContent = choices.length === 1 ? "One clear recommendation" : "Choose how to play it";
    if (hint) hint.textContent = choices.length === 1
      ? `${prefix === "mobile" ? "Tap" : "Click"} to preview the line`
      : `${prefix === "mobile" ? "Tap a plan" : "Click a plan"} to preview${prefix === "desktop" ? " its line" : ""}`;
  }
  if (available && !analysis) {
    void loadStrategyAnalysis(choices).then(() => {
      if (strategyAnalysisKey(currentStrategyChoices()) === analysisKey) renderStrategyChoices();
    }).catch(error => {
      console.warn("Strategy probability preload could not be generated.", error);
    });
  }
}

function selectStrategyChoice(choiceId) {
  const choice = currentStrategyChoices().find(item => item.id === choiceId);
  if (!choice) return;
  state.strategySelectedId = choice.id;
  state.selectedClub = choice.clubIndex;
  state.swingPower = choice.power / 100;
  state.target = coursePointFromCanonical(choice.target);
  state.manualTargetPreview = false;
  state.shotDraft = { club: true, target: true, power: true };
  rememberStructuredTarget(state.target, { resetAdjustment: true });
  updateAll();
}

function toggleDesktopCaddieChoices() {
  if (!currentStrategyChoices().length) return;
  state.desktopCaddieExpanded = !state.desktopCaddieExpanded;
  renderStrategyChoices();
  if (state.desktopCaddieExpanded) {
    $("#desktop-strategy-planner").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function showStrategyExplanation(choiceId) {
  const choices = currentStrategyChoices();
  const choice = choices.find(item => item.id === choiceId);
  if (!choice) return;
  $("#strategy-explanation-objective").textContent = choice.objective;
  $("#strategy-explanation-title").textContent = `Why ${choice.title.toLowerCase()}?`;
  $("#strategy-explanation-club").textContent = `${choice.clubName} · ${shotPowerLabel(choice.power, choice.clubName)}`;
  const clearance = choice.nearestHazard && choice.hazardClearanceYards != null
    ? ` · ${choice.hazardClearanceYards} yd from ${choice.nearestHazard.replaceAll("_", " ")}`
    : "";
  const cachedAnalysis = strategyAnalysisCache.get(strategyAnalysisKey(choices)) || null;
  const cachedProbability = cachedAnalysis?.candidates?.[choice.id] || null;
  $("#strategy-explanation-outcome").textContent = `${choice.targetLabel} · ${strategyOutlookLabel(cachedProbability?.hybrid_outlook || choice.outlook, cachedProbability ? "hybrid" : "deterministic")} · Risk index ${choice.risk}/100${clearance}`;
  renderStrategyExplanationReasons(choice, cachedAnalysis);
  const dialog = $("#strategy-explanation-dialog");
  dialog.dataset.choiceId = choice.id;
  $("#strategy-probability-content").innerHTML = `<p class="strategy-probability-loading">Running 400 paired outcomes for each plan…</p>`;
  $("#strategy-ai-verdict").textContent = "Reviewing the calculated options…";
  $("#strategy-ai-advice").textContent = "The probability comparison will be supplied to the local caddie when it is ready.";
  dialog.showModal();
  void loadStrategyAnalysis(choices).then(analysis => {
    if (dialog.dataset.choiceId !== choice.id) return;
    renderStrategyProbabilityAnalysis(analysis, choices, choice);
    return requestAiStrategyCritique(choice, choices, analysis);
  }).catch(error => {
    console.warn("Strategy probability analysis could not be generated.", error);
    if (dialog.dataset.choiceId !== choice.id) return;
    $("#strategy-probability-content").innerHTML = `<p class="strategy-probability-loading">Probability comparison unavailable. The deterministic course analysis remains available.</p>`;
    void requestAiStrategyCritique(choice, choices, null);
  });
}

function aiStrategyPayload(choice, choices, analysis = null) {
  return {
    course: { id: state.courseId, name: state.course.name },
    hole: {
      number: state.holeIndex + 1,
      par: card().Par,
      remaining_yards: Math.round(distance(state.ball, pin().center_point)),
      lie: currentLieType()
    },
    player: { profile_id: state.profile.id, profile_name: state.profile.name },
    selected_choice_id: choice.id,
    choices: choices.map(option => ({
      id: option.id,
      title: option.title,
      objective: option.objective,
      mode: option.mode,
      club: option.clubName,
      stock_carry_yards: option.stockCarryYards,
      lie_adjusted_full_carry_yards: option.lieAdjustedFullCarryYards,
      power_percent: option.power,
      swing_type: option.swingType,
      planned_carry_yards: option.carryYards,
      roll_yards: option.rollYards,
      leaves_yards: option.leavesYards,
      landing_surface: option.landingSurface,
      finish_surface: option.finishSurface,
      nearest_hazard: option.nearestHazard,
      hazard_clearance_yards: option.hazardClearanceYards,
      line_hazards: option.hazards,
      modeled_risk: option.risk,
      partial_swing_penalty: option.partialSwingPenalty,
      deterministic_outlook: option.outlook,
      hybrid_outlook: analysis?.candidates?.[option.id]?.hybrid_outlook || null,
      probability_score: analysis?.candidates?.[option.id]?.probability_score ?? null,
      advice_keys: option.adviceKeys,
      probability_analysis: analysis?.candidates?.[option.id] || null,
    })),
    probability_analysis: analysis ? {
      version: analysis.version,
      ranking_version: analysis.ranking_version,
      sample_count: analysis.sample_count,
      analysis_seed: analysis.analysis_seed,
      recommended_choice_id: analysis.recommended_choice_id,
      recommendation_margin: analysis.recommendation_margin
    } : null,
    verified_player_patterns: verifiedPlayerPatterns()
  };
}

async function requestAiStrategyCritique(choice, choices, analysis = null) {
  const response = await postAiJson("/api/ai/strategy", aiStrategyPayload(choice, choices, analysis), { retry: true });
  const dialog = $("#strategy-explanation-dialog");
  if (dialog.dataset.choiceId !== choice.id) return;
  if (!response?.advice) {
    $("#strategy-ai-verdict").textContent = "Local AI caddie unavailable";
    $("#strategy-ai-advice").textContent = "Use the calculated carry, finish, and hazard-clearance facts above.";
    return;
  }
  const recommended = choices.find(option => option.id === response.recommended_choice_id);
  const agrees = response.assessment === "agree" && recommended?.id === choice.id;
  $("#strategy-ai-verdict").textContent = agrees
    ? `Caddie agrees with ${choice.title.toLowerCase()}`
    : recommended
      ? `Caddie prefers ${recommended.title.toLowerCase()}`
      : "Caddie review";
  $("#strategy-ai-advice").textContent = [response.advice, response.tradeoff, response.library_guidance].filter(Boolean).join(" ");
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
    Trees: [.65, .45, 2.8, "trees_restricted"],
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

function fullShotSimulationContext(start, target, club, power, sidehill = null) {
  const conditions = shotConditions(start);
  const elevationMultiplier = bounded(1 - conditions.elevationFeet / Math.max(club.carry * 3, 1), .8, 1.2);
  return {
    start: canonicalPoint(start), target: canonicalPoint(target), pin: canonicalPoint(pin().center_point),
    club: authoritativeClub(club), lie: authoritativeLie(lieTypeForPoint(start), sidehill?.expected_curve_yards || 0),
    environment: {
      wind_forward_yards: 0, wind_lateral_yards: 0, wind_roll_multiplier: 1,
      elevation_carry_multiplier: elevationMultiplier,
      slope_mishit_multiplier: conditions.stance === "a fairly level stance" ? 1 : 1.1,
      surface_roll_multiplier: 1
    },
    intent: { distance_multiplier: power, complexity_multiplier: 1, label: power === 1 ? "stock" : "partial" },
    surfaces: canonicalSurfaces(), default_surface: "rough", profile_version: `browser-profile-${state.profile.id}`
  };
}

function authoritativeFullShot(start, target, club, power, sidehill) {
  const context = fullShotSimulationContext(start, target, club, power, sidehill);
  const identity = {
    roundSeed: state.roundSeed, holeNumber: state.holeIndex + 1,
    strokeIndex: competitionExecutionStrokeIndex(state.shots.length + 1)
  };
  return { packet: simulateFullShot(context, identity), request: { context, identity } };
}

function greensideShotSimulationContext(start, target, club, power) {
  const conditions = shotConditions(start);
  const contourSeed = (state.holeIndex + 1) * 17 + state.pinIndex * 11;
  const lie = authoritativeLie(lieTypeForPoint(start));
  return {
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
}

function authoritativeGreensideShot(start, target, club, power, strokeIndex) {
  const context = greensideShotSimulationContext(start, target, club, power);
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

function adjustmentRewardMessage(reward, clubName) {
  if (!reward || reward.grade === "not_declared" || reward.grade === "not_recognized") return null;
  if (reward.accuracy_bonus > 0) {
    const label = reward.grade === "excellent" ? "Excellent adjustment" :
      reward.grade === "sound" ? "Good adjustment" : "Useful adjustment";
    return `${label}: ${reward.explanation} ${clubName} accuracy improves from ${reward.base_accuracy}% to ${reward.effective_accuracy}% for this shot only.`;
  }
  return `Adjustment not rewarded: ${reward.explanation} ${clubName} remains at ${reward.base_accuracy}% accuracy.`;
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

function authoritativePutt(start, target, paceScale, identityOverride = null) {
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
      break_inches: read.breakInches,
      slope: read.slope,
      slope_degrees: read.slopeDegrees,
      downhill_strength: read.downhillStrength
    },
    pace_scale: paceScale,
    profile_version: `browser-profile-${state.profile.id}`,
    green_polygon: hole().geometries.green_complex.polygon.map(canonicalPoint),
    contour_hole_number: state.holeIndex + 1,
    contour_key: greenContourKey(),
    contour_strength: contourPuttStrength(read.feet)
  };
  const identity = identityOverride || {
    roundSeed: state.roundSeed, holeNumber: state.holeIndex + 1,
    strokeIndex: competitionExecutionStrokeIndex(state.shots.length + 1)
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
    lie: lieTypeForPoint(from),
    treeCondition: treeConditionAt(from)
  };
}

function treeConditionAt(point = state.ball) {
  const g = hole().geometries;
  const condition = evaluateTreeCondition({
    ball: point,
    pin: pin().center_point,
    treeZones: g.tree_zones || [],
    fairways: g.fairway_segments || [],
    protectedZones: [
      ...(g.tee_boxes || []),
      g.green_complex.polygon,
      ...(g.hazards || []),
      ...(g.out_of_bounds || [])
    ],
    yardsPerUnit: finiteScale()
  });
  return condition ? { ...condition, remaining_yards: distance(point, pin().center_point) } : null;
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
  return contourPuttRead({
    start: from,
    pin: pin().center_point,
    polygon: hole().geometries.green_complex.polygon,
    holeNumber: greenContourKey()
  });
}

function recommendedPuttPower(from = state.ball) {
  const read = puttingRead(from);
  const slopePaceMultiplier = bounded(1 + (Number(read.downhillStrength) || 0) * .012, .9, 1.1);
  return bounded(read.feet / PUTTER_RANGE_FEET / slopePaceMultiplier, .05, 1);
}

function activeGreenCaddieRead() {
  const read = state.greenCaddieRead;
  if (!read || read.holeIndex !== state.holeIndex || !Array.isArray(state.ball)) return null;
  return distance(read.ball, state.ball) < .01 ? read : null;
}

function greenCaddieAimLabel(read) {
  const inches = Math.abs(read.aimOffsetInches);
  return inches <= 1 ? "Start near cup center" : `Start ${inches} in ${read.aimDirection} of the cup`;
}

function greenCaddieSectionCopy(sections) {
  return sections.map((section, index) =>
    `${index === 0 ? section.label : section.label.toLowerCase()} is ${section.tendency}`
  ).join("; ");
}

function alignGreenToPlayerView() {
  if (!Array.isArray(state.ball)) return;
  state.greenViewYaw = greenPlayerViewYawDegrees(
    canonicalPoint(state.ball),
    canonicalPoint(pin().center_point)
  );
}

function showBallToPinGreenView() {
  if (!state.greenEnlarged || !Array.isArray(state.ball)) return;
  alignGreenToPlayerView();
  state.greenViewMode = "3d";
  greenOrbitDrag = null;
  updateGreenViewControls();
  renderMap();
}

function rotateGreenViewQuarterTurn() {
  if (!state.greenEnlarged) return;
  state.greenViewYaw = greenQuarterTurnYawDegrees(state.greenViewYaw);
  state.greenViewMode = "3d";
  greenOrbitDrag = null;
  updateGreenViewControls();
  renderMap();
}

function createGreenCaddieRead() {
  const recommendation = buildGreenCaddieRead({
    start: canonicalPoint(state.ball),
    pin: canonicalPoint(pin().center_point),
    greenPolygon: hole().geometries.green_complex.polygon.map(canonicalPoint),
    contourKey: greenContourKey(),
    contourStrength: contourPuttStrength(distance(state.ball, pin().center_point) * 3),
    putterRangeFeet: PUTTER_RANGE_FEET
  });
  return {
    holeIndex: state.holeIndex,
    ball: [...state.ball],
    target: coursePointFromCanonical(recommendation.target),
    landing: coursePointFromCanonical(recommendation.landing),
    path: recommendation.path.map(coursePointFromCanonical),
    aimOffsetInches: recommendation.aim_offset_inches,
    aimDirection: recommendation.aim_direction,
    pacePercent: recommendation.pace_percent,
    paceRange: recommendation.pace_range,
    finishRadiusCourse: recommendation.finish_radius_feet / 3 / finiteScale(),
    predictedLeaveFeet: recommendation.predicted_leave_feet,
    directDistanceFeet: recommendation.direct_distance_feet,
    sections: recommendation.sections
  };
}

function renderGreenCaddieReadUI() {
  const putting = state.greenEnlarged && !state.holeFinished && currentLieType() === "Green";
  const read = putting ? activeGreenCaddieRead() : null;
  const toggle = $("#green-caddie-read-toggle");
  const panel = $("#green-caddie-read-panel");
  toggle.hidden = !putting;
  toggle.setAttribute("aria-pressed", String(Boolean(read)));
  panel.hidden = !read;
  if (!read) return;
  $("#green-caddie-read-title").textContent = `${greenCaddieAimLabel(read)} · ${read.paceRange[0]}–${read.paceRange[1]}% pace`;
  const leave = read.predictedLeaveFeet < .5
    ? "The reference roll reaches the cup area"
    : `The reference roll finishes about ${Math.max(1, Math.round(read.predictedLeaveFeet))} ft from the cup`;
  $("#green-caddie-read-copy").textContent =
    `${greenCaddieSectionCopy(read.sections)}. ${leave}. Read the gold line as the contour's influence, then choose your own starting line and pace.`;
}

function toggleGreenCaddieRead() {
  if (!state.greenEnlarged || state.holeFinished || currentLieType() !== "Green") return;
  const turningOn = !activeGreenCaddieRead();
  state.greenCaddieRead = turningOn ? createGreenCaddieRead() : null;
  if (turningOn) alignGreenToPlayerView();
  renderMap();
  renderGreenCaddieReadUI();
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

function greenEdgeDistanceOnCupLine(start = state.ball) {
  const cup = pin().center_point;
  const progress = segmentPolygonEntryProgress(
    canonicalPoint(start),
    canonicalPoint(cup),
    hole().geometries.green_complex.polygon.map(canonicalPoint)
  );
  return progress === null ? null : distance(start, cup) * progress;
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
  const greenEdgeYards = greenEdgeDistanceOnCupLine(start);
  const read = puttingRead(projectPointToward(start, pin().center_point, carryYards));
  const lateralOffsetYards = (read.breakInches / 36) * 0.8 * (read.startDirection === "right" ? 1 : -1);
  const centerLanding = projectPointToward(start, pin().center_point, carryYards);
  const landingPoint = offsetPointPerpendicular(start, pin().center_point, centerLanding, lateralOffsetYards);
  return {
    clubIndex: state.profile.clubs.findIndex(item => item.name === club.candidate.name),
    clubName: club.candidate.name,
    carryYards,
    rollYards: Math.max(0, totalYards - carryYards),
    greenEdgeYards,
    landingDepthYards: greenEdgeYards === null ? null : carryYards - greenEdgeYards,
    landingPoint,
    breakInches: read.breakInches,
    startDirection: read.startDirection,
    recommendedPower: 75
  };
}

function gameMasterBriefing(includeDistance = true) {
  const c = shotConditions();
  if (c.treeCondition) return treeConditionMessage(c.treeCondition, { includeDistance });
  if (c.lie === "Green") {
    const read = puttingRead();
    const profileChance = Math.round(puttingMakeProbability(read.feet) * 100);
    const rangeWarning = read.feet > PUTTER_RANGE_FEET
      ? ` This is beyond the ${PUTTER_RANGE_FEET}-foot modeled putter range; treat it as a lag putt and expect another putt.`
      : "";
    const distanceLead = includeDistance ? `You have ${formatPuttDistance(read.feet)} to the cup. ` : "";
    const breakDescription = read.breakInches > 0
      ? `The contour moves it about ${formatInches(read.breakInches)} to the ${read.direction}; a neutral read starts roughly ${formatInches(read.breakInches)} ${read.startDirection} of the cup.`
      : "The contour is nearly straight on this line.";
    return `${distanceLead}Your profile make rate is about ${profileChance}%. ${breakDescription} This section is ${read.slope} at roughly ${read.slopeDegrees.toFixed(1)}°.${rangeWarning}`;
  }
  const chipPlan = isGreensideChip() ? recommendedChipPlan() : null;
  if (chipPlan) {
    const edgeDescription = chipPlan.greenEdgeYards === null
      ? ""
      : ` Along the direct line, the front edge of the green is about ${Math.round(chipPlan.greenEdgeYards)} yards from the ball.`;
    const landingDescription = chipPlan.landingDepthYards === null
      ? `${Math.round(chipPlan.carryYards)} yards from the ball`
      : chipPlan.landingDepthYards >= 0
        ? `${Math.round(chipPlan.carryYards)} yards from the ball—about ${Math.max(0, Math.round(chipPlan.landingDepthYards))} yards onto the green`
        : `${Math.round(chipPlan.carryYards)} yards from the ball—about ${Math.abs(Math.round(chipPlan.landingDepthYards))} yards short of the front edge`;
    const distanceLead = includeDistance ? `You have ${Math.round(c.remaining)} yards to the cup from ${c.lie.toLowerCase()}.` : `From ${c.lie.toLowerCase()},`;
    return `${distanceLead}${edgeDescription} Treat the target as a landing spot, not the cup. A ${chipPlan.clubName} should land about ${landingDescription}, then release about ${Math.round(chipPlan.rollYards)} yards toward the cup. Favor the ${chipPlan.startDirection} side by about ${formatInches(chipPlan.breakInches)}.`;
  }
  const unit = `${Math.round(c.remaining)} yards`;
  const sidehill = sidehillShotPlan(state.ball, normalShotTarget(state.ball));
  const sidehillAdvice = sidehill.stance === "level"
    ? ""
    : sidehill.stance === "ball_below_feet"
      ? ` Expect about ${Math.round(Math.abs(sidehill.expected_curve_yards) * 10) / 10} yards of movement right; aim roughly ${Math.round(Math.abs(sidehill.recommended_aim_yards) * 10) / 10} yards left.`
      : ` Expect about ${Math.round(Math.abs(sidehill.expected_curve_yards) * 10) / 10} yards of movement left; aim roughly ${Math.round(Math.abs(sidehill.recommended_aim_yards) * 10) / 10} yards right.`;
  const distanceLead = includeDistance ? `You have ${unit} to the pin from ${c.lie.toLowerCase()}. ` : "";
  return `${distanceLead}The stance has ${c.stance}, and the shot is ${c.slope}${Math.abs(c.elevationFeet) >= 4 ? ` by about ${Math.abs(Math.round(c.elevationFeet))} feet` : ""}.${sidehillAdvice}`;
}

function addGmMessage(text, role = "gm", metadata = {}) {
  state.gmMessages.push({ text, role, ...metadata });
  renderGmConversation();
}

function storeAiShotComments(shotUpdateId, texts) {
  const resultIndex = state.gmMessages.findIndex(message =>
    message.shotUpdateId === shotUpdateId && message.kind === "shot-result"
  );
  if (resultIndex < 0) return;
  const messages = texts.filter(Boolean).map(text => ({ text, role: "gm", kind: "ai-comment", shotUpdateId }));
  state.gmMessages.splice(resultIndex, 0, ...messages);
  renderGmConversation();
}

function remainingPositionMessage({ start, landing, remaining, resultLie, completionType }) {
  if (completionType === "holed") return "In the cup · 0 ft remaining.";
  const targetName = resultLie.type === "Green" ? "cup" : "pin";
  const distanceLabel = targetName === "cup"
    ? formatPuttDistance(remaining * 3)
    : `${Math.round(remaining)} ${Math.round(remaining) === 1 ? "yard" : "yards"}`;
  const lateralYards = signedAimOffsetYards(start, pin().center_point, landing);
  const lateralAmount = targetName === "cup" ? Math.abs(lateralYards * 36) : Math.abs(lateralYards);
  const centered = lateralAmount < (targetName === "cup" ? 1 : 1);
  const side = lateralYards >= 0 ? "right" : "left";
  const lateralLabel = centered
    ? `on the ${targetName} line`
    : targetName === "cup"
      ? `${lateralAmount < 36 ? formatInches(Math.round(lateralAmount)) : formatPuttDistance(lateralAmount / 12)} ${side} of the cup line`
      : `${Math.round(lateralAmount)} ${Math.round(lateralAmount) === 1 ? "yard" : "yards"} ${side} of the pin line`;
  return `${distanceLabel} to the ${targetName} · ${lateralLabel}.`;
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
      void playShot().catch(error => {
        console.error(error);
        addGmMessage(`The shot could not be played because of an internal error: ${error?.message || error}.`);
      });
    } catch (error) {
      console.error(error);
      addGmMessage(`The shot could not be played because of an internal error: ${error?.message || error}.`);
    }
  }, 180);
}

async function postAiJson(path, payload, { retry = false } = {}) {
  if (state.aiAvailable === false && !retry) return null;
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

function verifiedLearningNotesForShot(shot) {
  const patterns = verifiedPlayerPatterns();
  if (!patterns.length) return [];
  const notes = [];
  const requestContext = shot?.resultRequest?.context || {};
  const lieKey = requestContext?.lie?.lie_type || requestContext?.lie_type || {
    Tee: "tee_standard", Fairway: "fairway_clean", Rough: "rough_light",
    "Heavy rough": "rough_deep", Bunker: "bunker_fairway", Green: "green"
  }[shot?.conditionSnapshot?.lie];
  const liePattern = patterns.find(pattern =>
    ["lie_strength", "lie_improvement"].includes(pattern.kind) && pattern.key === lieKey
  );
  if (liePattern) {
    notes.push(`${liePattern.kind === "lie_strength" ? "Verified strength" : "Practice priority"} from ${formatStrategyCategory(lieKey)}: course-management decision ${liePattern.decision_score}, across ${liePattern.sample_size} shots in ${liePattern.round_count} rounds.`);
  }
  const reasons = new Set(shot?.strategyPacket?.decision?.reasons || []);
  const recurring = patterns.find(pattern =>
    pattern.kind === "recurring_decision_mistake" && reasons.has(pattern.key)
  );
  if (recurring) {
    notes.push(`This decision matches your verified recurring ${formatStrategyReason(recurring.key).toLowerCase()} pattern (${recurring.sample_size} times across ${recurring.round_count} rounds).`);
  }
  const sidehill = patterns.find(pattern =>
    ["sidehill_strength", "sidehill_improvement"].includes(pattern.kind)
  );
  if (sidehill && ["correct", "wrong_direction", "missing"].includes(shot?.sidehillPlan?.compensation)) {
    notes.push(`${sidehill.kind === "sidehill_strength" ? "Verified strength" : "Practice priority"}: ${sidehill.success_rate}% correct sidehill adjustments across ${sidehill.sample_size} shots in ${sidehill.round_count} rounds.`);
  }
  return notes.slice(0, 2);
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
      condition_snapshot: shotRecord.conditionSnapshot,
      resolved_tree_condition: shotRecord.resolvedTreeCondition,
      player_intent: shotRecord.playerIntent,
      sidehill_plan: shotRecord.sidehillPlan,
      adjustment_reward: shotRecord.adjustmentReward,
      strategy_choice: shotRecord.strategyChoice,
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

async function requestAiShotNarration(payload, shotUpdateId) {
  const response = await postAiJson("/api/ai/shot", payload);
  if (!response?.summary) {
    storeAiShotComments(shotUpdateId, ["AI review unavailable. The calculated shot result below is complete."]);
    return;
  }
  storeAiShotComments(shotUpdateId, [response.summary, response.next_play]);
}

function meaningfulReviewHoles() {
  return state.roundHistory.map((holeShots, index) => {
    const score = state.scores[index];
    const scoreToPar = score == null ? null : score - state.scorecard[index].Par;
    const penalties = holeShots.reduce((sum, shot) => sum + (shot.penalty || 0), 0);
    const reviewedDecisions = holeShots.filter(shot =>
      decisionQualityFromAssessment(packetAssessment(shot), shot.quality) === "review"
    ).length;
    const missedExecutions = holeShots.filter(shot =>
      executionQualityFromAssessment(packetAssessment(shot), shot.quality) === "review"
    ).length;
    const correctLieResponses = holeShots.filter(shot =>
      shot.adjustmentReward?.accuracy_bonus > 0 || shot.sidehillPlan?.compensation === "correct"
    ).length;
    const majorScoringSwing = scoreToPar != null && (scoreToPar <= -1 || scoreToPar >= 2);
    const meaningfulExecutionPattern = missedExecutions >= 2 || (missedExecutions >= 1 && scoreToPar != null && scoreToPar >= 2);
    const reasons = [
      penalties ? `${penalties} penalty ${penalties === 1 ? "stroke" : "strokes"}` : null,
      reviewedDecisions ? `${reviewedDecisions} strategic ${reviewedDecisions === 1 ? "decision" : "decisions"} to review` : null,
      meaningfulExecutionPattern ? `${missedExecutions} ${missedExecutions === 1 ? "shot" : "shots"} missed the plan` : null,
      majorScoringSwing ? `${fmtScore(scoreToPar)} scoring swing` : null,
      correctLieResponses ? `${correctLieResponses} correct lie ${correctLieResponses === 1 ? "response" : "responses"}` : null
    ].filter(Boolean);
    return {
      index,
      holeNumber: index + 1,
      reasons,
      severity: penalties * 100 + reviewedDecisions * 30 + (meaningfulExecutionPattern ? missedExecutions * 15 : 0) +
        (majorScoringSwing ? Math.abs(scoreToPar) * 12 : 0) + correctLieResponses * 18
    };
  }).filter(hole => hole.reasons.length)
    .sort((first, second) => second.severity - first.severity || first.holeNumber - second.holeNumber)
    .slice(0, 6);
}

function aiRoundPayload(reviewHoleNumbers = null) {
  const strategyAnalysis = analyzeRoundStrategy(state.roundHistory);
  const requestedHoles = reviewHoleNumbers ? new Set(reviewHoleNumbers) : null;
  const meaningfulByIndex = new Map(meaningfulReviewHoles()
    .filter(hole => !requestedHoles || requestedHoles.has(hole.holeNumber))
    .map(hole => [hole.index, hole]));
  return {
    course: { id: state.courseId, name: state.course.name },
    player: { profile_id: state.profile.id, profile_name: state.profile.name },
    round: {
      score_to_par: state.scores.reduce((sum, score, index) => score == null ? sum : sum + score - state.scorecard[index].Par, 0),
      completed_holes: state.scores.filter(score => score != null).length,
      scores: state.scores
    },
    strategy_analysis: strategyAnalysis,
    verified_player_patterns: verifiedPlayerPatterns(),
    holes: state.roundHistory.map((holeShots, index) => ({
      hole_number: index + 1,
      par: state.scorecard[index].Par,
      distance_yards: state.scorecard[index][`Yards_${state.tee}`],
      handicap: state.scorecard[index].Handicap,
      score: state.scores[index],
      meaningful: meaningfulByIndex.has(index),
      meaning_reasons: meaningfulByIndex.get(index)?.reasons || [],
      review_shots: holeShots.filter(shot => {
        const assessment = packetAssessment(shot);
        return overallQualityFromAssessment(assessment, shot.quality) === "bad" ||
          decisionQualityFromAssessment(assessment, shot.quality) === "review" ||
          executionQualityFromAssessment(assessment, shot.quality) === "review";
      }).length,
      shots: meaningfulByIndex.has(index) ? holeShots.map((shot, shotIndex) => ({
        stroke_number: shotIndex + 1,
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
        lesson: shot.lesson,
        strategy_packet: shot.strategyPacket || null,
        player_intent: shot.playerIntent || null,
        condition_snapshot: shot.conditionSnapshot || null,
        sidehill_plan: shot.sidehillPlan || null,
        adjustment_reward: shot.adjustmentReward || null,
        strategy_choice: shot.strategyChoice || null
      })) : []
    }))
  };
}

function setAiRoundReviewUnavailable(card) {
  const holeNumber = Number(card.dataset.aiHoleReview);
  card.querySelector("p").textContent = "AI insight unavailable. The calculated hole review remains complete.";
  card.querySelector("[data-ai-review-retry]")?.remove();
  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.className = "ai-review-retry";
  retryButton.dataset.aiReviewRetry = "";
  retryButton.textContent = "Try AI insight again";
  retryButton.addEventListener("click", () => void requestAiRoundReview([holeNumber]));
  card.append(retryButton);
}

async function requestAiRoundReview(reviewHoleNumbers = null) {
  const requestedHoles = reviewHoleNumbers ? new Set(reviewHoleNumbers) : null;
  const cards = $$('[data-ai-hole-review]').filter(card =>
    !requestedHoles || requestedHoles.has(Number(card.dataset.aiHoleReview))
  );
  cards.forEach(card => {
    card.querySelector("p").textContent = "Reviewing this meaningful hole…";
    card.querySelector("[data-ai-review-retry]")?.remove();
  });
  const holeNumbers = cards.map(card => Number(card.dataset.aiHoleReview));
  const batchSize = 2;
  let verdictUpdated = Boolean(reviewHoleNumbers);
  for (let offset = 0; offset < holeNumbers.length; offset += batchSize) {
    const batch = holeNumbers.slice(offset, offset + batchSize);
    const response = await postAiJson("/api/ai/review", aiRoundPayload(batch), { retry: true });
    const batchCards = cards.filter(card => batch.includes(Number(card.dataset.aiHoleReview)));
    if (!response || (!response.verdict && !(response.hole_reviews || []).length)) {
      batchCards.forEach(setAiRoundReviewUnavailable);
      continue;
    }
    if (!verdictUpdated) {
      const verdict = $("#round-review-summary .review-verdict p");
      if (verdict) verdict.textContent = response.verdict;
      verdictUpdated = true;
    }
    const reviews = new Map((response.hole_reviews || []).map(review => [Number(review.hole_number), review]));
    batchCards.forEach(card => {
      const review = reviews.get(Number(card.dataset.aiHoleReview));
      const label = card.querySelector("span");
      if (label) label.textContent = review?.source === "verified_fallback" ? "Verified caddie insight" : "AI Caddie insight";
      card.querySelector("p").textContent = review
        ? [
            review.insight,
            review.credit ? `Credit: ${review.credit}` : "",
            review.correction ? `Improve: ${review.correction}` : "",
            review.next_time ? `Next time: ${review.next_time}` : ""
          ].filter(Boolean).join("\n")
        : "The deterministic review identified this as meaningful, but no additional AI insight was returned.";
    });
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

const SEPARATE_FEEDBACK_KINDS = new Set(["ai-comment", "adjustment-reward", "shot-result", "position-status"]);

function conversationMessages() {
  return state.gmMessages.filter(message => !SEPARATE_FEEDBACK_KINDS.has(message.kind));
}

function latestShotFeedback() {
  for (let index = state.gmMessages.length - 1; index >= 0; index -= 1) {
    const status = state.gmMessages[index];
    if (status.kind !== "position-status" || !status.shotUpdateId) continue;
    const related = state.gmMessages.filter(message => message.shotUpdateId === status.shotUpdateId);
    const adjustment = related.find(message => message.kind === "adjustment-reward")?.text;
    const result = related.find(message => message.kind === "shot-result")?.text || "Shot calculated.";
    return {
      shotUpdateId: status.shotUpdateId,
      result: [adjustment, result].filter(Boolean).join(" "),
      status: status.text,
      aiComments: related.filter(message => message.kind === "ai-comment").map(message => message.text)
    };
  }
  return null;
}

let lastSpokenShotUpdateId = null;

function desktopGmVoiceAvailable() {
  return window.matchMedia?.("(min-width: 761px)").matches &&
    "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function speakGmText(text) {
  if (!desktopGmVoiceAvailable() || !text) return;
  const utterance = new SpeechSynthesisUtterance(String(text).replaceAll("·", "."));
  const voices = window.speechSynthesis.getVoices();
  utterance.voice = voices.find(voice => voice.lang?.toLowerCase().startsWith("en-us"))
    || voices.find(voice => voice.lang?.toLowerCase().startsWith("en"))
    || null;
  utterance.rate = .92;
  utterance.pitch = .96;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function updateGmVoiceButton() {
  const button = $("#gm-voice-toggle");
  if (!button) return;
  const supported = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  button.disabled = !supported;
  button.setAttribute("aria-pressed", String(supported && state.gmVoiceEnabled));
  button.setAttribute("aria-label", supported
    ? `Turn ${state.gmVoiceEnabled ? "off" : "on"} Game Master voice`
    : "Game Master voice is unavailable in this browser");
  button.querySelector("span").textContent = supported
    ? `Voice ${state.gmVoiceEnabled ? "on" : "off"}`
    : "No voice";
}

function restoreGmVoicePreference() {
  state.gmVoiceEnabled = localStorage.getItem(playerStorageKey("gm-voice-enabled")) === "true";
  updateGmVoiceButton();
}

function toggleGmVoice() {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
  state.gmVoiceEnabled = !state.gmVoiceEnabled;
  localStorage.setItem(playerStorageKey("gm-voice-enabled"), String(state.gmVoiceEnabled));
  updateGmVoiceButton();
  if (state.gmVoiceEnabled && desktopGmVoiceAvailable()) speakGmText("Game Master voice is on.");
  else window.speechSynthesis.cancel();
}

function announceLatestShotResult() {
  if (!state.gmVoiceEnabled || !desktopGmVoiceAvailable()) return;
  const feedback = latestShotFeedback();
  if (!feedback || feedback.shotUpdateId === lastSpokenShotUpdateId) return;
  lastSpokenShotUpdateId = feedback.shotUpdateId;
  speakGmText(`${feedback.result} ${feedback.status}`);
}

function renderShotFeedback(prefix) {
  const container = $(`#${prefix}-shot-feedback`);
  const aiContainer = $(`#${prefix}-ai-caddie-feedback`);
  if (!container || !aiContainer) return;
  const feedback = latestShotFeedback();
  container.hidden = !feedback;
  aiContainer.hidden = !feedback;
  if (!feedback) return;
  $(`#${prefix}-shot-result-copy`).textContent = feedback.result;
  $(`#${prefix}-position-status`).textContent = feedback.status;
  $(`#${prefix}-ai-caddie-copy`).textContent = feedback.aiComments.length
    ? feedback.aiComments.join(" ")
    : "Reviewing shot… Your calculated result is already available below.";
}

function sizeForTwoRecentMessages(container, minimumHeight) {
  const messages = [...container.querySelectorAll(".gm-message")].slice(-2);
  const containerStyle = getComputedStyle(container);
  const padding = parseFloat(containerStyle.paddingTop) + parseFloat(containerStyle.paddingBottom);
  const rowGap = Number.parseFloat(containerStyle.rowGap);
  const messageHeight = messages.reduce((total, message) => {
    const style = getComputedStyle(message);
    return total + message.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
  }, 0);
  const required = padding + messageHeight + (messages.length > 1 && Number.isFinite(rowGap) ? rowGap : 0) + 2;
  container.style.height = `${Math.ceil(Math.max(minimumHeight, required))}px`;
}

function renderGmConversation() {
  if (!state.gmMessages.length) state.gmMessages.push({ text: gameMasterBriefing(), role: "gm" });
  const conversation = $("#gm-conversation");
  conversation.innerHTML = conversationMessages()
    .map(message => `<p class="gm-message ${message.role === "player" ? "player" : ""} ${message.kind || ""}">${escapeHtml(message.text)}</p>`)
    .join("");
  sizeForTwoRecentMessages(conversation, 168);
  conversation.scrollTop = conversation.scrollHeight;
  renderShotFeedback("desktop");
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
  clearStrategyPlan();
  addGmMessage(text, "player");
  const normalized = text.toLowerCase().replaceAll("-", " ").replace(/\bi(?=\s*(?:inch|inches|in)\b)/g, "1");
  const parsedTarget = parseShotTargetInstruction(text);
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
      const recommendedPace = Math.round(recommendedPuttPower() * 100);
      const rangeAdvice = exactFeet > PUTTER_RANGE_FEET
        ? `The cup is beyond the ${PUTTER_RANGE_FEET}-foot modeled putter range, so use 100% as a lag putt and prioritize the next putt.`
        : `Use about ${recommendedPace}% pace, ${pace}.`;
      addGmMessage(`You have ${formatPuttDistance(exactFeet)} to the cup. It is simulated to break about ${formatInches(read.breakInches)} to the ${read.direction}, so start near ${formatInches(read.breakInches)} ${read.startDirection} of the cup. ${rangeAdvice}`);
      return { blocked: true };
    }
    const chipPlan = recommendedChipPlan();
    if (chipPlan) {
      state.selectedClub = chipPlan.clubIndex;
      state.target = chipPlan.landingPoint;
      state.swingPower = chipPlan.recommendedPower / 100;
      state.shotDraft = { club: true, target: true, power: true };
      updateAll();
      const edgeCopy = chipPlan.greenEdgeYards === null
        ? ""
        : ` The front edge is about ${Math.round(chipPlan.greenEdgeYards)} yards from the ball.`;
      const landingCopy = chipPlan.landingDepthYards === null
        ? `Land it about ${Math.round(chipPlan.carryYards)} yards from the ball.`
        : chipPlan.landingDepthYards >= 0
          ? `Land it about ${Math.round(chipPlan.carryYards)} yards from the ball, roughly ${Math.max(0, Math.round(chipPlan.landingDepthYards))} yards onto the green.`
          : `The modeled landing point is ${Math.round(chipPlan.carryYards)} yards from the ball, roughly ${Math.abs(Math.round(chipPlan.landingDepthYards))} yards short of the front edge.`;
      addGmMessage(`I like ${chipPlan.clubName}.${edgeCopy} ${landingCopy} Let it release about ${Math.round(chipPlan.rollYards)} yards toward the cup. Favor the ${chipPlan.startDirection} side by about ${formatInches(chipPlan.breakInches)}.`);
      return { blocked: true };
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
    return { blocked: true };
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
  const namedSwingPower = /(?:three|3)[ -]?quarter|3\s*\/\s*4|¾/.test(normalized) ? .75
    : /(?:two|2)[ -]?quarter|2\s*\/\s*4|half|1\s*\/\s*2|½/.test(normalized) ? .5
      : /(?:one|1)[ -]?quarter|1\s*\/\s*4|¼/.test(normalized) ? .25
        : normalized.includes("full swing") ? 1 : null;
  if (percentageMatch) {
    const requestedPower = Math.max(.05, Math.min(1, Number(percentageMatch[1]) / 100));
    state.swingPower = finePaceControl() ? requestedPower : nearestSwingPower(requestedPower);
    state.shotDraft.power = true;
  } else if (namedSwingPower !== null) {
    state.swingPower = namedSwingPower;
    state.shotDraft.power = true;
  }

  let adjustment = 0;
  if (normalized.includes("one club up") || normalized.includes("club more") || normalized.includes("extra club")) adjustment = 1;
  if (normalized.includes("one club down") || normalized.includes("club less") || normalized.includes("less club")) adjustment = -1;
  if (adjustment && !state.shotDraft.club && namedClub < 0) {
    addGmMessage(`Which club should I adjust from? For example, say “7 Iron, one club up.”`);
    return { blocked: true };
  }
  if (adjustment) {
    state.selectedClub = Math.max(0, Math.min(state.profile.clubs.length - 1, state.selectedClub - adjustment));
    state.clubAdjustment = adjustment;
    state.shotDraft.club = true;
  }
  let targetDescription = "";
  const inchOffset = parsedTarget.lateral_inches === null ? null : [
    "",
    parsedTarget.lateral_inches,
    parsedTarget.lateral_direction,
    null
  ];
  const cupEdge = normalized.match(/(?:aim\s+)?(?:at\s+|the\s+)?(left|right)\s+edge\s+of\s+(?:the\s+)?(?:cup|pin)/);
  const lateralAim = normalized.match(/(?:aim\s+)?(?:(\d+(?:\.\d+)?)\s*yards?\s+|slightly\s+)(left|right)(?:\s+of\s+(?:the\s+)?(?:pin|target|flag))?/);
  if (mapViewMode() === "putting" && cupEdge) {
    const edgeDirection = cupEdge[1];
    const cupRadiusInches = 2.125;
    state.target = puttTargetFromCup(edgeDirection === "right" ? cupRadiusInches : -cupRadiusInches);
    if (!state.target) {
      addGmMessage("I could not resolve the cup position for that putt line. Aim at the cup again or click a line on the green.");
      return { blocked: true };
    }
    targetDescription = `the ${edgeDirection} edge of the cup`;
    state.shotDraft.target = true;
  } else if (mapViewMode() === "putting" && inchOffset) {
    const offsetDirection = inchOffset[2] || inchOffset[3];
    const signedOffset = Number(inchOffset[1]) * (offsetDirection === "right" ? 1 : -1);
    state.target = puttTargetFromCup(signedOffset);
    if (!state.target) {
      addGmMessage("I could not resolve that putting line. Try the read again or click a line on the green.");
      return { blocked: true };
    }
    targetDescription = `${formatInches(inchOffset[1])} ${offsetDirection} of the cup`;
    state.shotDraft.target = true;
  } else if (mapViewMode() !== "putting" && parsedTarget.landing_yards !== null) {
    const landingPoint = projectPointToward(state.ball, pinPoint(), parsedTarget.landing_yards);
    const offsetYards = parsedTarget.lateral_inches === null
      ? 0
      : parsedTarget.lateral_inches / 36 * (parsedTarget.lateral_direction === "right" ? 1 : -1);
    state.target = offsetYards
      ? offsetPointPerpendicular(state.ball, pinPoint(), landingPoint, offsetYards)
      : landingPoint;
    targetDescription = `${Math.round(parsedTarget.landing_yards * 10) / 10} yards from the ball${parsedTarget.lateral_inches === null ? "" : `, ${formatInches(parsedTarget.lateral_inches)} ${parsedTarget.lateral_direction} of the cup line`}`;
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
  } else if (parsedTarget.explicit_pin_aim) {
    state.target = pinPoint();
    targetDescription = "the pin";
    state.shotDraft.target = true;
  }
  if (targetDescription) {
    state.manualTargetPreview = false;
    rememberStructuredTarget(state.target, { resetAdjustment: true });
  }

  const unresolvedTarget = parsedTarget.mentions_targeting && !targetDescription;
  const unresolvedOffset = parsedTarget.mentions_lateral_offset && parsedTarget.lateral_inches === null && !lateralAim;
  if (unresolvedTarget || unresolvedOffset) {
    const understoodClub = currentClub().name;
    addGmMessage(`I understood Club: ${understoodClub}, but I could not confirm the requested landing point or aim offset. Shot paused. Please use a format such as “aim 8 yards from the ball, 14 inches right,” or click the target on the map.`);
    updateAll();
    return { blocked: true };
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
  const swing = percentageMatch || namedSwingPower !== null
    ? ` at ${finePaceControl() ? `${Math.round(state.swingPower * 100)}% pace` : swingLengthLabel(state.swingPower)}`
    : "";
  const targetConfirmation = targetDescription
    ? ` You are aimed at ${targetDescription}.`
    : state.target
      ? " Your existing aim line is unchanged."
      : " Now click an aim line on the map.";
  const shotCommand = namedClub >= 0 ||
    percentageMatch !== null ||
    Boolean(targetDescription) ||
    namedSwingPower !== null ||
    normalized.includes("aim ") ||
    normalized.includes("play") ||
    normalized.includes("hit it") ||
    normalized.includes("take the shot") ||
    adjustment !== 0;
  if (shotCommand) {
    const instruction = text.trim().slice(0, 240);
    if (instruction && state.pendingPlayerInstructions.at(-1) !== instruction) {
      state.pendingPlayerInstructions = [...state.pendingPlayerInstructions, instruction].slice(-4);
    }
  }
  const clubDescription = club.name === "Putter" && mapViewMode() === "putting"
    ? `${Math.round(distance(state.ball, pin().center_point) * 3)}-foot putt`
    : `${club.name}, ${club.carry} yards`;
  const missing = [];
  if (!state.shotDraft.club) missing.push("club");
  if (!state.shotDraft.target) missing.push("aim line");
  if (!state.shotDraft.power) missing.push(club.name === "Putter" ? "pace percentage" : "swing length");
  const completeShot = shotCommand && missing.length === 0 && state.target;
  const clarification = shotCommand && missing.length
    ? ` Before I play, I still need ${missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`}.`
    : "";
  const structuredTargetConfirmation = mapViewMode() !== "putting" && parsedTarget.landing_yards !== null
    ? `Understood — Club: ${club.name} · Landing: ${Math.round(parsedTarget.landing_yards * 10) / 10} yards from ball${parsedTarget.lateral_inches !== null ? ` · Line: ${formatInches(parsedTarget.lateral_inches)} ${parsedTarget.lateral_direction} of cup line` : parsedTarget.explicit_pin_aim ? " · Line: pin" : ""}${parsedTarget.roll_to_cup ? " · Roll: toward cup" : ""} · ${finePaceControl() ? "Pace" : "Swing"}: ${finePaceControl() ? `${Math.round(state.swingPower * 100)}%` : swingLengthLabel(state.swingPower)}.${clarification}${completeShot ? " Playing now." : ""}`
    : `Understood: ${clubDescription}${swing}.${agreement}${targetConfirmation}${sidehillAgreement}${clarification}${completeShot ? " Playing now." : ""}`;
  addGmMessage(structuredTargetConfirmation);
  updateAll();
  if (completeShot && !state.holeFinished) {
    queueAutoPlay();
  }
  return { blocked: false, completeShot };
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

function hideMapDistancePreview() {
  const badge = $("#distance-badge");
  if (badge) badge.hidden = true;
}

function showMapDistancePreview(event, yardsFromBall, putting = false, hoverPoint = null) {
  if (!Number.isFinite(yardsFromBall)) {
    hideMapDistancePreview();
    return;
  }
  const badge = $("#distance-badge");
  const stage = badge.closest(".course-stage");
  const stageRect = stage.getBoundingClientRect();
  if (putting && hoverPoint) {
    const feetFromCup = distance(hoverPoint, pin().center_point) * 3;
    badge.textContent = `${formatPuttDistance(yardsFromBall * 3)} from ball · ${formatPuttDistance(feetFromCup)} from cup`;
  } else {
    badge.textContent = `${Math.round(yardsFromBall)} yd from ball`;
  }
  badge.style.left = `${bounded(event.clientX - stageRect.left, 48, stageRect.width - 48)}px`;
  badge.style.top = `${bounded(event.clientY - stageRect.top, 42, stageRect.height - 8)}px`;
  badge.hidden = false;
}

function onMapDistancePreview(event) {
  if (event.pointerType !== "mouse" || targetDragging || (state.holeFinished && !state.liveGpsView)) {
    hideMapDistancePreview();
    return;
  }
  const svg = event.currentTarget;
  const screenPoint = svgPointFromPointer(event, svg);
  if (!screenPoint) {
    hideMapDistancePreview();
    return;
  }
  const hoverPoint = coursePoint(screenPoint[0], screenPoint[1]);
  const origin = state.liveGpsView ? liveGpsBallPoint() : state.ball;
  if (!origin) return hideMapDistancePreview();
  showMapDistancePreview(event, distance(origin, hoverPoint), !state.liveGpsView && mapViewMode() === "putting", hoverPoint);
}

function onGreenDistancePreview(event) {
  if (event.pointerType !== "mouse" || greenOrbitDrag || state.holeFinished) {
    hideMapDistancePreview();
    return;
  }
  const screenPoint = svgPointFromPointer(event, event.currentTarget);
  const projection = screenPoint ? greenReliefProjection() : null;
  const hoverPoint = projection
    ? closestProjectedPolygonPoint(screenPoint, projection.greenPolygon, projection.project)
    : null;
  if (!hoverPoint) return hideMapDistancePreview();
  showMapDistancePreview(event, distance(state.ball, hoverPoint), currentLieType() === "Green", hoverPoint);
}

function onTerrainDistancePreview(event) {
  if (event.pointerType !== "mouse" || terrainOrbitDrag || state.holeFinished) {
    hideMapDistancePreview();
    return;
  }
  const screenPoint = svgPointFromPointer(event, event.currentTarget);
  const projection = screenPoint ? holeTerrainProjection() : null;
  const hoverPoint = projection
    ? closestProjectedTerrainPoint(screenPoint, state.bounds, projection.project, { maxErrorPixels: 28 })
    : null;
  if (!hoverPoint) return hideMapDistancePreview();
  showMapDistancePreview(event, distance(state.ball, hoverPoint));
}

function setTargetFromPointer(event, announce = false) {
  if (state.liveGpsView) return false;
  const svg = $("#course-map svg");
  const point = svgPointFromPointer(event, svg);
  if (!point) return false;
  const [screenX, screenY] = point;
  const frame = mapFrame();
  if (screenX < frame.left - 40 || screenX > frame.right + 40 || screenY < frame.top - 25 || screenY > frame.bottom + 25) return;
  clearStrategyPlan();
  state.target = coursePoint(screenX, screenY);
  state.manualTargetPreview = false;
  state.shotDraft.target = true;
  rememberStructuredTarget(state.target);
  renderMap();
  updateShotDesk();
  if (announce) {
    const lineDistance = distance(state.ball, state.target);
    const lineDistanceLabel = mapViewMode() === "putting"
      ? `${Math.round(lineDistance * 3)} feet`
      : `${Math.round(lineDistance)} yards`;
    $("#distance-badge").hidden = true;
    addGmMessage(mapViewMode() === "putting"
      ? `Aim line set at ${lineDistanceLabel}. Drag the marker or use the one-inch arrows to refine the line, then tell me the club and pace percentage.`
      : `Aim line set at ${lineDistanceLabel}. Drag the marker to refine the line, then choose a ¼, ½, ¾, or full swing.`);
  }
  return true;
}

function onMapClick(event) {
  if (state.liveGpsView || state.holeFinished || targetDragging || performance.now() < suppressMapClickUntil) return;
  hideMapDistancePreview();
  setTargetFromPointer(event, true);
}

function onMapPointerUp(event) {
  if (event.pointerType === "mouse") return;
  if (state.liveGpsView || state.holeFinished || targetDragging || performance.now() < suppressMapClickUntil) return;
  if (event.target.closest(".target-mark")) return;
  setTargetFromPointer(event, true);
}

function onTargetPointerDown(event) {
  if (state.liveGpsView) return;
  const targetMarkerPressed = Boolean(event.target.closest(".target-mark"));
  const enlargedPuttSurface = state.greenEnlarged &&
    state.greenViewMode === "top" &&
    currentLieType() === "Green";
  if (state.holeFinished || (!targetMarkerPressed && !enlargedPuttSurface)) return;
  hideMapDistancePreview();
  event.preventDefault();
  targetDragging = true;
  targetDragMoved = false;
  targetPointerId = event.pointerId;
  targetDragStart = [event.clientX, event.clientY];
  // The SVG is redrawn as the line moves. Capture on its stable container so
  // a phone keeps delivering the drag after that redraw.
  $("#course-map").setPointerCapture?.(event.pointerId);
}

function onTargetPointerMove(event) {
  if (mobileMapPlanDrag || mobileCarouselSwipe) return;
  if (!targetDragging || event.pointerId !== targetPointerId) return;
  event.preventDefault();
  if (targetDragStart && Math.hypot(event.clientX - targetDragStart[0], event.clientY - targetDragStart[1]) > 3) {
    targetDragMoved = true;
  }
  setTargetFromPointer(event);
}

function onTargetPointerUp(event) {
  if (!targetDragging || event.pointerId !== targetPointerId) return;
  const mapSurface = $("#course-map");
  if (mapSurface.hasPointerCapture?.(event.pointerId)) {
    mapSurface.releasePointerCapture(event.pointerId);
  }
  if (targetDragMoved) {
    state.manualTargetPreview = false;
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

function cancelTargetPointerDrag() {
  if (!targetDragging) return;
  const mapSurface = $("#course-map");
  if (targetPointerId != null && mapSurface.hasPointerCapture?.(targetPointerId)) {
    mapSurface.releasePointerCapture(targetPointerId);
  }
  targetDragging = false;
  targetDragMoved = false;
  targetPointerId = null;
  targetDragStart = null;
}

function recommendClub() {
  const targetDistance = distance(state.ball, pin().center_point);
  if (currentLieType() === "Green") {
    state.selectedClub = state.profile.clubs.findIndex(club => club.name === "Putter");
    state.swingPower = recommendedPuttPower();
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
  if (putterIndex >= 0) {
    state.selectedClub = putterIndex;
    state.swingPower = recommendedPuttPower();
  }
}

function competitionActive() {
  return Boolean(state.competition?.status === "active");
}

function competitionExecutionStrokeIndex(fallback) {
  if (!competitionActive()) return fallback;
  const turn = state.competition.turns.at(-1);
  return turn && [CompetitionPhase.BOTH_DECISIONS_LOCKED, CompetitionPhase.RESOLVING].includes(state.competition.phase)
    ? turn.paired_stroke_index
    : fallback;
}

function strategistInitialHoleState() {
  const teeBall = teePoint();
  return {
    ball: teeBall,
    lie: "Tee",
    remaining_distance_yards: distance(teeBall, pin().center_point)
  };
}

function activeStrategistHoleState() {
  if (!competitionActive()) return null;
  return strategistHoleState(state.competition, state.holeIndex, strategistInitialHoleState());
}

function withStrategistContext(callback) {
  const strategist = activeStrategistHoleState();
  if (!strategist) return null;
  const saved = {
    ball: state.ball,
    shots: state.shots,
    currentLie: state.currentLie,
    profile: state.profile,
    selectedClub: state.selectedClub,
    swingPower: state.swingPower,
    target: state.target,
    holeFinished: state.holeFinished
  };
  try {
    state.ball = pointArray(strategist.ball || teePoint());
    state.shots = strategist.shots || [];
    state.currentLie = strategist.lie || lieAt(state.ball).type;
    state.profile = normalizeProfile(structuredClone(state.competition.strategist_profile));
    state.selectedClub = 0;
    state.swingPower = 1;
    state.target = null;
    state.holeFinished = strategist.hole_finished;
    return callback(strategist);
  } finally {
    Object.assign(state, saved);
  }
}

function competitionDecisionExplanation(selection) {
  if (selection.kind === "putt") {
    return `The Game Master chose the modeled contour read and pace for a ${Math.round(selection.read.feet)}-foot putt.`;
  }
  const summary = selection.summary || {};
  const candidate = selection.choice;
  const reasons = [];
  if (Number.isFinite(summary.penalty_percent)) reasons.push(`${summary.penalty_percent}% penalty exposure`);
  if (Number.isFinite(summary.playable_percent)) reasons.push(`${summary.playable_percent}% playable-lie rate`);
  if (Number.isFinite(summary.median_leave_yards)) reasons.push(`a typical ${summary.median_leave_yards}-yard leave`);
  return `${candidate.title || candidate.objective || "This line"} produced the lowest modeled scoring cost${reasons.length ? ` with ${reasons.join(", ")}` : ""}.`;
}

function prepareCompetitionTurn(humanDecision) {
  if (!competitionActive()) return null;
  state.competition = lockCompetitionDecision(state.competition, ParticipantType.HUMAN, humanDecision);
  state.competition = markGameMasterDeciding(state.competition);
  const turn = state.competition.turns.at(-1);
  const prepared = withStrategistContext(strategist => {
    if (strategist.hole_finished) {
      return {
        decision: { kind: "holed_out", label: "Holed out", expected_score: 0, reason_codes: ["already_holed"] },
        result: null,
        event: null,
        decisionScore: 100,
        explanation: "The Game Master has already completed this hole."
      };
    }
    const start = [...state.ball];
    const identity = {
      roundSeed: state.roundSeed,
      holeNumber: state.holeIndex + 1,
      strokeIndex: turn.paired_stroke_index
    };
    if (currentLieType() === "Green") {
      const read = puttingRead(start);
      const offsetYards = read.breakInches / 36 * (read.startDirection === "right" ? 1 : -1);
      const target = offsetPointPerpendicular(start, pin().center_point, pin().center_point, offsetYards);
      const pace = recommendedPuttPower(start);
      const authoritative = authoritativePutt(start, target, pace, identity);
      const packet = authoritative.packet;
      const landing = pointArray(coursePointFromCanonical(packet.landing));
      const remaining = packet.remaining_distance_yards;
      const completionType = classifyShotCompletion(remaining);
      const penalty = 0;
      const priorScore = strategist.shots.reduce((sum, shot) => sum + 1 + (shot.penalty || 0), 0);
      const extra = completionType === "gimme" ? 1 : 0;
      const score = completionType ? priorScore + 1 + extra : null;
      const record = {
        start, landing, resolvedBall: landing, club: "Putter", power: Math.round(pace * 100),
        yards: Math.round(packet.total_yards), feet: Math.round(packet.total_yards * 3), penalty,
        lie: "Green", landingLie: "Green", remaining: Math.round(remaining), puttPacket: packet,
        puttRequest: authoritative.request, strategyPacket: scorePuttStrategy(packet)
      };
      return {
        kind: "putt", read,
        decision: { kind: "putt", club: "Putter", power_percent: Math.round(pace * 100), target: canonicalPoint(target), expected_score: null, read },
        result: record,
        event: {
          event_type: "shot_committed", stroke_index: strategist.shots.length + 1,
          stroke_count_delta: 1 + extra, penalty_strokes: 0, hole_finished: completionType !== null,
          completion_type: completionType, score, remaining_distance_yards: remaining,
          resolved_lie: "Green", resolved_ball: landing, payload: { shot: record }
        },
        decisionScore: record.strategyPacket?.decision_score ?? (packet.correct_decision ? 100 : 70)
      };
    }
    const choices = currentStrategyChoices();
    if (!choices.length) throw new Error("No legal Game Master strategy candidates were generated.");
    const analysis = runStrategyAnalysis(choices);
    const selection = selectSmartExpectedScore(choices, analysis, {
      preferredScoringRange: [Math.max(25, preferredApproachDistance() - 20), preferredApproachDistance() + 20]
    });
    const choice = selection.candidate;
    const candidate = strategySimulationCandidate(choice);
    const packet = candidate.engine === "greenside"
      ? simulateGreensideShot(candidate.context, identity)
      : simulateFullShot(candidate.context, identity);
    let landing = pointArray(coursePointFromCanonical(packet.resolved_ball || packet.landing));
    const resultLie = packet.relief
      ? resultLieFromSurface(packet.relief.resulting_surface)
      : resultLieFromSurface(packet.resolved_surface || packet.landing_surface);
    const penalty = packet.relief?.penalty_strokes || 0;
    const remaining = packet.remaining_distance_yards;
    const completionType = classifyShotCompletion(remaining);
    const extra = completionType === "gimme" ? 1 : 0;
    const priorScore = strategist.shots.reduce((sum, shot) => sum + 1 + (shot.penalty || 0), 0);
    const score = completionType ? priorScore + 1 + penalty + extra : null;
    const club = state.profile.clubs[choice.clubIndex];
    const record = {
      start,
      landing: pointArray(coursePointFromCanonical(packet.landing)),
      resolvedBall: landing,
      club: club.name,
      power: choice.power,
      yards: Math.round(packet.total_yards),
      penalty,
      relief: packet.relief,
      lie: resultLie.type,
      landingLie: resultLieFromSurface(packet.landing_surface).type,
      remaining: Math.round(remaining),
      resultPacket: packet,
      strategyChoice: {
        id: choice.id, title: choice.title, objective: choice.objective, target_label: choice.targetLabel,
        probability_analysis: selection.summary, expected_score: selection.expected_score,
        analysis_identity: { seed: analysis.analysis_seed, sample_count: analysis.sample_count }
      }
    };
    return {
      kind: "shot", choice, summary: selection.summary,
      decision: {
        kind: "shot", candidate_id: choice.id, club: club.name, club_index: choice.clubIndex,
        power_percent: choice.power, target: choice.target, target_label: choice.targetLabel,
        expected_score: selection.expected_score, evaluation: selection.summary,
        alternatives: selection.alternatives.map(item => ({ candidate_id: item.candidate.id, club: state.profile.clubs[item.candidate.clubIndex].name, expected_score: item.expected_score, evaluation: item.summary }))
      },
      result: record,
      event: {
        event_type: "shot_committed", stroke_index: strategist.shots.length + 1,
        stroke_count_delta: 1 + extra, penalty_strokes: penalty, hole_finished: completionType !== null,
        completion_type: completionType, score, remaining_distance_yards: remaining,
        resolved_lie: resultLie.type, resolved_ball: landing, payload: { shot: record }
      },
      decisionScore: Math.round(selection.summary?.probability_score ?? 70)
    };
  });
  prepared.explanation ||= competitionDecisionExplanation(prepared);
  prepared.decision.explanation = prepared.explanation;
  state.competition = lockCompetitionDecision(state.competition, ParticipantType.AI_STRATEGIST, prepared.decision);
  state.competitionPendingTurn = prepared;
  saveCompetition(localStorage, state.competition, state.player?.id);
  renderCompetitionStatus();
  return prepared;
}

function finalizeCompetitionTurn(humanResult, humanDecisionScore) {
  if (!competitionActive() || !state.competitionPendingTurn) return;
  const prepared = state.competitionPendingTurn;
  if (prepared.event) state.competition = appendStrategistResult(state.competition, state.holeIndex, prepared.event);
  state.competition = resolveCompetitionTurn(state.competition, {
    humanResult,
    strategistResult: prepared.result,
    humanDecisionScore,
    strategistDecisionScore: prepared.decisionScore
  });
  if (humanResult) {
    state.competitionComparisonTurnId = state.competition.turns.at(-1)?.id || null;
    if (state.competition.coaching_enabled) void requestCompetitionDecisionExplanation(state.competitionComparisonTurnId);
  }
  state.competition.human_round = structuredClone(state.roundState);
  state.competition = recordCompetitionHoleSummary(state.competition, state.holeIndex);
  saveCompetition(localStorage, state.competition, state.player?.id);
  state.competitionPendingTurn = null;
  renderCompetitionStatus();
  renderMap();
}

async function requestCompetitionDecisionExplanation(turnId) {
  const turn = state.competition?.turns?.find(item => item.id === turnId);
  const selected = turn?.strategist_decision;
  if (!turn || !selected || selected.kind === "holed_out") return;
  const payload = {
    profile: {
      id: state.profile.id,
      name: state.profile.name,
      preferred_scoring_range_yards: [Math.max(25, preferredApproachDistance() - 20), preferredApproachDistance() + 20]
    },
    situation: {
      hole_number: turn.hole_number,
      par: card().Par,
      lie: selected.decision_context?.lie || activeStrategistHoleState()?.lie || null,
      distance_to_pin_yards: selected.decision_context?.remaining_yards ?? null
    },
    selected,
    alternatives: selected.alternatives || []
  };
  const response = await postAiJson("/api/ai/competition-decision", payload);
  const current = state.competition?.turns?.find(item => item.id === turnId);
  if (!current) return;
  current.coach_explanation = response?.reason
    ? { ...response, unavailable: false }
    : { reason: "AI explanation temporarily unavailable. The verified strategy data remains authoritative.", unavailable: true };
  saveCompetition(localStorage, state.competition, state.player?.id);
  if (state.competitionComparisonTurnId === turnId && state.competitionComparisonOpen) {
    $("#comparison-why-copy").textContent = current.coach_explanation.reason;
  }
}

function completeStrategistHoleAfterHuman() {
  if (!competitionActive() || !state.holeFinished) return;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const strategist = activeStrategistHoleState();
    if (strategist?.hole_finished) break;
    if (state.competition.phase === CompetitionPhase.COMPARISON_READY) {
      state.competition = continueCompetition(state.competition);
    }
    const prepared = prepareCompetitionTurn({
      kind: "human_holed_out",
      club: null,
      power_percent: null,
      target: null,
      target_label: "Human already holed"
    });
    if (!prepared) break;
    finalizeCompetitionTurn(null, 100);
  }
  saveCompetition(localStorage, state.competition, state.player?.id);
}

function competitionScoreText(value) {
  if (!value) return "E";
  return value > 0 ? `+${value}` : String(value).replace("0", "E");
}

function competitionScores() {
  const humanScores = state.competition?.human_round?.holes?.map(holeState => holeState.score ?? null) || state.scores;
  const strategistScores = state.competition?.strategist_round?.holes?.map(holeState => holeState.score ?? null) || Array(18).fill(null);
  const pars = state.scorecard.map(entry => entry.Par);
  return {
    humanScores,
    strategistScores,
    human: competitionTotals(humanScores, pars),
    strategist: competitionTotals(strategistScores, pars)
  };
}

function renderCompetitionStatus() {
  const active = competitionActive();
  document.body.classList.toggle("competition-active", active);
  const header = $("#competition-score-header");
  if (!header) return;
  header.hidden = !active;
  $("#competition-button-label").textContent = active ? "Game Master" : "Play GM";
  $("#competition-exit").hidden = !active;
  if (!active) return;
  const scores = competitionScores();
  const strategist = activeStrategistHoleState();
  $("#competition-you-score").textContent = competitionScoreText(scores.human.relative_to_par);
  $("#competition-gm-score").textContent = competitionScoreText(scores.strategist.relative_to_par);
  $("#competition-you-shot").textContent = state.holeFinished ? "Holed" : `Shot ${state.shots.length + 1}`;
  $("#competition-gm-shot").textContent = state.competitionBusy
    ? state.competitionPlayback === "gm" ? "Playing…" : state.competitionPlayback === "human" ? "Waiting…" : "Deciding…"
    : strategist?.hole_finished ? "Holed" : `Shot ${(strategist?.shots?.length || 0) + 1}`;
  header.dataset.phase = state.competition.phase;
}

function setCompetitionBusy(busy) {
  state.competitionBusy = Boolean(busy);
  if (!state.competitionBusy) state.competitionPlayback = null;
  document.body.classList.toggle("competition-busy", state.competitionBusy);
  [$("#gm-form button[type='submit']"), $("#mobile-gm-form button[type='submit']"), $("#green-putt-play")]
    .filter(Boolean)
    .forEach(button => { button.disabled = state.competitionBusy; });
  renderCompetitionStatus();
}

function allowCompetitionStatusPaint() {
  return new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
}

function resultSummary(result) {
  if (!result) return "Already holed";
  const distance = result.club === "Putter" ? `${result.feet || 0} ft` : `${result.yards || 0} yd`;
  const leave = Number.isFinite(result.remaining) ? ` · ${result.remaining} yd left` : "";
  return `${result.lie || result.landingLie || "Playable"} · ${distance}${leave}`;
}

function showCompetitionComparison() {
  const turn = state.competition?.turns?.find(item => item.id === state.competitionComparisonTurnId)
    || state.competition?.turns?.at(-1);
  if (!turn?.resolved_at) return;
  const humanDecision = turn.human_decision;
  const gmDecision = turn.strategist_decision;
  const puttingComparison = humanDecision.kind === "putt" && gmDecision.kind === "putt";
  const puttLabel = (decision, result) => {
    const packet = result?.puttPacket;
    if (!packet) return `${decision.club || "Putter"} · ${decision.power_percent ?? 100}%`;
    const offset = packet.player_offset_inches < .5
      ? "at cup"
      : `${formatInches(Math.round(packet.player_offset_inches))} ${packet.player_offset_direction}`;
    return `${decision.club || "Putter"} · ${decision.power_percent ?? 100}% · ${offset}`;
  };
  const humanLabel = puttingComparison
    ? puttLabel(humanDecision, turn.human_result)
    : `${humanDecision.club || "—"} · ${humanDecision.power_percent ?? 100}%`;
  const gmLabel = gmDecision.kind === "holed_out"
    ? "Holed out"
    : puttingComparison
      ? puttLabel(gmDecision, turn.strategist_result)
      : `${gmDecision.club || "—"} · ${gmDecision.power_percent ?? 100}%`;
  const difference = (turn.strategist_decision_score ?? 0) - (turn.human_decision_score ?? 0);
  const leader = difference > 0 ? "GM" : difference < 0 ? "YOU" : "EVEN";
  const hasExpectedScores = Number.isFinite(humanDecision.expected_score) && Number.isFinite(gmDecision.expected_score);
  const expectedDifference = hasExpectedScores ? gmDecision.expected_score - humanDecision.expected_score : null;
  const expectedLeader = expectedDifference > 0 ? "YOU" : expectedDifference < 0 ? "GM" : "EVEN";
  let comparisonCopy = hasExpectedScores
    ? expectedDifference === 0
      ? "The two decisions carried the same modeled expected score."
      : `${expectedLeader} held a ${Math.abs(expectedDifference).toFixed(2)} expected-stroke strategy edge.`
    : difference === 0
      ? "The decisions received the same strategy grade."
      : `${leader} held a ${Math.abs(difference)}-point decision-grade edge.`;
  if (puttingComparison && turn.human_result?.puttPacket) {
    const humanPacket = turn.human_result.puttPacket;
    const gmPacket = turn.strategist_result?.puttPacket;
    comparisonCopy = `Compare the chosen starting lines, pace, and final leaves. Your line and pace differed from the modeled read by ${formatInches(Math.round(humanPacket.aim_error_inches))} and ${Math.round(humanPacket.power_error_points)} points`;
    if (gmPacket) comparisonCopy += `; GM's differed by ${formatInches(Math.round(gmPacket.aim_error_inches))} and ${Math.round(gmPacket.power_error_points)} points`;
    comparisonCopy += ". No numeric decision grade is used on the green.";
  }
  if (state.competition.pace === "fast") {
    const toast = $("#mobile-shot-toast");
    $("#mobile-shot-toast-title").textContent = `GM chose ${gmLabel}`;
    $("#mobile-shot-toast-copy").textContent = comparisonCopy;
    toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 4200);
    state.competition = continueCompetition(state.competition);
    saveCompetition(localStorage, state.competition, state.player?.id);
    renderCompetitionStatus();
    return;
  }
  $("#comparison-you-choice").textContent = humanLabel;
  $("#comparison-gm-choice").textContent = gmLabel;
  $("#comparison-you-result").textContent = resultSummary(turn.human_result);
  $("#comparison-gm-result").textContent = resultSummary(turn.strategist_result);
  $("#comparison-decision-row").hidden = puttingComparison;
  $("#comparison-decision-label").textContent = puttingComparison ? "Putting plan" : "Decision quality";
  $("#comparison-decision-score").textContent = `YOU ${turn.human_decision_score ?? "—"}/100 · GM ${turn.strategist_decision_score ?? "—"}/100`;
  $("#comparison-edge").textContent = puttingComparison
    ? comparisonCopy
    : `${comparisonCopy} This grades the plan, not the outcome.`;
  $("#comparison-why-copy").textContent = turn.coach_explanation?.reason || gmDecision.explanation || "Explanation loading. Verified strategy data is already available.";
  $("#comparison-why-copy").hidden = true;
  $("#competition-comparison").hidden = false;
  state.competitionComparisonOpen = true;
}

function closeCompetitionComparison({ continueRound = true } = {}) {
  $("#competition-comparison").hidden = true;
  state.competitionComparisonOpen = false;
  state.competitionComparisonTurnId = null;
  if (continueRound && state.competition?.phase === CompetitionPhase.COMPARISON_READY) {
    state.competition = continueCompetition(state.competition);
    saveCompetition(localStorage, state.competition, state.player?.id);
    renderCompetitionStatus();
  }
}

function renderCompetitionScorecard() {
  if (!competitionActive()) return;
  const { humanScores, strategistScores, human, strategist } = competitionScores();
  const roundSummary = competitionRoundSummary(state.competition, state.scorecard.map(entry => entry.Par));
  const rows = state.scorecard.map((entry, index) => `
    <tr><th scope="row">${index + 1}</th><td>${entry.Par}</td><td>${humanScores[index] ?? "—"}</td><td>${strategistScores[index] ?? "—"}</td></tr>`).join("");
  const completedSummaries = (state.competition.hole_summaries || []).filter(Boolean);
  const expectedEdge = roundSummary.expected_strategy_difference;
  const expectedCopy = Number.isFinite(expectedEdge)
    ? expectedEdge === 0
      ? "Modeled strategy is even through the completed holes."
      : `${expectedEdge > 0 ? "Game Master" : "You"} holds a ${Math.abs(expectedEdge).toFixed(2)} expected-stroke strategy edge.`
    : "Expected-score comparison will appear after comparable full-shot decisions.";
  const latestSummary = completedSummaries.at(-1);
  const finalCopy = roundSummary.holes_completed === 18
    ? `<strong>Final score · YOU ${human.strokes} · GM ${strategist.strokes}</strong>`
    : `<strong>Through ${roundSummary.holes_completed} completed hole${roundSummary.holes_completed === 1 ? "" : "s"}</strong>`;
  $("#competition-scorecard-grid").innerHTML = `
    <table class="competition-scorecard-table">
      <thead><tr><th>Hole</th><th>Par</th><th>YOU</th><th>GM</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th colspan="2">Total</th><td>${human.strokes || "—"}<small>${competitionScoreText(human.relative_to_par)}</small></td><td>${strategist.strokes || "—"}<small>${competitionScoreText(strategist.relative_to_par)}</small></td></tr></tfoot>
    </table>
    <section class="competition-round-summary" aria-label="Competition round summary">
      ${finalCopy}<p>${escapeHtml(expectedCopy)}</p>
      ${latestSummary ? `<small>Hole ${latestSummary.hole_number} · ${escapeHtml(latestSummary.narrative)}</small>` : `<small>Hole insights appear after both players hole out.</small>`}
    </section>`;
}

function renderCompetitionSetup() {
  const profiles = [...builtInProfiles, ...state.customProfiles];
  $("#competition-course").innerHTML = visibleCourses().map(course => `<option value="${escapeHtml(course.id)}" ${course.id === state.courseId ? "selected" : ""}>${escapeHtml(course.name)}</option>`).join("");
  $("#competition-tee").value = state.tee;
  $("#competition-profile").innerHTML = profiles.map(profile => `<option value="${escapeHtml(profile.id)}" ${profile.id === state.profile.id ? "selected" : ""}>${escapeHtml(profile.name)}</option>`).join("");
  const savedPace = localStorage.getItem(playerStorageKey("competition-pace")) || "normal";
  const pace = $("#competition-form").elements.namedItem("competition-pace");
  [...pace].forEach(input => { input.checked = input.value === (state.competition?.pace || savedPace); });
  $("#competition-coaching").checked = state.competition?.coaching_enabled !== false;
  $("#competition-exit").hidden = !competitionActive();
  $("#competition-setup-status").textContent = competitionActive()
    ? "A Game Master round is active. Starting again creates a fresh competition; your solo round remains saved."
    : "Your current solo round will remain saved separately.";
}

async function restoreCompetitionRound() {
  const savedCompetitions = visibleCourses().map(course => {
    try {
      return loadCompetition(localStorage, course.id, state.player?.id);
    } catch (error) {
      console.warn(`Ignored an invalid saved Game Master round for ${course.id}.`, error);
      return null;
    }
  }).filter(competition => competition?.status === "active")
    .sort((first, second) => String(second.created_at).localeCompare(String(first.created_at)));
  let competition = savedCompetitions[0];
  if (!competition) return false;
  if (competition.course_id !== state.courseId) await loadData(competition.course_id);
  const recovery = recoverInterruptedCompetition(competition);
  competition = recovery.competition;
  state.competition = competition;
  state.competitionRecoveryMessage = recovery.recovered
    ? recovery.replay_required
      ? "The last paired turn was interrupted before the Game Master finished. Its original data was archived and the shot was returned to the pre-shot position so you can replay it."
      : "An interrupted Game Master decision was cleared. You can play the shot again."
    : null;
  state.profile = normalizeProfile(structuredClone(competition.human_profile_snapshot));
  state.tee = competition.tee;
  state.roundSeed = competition.round_seed;
  state.roundState = structuredClone(competition.human_round || createRoundState({
    courseId: competition.course_id,
    roundSeed: competition.round_seed,
    tee: competition.tee
  }));
  state.holeIndex = bounded(Number(competition.current_hole || 1) - 1, 0, 17);
  state.pinIndex = rotatingPinIndex(state.holeIndex, hole().geometries.green_complex.pin_zones.length);
  syncRoundStateCaches();
  saveCompetition(localStorage, state.competition, state.player?.id);
  if (state.competition.phase === CompetitionPhase.COMPARISON_READY) {
    state.competitionComparisonTurnId = state.competition.turns.at(-1)?.id || null;
  }
  return true;
}

async function startCompetitionFromSetup(event) {
  event.preventDefault();
  const courseId = $("#competition-course").value;
  const tee = $("#competition-tee").value;
  const profileId = $("#competition-profile").value;
  const pace = new FormData(event.currentTarget).get("competition-pace") || "normal";
  if (courseId !== state.courseId) await loadData(courseId);
  const profile = [...builtInProfiles, ...state.customProfiles].find(candidate => candidate.id === profileId) || state.profile;
  state.profile = normalizeProfile(structuredClone(profile));
  state.tee = tee;
  state.roundSeed = newRoundSeed();
  state.competition = createCompetitionRound({
    courseId, tee, roundSeed: state.roundSeed, humanProfile: state.profile,
    pace, coachingEnabled: $("#competition-coaching").checked
  });
  const fairness = validateSameGameplayProfile(state.profile, state.competition.strategist_profile);
  if (!fairness.same_profile) throw new Error("The Game Master profile clone did not pass fairness validation.");
  state.roundState = createRoundState({ courseId, roundSeed: state.roundSeed, tee });
  state.competition.human_round = structuredClone(state.roundState);
  state.holeIndex = 0;
  state.pinIndex = rotatingPinIndex(0, hole().geometries.green_complex.pin_zones.length);
  localStorage.setItem(playerStorageKey("competition-pace"), pace);
  saveCompetition(localStorage, state.competition, state.player?.id);
  resetHole();
  renderCompetitionStatus();
  $("#competition-dialog").close();
  addGmMessage("Competition started. The Game Master has the same golfer profile and receives paired execution luck. Only the decisions differ.");
}

async function exitCompetition() {
  if (!competitionActive()) return;
  state.competition.status = "exited";
  state.competition.exited_at = new Date().toISOString();
  saveCompetition(localStorage, state.competition, state.player?.id);
  state.competition = null;
  state.competitionPendingTurn = null;
  setCompetitionBusy(false);
  closeCompetitionComparison({ continueRound: false });
  await loadData(state.courseId);
  resetHole();
  renderCompetitionStatus();
  $("#competition-dialog").close();
}

async function playShot() {
  if (!state.target || state.holeFinished) return;
  if (competitionActive() && state.competitionBusy) return;
  if (competitionActive() && state.competition.phase === CompetitionPhase.COMPARISON_READY) {
    state.competitionComparisonTurnId ||= state.competition.turns.at(-1)?.id || null;
    showCompetitionComparison();
    addGmMessage("Review the last paired shot, then press Continue before playing the next one.");
    return;
  }
  state.desktopCaddieExpanded = false;
  state.greenCaddieRead = null;
  clearPuttAnimation();
  clearFlightAnimation();
  $("#putt-analysis").hidden = true;
  const strokeIndex = state.shots.length + 1;
  const start = [...state.ball];
  const preShotTerrainBounds = state.bounds ? { ...state.bounds } : null;
  const startingConditions = shotConditions(start);
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
  const availableStrategyChoices = state.strategySelectedId ? currentStrategyChoices() : [];
  const playedStrategy = availableStrategyChoices.find(choice => choice.id === state.strategySelectedId) || null;
  let playedStrategyAnalysis = null;
  if (playedStrategy) {
    try {
      playedStrategyAnalysis = runStrategyAnalysis(availableStrategyChoices);
    } catch (error) {
      console.warn("Strategy probability analysis was not stored with this shot.", error);
    }
  }
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
  let competitionTurn = null;
  let competitionHumanDecisionScore = null;
  if (competitionActive()) {
    setCompetitionBusy(true);
    await allowCompetitionStatusPaint();
    try {
      const humanEvaluation = isPutt ? null : evaluateLockedHumanShot({
        start,
        intendedTarget,
        intendedLie,
        club,
        power: usedPower,
        sidehill,
        greenside: isGreenside
      });
      competitionTurn = prepareCompetitionTurn({
        kind: isPutt ? "putt" : "shot",
        club: club.name,
        power_percent: Math.round(usedPower * 100),
        target: canonicalPoint(intendedTarget),
        target_label: intendedLie,
        decision_context: {
          lie: startingConditions.lie,
          remaining_yards: Math.round(startingConditions.remaining),
          planned_risk: plannedRisk
        },
        expected_score: humanEvaluation?.expected_score ?? null,
        evaluation: humanEvaluation?.evaluation ?? null,
        analysis_identity: humanEvaluation?.analysis_identity ?? null
      });
    } catch (error) {
      console.error("Game Master decision failed", error);
      state.competitionPendingTurn = null;
      setCompetitionBusy(false);
      addGmMessage(`The Game Master could not generate a legal strategy decision, so this paired turn was not played. ${error.message}`);
      return;
    }
  }
  const adjustmentReward = isPutt ? null : gradeAdjustmentReward({
    instructions: state.pendingPlayerInstructions,
    sidehillPlan: sidehill,
    slope: startingConditions.slope,
    clubAdjustment: state.clubAdjustment,
    lie: startingConditions.lie,
    baseAccuracy: club.accuracy
  });
  const effectiveClub = adjustmentReward?.accuracy_bonus > 0
    ? { ...club, accuracy: adjustmentReward.effective_accuracy }
    : club;
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
      requiredPower: recommendedPuttPower(start),
      usedPower,
      playerOffsetInches: puttPacket.player_offset_inches,
      playerOffsetDirection: puttPacket.player_offset_direction
    };
  } else {
    const authoritative = isGreenside
      ? authoritativeGreensideShot(start, intendedTarget, effectiveClub, usedPower, competitionExecutionStrokeIndex(strokeIndex))
      : authoritativeFullShot(start, intendedTarget, effectiveClub, usedPower, sidehill);
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
  const landingTreeCondition = treeConditionAt(authoritativeLanding);
  const landingLie = landingTreeCondition
    ? { type: "Trees", color: "#315a3b" }
    : resultPacket ? resultLieFromSurface(resultPacket.landing_surface) : { type: "Green", color: "#c3da83" };
  const relief = resultPacket?.relief || null;
  const penalty = relief?.penalty_strokes || 0;
  if (relief) landing = pointArray(coursePointFromCanonical(relief.ball_position));
  const resultLie = relief
    ? resultLieFromSurface(relief.resulting_surface)
    : lieAt(landing);
  const resolvedTreeCondition = relief ? null : treeConditionAt(landing);

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
    sidehillPlan: sidehill,
    adjustmentReward,
    conditionSnapshot: {
      lie: startingConditions.lie,
      stance: startingConditions.stanceType,
      slope: startingConditions.slope,
      elevation_feet: Math.round(startingConditions.elevationFeet * 10) / 10,
      remaining_yards: Math.round(startingConditions.remaining),
      tree_condition: startingConditions.treeCondition
    },
    resolvedTreeCondition,
    playerIntent: state.pendingPlayerInstructions.length || state.pendingPlayerNote ? {
      instructions: [...state.pendingPlayerInstructions],
      note: state.pendingPlayerNote || null,
      club_adjustment: state.clubAdjustment,
      selected_club: club.name,
      power_percent: Math.round(usedPower * 100)
    } : null,
    strategyChoice: playedStrategy ? {
      version: playedStrategy.version,
      id: playedStrategy.id,
      title: playedStrategy.title,
      objective: playedStrategy.objective,
      mode: playedStrategy.mode,
      target_label: playedStrategy.targetLabel,
      outlook: playedStrategyAnalysis?.candidates?.[playedStrategy.id]?.hybrid_outlook || playedStrategy.outlook,
      deterministic_outlook: playedStrategy.outlook,
      hybrid_outlook: playedStrategyAnalysis?.candidates?.[playedStrategy.id]?.hybrid_outlook || null,
      probability_score: playedStrategyAnalysis?.candidates?.[playedStrategy.id]?.probability_score ?? null,
      recommended_by: playedStrategyAnalysis ? "paired_simulation" : "deterministic_fallback",
      planned_leave_yards: playedStrategy.leavesYards,
      modeled_risk: playedStrategy.risk,
      probability_analysis: playedStrategyAnalysis?.candidates?.[playedStrategy.id] || null,
      analysis_identity: playedStrategyAnalysis ? {
        version: playedStrategyAnalysis.version,
        ranking_version: playedStrategyAnalysis.ranking_version,
        seed: playedStrategyAnalysis.analysis_seed,
        sample_count: playedStrategyAnalysis.sample_count,
        recommended_choice_id: playedStrategyAnalysis.recommended_choice_id,
        recommendation_margin: playedStrategyAnalysis.recommendation_margin
      } : null
    } : null
  };
  state.target = null;
  state.manualTargetPreview = false;
  state.swingPower = 1;
  state.shotDraft = { club: false, target: false, power: false };
  state.structuredShot = { aim: "", adjustment: "none", offset: 1, selectedTarget: null };
  state.pendingPlayerInstructions = [];
  state.pendingPlayerNote = "";
  state.clubAdjustment = 0;
  state.strategySelectedId = null;
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
    const costly = penalty > 0 || ["Bunker", "Heavy rough", "Trees", "Water", "Out of bounds"].includes(resultLie.type);
    shotRecord.decisionQuality = decisionQualityFromAssessment(resultPacket?.assessment);
    shotRecord.executionQuality = executionQualityFromAssessment(resultPacket?.assessment);
    shotRecord.risk = resultPacket?.assessment?.decision_risk ?? plannedRisk;
    shotRecord.quality = overallQualityFromAssessment(resultPacket?.assessment);
    shotRecord.lesson = relief
      ? `${club.name} · ${shotPowerLabel(shotRecord.power, club.name)} entered ${landingLie.type.toLowerCase()}; ${relief.relief_type.replaceAll("_", " ")} added one penalty stroke and the ball finished in ${resultLie.type.toLowerCase()}.`
      : resultLie.type === intendedLie
      ? `${club.name} · ${shotPowerLabel(shotRecord.power, club.name)} finished in the intended ${intendedLie.toLowerCase()}.`
      : `${club.name} · ${shotPowerLabel(shotRecord.power, club.name)} missed the intended ${intendedLie.toLowerCase()} and finished in ${resultLie.type.toLowerCase()}${costly ? ", costing position or a penalty" : ""}.`;
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
  if (competitionTurn) {
    competitionHumanDecisionScore = Math.round(
      state.competition?.turns?.at(-1)?.human_decision?.evaluation?.probability_score ??
      playedStrategyAnalysis?.candidates?.[playedStrategy?.id]?.probability_score ??
      strategyPacket?.decision_score ??
      Math.max(0, 100 - plannedRisk)
    );
    state.competitionPlayback = "human";
    renderCompetitionStatus();
  }
  const puttRollAnimation = puttPacket ? beginPuttAnimation(puttPacket, strokeIndex) : null;
  const fullShotFlightAnimation = resultPacket
    ? beginFlightAnimation(resultPacket, strokeIndex, preShotTerrainBounds, start)
    : null;
  const shotUpdateId = `shot-${state.holeIndex + 1}-${strokeIndex}-${++gmShotUpdateSequence}`;
  const rewardMessage = adjustmentRewardMessage(adjustmentReward, club.name);
  if (rewardMessage) {
    addGmMessage(rewardMessage, "gm", { kind: "adjustment-reward", shotUpdateId });
  }
  if (completionType === "holed") {
    finishHole(0, "holed", { kind: "shot-result", shotUpdateId });
    addGmMessage(
      remainingPositionMessage({ start, landing, remaining, resultLie, completionType }),
      "gm",
      { kind: "position-status", shotUpdateId }
    );
  } else if (completionType === "gimme") {
    finishHole(1, "gimme", { kind: "shot-result", shotUpdateId });
    addGmMessage(
      remainingPositionMessage({ start, landing, remaining, resultLie, completionType }),
      "gm",
      { kind: "position-status", shotUpdateId }
    );
  } else {
    state.ball = pointArray(landing);
    state.currentLie = resultLie.type;
    autoSelectClubForLie();
    const missDistance = distance(authoritativeLanding, intendedTarget);
    const costlyMiss = penalty > 0 || ["Bunker", "Heavy rough", "Trees", "Water", "Out of bounds"].includes(resultLie.type);
    const penaltyOutcome = relief?.reason === "water"
      ? `The shot entered the water. One penalty stroke was added and the ball was dropped near its last boundary crossing.`
      : relief?.reason === "out_of_bounds"
        ? `The shot finished out of bounds. One penalty stroke was added and stroke-and-distance returned you to the previous position.`
        : null;
    const outcome = puttingEvaluation
      ? puttingEvaluation.correctDecision
        ? `That was the right read and pace, but the ${Math.round(puttingEvaluation.makeProbability * 100)}% profile-based make chance did not fall this time.`
        : `That putt missed because the decision was off by about ${formatInches(Math.round(puttingEvaluation.aimErrorInches))} of starting line and ${Math.round(puttingEvaluation.powerErrorPoints)} percentage points of pace.`
      : penaltyOutcome
        ? penaltyOutcome
      : resultLie.type === intendedLie
      ? `Good shot. You held the ${resultLie.type.toLowerCase()} and finished about ${Math.round(missDistance)} yards from your intended landing point.`
      : costlyMiss
        ? `That was a costly miss. You aimed for ${intendedLie.toLowerCase()}, but the shot dispersed about ${Math.round(missDistance)} yards and finished in ${resultLie.type.toLowerCase()}.`
        : `That shot missed your intended ${intendedLie.toLowerCase()}. It dispersed about ${Math.round(missDistance)} yards and finished in ${resultLie.type.toLowerCase()}.`;
    if (!rewardMessage && sidehill?.compensation === "correct") {
      addGmMessage(`Correct sidehill decision: your ${Math.abs(sidehill.player_aim_yards)}-yard ${sidehill.player_aim_yards > 0 ? "right" : "left"} adjustment opposed the expected ${Math.abs(sidehill.expected_curve_yards)}-yard curve.`, "gm", { kind: "coaching", shotUpdateId });
    } else if (!rewardMessage && sidehill && sidehill.compensation !== "not_required") {
      addGmMessage(`Sidehill review: with ${shotConditions(start).stance}, the recommended aim was about ${Math.abs(sidehill.recommended_aim_yards)} yards ${sidehill.recommended_aim_yards > 0 ? "right" : "left"}.`, "gm", { kind: "coaching", shotUpdateId });
    }
    addGmMessage(gameMasterBriefing(false), "gm", { kind: "coaching", shotUpdateId });
    addGmMessage(outcome, "gm", { kind: "shot-result", shotUpdateId });
    addGmMessage(
      remainingPositionMessage({ start, landing, remaining, resultLie, completionType }),
      "gm",
      { kind: "position-status", shotUpdateId }
    );
  }
  void requestAiShotNarration(aiShotPayload({
    shotRecord,
    puttingEvaluation,
    plannedRisk,
    remaining,
    completionType,
    resultLie,
    intendedTarget
  }), shotUpdateId);
  renderMap();
  updateAll(false);
  if (!isPutt && window.matchMedia?.("(max-width: 760px)").matches) {
    setMobileQuickPanel(null);
    setMobileCarouselPage(1);
  }
  const presentShotResult = () => {
    if (puttRollAnimation && state.puttAnimation && state.puttAnimation !== puttRollAnimation) return;
    if (fullShotFlightAnimation && state.flightAnimation && state.flightAnimation !== fullShotFlightAnimation) return;
    if (puttRollAnimation && state.puttAnimation === puttRollAnimation) {
      state.puttAnimation = null;
      puttAnimationTimer = null;
      renderMap();
      if (completionType === "holed") playBallInHoleSound();
    }
    if (fullShotFlightAnimation && state.flightAnimation === fullShotFlightAnimation) {
      state.flightAnimation = null;
      flightAnimationTimer = null;
      renderMap();
      syncMobileSheetUI();
    }
    showResult(resultLie, remaining, penalty);
    if (puttingEvaluation) renderPuttAnalysis(puttingEvaluation, remaining);
    if (competitionTurn) showCompetitionComparison();
    if (state.holeFinished && state.holeIndex === 17) {
      window.setTimeout(openRoundReview, 650);
    }
  };
  const finishGameMasterPlayback = gmAnimation => {
    if (gmAnimation?.putt && state.puttAnimation === gmAnimation.putt) {
      state.puttAnimation = null;
      puttAnimationTimer = null;
    }
    if (gmAnimation?.flight && state.flightAnimation === gmAnimation.flight) {
      state.flightAnimation = null;
      flightAnimationTimer = null;
    }
    finalizeCompetitionTurn(shotRecord, competitionHumanDecisionScore);
    if (completionType) completeStrategistHoleAfterHuman();
    setCompetitionBusy(false);
    renderMap();
    presentShotResult();
  };
  const playGameMasterShot = () => {
    if (puttRollAnimation && state.puttAnimation === puttRollAnimation) {
      state.puttAnimation = null;
      puttAnimationTimer = null;
      if (completionType === "holed") playBallInHoleSound();
    }
    if (fullShotFlightAnimation && state.flightAnimation === fullShotFlightAnimation) {
      state.flightAnimation = null;
      flightAnimationTimer = null;
    }
    state.competitionPlayback = "gm";
    renderCompetitionStatus();
    renderMap();
    const gmShot = competitionTurn?.result;
    window.setTimeout(() => {
      if (!competitionActive() || state.competitionPendingTurn !== competitionTurn) return;
      const strategist = activeStrategistHoleState();
      const gmStrokeIndex = (strategist?.shots?.length || 0) + 1;
      const gmPuttAnimation = gmShot?.puttPacket
        ? beginPuttAnimation(gmShot.puttPacket, gmStrokeIndex, gmShot, "gm")
        : null;
      const gmFlightAnimation = gmShot?.resultPacket
        ? beginFlightAnimation(gmShot.resultPacket, gmStrokeIndex, preShotTerrainBounds, gmShot.start, gmShot, "gm")
        : null;
      const gmAnimation = { putt: gmPuttAnimation, flight: gmFlightAnimation };
      renderMap();
      if (gmPuttAnimation) {
        puttAnimationTimer = window.setTimeout(() => finishGameMasterPlayback(gmAnimation), gmPuttAnimation.durationMs + 80);
      } else if (gmFlightAnimation) {
        flightAnimationTimer = window.setTimeout(() => finishGameMasterPlayback(gmAnimation), gmFlightAnimation.durationMs + 80);
      } else {
        window.setTimeout(() => finishGameMasterPlayback(gmAnimation), 450);
      }
    }, 500);
  };
  const finishHumanPlayback = competitionTurn ? playGameMasterShot : presentShotResult;
  if (puttRollAnimation) {
    puttAnimationTimer = window.setTimeout(finishHumanPlayback, puttRollAnimation.durationMs + 80);
  } else if (fullShotFlightAnimation) {
    flightAnimationTimer = window.setTimeout(finishHumanPlayback, fullShotFlightAnimation.durationMs + 80);
  } else {
    finishHumanPlayback();
  }
}

function finishHole(extraStroke = 0, completionType = "holed", messageMetadata = {}) {
  const strokes = state.scores[state.holeIndex] ?? (state.shots.reduce((sum, shot) => sum + 1 + shot.penalty, 0) + extraStroke);
  if (completionType === "holed" && !state.puttAnimation) playBallInHoleSound();
  addGmMessage(holeCompletionMessage(strokes), "gm", messageMetadata);
}

function openHoleCompleteDialog() {
  const dialog = $("#hole-complete-dialog");
  if (!dialog) return;
  const strokes = state.scores[state.holeIndex] ?? state.shots.reduce((sum, shot) => sum + 1 + shot.penalty, 0);
  const relative = strokes - card().Par;
  const nextButton = $("#hole-complete-next");
  const finalPuttYards = Number(state.shots.at(-1)?.puttPacket?.remaining_distance_yards);
  const gimmeDistance = Number.isFinite(finalPuttYards)
    ? formatPuttDistance(finalPuttYards * 3)
    : "inside two feet";
  $("#hole-complete-title").textContent = state.completionType === "gimme"
    ? "Gimme · inside two feet"
    : "Holed";
  $("#hole-complete-copy").textContent = state.completionType === "gimme"
    ? `That finished ${gimmeDistance} from the cup, so the next putt is conceded as a gimme. You completed Hole ${state.holeIndex + 1} in ${strokes} strokes for ${golfScoreName(relative)}.`
    : `It is holed. You completed Hole ${state.holeIndex + 1} in ${strokes} strokes for ${golfScoreName(relative)}.`;
  nextButton.textContent = state.holeIndex < 17 ? `Play Hole ${state.holeIndex + 2}` : "Review round";
  // Mobile Safari can leave the fixed enlarged-green layer above a newly
  // opened dialog. Remove that layer first, then open on the next frame.
  if (state.greenEnlarged) closeEnlargedGreen();
  window.requestAnimationFrame(() => {
    if (dialog.open) return;
    try {
      dialog.showModal();
    } catch {
      // Older mobile WebKit still displays an opened dialog correctly after
      // the enlarged layer has been removed, even if showModal is rejected.
      dialog.setAttribute("open", "");
    }
  });
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
  const resultDistance = last.club === "Putter"
    ? formatPuttDistance((last.puttPacket?.total_yards ?? 0) * 3)
    : `${last.yards} yards`;
  const resultTitle = state.holeFinished
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
  const resultCopy = state.holeFinished
    ? `${fmtScore(state.scores[state.holeIndex] - card().Par)} on the hole. ${state.holeIndex < 17 ? "Move to the next tee when ready." : "Your round is complete."}`
    : last.club === "Putter"
      ? `${formatPuttDistance(remaining * 3)} remain.${reliefCopy}`
      : `${Math.round(remaining)} yards remain.${reliefCopy}`;
  showMobileShotToast(resultTitle, resultCopy);
  announceLatestShotResult();
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
  const nine = (label, start) => {
    const nineScores = state.scores.slice(start, start + 9);
    const completed = nineScores.filter(score => Number.isInteger(score));
    const nineRelative = nineScores.reduce((total, score, offset) =>
      Number.isInteger(score) ? total + score - Number(state.scorecard[start + offset].Par) : total, 0);
    const status = completed.length ? `${completed.length}/9 · ${fmtScore(nineRelative)}` : "Not started";
    return `<section class="round-nine-card" aria-label="${label}">
      <header><strong>${label}</strong><span>${status}</span></header>
      <div class="round-nine-holes">
        ${state.scorecard.slice(start, start + 9).map((entry, offset) => {
          const index = start + offset;
          const score = state.scores[index];
          const relative = score == null ? "" : fmtScore(score - entry.Par);
          return `<button type="button" class="round-hole ${score == null ? "" : "complete"} ${index === state.holeIndex ? "active" : ""}" data-round-hole="${index}" aria-label="Go to hole ${index + 1}${score == null ? `, par ${entry.Par}, not played` : `, par ${entry.Par}, score ${score}, ${relative}`}" ${index === state.holeIndex ? 'aria-current="step" disabled' : ""}>
            <span class="round-hole-number">${index + 1}</span>
            <small>Par ${entry.Par}</small>
            <strong class="round-hole-score">${score == null ? '<span class="round-hole-unplayed">—</span>' : scoreMarkMarkup(score, entry.Par)}</strong>
          </button>`;
        }).join("")}
      </div>
    </section>`;
  };
  return nine("Front nine", 0) + nine("Back nine", 9);
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
  const mapDate = new Date(state.course.mapUpdatedAt);
  const readableMapDate = Number.isNaN(mapDate.getTime())
    ? "date unavailable"
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(mapDate);
  const mapStatus = $("#map-version-status");
  mapStatus.textContent = `${state.course.isCustomMap ? "Custom map" : "Built-in map"} · Updated ${readableMapDate}`;
  mapStatus.classList.toggle("custom", state.course.isCustomMap === true);
  $("#course-select").value = state.courseId;
  $("#scorecard-course-name").textContent = state.course.name;
  $("#header-hole").textContent = state.holeIndex + 1;
  $("#hole-number").textContent = String(state.holeIndex + 1).padStart(2, "0");
  $("#hole-name").textContent = state.courseId === "meadows" ? holeNames[state.holeIndex] : h.layout_type;
  $("#hole-layout").textContent = h.layout_type;
  $("#hole-facts").textContent = `Par ${card().Par} · HCP ${card().Handicap} · ${teeYards()} yards`;
  const totalElevation = hole().elevation_profile.points.at(-1).elevation_m * 3.28084;
  $("#elevation-value").textContent = `${totalElevation >= 0 ? "+" : "−"}${Math.abs(Math.round(totalElevation))} ft`;
  $("#current-lie").textContent = currentLieType();
  const viewMode = mapViewMode();
  const showGreenContour = greenContourIsVisible(viewMode);
  $(".course-stage")?.classList.remove("terrain-3d");
  $("#enlarge-green").hidden = state.greenEnlarged || state.liveGpsView;
  $("#enlarge-green").textContent = "Enlarge green";
  $("#mobile-enlarge-green").hidden = state.greenEnlarged || state.liveGpsView;
  $("#reset-view").hidden = state.liveGpsView;
  $("#mobile-reset-view").hidden = state.liveGpsView;
  $(".map-hint").innerHTML = state.liveGpsView
    ? "<i></i> Actual GPS positions · refreshes every 5 seconds"
    : automaticGreenReliefActive()
    ? "<i></i> Green 3D · click to aim · drag to read the contour"
    : viewMode === "putting"
    ? "<i></i> Putting view · move for distance · click to set line"
    : showGreenContour
      ? "<i></i> Greenside contour · move for distance · click to set line"
    : viewMode === "approach"
      ? "<i></i> Approach view · move for distance · click to set line"
      : "<i></i> Move for distance · click to set line";
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
  state.greenEnlarged = true;
  state.greenZoom = 1;
  state.greenViewMode = "top";
  alignGreenToPlayerView();
  state.greenViewTilt = 52;
  $(".course-stage").classList.add("enlarged-green");
  document.body.classList.add("green-view-open");
  $("#green-toolbar").hidden = false;
  $("#close-enlarged-green").hidden = false;
  $("#green-view-switch").hidden = false;
  $("#green-zoom-control").hidden = false;
  $("#green-zoom").value = "100";
  updateGreenViewControls();
  $("#enlarge-green").hidden = true;
  $("#mobile-enlarge-green").hidden = true;
  renderMap();
  updateEnlargedPuttControls();
}

function updateEnlargedPuttControls() {
  const controls = $("#green-putt-controls");
  if (!controls) return;
  const putting = currentLieType() === "Green";
  const visible = state.greenEnlarged && !state.holeFinished;
  controls.hidden = !visible;
  if (!visible) {
    renderGreenCaddieReadUI();
    return;
  }
  controls.classList.toggle("full-shot", !putting);
  const aimForm = $("#green-putt-aim-form");
  const fullShotClub = $("#green-full-shot-club");
  aimForm.hidden = !putting;
  fullShotClub.hidden = putting;
  $("#green-shot-line-label").textContent = putting ? "Putting line" : "Approach preview";
  $("#green-power-label").textContent = putting ? "Pace" : "Swing";
  $("#green-putt-play").textContent = putting ? "Play putt" : "Play shot";

  const toPinYards = distance(state.ball, pin().center_point);
  const feetToCup = toPinYards * 3;
  const powerPercentage = Math.round(state.swingPower * 100);
  const rollFeet = Math.round(PUTTER_RANGE_FEET * state.swingPower);
  $("#green-putt-distance").textContent = putting
    ? `${feetToCup < 1 ? Math.max(1, Math.round(feetToCup * 12)) + " in" : Math.round(feetToCup) + " ft"} to cup`
    : `${Math.round(toPinYards)} yd to pin`;
  $("#green-putt-status").textContent = state.target
    ? putting
      ? `${Math.max(1, Math.round(distance(state.ball, state.target) * 3))} ft line selected · click again to refine`
      : `${Math.max(1, Math.round(distance(state.ball, state.target)))} yd landing target · ${currentLieType()} lie`
    : putting
      ? "Tap or drag on the green to set your line"
      : `Tap the green to choose a landing point · ${currentLieType()} lie`;
  if (!putting) {
    $("#green-shot-club-select").innerHTML = state.profile.clubs.map((club, index) =>
      `<option value="${index}" ${index === state.selectedClub ? "selected" : ""}>${escapeHtml(clubPowerLabel(club))}</option>`
    ).join("");
  }
  $("#green-putt-power").min = putting ? "5" : "25";
  $("#green-putt-power").step = putting ? "1" : "25";
  $("#green-putt-power").setAttribute("aria-label", putting ? "Putt pace percentage" : "Swing length");
  $("#green-putt-power").value = String(powerPercentage);
  $("#green-putt-power-readout").textContent = putting
    ? `${powerPercentage}% · ${rollFeet} ft`
    : `${swingLengthLabel(state.swingPower)} · ${clubPowerDistanceLabel(currentClub())}`;
  $("#green-putt-play").disabled = !state.target;
  renderGreenCaddieReadUI();
}

function applyEnlargedGreenAimInstruction(value) {
  const instruction = String(value || "").trim();
  const parsed = parsePuttAimInstruction(instruction);
  const feedback = $("#green-putt-aim-feedback");
  if (!parsed) {
    feedback.textContent = "Try “aim at cup” or “aim 2 in right of cup.”";
    feedback.classList.add("error");
    return false;
  }
  const target = puttTargetFromCup(parsed.offset_inches);
  if (!target) {
    feedback.textContent = "The cup line could not be set. Close and reopen the green view.";
    feedback.classList.add("error");
    return false;
  }
  clearStrategyPlan();
  state.target = target;
  state.manualTargetPreview = false;
  state.shotDraft.target = true;
  const playerInstruction = instruction.slice(0, 240);
  addGmMessage(playerInstruction, "player");
  if (state.pendingPlayerInstructions.at(-1) !== playerInstruction) {
    state.pendingPlayerInstructions = [...state.pendingPlayerInstructions, playerInstruction].slice(-4);
  }
  addGmMessage(`Putting line set at ${parsed.description}. Choose the pace, then press Play putt.`);
  feedback.textContent = `Line set: ${parsed.description}.`;
  feedback.classList.remove("error");
  updateAll();
  return true;
}

function closeEnlargedGreen() {
  const wasOpen = state.greenEnlarged;
  state.greenEnlarged = false;
  state.greenZoom = 1;
  state.greenViewMode = "top";
  state.greenCaddieRead = null;
  $(".course-stage")?.classList.remove("enlarged-green");
  $(".course-stage")?.classList.remove("green-3d");
  document.body.classList.remove("green-view-open");
  document.body.classList.remove("green-aim-editing");
  document.body.classList.remove("green-putt-panel-moved");
  $("#green-putt-controls")?.style.removeProperty("--green-aim-top");
  greenAimPanelDrag = null;
  const closeButton = $("#close-enlarged-green");
  if (closeButton) closeButton.hidden = true;
  const toolbar = $("#green-toolbar");
  if (toolbar) toolbar.hidden = true;
  const zoomControl = $("#green-zoom-control");
  if (zoomControl) zoomControl.hidden = true;
  const viewSwitch = $("#green-view-switch");
  if (viewSwitch) viewSwitch.hidden = true;
  const viewHint = $("#green-3d-hint");
  if (viewHint) viewHint.hidden = true;
  const puttControls = $("#green-putt-controls");
  if (puttControls) puttControls.hidden = true;
  renderGreenCaddieReadUI();
  if (wasOpen && state.holes.length) {
    $("#enlarge-green").hidden = false;
    $("#mobile-enlarge-green").hidden = false;
    renderMap();
  }
}

function updateGreenViewControls() {
  const is3D = state.greenViewMode === "3d";
  $(".course-stage")?.classList.toggle("green-3d", is3D);
  $$('[data-green-view]').forEach(button => {
    const active = button.dataset.greenView === state.greenViewMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#green-3d-hint").hidden = !state.greenEnlarged || !is3D;
  $("#green-3d-hint").textContent = "Click to aim · drag to rotate and tilt";
  updateEnlargedPuttControls();
}

function setGreenViewMode(mode) {
  if (!state.greenEnlarged || !["top", "3d"].includes(mode)) return;
  if (mode === "3d") {
    $("#green-putt-aim-input")?.blur();
    document.body.classList.remove("green-aim-editing");
  }
  state.greenViewMode = mode;
  greenOrbitDrag = null;
  updateGreenViewControls();
  renderMap();
}

function onGreenAimPanelPointerDown(event) {
  if (!state.greenEnlarged || (event.pointerType === "mouse" && event.button !== 0)) return;
  event.preventDefault();
  const panel = $("#green-putt-controls");
  const rect = panel.getBoundingClientRect();
  document.body.classList.add("green-putt-panel-moved");
  panel.style.setProperty("--green-aim-top", `${Math.round(rect.top)}px`);
  greenAimPanelDrag = {
    pointerId: event.pointerId,
    startY: event.clientY,
    startTop: rect.top,
    height: rect.height
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function onGreenAimPanelPointerMove(event) {
  if (!greenAimPanelDrag || event.pointerId !== greenAimPanelDrag.pointerId) return;
  event.preventDefault();
  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportHeight = viewport?.height || window.innerHeight;
  const minimumTop = viewportTop + 8;
  const maximumTop = Math.max(minimumTop, viewportTop + viewportHeight - greenAimPanelDrag.height - 8);
  const nextTop = bounded(
    greenAimPanelDrag.startTop + event.clientY - greenAimPanelDrag.startY,
    minimumTop,
    maximumTop
  );
  $("#green-putt-controls").style.setProperty("--green-aim-top", `${Math.round(nextTop)}px`);
}

function keepGreenAimPanelInView() {
  if (!state.greenEnlarged || !document.body.classList.contains("green-aim-editing")) return;
  const panel = $("#green-putt-controls");
  if (!panel || panel.hidden) return;
  const rect = panel.getBoundingClientRect();
  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop || 0;
  const viewportHeight = viewport?.height || window.innerHeight;
  const minimumTop = viewportTop + 8;
  const maximumTop = Math.max(minimumTop, viewportTop + viewportHeight - rect.height - 8);
  const nextTop = bounded(rect.top, minimumTop, maximumTop);
  if (Math.abs(nextTop - rect.top) < 1) return;
  document.body.classList.add("green-putt-panel-moved");
  panel.style.setProperty("--green-aim-top", `${Math.round(nextTop)}px`);
}

function onGreenAimPanelPointerUp(event) {
  if (!greenAimPanelDrag || event.pointerId !== greenAimPanelDrag.pointerId) return;
  const handle = $("#green-putt-drag-handle");
  if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  greenAimPanelDrag = null;
}

function updateProfileUI() {
  $("#profile-monogram").textContent = state.profile.id.startsWith("custom") ? "C" : state.profile.id[0];
  $("#profile-button-name").textContent = state.profile.name;
  updateAccountProfileSummary();
  $("#club-select").innerHTML = state.profile.clubs.map((club, i) => `<option value="${i}" ${i === state.selectedClub ? "selected" : ""}>${escapeHtml(clubPowerLabel(club))}</option>`).join("");
  renderMobileClubSelect();
  renderMobileQuickClubCarousel();
}

function clubPowerDistance(club) {
  return club.name === "Putter"
    ? Math.round(PUTTER_RANGE_FEET * state.swingPower)
    : Math.round(club.carry * state.swingPower);
}

function clubPowerDistanceLabel(club) {
  return club.name === "Putter"
    ? `${clubPowerDistance(club)} ft`
    : `${clubPowerDistance(club)} yd`;
}

function clubPowerLabel(club) {
  return `${club.name} · ${clubPowerDistanceLabel(club)}`;
}

function updateClubPowerLabels() {
  $$("#club-select option").forEach((option, index) => {
    option.textContent = clubPowerLabel(state.profile.clubs[index]);
  });
  $$("#mobile-club-select option").forEach((option, index) => {
    option.textContent = clubPowerLabel(state.profile.clubs[index]);
  });
  $$('[data-mobile-quick-club-distance]').forEach((label, index) => {
    label.textContent = clubPowerDistanceLabel(state.profile.clubs[index]);
  });
}

function setSelectedClub(index) {
  clearStrategyPlan();
  state.selectedClub = Number(index);
  if (!finePaceControl()) state.swingPower = nearestSwingPower(state.swingPower);
  state.shotDraft.club = true;
  syncManualTargetPreview();
  renderMobileClubSelect();
  renderMobileQuickClubCarousel();
  renderMap();
  updateShotDesk();
}

function renderMobileClubSelect() {
  const select = $("#mobile-club-select");
  if (!select || !state.profile) return;
  select.innerHTML = state.profile.clubs.map((club, index) => `
    <option value="${index}" ${index === state.selectedClub ? "selected" : ""}>${escapeHtml(clubPowerLabel(club))}</option>
  `).join("");
}

function renderMobileQuickClubCarousel() {
  const container = $("#mobile-quick-club-carousel");
  if (!container || !state.profile) return;
  container.innerHTML = state.profile.clubs.map((club, index) => `
    <button type="button" class="mobile-quick-club-card ${index === state.selectedClub ? "active" : ""}" data-mobile-quick-club="${index}">
      <strong>${escapeHtml(club.name)}</strong>
      <span data-mobile-quick-club-distance>${clubPowerDistanceLabel(club)}</span>
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
  history.innerHTML = conversationMessages()
    .map(message => `<p class="gm-message ${message.role === "player" ? "player" : ""} ${message.kind || ""}">${escapeHtml(message.text)}</p>`)
    .join("");
  sizeForTwoRecentMessages(history, 150);
  history.scrollTop = history.scrollHeight;
  renderShotFeedback("mobile");
}

function plannerMarkerDistance(remaining, markerYards) {
  if (remaining <= markerYards - 5) return "Passed";
  if (Math.abs(remaining - markerYards) < 5) return "At mark";
  return `${Math.round(remaining - markerYards)} yd`;
}

function structuredShotIsPutt() {
  return currentLieType() === "Green" && currentClub().name === "Putter";
}

function syncStructuredShotControls() {
  const putting = structuredShotIsPutt();
  const offsets = putting ? Array.from({ length: 12 }, (_, index) => index + 1) : [1, 2, 3, 4, 5];
  if (!offsets.includes(Number(state.structuredShot.offset))) state.structuredShot.offset = offsets.at(-1);
  $$('[data-structured-shot-form]').forEach(form => {
    const aim = form.querySelector('[data-shot-field="aim"]');
    const adjustment = form.querySelector('[data-shot-field="adjustment"]');
    const offset = form.querySelector('[data-shot-field="offset"]');
    const unit = form.querySelector('[data-shot-offset-unit]');
    const selectedOption = aim?.querySelector('option[value="selected"]');
    const pinOption = aim?.querySelector('option[value="pin"]');
    if (selectedOption) {
      selectedOption.disabled = false;
      selectedOption.textContent = state.structuredShot.selectedTarget
        ? (putting ? "Selected line" : "Selected target")
        : (putting ? "Selected line · tap green" : "Selected target · tap map");
    }
    if (pinOption) pinOption.textContent = putting ? "Cup" : "Pin";
    if (aim) aim.value = state.structuredShot.aim;
    if (adjustment) adjustment.value = state.structuredShot.adjustment;
    if (offset) {
      const values = [...offset.options].map(option => Number(option.value));
      if (values.length !== offsets.length || values.some((value, index) => value !== offsets[index])) {
        offset.innerHTML = offsets.map(value => `<option value="${value}">${value}</option>`).join("");
      }
      offset.value = String(state.structuredShot.offset);
      offset.disabled = state.structuredShot.adjustment === "none";
    }
    if (unit) unit.textContent = putting ? "in" : "yd";
  });
}

function previewStructuredShot() {
  const plan = state.structuredShot;
  const baseTarget = plan.aim === "pin"
    ? pinPoint()
    : plan.aim === "selected"
      ? finitePointOrNull(plan.selectedTarget)
      : null;
  if (!baseTarget) {
    syncStructuredShotControls();
    return false;
  }
  const signedOffset = plan.adjustment === "right"
    ? Number(plan.offset)
    : plan.adjustment === "left"
      ? -Number(plan.offset)
      : 0;
  const offsetYards = structuredShotIsPutt() ? signedOffset / 36 : signedOffset;
  state.target = offsetYards
    ? offsetPointPerpendicular(state.ball, baseTarget, baseTarget, offsetYards)
    : [...baseTarget];
  state.manualTargetPreview = false;
  state.shotDraft.target = true;
  syncStructuredShotControls();
  return true;
}

function rememberStructuredTarget(target, { resetAdjustment = false } = {}) {
  const point = finitePointOrNull(target);
  if (!point) return false;
  state.structuredShot.selectedTarget = [...point];
  state.structuredShot.aim = "selected";
  if (resetAdjustment) {
    state.structuredShot.adjustment = "none";
    state.structuredShot.offset = 1;
  }
  return previewStructuredShot();
}

function updateStructuredShotField(field, value) {
  if (field === "aim" && ["", "selected", "pin"].includes(value)) state.structuredShot.aim = value;
  if (field === "adjustment" && ["none", "left", "right"].includes(value)) state.structuredShot.adjustment = value;
  if (field === "offset") state.structuredShot.offset = bounded(Math.round(Number(value)), 1, structuredShotIsPutt() ? 12 : 5);
  clearStrategyPlan();
  if (previewStructuredShot()) {
    renderMap();
    updateShotDesk();
  } else if (field === "aim" && value === "selected") {
    const instruction = structuredShotIsPutt()
      ? "Selected line is ready. Tap the intended starting line on the green."
      : "Selected target is ready. Tap the intended landing point on the map.";
    const desktopHelp = $("#gm-command-help");
    const mobileHelp = $("#mobile-gm-help");
    if (desktopHelp) desktopHelp.textContent = instruction;
    if (mobileHelp) mobileHelp.textContent = instruction;
  }
}

function playStructuredShot(prefix) {
  const form = $(`[data-structured-shot-form="${prefix}"]`)?.closest("form");
  const noteInput = prefix === "mobile" ? $("#mobile-gm-input") : $("#gm-input");
  const note = noteInput?.value.trim().slice(0, 240) || "";
  if (!state.structuredShot.aim) {
    addGmMessage("Choose Pin, or tap the map and use Selected target before playing.");
    if (prefix === "mobile") setMobileCarouselPage(0);
    return false;
  }
  if (state.structuredShot.aim === "selected" && !state.structuredShot.selectedTarget) {
    addGmMessage("Selected target needs a point on the map. Tap the landing point, then press Play.");
    if (prefix === "mobile") setMobileCarouselPage(0);
    return false;
  }
  if (!previewStructuredShot()) return false;

  const putting = structuredShotIsPutt();
  const aimName = state.structuredShot.aim === "pin" ? (putting ? "cup" : "pin") : "selected target";
  const targetDistance = distance(state.ball, state.target);
  const targetDistanceLabel = putting ? formatPuttDistance(targetDistance * 3) : `${Math.round(targetDistance)} yards`;
  const adjustment = state.structuredShot.adjustment === "none"
    ? "no lie adjustment"
    : `aim ${state.structuredShot.offset} ${putting ? (state.structuredShot.offset === 1 ? "inch" : "inches") : (state.structuredShot.offset === 1 ? "yard" : "yards")} ${state.structuredShot.adjustment}`;
  const structuredInstruction = `Aim at ${aimName}; ${adjustment}.`;
  state.pendingPlayerInstructions = [structuredInstruction];
  state.pendingPlayerNote = note;
  if (noteInput) noteInput.value = "";
  addGmMessage(`${structuredInstruction} Target line: ${targetDistanceLabel} from the ball.${note ? ` Note: ${note}` : ""}`, "player");
  addGmMessage(`Confirmed: ${currentClub().name} · ${finePaceControl() ? `${Math.round(state.swingPower * 100)}% pace` : swingLengthLabel(state.swingPower)} · ${aimName} · ${adjustment}.`);
  acceptCurrentShotSetup();
  playCurrentShotFromMobile();
  form?.querySelector('[data-shot-field="aim"]')?.setCustomValidity("");
  return true;
}

function acceptCurrentShotSetup() {
  state.shotDraft.club = true;
  state.shotDraft.power = true;
  if (state.target) state.shotDraft.target = true;
}

function syncMobileSheetUI() {
  const sheet = $("#mobile-shot-sheet");
  if (!sheet) return;
  const page = bounded(Math.round(state.mobileCarouselPage || 0), 0, MOBILE_CAROUSEL_SECTIONS.length - 1);
  const dock = MOBILE_CAROUSEL_DOCKS.includes(state.mobileCarouselDock) ? state.mobileCarouselDock : "bottom";
  state.mobileCarouselPage = page;
  state.mobileCarouselDock = dock;
  sheet.dataset.sheetState = "carousel";
  sheet.dataset.carouselPage = String(page);
  sheet.dataset.dock = dock;
  sheet.style.removeProperty("--mobile-carousel-drag-top");
  sheet.removeAttribute("data-dragging");
  $("#mobile-carousel-track").style.transform = `translateY(-${page * 100}%)`;
  const pages = $$('[data-mobile-carousel-section]');
  pages.forEach((item, index) => {
    item.setAttribute("aria-hidden", String(index !== page));
    item.inert = index !== page;
  });
  const titles = [
    ["Shot plan", sheet.dataset.planTitle || "Plan this shot"],
    ["Game Master", $("#mobile-caddie-label").textContent],
    ["Club and swing", `${currentClub().name} · ${finePaceControl() ? `${Math.round(state.swingPower * 100)}% pace` : swingLengthLabel(state.swingPower)}`],
    ["Caddie choices", "Aggressive or Safe & Smart"],
    ["Adjustment", "Think, adjust, then play"]
  ];
  const flight = activeFlightAnimation();
  sheet.dataset.flight = flight ? "true" : "false";
  $("#mobile-carousel-kicker").textContent = flight ? "Ball in flight" : titles[page][0];
  $("#mobile-carousel-title").textContent = flight
    ? `${state.shots.at(-1)?.club || "Shot"} · watch the ball`
    : titles[page][1];
  $("#mobile-carousel-position").textContent = flight ? "LIVE" : `${page + 1}/${pages.length}`;
  $("#mobile-carousel-dock-label").textContent = "Move";
  $("#mobile-carousel-previous").disabled = Boolean(flight) || page === 0;
  $("#mobile-carousel-next").disabled = Boolean(flight) || page === pages.length - 1;
  sheet.closest(".course-stage")?.classList.remove("mobile-shot-setup-open");
}

function mobileCarouselDockTargets(sheet) {
  const stage = sheet.closest(".course-stage");
  const stageRect = stage?.getBoundingClientRect() || { top: 0, height: window.innerHeight };
  const height = sheet.getBoundingClientRect().height;
  const top = Math.min(48, Math.max(8, stageRect.height - height - 58));
  const bottom = Math.max(top, stageRect.height - height - 58);
  return { stageTop: stageRect.top, top, bottom };
}

function setMobileCarouselDock(dock) {
  if (!MOBILE_CAROUSEL_DOCKS.includes(dock)) return;
  state.mobileCarouselDock = dock;
  localStorage.setItem("golf-mobile-carousel-dock", dock);
  syncMobileSheetUI();
}

function setMobileCarouselPage(index) {
  state.mobileCarouselPage = bounded(Math.round(index), 0, MOBILE_CAROUSEL_SECTIONS.length - 1);
  syncMobileSheetUI();
}

function onMobileMapPlanPointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  // Mobile Safari can retarget the delayed synthetic click to the map after
  // this floating panel has moved away from the original touch point.
  suppressMapClickUntil = performance.now() + 1200;
  cancelTargetPointerDrag();
  const sheet = $("#mobile-shot-sheet");
  const rect = sheet.getBoundingClientRect();
  const targets = mobileCarouselDockTargets(sheet);
  mobileMapPlanDrag = {
    pointerId: event.pointerId,
    startY: event.clientY,
    startTop: rect.top - targets.stageTop,
    currentTop: rect.top - targets.stageTop,
    moved: false,
    targets,
    lockedTarget: state.target ? [...state.target] : null
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function onMobileMapPlanPointerMove(event) {
  if (!mobileMapPlanDrag || event.pointerId !== mobileMapPlanDrag.pointerId) return;
  event.preventDefault();
  const nextTop = bounded(
    mobileMapPlanDrag.startTop + event.clientY - mobileMapPlanDrag.startY,
    mobileMapPlanDrag.targets.top,
    mobileMapPlanDrag.targets.bottom
  );
  mobileMapPlanDrag.currentTop = nextTop;
  mobileMapPlanDrag.moved ||= Math.abs(event.clientY - mobileMapPlanDrag.startY) > 8;
  const sheet = $("#mobile-shot-sheet");
  sheet.dataset.dragging = "true";
  sheet.style.setProperty("--mobile-carousel-drag-top", `${Math.round(nextTop)}px`);
}

function onMobileMapPlanPointerUp(event) {
  if (!mobileMapPlanDrag || event.pointerId !== mobileMapPlanDrag.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  suppressMapClickUntil = performance.now() + 1200;
  const handle = $("#mobile-map-plan-drag");
  if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  const drag = mobileMapPlanDrag;
  mobileMapPlanDrag = null;
  state.target = drag.lockedTarget ? [...drag.lockedTarget] : null;
  if (!drag.moved) {
    const next = MOBILE_CAROUSEL_DOCKS[(MOBILE_CAROUSEL_DOCKS.indexOf(state.mobileCarouselDock) + 1) % MOBILE_CAROUSEL_DOCKS.length];
    setMobileCarouselDock(next);
    return;
  }
  const nearest = MOBILE_CAROUSEL_DOCKS
    .map(dock => ({ dock, distance: Math.abs(drag.currentTop - drag.targets[dock]) }))
    .sort((first, second) => first.distance - second.distance)[0].dock;
  setMobileCarouselDock(nearest);
}

function keepMobileMapPlanInView() {
  syncMobileSheetUI();
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
  setMobileQuickPanel(state.mobileQuickPanel === panel ? null : panel);
}

function onMobileCarouselWheel(event) {
  if (Math.abs(event.deltaY) < 8 || performance.now() < mobileCarouselWheelUntil) return;
  event.preventDefault();
  mobileCarouselWheelUntil = performance.now() + 280;
  setMobileCarouselPage(state.mobileCarouselPage + (event.deltaY > 0 ? 1 : -1));
}

function onMobileCarouselPointerDown(event) {
  if (event.target.closest("button, input, select, textarea, a")) return;
  cancelTargetPointerDrag();
  mobileCarouselSwipe = {
    pointerId: event.pointerId,
    startY: event.clientY,
    lockedTarget: state.target ? [...state.target] : null
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function onMobileCarouselPointerUp(event) {
  if (!mobileCarouselSwipe || event.pointerId !== mobileCarouselSwipe.pointerId) return;
  const delta = event.clientY - mobileCarouselSwipe.startY;
  const lockedTarget = mobileCarouselSwipe.lockedTarget;
  mobileCarouselSwipe = null;
  state.target = lockedTarget ? [...lockedTarget] : null;
  if (Math.abs(delta) >= 38) setMobileCarouselPage(state.mobileCarouselPage + (delta < 0 ? 1 : -1));
}

function onMobileCarouselPointerCancel(event) {
  if (!mobileCarouselSwipe || event.pointerId !== mobileCarouselSwipe.pointerId) return;
  state.target = mobileCarouselSwipe.lockedTarget ? [...mobileCarouselSwipe.lockedTarget] : null;
  mobileCarouselSwipe = null;
}

function onMobileCarouselKeyDown(event) {
  if (event.key === "ArrowDown") { event.preventDefault(); setMobileCarouselPage(state.mobileCarouselPage + 1); }
  if (event.key === "ArrowUp") { event.preventDefault(); setMobileCarouselPage(state.mobileCarouselPage - 1); }
}

function setSwingPowerFromMobile(percentage) {
  clearStrategyPlan();
  const requestedPower = Math.max(.05, Math.min(1, Number(percentage) / 100));
  state.swingPower = finePaceControl() ? requestedPower : nearestSwingPower(requestedPower);
  state.shotDraft.power = true;
  syncManualTargetPreview();
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
      setMobileCarouselPage(0);
      return;
    }
    state.target = target;
    state.manualTargetPreview = false;
    state.shotDraft.target = true;
    addGmMessage("No target was selected, so I used the recommended line for this shot.");
  }
  state.shotDraft.club = true;
  state.shotDraft.target = true;
  state.shotDraft.power = true;
  renderMap();
  updateShotDesk();
  addGmMessage(`${currentClub().name} selected at ${finePaceControl() ? `${Math.round(state.swingPower * 100)}% pace` : swingLengthLabel(state.swingPower)}.`);
  void playShot().catch(error => {
    console.error(error);
    showMobileShotToast("Shot could not be played", "The mobile shot action hit an error. Try setting the line again.");
  });
  if (!state.holeFinished) {
    setMobileQuickPanel(null);
  }
}

function selectedShotExpectedYards() {
  const club = currentClub();
  const putting = currentLieType() === "Green" && club.name === "Putter";
  return putting
    ? PUTTER_RANGE_FEET * state.swingPower / 3
    : club.carry * liePenalty() * state.swingPower;
}

function syncManualTargetPreview() {
  if (!state.ball || state.holeFinished) return;
  if (!state.shotDraft.club) return;
  if (state.target && !state.manualTargetPreview) return;
  const referenceTarget = mapViewMode() === "putting" ? pinPoint() : normalShotTarget(state.ball);
  state.target = projectPointToward(state.ball, referenceTarget, selectedShotExpectedYards());
  state.manualTargetPreview = true;
  state.shotDraft.target = true;
  rememberStructuredTarget(state.target, { resetAdjustment: true });
  state.manualTargetPreview = true;
}

function expectedShotProjection() {
  const club = currentClub();
  const putting = currentLieType() === "Green" && club.name === "Putter";
  const planCommitted = state.shotDraft.club || Boolean(state.strategySelectedId);
  const currentToPinYards = distance(state.ball, pin().center_point);
  if (!planCommitted) {
    const toPinLabel = putting
      ? (currentToPinYards * 3 < 1
          ? `${Math.max(1, Math.round(currentToPinYards * 36))} in`
          : `${Math.round(currentToPinYards * 3)} ft`)
      : `${Math.round(currentToPinYards)} yd`;
    return {
      expectedLabel: "—",
      toPinLabel,
      toPinHeading: putting ? "To cup" : "To pin",
      copy: `Choose a club to preview its expected ${putting ? "roll and distance after the putt" : "carry and distance to the pin after the shot"}.`
    };
  }
  const expectedYards = selectedShotExpectedYards();
  const linePoint = state.target || pin().center_point;
  const dx = linePoint[0] - state.ball[0];
  const dy = linePoint[1] - state.ball[1];
  const lineLength = Math.hypot(dx, dy);
  const scale = METERS_TO_YARDS * gameplayScale();
  const projectedLanding = lineLength > 1e-9
    ? [
        state.ball[0] + dx / lineLength * expectedYards / scale,
        state.ball[1] + dy / lineLength * expectedYards / scale
      ]
    : [...state.ball];
  const toPinYards = distance(projectedLanding, pin().center_point);
  const expectedLabel = putting
    ? `${Math.round(expectedYards * 3)} ft roll`
    : `${Math.round(expectedYards)} yd carry`;
  const toPinLabel = putting
    ? (toPinYards * 3 < 1 ? `${Math.max(1, Math.round(toPinYards * 36))} in` : `${Math.round(toPinYards * 3)} ft`)
    : `${Math.round(toPinYards)} yd`;
  const lineDescription = state.target ? "Along your selected line" : "On a line toward the pin";
  const copy = putting
    ? `${lineDescription}, ${expectedLabel} leaves about ${toPinLabel} to the cup.`
    : `${lineDescription}, ${expectedLabel} leaves about ${toPinLabel} to the pin for your next shot.`;
  return { expectedLabel, toPinLabel, toPinHeading: putting ? "To cup after" : "To pin after", copy };
}

function updateShotDesk() {
  const remaining = distance(state.ball, pin().center_point);
  const club = currentClub();
  const putting = currentLieType() === "Green";
  const projection = expectedShotProjection();
  const displayDistance = yards => putting ? `${Math.round(yards * 3)} ft` : `${Math.round(yards)} yd`;
  $("#shot-number").textContent = state.shots.length + 1;
  const puttingFeet = remaining * 3;
  $("#yards-left").textContent = putting ? (puttingFeet < 1 ? Math.max(1, Math.round(puttingFeet * 12)) : Math.round(puttingFeet)) : Math.round(remaining);
  $(".yards-left span").textContent = putting ? (puttingFeet < 1 ? "in to cup" : "ft to cup") : "yd left";
  $("#club-select").value = String(state.selectedClub);
  $("#mobile-club-select").value = String(state.selectedClub);
  updateClubPowerLabels();
  $("#desktop-shot-lie").textContent = currentLieType();
  $("#desktop-shot-expected").textContent = projection.expectedLabel;
  $("#desktop-shot-to-pin-label").textContent = projection.toPinHeading;
  $("#desktop-shot-to-pin").textContent = projection.toPinLabel;
  const paceControl = finePaceControl();
  const powerPercentage = Math.round(state.swingPower * 100);
  for (const prefix of ["desktop", "mobile"]) {
    const slider = $(`#${prefix}-power-slider`);
    slider.min = paceControl ? "5" : "25";
    slider.step = paceControl ? "1" : "25";
    slider.setAttribute("aria-label", paceControl ? "Putt pace percentage" : "Swing length");
    slider.value = String(powerPercentage);
    $(`#${prefix}-power-label`).textContent = paceControl ? "Pace" : "Swing";
    $(`#${prefix}-swing-scale`).hidden = paceControl;
  }
  $("#desktop-power-readout").textContent = paceControl
    ? `${powerPercentage}% pace`
    : `${swingLengthLabel(state.swingPower)} · ${clubPowerDistanceLabel(club)}`;
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
  $("#mobile-hole-facts").textContent = `P${card().Par} · ${teeYards()}`;
  $("#mobile-shot-sheet").dataset.planTitle = `Shot ${state.shots.length + 1} · Pin ${displayDistance(remaining)}`;
  if (state.target) {
    const targetFromBall = distance(state.ball, state.target);
    const targetToPin = distance(state.target, pin().center_point);
    $("#mobile-plan-copy").textContent = putting
      ? `Target · ${formatPuttDistance(targetFromBall * 3)} from ball · ${formatPuttDistance(targetToPin * 3)} to cup`
      : `Target · ${Math.round(targetFromBall)} yd from ball · ${Math.round(targetToPin)} yd to pin`;
  } else {
    $("#mobile-plan-copy").textContent = "Tap the map to place the target line, then roll down through the shot controls.";
  }
  $("#mobile-sheet-lie").textContent = currentLieType();
  $("#mobile-sheet-expected").textContent = projection.expectedLabel;
  $("#mobile-sheet-to-pin-label").textContent = projection.toPinHeading;
  $("#mobile-sheet-to-pin").textContent = projection.toPinLabel;
  updateMobileCaddie();
  renderMobileGmHistory();
  $("#mobile-power-readout").textContent = paceControl
    ? `${powerPercentage}% · ${clubPowerDistanceLabel(club)}`
    : `${swingLengthLabel(state.swingPower)} · ${clubPowerDistanceLabel(club)}`;
  syncStructuredShotControls();
  updateEnlargedPuttControls();
  syncMobileSheetUI();
  renderStrategyChoices();
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
  input.placeholder = "Optional coaching note";
  help.innerHTML = `The dropdowns control the shot. Your note is saved for coaching and cannot change the setup.${stanceNote}`;
  if (mobileInput) mobileInput.placeholder = "Optional coaching note";
  if (mobileHelp) mobileHelp.textContent = `The dropdowns control the shot. Your note is saved for coaching and cannot change the setup.${stanceNote}`;
  if (viewMode === "putting") {
    button.textContent = "Aim at cup";
    button.dataset.gmSuggestion = "Aim at the pin";
  } else if (remaining <= 30) {
    button.textContent = "Aim at pin";
    button.dataset.gmSuggestion = "Aim at the pin";
  } else if (remaining <= 210) {
    button.textContent = "Aim at pin";
    button.dataset.gmSuggestion = "Aim at the pin";
  } else {
    button.textContent = card().Par === 5 && remaining < teeYards() * .62 ? "Layup center" : "Fairway center";
    button.dataset.gmSuggestion = "Aim fairway center";
  }
}

function updateAll(redraw = true) {
  updateHoleBrief();
  updateProfileUI();
  updateShotDesk();
  renderGmConversation();
  updateFullscreenButton();
  updateCourseMapModeUI();
  renderCompetitionStatus();
  if (redraw) renderMap();
}

function gpsRoundStorageKey() {
  return playerStorageKey(`${state.courseId}-on-course-gps-round`);
}

function loadGpsRound() {
  try {
    const saved = JSON.parse(localStorage.getItem(gpsRoundStorageKey()) || "null");
    if (saved?.version === "on-course-gps-round-v1" && saved.course_id === state.courseId && Array.isArray(saved.holes)) {
      let migrated = false;
      if (typeof saved.round_id !== "string" || saved.round_id.length < 8) {
        saved.round_id = createGpsRoundId();
        migrated = true;
      }
      if (!Number.isInteger(saved.revision) || saved.revision < 0) {
        saved.revision = 0;
        migrated = true;
      }
      if (migrated) localStorage.setItem(gpsRoundStorageKey(), JSON.stringify(saved));
      return saved;
    }
  } catch (error) {
    console.warn("Ignored invalid on-course GPS round.", error);
  }
  const created = createGpsRound(state.courseId);
  localStorage.setItem(gpsRoundStorageKey(), JSON.stringify(created));
  return created;
}

function persistGpsRound() {
  if (!gpsRound) return;
  gpsRound.revision = (Number.isInteger(gpsRound.revision) ? gpsRound.revision : 0) + 1;
  gpsRound.updated_at = new Date().toISOString();
  localStorage.setItem(gpsRoundStorageKey(), JSON.stringify(gpsRound));
  setGpsSyncDisplay("Saved on phone", "local");
  scheduleGpsRoundSync();
}

function setGpsSyncDisplay(text, tone = "local") {
  gpsSyncDisplay = { text, tone };
  const status = $("#gps-sync-status");
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = tone;
}

async function syncGpsRound() {
  if (!state.player || !gpsRound) return { saved: false, unavailable: true };
  if (navigator.onLine === false) {
    setGpsSyncDisplay("Offline · on phone", "error");
    return { saved: false, offline: true };
  }
  const snapshot = typeof structuredClone === "function"
    ? structuredClone(gpsRound)
    : JSON.parse(JSON.stringify(gpsRound));
  setGpsSyncDisplay("Syncing…", "syncing");
  try {
    const result = await playerApi("/api/player/gps-round", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ round: snapshot })
    });
    if (result.conflict) {
      setGpsSyncDisplay("Newer server copy", "error");
      console.warn("GPS round sync stopped because the server has a newer revision.", result);
      return result;
    }
    if (gpsRound?.round_id === snapshot.round_id && gpsRound.revision === snapshot.revision) {
      setGpsSyncDisplay(result.complete ? "Round synced" : "Synced", "synced");
    } else {
      setGpsSyncDisplay("Saved on phone", "local");
      scheduleGpsRoundSync(100);
    }
    return result;
  } catch (error) {
    console.error("Could not sync on-course GPS round", error);
    setGpsSyncDisplay(navigator.onLine === false ? "Offline · on phone" : "Server unavailable", "error");
    return { saved: false, error };
  }
}

function scheduleGpsRoundSync(delay = 700) {
  if (!state.player || !gpsRound) return;
  window.clearTimeout(gpsSyncTimer);
  gpsSyncTimer = window.setTimeout(() => {
    gpsSyncPromise = gpsSyncPromise
      .catch(() => {})
      .then(syncGpsRound);
  }, delay);
}

function gpsHoleState() {
  gpsRound ||= loadGpsRound();
  return gpsRound.holes[state.holeIndex];
}

function gpsCalibration() {
  return hole()?.hole_metadata?.gps_calibration || null;
}

function gpsCurrentFix(holeState = gpsHoleState()) {
  return holeState.shots.at(-1)?.end || holeState.tee || null;
}

function peekLocalGpsRound() {
  try {
    const saved = JSON.parse(localStorage.getItem(gpsRoundStorageKey()) || "null");
    return saved?.version === "on-course-gps-round-v1" &&
      saved.course_id === state.courseId && Array.isArray(saved.holes)
      ? saved
      : null;
  } catch {
    return null;
  }
}

function gpsFixCoursePoint(fix) {
  if (Array.isArray(fix?.course_point) && fix.course_point.length === 2 && fix.course_point.every(Number.isFinite)) {
    return [...fix.course_point];
  }
  if (!Number.isFinite(fix?.lat) || !Number.isFinite(fix?.lng)) return null;
  try {
    return gpsToCoursePoint(gpsCalibration(), fix);
  } catch {
    return null;
  }
}

function liveGpsHoleState() {
  return state.liveGpsRound?.holes?.[state.holeIndex] || null;
}

function liveGpsCurrentFix(holeState = liveGpsHoleState()) {
  return holeState?.shots?.at(-1)?.end || holeState?.tee || null;
}

function liveGpsBallPoint() {
  return gpsFixCoursePoint(liveGpsCurrentFix());
}

function liveGpsShotSegments() {
  return (liveGpsHoleState()?.shots || []).map((shot, index) => ({
    number: Number(shot.number) || index + 1,
    shot,
    start: gpsFixCoursePoint(shot.start),
    end: gpsFixCoursePoint(shot.end)
  })).filter(segment => segment.start && segment.end);
}

function gpsRoundLatestHoleIndex(round) {
  let bestIndex = 0;
  let bestTime = -Infinity;
  let foundActivity = false;
  (round?.holes || []).forEach((holeState, index) => {
    const fixes = [holeState?.tee, ...(holeState?.shots || []).flatMap(shot => [shot.start, shot.end])];
    const timestamps = [
      ...fixes.map(fix => fix?.recorded_at),
      ...(holeState?.shots || []).map(shot => shot?.recorded_at)
    ].map(value => Date.parse(value)).filter(Number.isFinite);
    const active = Boolean(holeState?.tee || holeState?.shots?.length || holeState?.putts || holeState?.finished);
    if (!active) return;
    foundActivity = true;
    const latest = timestamps.length ? Math.max(...timestamps) : index;
    if (latest >= bestTime) {
      bestTime = latest;
      bestIndex = index;
    }
  });
  return foundActivity ? bounded(bestIndex, 0, Math.max(0, (round?.holes?.length || 18) - 1)) : 0;
}

function newerGpsRound(first, second) {
  if (!first) return second || null;
  if (!second) return first;
  const firstRevision = Number(first.revision) || 0;
  const secondRevision = Number(second.revision) || 0;
  if (first.round_id === second.round_id && firstRevision !== secondRevision) {
    return secondRevision > firstRevision ? second : first;
  }
  return Date.parse(second.updated_at || second.started_at || 0) > Date.parse(first.updated_at || first.started_at || 0)
    ? second
    : first;
}

function liveGpsAgeLabel(round = state.liveGpsRound) {
  const timestamp = Date.parse(round?.updated_at || round?.started_at || "");
  if (!Number.isFinite(timestamp)) return "GPS round loaded";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `Updated ${minutes}m ago` : `Updated ${Math.round(minutes / 60)}h ago`;
}

function parseLivePanelPosition() {
  if (!state.livePanelPosition) return null;
  try {
    const position = typeof state.livePanelPosition === "string"
      ? JSON.parse(state.livePanelPosition)
      : state.livePanelPosition;
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return null;
    return { x: bounded(position.x, 0, 1), y: bounded(position.y, 0, 1) };
  } catch {
    return null;
  }
}

function livePanelPositionBounds(panel = $("#live-round-panel")) {
  const stage = panel?.closest(".course-stage");
  const stageRect = stage?.getBoundingClientRect();
  const panelRect = panel?.getBoundingClientRect();
  if (!stageRect || !panelRect) return null;
  const minLeft = 10;
  const minTop = 48;
  return {
    stageRect,
    minLeft,
    maxLeft: Math.max(minLeft, stageRect.width - panelRect.width - 10),
    minTop,
    maxTop: Math.max(minTop, stageRect.height - panelRect.height - 58)
  };
}

function positionLiveRoundPanel() {
  const panel = $("#live-round-panel");
  const position = parseLivePanelPosition();
  if (!panel || panel.hidden || !position || livePanelDrag) return;
  const bounds = livePanelPositionBounds(panel);
  if (!bounds) return;
  panel.dataset.dock = "free";
  panel.style.left = `${Math.round(bounds.minLeft + position.x * (bounds.maxLeft - bounds.minLeft))}px`;
  panel.style.top = `${Math.round(bounds.minTop + position.y * (bounds.maxTop - bounds.minTop))}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
}

function onLivePanelPointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const panel = $("#live-round-panel");
  const bounds = livePanelPositionBounds(panel);
  if (!panel || !bounds) return;
  event.preventDefault();
  event.stopPropagation();
  const panelRect = panel.getBoundingClientRect();
  livePanelDrag = {
    pointerId: event.pointerId,
    handle: event.currentTarget,
    offsetX: event.clientX - panelRect.left,
    offsetY: event.clientY - panelRect.top,
    left: panelRect.left - bounds.stageRect.left,
    top: panelRect.top - bounds.stageRect.top,
    bounds
  };
  panel.dataset.dock = "free";
  panel.dataset.dragging = "true";
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function onLivePanelPointerMove(event) {
  if (!livePanelDrag || event.pointerId !== livePanelDrag.pointerId) return;
  event.preventDefault();
  const panel = $("#live-round-panel");
  const { bounds } = livePanelDrag;
  livePanelDrag.left = bounded(event.clientX - bounds.stageRect.left - livePanelDrag.offsetX, bounds.minLeft, bounds.maxLeft);
  livePanelDrag.top = bounded(event.clientY - bounds.stageRect.top - livePanelDrag.offsetY, bounds.minTop, bounds.maxTop);
  panel.style.left = `${Math.round(livePanelDrag.left)}px`;
  panel.style.top = `${Math.round(livePanelDrag.top)}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
}

function onLivePanelPointerUp(event) {
  if (!livePanelDrag || event.pointerId !== livePanelDrag.pointerId) return;
  event.preventDefault();
  event.stopPropagation();
  const panel = $("#live-round-panel");
  const drag = livePanelDrag;
  livePanelDrag = null;
  if (drag.handle.hasPointerCapture?.(event.pointerId)) drag.handle.releasePointerCapture(event.pointerId);
  panel?.removeAttribute("data-dragging");
  const position = {
    x: drag.bounds.maxLeft === drag.bounds.minLeft ? 0 : (drag.left - drag.bounds.minLeft) / (drag.bounds.maxLeft - drag.bounds.minLeft),
    y: drag.bounds.maxTop === drag.bounds.minTop ? 0 : (drag.top - drag.bounds.minTop) / (drag.bounds.maxTop - drag.bounds.minTop)
  };
  state.livePanelPosition = JSON.stringify(position);
  localStorage.setItem("golf-live-panel-position", state.livePanelPosition);
}

function setLivePanelCollapsed(collapsed) {
  state.livePanelCollapsed = Boolean(collapsed);
  localStorage.setItem("golf-live-panel-collapsed", String(state.livePanelCollapsed));
  updateCourseMapModeUI();
}

function updateCourseMapModeUI() {
  $$('[data-course-map-mode]').forEach(button => {
    button.setAttribute("aria-pressed", String((button.dataset.courseMapMode === "live") === state.liveGpsView));
  });
  document.body.classList.toggle("live-round-view", state.liveGpsView);
  const shotDesk = $(".shot-desk");
  if (shotDesk) {
    shotDesk.inert = state.liveGpsView;
    shotDesk.setAttribute("aria-hidden", String(state.liveGpsView));
  }
  const panel = $("#live-round-panel");
  if (!panel) return;
  const livePanelDock = ["top", "bottom"].includes(state.livePanelDock) ? state.livePanelDock : "bottom";
  state.livePanelDock = livePanelDock;
  panel.dataset.dock = parseLivePanelPosition() ? "free" : livePanelDock;
  panel.dataset.collapsed = String(state.livePanelCollapsed);
  const moveButton = $("#live-round-move");
  if (moveButton) moveButton.setAttribute("aria-label", "Drag Live summary");
  const collapseButton = $("#live-round-collapse");
  if (collapseButton) {
    collapseButton.textContent = state.livePanelCollapsed ? "Open" : "Hide";
    collapseButton.setAttribute("aria-expanded", String(!state.livePanelCollapsed));
    collapseButton.setAttribute("aria-label", state.livePanelCollapsed ? "Open Live summary" : "Hide Live summary");
  }
  panel.hidden = !state.liveGpsView;
  if (!state.liveGpsView) return;
  requestAnimationFrame(positionLiveRoundPanel);

  const round = state.liveGpsRound;
  const holeState = liveGpsHoleState();
  const currentFix = liveGpsCurrentFix(holeState);
  const currentPoint = gpsFixCoursePoint(currentFix);
  $("#live-round-sync").textContent = state.liveGpsLoading ? "Refreshing…" : liveGpsAgeLabel(round);
  $("#live-round-title").textContent = `${state.course?.shortName || state.course?.name || "Course"} · Hole ${state.holeIndex + 1}`;
  if (!round) {
    $("#live-round-position").textContent = state.liveGpsStatus;
    $("#live-round-score").textContent = "—";
    $("#live-hole-score").textContent = "—";
    $("#live-last-shot").textContent = "—";
    return;
  }
  const accuracy = Number(currentFix?.accuracy_meters);
  const positionParts = [];
  if (currentFix?.lie) positionParts.push(currentFix.lie);
  if (currentPoint) positionParts.push(`${Math.round(distance(currentPoint, pin().center_point))} yd to pin`);
  if (Number.isFinite(accuracy)) positionParts.push(`GPS ±${Math.round(accuracy * METERS_TO_YARDS)} yd`);
  $("#live-round-position").textContent = positionParts.join(" · ") || "No location recorded on this hole yet.";
  $("#live-round-score").textContent = String(gpsRoundScore(round));
  $("#live-hole-score").textContent = holeState?.tee ? String(gpsHoleScore(holeState)) : "—";
  const lastShot = holeState?.shots?.at(-1);
  const shotName = lastShot?.strategy?.club_name || lastShot?.strategy?.title || "Shot";
  $("#live-last-shot").textContent = lastShot ? `${shotName} · ${Math.round(lastShot.distance_yards || 0)} yd` : "—";
}

async function fetchLatestGpsRoundForCourse() {
  if (!state.player || navigator.onLine === false) return null;
  const active = await playerApi(`/api/player/gps-round?course_id=${encodeURIComponent(state.courseId)}`);
  if (active.round) return active.round;
  const history = await playerApi("/api/player/gps-round-history?limit=20");
  const latest = (history.rounds || []).find(item => item.course_id === state.courseId);
  if (!latest?.round_id) return null;
  const result = await playerApi(`/api/player/gps-round?round_id=${encodeURIComponent(latest.round_id)}`);
  return result.round || null;
}

function scheduleLiveGpsPoll(delay = LIVE_GPS_POLL_MS) {
  window.clearTimeout(liveGpsPollTimer);
  if (!state.liveGpsView) return;
  liveGpsPollTimer = window.setTimeout(() => void refreshLiveGpsRound({ silent: true }), delay);
}

async function refreshLiveGpsRound({ followHole = state.liveGpsFollowHole, silent = false } = {}) {
  if (!state.liveGpsView) return;
  state.liveGpsLoading = true;
  if (!silent) state.liveGpsStatus = "Loading the latest GPS round for this course…";
  let candidate = newerGpsRound(gpsRound?.course_id === state.courseId ? gpsRound : null, peekLocalGpsRound());
  state.liveGpsRound = newerGpsRound(state.liveGpsRound, candidate);
  updateCourseMapModeUI();
  try {
    candidate = newerGpsRound(candidate, await fetchLatestGpsRoundForCourse());
    state.liveGpsRound = newerGpsRound(state.liveGpsRound, candidate);
    state.liveGpsStatus = state.liveGpsRound
      ? "Showing actual on-course GPS positions."
      : "No GPS round has been recorded for this course yet.";
  } catch (error) {
    console.error("Could not load the on-course GPS round", error);
    state.liveGpsStatus = state.liveGpsRound
      ? "Showing the phone copy; the server could not be refreshed."
      : "The GPS round could not be loaded from the server.";
  } finally {
    state.liveGpsLoading = false;
    state.liveGpsLastRefresh = new Date().toISOString();
  }
  if (followHole && state.liveGpsRound) {
    const latestHole = gpsRoundLatestHoleIndex(state.liveGpsRound);
    if (latestHole !== state.holeIndex) {
      state.holeIndex = latestHole;
      state.pinIndex = rotatingPinIndex(state.holeIndex, hole().geometries.green_complex.pin_zones.length);
      resetHole();
    } else {
      updateAll();
    }
  } else {
    updateAll();
  }
  scheduleLiveGpsPoll();
}

function setCourseMapMode(mode) {
  const live = mode === "live";
  if (state.liveGpsView === live) {
    if (live) void refreshLiveGpsRound();
    return;
  }
  state.liveGpsView = live;
  window.clearTimeout(liveGpsPollTimer);
  if (live) {
    state.liveGpsFollowHole = true;
    closeEnlargedGreen();
    state.liveGpsRound = newerGpsRound(gpsRound?.course_id === state.courseId ? gpsRound : null, peekLocalGpsRound());
    if (state.liveGpsRound) {
      state.holeIndex = gpsRoundLatestHoleIndex(state.liveGpsRound);
      state.pinIndex = rotatingPinIndex(state.holeIndex, hole().geometries.green_complex.pin_zones.length);
    }
    resetHole();
    void refreshLiveGpsRound();
  } else {
    updateCourseMapModeUI();
    resetHole();
  }
}

function gpsBallConditions(fix = gpsCurrentFix(), lie = fix?.lie) {
  return normalizeGpsBallConditions(fix?.conditions, lie);
}

function gpsPlanningLie(lie, conditions) {
  if (lie !== "Rough" && lie !== "Heavy rough") return lie === "Trees/Recovery" ? "Rough" : lie;
  if (conditions.rough_depth === "deep") return "Heavy rough";
  if (conditions.rough_depth === "mild") return "Rough medium";
  return "Rough";
}

function gpsShotDistanceMultiplier(lie, conditions) {
  const strategyLie = gpsPlanningLie(lie, conditions);
  const lieMultiplier = { Fairway: 1, Tee: 1, Rough: .9, "Rough medium": .82, "Heavy rough": .7, Bunker: .72 }[strategyLie] || .82;
  const slopeMultiplier = conditions.slope === "uphill" ? .92 : conditions.slope === "downhill" ? 1.06 : 1;
  return lieMultiplier * slopeMultiplier;
}

function gpsConditionSummary(conditions, lie) {
  const stance = {
    tbd: "Ball TBD", level: "Level ball", above_feet: "Ball above feet", below_feet: "Ball below feet"
  }[conditions.stance];
  const slope = { tbd: "Hill TBD", level: "Level ground", uphill: "Uphill", downhill: "Downhill" }[conditions.slope];
  const rough = lie === "Rough" || lie === "Heavy rough"
    ? conditions.rough_depth === "tbd"
      ? " · Rough TBD"
      : ` · ${conditions.rough_depth[0].toUpperCase()}${conditions.rough_depth.slice(1)} rough`
    : "";
  return `${stance} · ${slope}${rough}`;
}

function setGpsStatus(message, tone = "neutral") {
  const status = $("#gps-mode-status");
  status.textContent = message;
  status.dataset.tone = tone;
}

function gpsStrategyChoices(point, lie, conditions = gpsBallConditions(null, lie)) {
  if (!state.profile || !point || lie === "Green") return [];
  const strategyLie = gpsPlanningLie(lie, conditions);
  try {
    return buildStrategyChoices({
      start: canonicalPoint(point),
      pin: canonicalPoint(pin().center_point),
      centerline: hole().centerline_waypoints.map(waypoint => canonicalPoint(waypoint.point)),
      fairways: hole().geometries.fairway_segments.map(segment => segment.polygon.map(canonicalPoint)),
      surfaces: canonicalSurfaces(),
      clubs: state.profile.clubs,
      lieMultiplier: gpsShotDistanceMultiplier(lie, conditions),
      preferredApproachYards: preferredApproachDistance(),
      startSurface: strategyLie,
      recoveryRequired: lie === "Trees/Recovery"
    }).slice(0, 2);
  } catch (error) {
    console.warn("GPS caddie choices could not be generated.", error);
    return [];
  }
}

function gpsStrategyAnalysisKey(point, lie, conditions, choices) {
  return JSON.stringify({
    version: "gps-strategy-analysis-v2",
    course: state.courseId,
    hole: state.holeIndex + 1,
    pin: canonicalPoint(pin().center_point),
    ball: canonicalPoint(point),
    lie,
    conditions,
    profile: state.profile.id,
    clubs: choices.map(choice => {
      const club = state.profile.clubs[choice.clubIndex];
      return { id: choice.id, club: club.name, carry: club.carry, accuracy: club.accuracy, power: choice.power, target: choice.target };
    })
  });
}

function gpsStrategySimulationCandidate(choice, point, lie, conditions) {
  const start = [...point];
  const club = state.profile.clubs[choice.clubIndex];
  const power = choice.power / 100;
  const lineTarget = coursePointFromCanonical(choice.target);
  const greenside = isGreensideChip(start, club);
  const intendedTarget = greenside
    ? lineTarget
    : resolveIntentTarget(start, lineTarget, club, power) || lineTarget;
  const strategyLie = gpsPlanningLie(lie, conditions);
  const context = greenside
    ? greensideShotSimulationContext(start, intendedTarget, club, power)
    : fullShotSimulationContext(start, intendedTarget, club, power, null);
  if (greenside) {
    context.lie_type = authoritativeLie(strategyLie).lie_type;
    context.roll_slope_factor = conditions.slope === "uphill" ? .78 : conditions.slope === "downhill" ? 1.18 : 1;
  } else {
    const stanceType = {
      tbd: "level", level: "level", above_feet: "ball_above_feet", below_feet: "ball_below_feet"
    }[conditions.stance];
    const sidehill = analyzeSidehillShot({
      stance: stanceType,
      lateralDistanceYards: stanceType === "level" ? 0 : 8,
      shotDistanceYards: distance(start, intendedTarget),
      playerAimYards: 0
    });
    context.lie = authoritativeLie(strategyLie, sidehill.expected_curve_yards);
    if (conditions.stance === "above_feet" || conditions.stance === "below_feet") {
      context.lie.mishit_multiplier *= 1.12;
    }
    context.environment.elevation_carry_multiplier = conditions.slope === "uphill" ? .92 : conditions.slope === "downhill" ? 1.06 : 1;
    context.environment.slope_mishit_multiplier = conditions.slope === "uphill" || conditions.slope === "downhill" ? 1.08 : 1;
  }
  return {
    id: choice.id,
    engine: greenside ? "greenside" : "full",
    deterministicOutlook: choice.outlook,
    context,
    target: choice.expectedFinish || choice.target,
    targetRadiusYards: choice.mode === "approach" ? 12 : choice.mode === "recovery" ? 15 : 18,
    successSurface: choice.mode === "approach" ? "green" : null
  };
}

function runGpsStrategyAnalysis(point, lie, conditions, choices) {
  const key = gpsStrategyAnalysisKey(point, lie, conditions, choices);
  if (strategyAnalysisCache.has(key)) return strategyAnalysisCache.get(key);
  const candidates = choices.map(choice => gpsStrategySimulationCandidate(choice, point, lie, conditions));
  const analysis = evaluateShotCandidates({
    candidates,
    sampleCount: 400,
    analysisSeed: stableAnalysisSeed(key),
    holeNumber: state.holeIndex + 1,
    simulate: (candidate, identity) => candidate.engine === "greenside"
      ? simulateGreensideShot(candidate.context, identity)
      : simulateFullShot(candidate.context, identity)
  });
  strategyAnalysisCache.set(key, analysis);
  return analysis;
}

function loadGpsStrategyAnalysis(point, lie, conditions, choices) {
  const key = gpsStrategyAnalysisKey(point, lie, conditions, choices);
  if (strategyAnalysisCache.has(key)) return Promise.resolve(strategyAnalysisCache.get(key));
  if (strategyAnalysisPending.has(key)) return strategyAnalysisPending.get(key);
  const candidates = choices.map(choice => gpsStrategySimulationCandidate(choice, point, lie, conditions));
  const pending = evaluateStrategyCandidatesAsync(candidates, stableAnalysisSeed(key), state.holeIndex + 1)
    .catch(error => {
      console.warn("GPS strategy worker fell back to the main thread.", error);
      return runGpsStrategyAnalysis(point, lie, conditions, choices);
    })
    .then(analysis => {
      strategyAnalysisCache.set(key, analysis);
      return analysis;
    });
  strategyAnalysisPending.set(key, pending);
  void pending.finally(() => strategyAnalysisPending.delete(key));
  return pending;
}

function gpsScoreName(strokes, par = card().Par) {
  return scoreNotation(strokes - par).label;
}

const GPS_PAGE_VIEWS = new Set(["actual", "tee", "shot", "green", "complete"]);

function gpsPagePreviewActive() {
  return state.gpsPageView !== "actual";
}

function gpsPreviewFix(point, lie) {
  let coordinate = {};
  try { coordinate = gpsCoursePointToGps(gpsCalibration(), point); }
  catch { /* Course coordinates are sufficient for a read-only preview. */ }
  return {
    ...coordinate,
    course_point: [...point],
    accuracy_meters: 4,
    recorded_at: new Date().toISOString(),
    lie,
    conditions: normalizeGpsBallConditions({ stance: "level", slope: "level", rough_depth: "light" }, lie)
  };
}

function gpsPreviewHoleState(view) {
  const tee = gpsPreviewFix(teePoint(), "Tee");
  const waypoints = hole().centerline_waypoints.map(waypoint => waypoint.point);
  const previewRemaining = Math.min(165, Math.max(70, teeYards() * .45));
  const shotPoint = pointAlongPolylineFromEnd(waypoints, previewRemaining)
    || projectPointToward(teePoint(), pin().center_point, Math.max(20, teeYards() - previewRemaining));
  const shotFix = gpsPreviewFix(shotPoint, "Fairway");
  const greenFix = gpsPreviewFix(projectPointToward(pin().center_point, teePoint(), 7), "Green");
  const firstClub = state.profile?.clubs?.find(club => club.name !== "Putter");
  const firstClubIndex = Math.max(0, state.profile?.clubs?.indexOf(firstClub) ?? 0);
  const firstShot = {
    number: 1,
    start: tee,
    end: shotFix,
    distance_yards: distance(tee.course_point, shotFix.course_point),
    strategy: { id: "manual-choice", title: "Player choice", club_name: firstClub?.name || "Driver", club_index: firstClubIndex, power: 100 },
    recorded_at: shotFix.recorded_at
  };
  const approachClub = state.profile?.clubs?.find(club => /wedge/i.test(club.name)) || firstClub;
  const approachClubIndex = Math.max(0, state.profile?.clubs?.indexOf(approachClub) ?? 0);
  const secondShot = {
    number: 2,
    start: shotFix,
    end: greenFix,
    distance_yards: distance(shotFix.course_point, greenFix.course_point),
    strategy: { id: "manual-choice", title: "Player choice", club_name: approachClub?.name || "Wedge", club_index: approachClubIndex, power: 75 },
    recorded_at: greenFix.recorded_at
  };
  if (view === "tee") return { hole_number: state.holeIndex + 1, tee: null, shots: [], putts: 0, final_stroke: false, finished: false, pending_strategy: null };
  if (view === "shot") return { hole_number: state.holeIndex + 1, tee, shots: [firstShot], putts: 0, final_stroke: false, finished: false, pending_strategy: null };
  if (view === "green") return { hole_number: state.holeIndex + 1, tee, shots: [firstShot, secondShot], putts: 0, final_stroke: false, finished: false, pending_strategy: null };
  return { hole_number: state.holeIndex + 1, tee, shots: [firstShot, secondShot], putts: 1, final_stroke: true, finished: true, pending_strategy: null };
}

function renderGpsMode() {
  if (!gpsRound || $("#gps-mode-screen").hidden) return;
  setGpsSyncDisplay(gpsSyncDisplay.text, gpsSyncDisplay.tone);
  if (!GPS_PAGE_VIEWS.has(state.gpsPageView)) state.gpsPageView = "actual";
  const previewing = gpsPagePreviewActive();
  const holeState = previewing ? gpsPreviewHoleState(state.gpsPageView) : gpsHoleState();
  const calibration = gpsCalibration();
  const currentFix = gpsCurrentFix(holeState);
  const currentPoint = currentFix?.course_point || null;
  const currentLie = currentFix?.lie || (holeState.tee ? "Tee" : null);
  const onGreen = currentLie === "Green";
  const score = gpsHoleScore(holeState);
  let pinGps = null;
  let calibrationError = null;
  if (calibration) {
    try { pinGps = gpsCoursePointToGps(calibration, pin().center_point); }
    catch (error) { calibrationError = error; }
  }
  const remainingYards = previewing && currentPoint
    ? distance(currentPoint, pin().center_point)
    : currentFix && pinGps
      ? gpsDistanceYards(currentFix, pinGps)
      : teeYards();

  $("#gps-page-view").value = state.gpsPageView;
  $("#gps-preview-note").hidden = !previewing;

  $("#gps-course-name").textContent = state.course.shortName;
  $("#gps-hole-label").textContent = `Hole ${state.holeIndex + 1}`;
  $("#gps-hole-facts").textContent = `Par ${card().Par} · ${teeYards()} yd · HCP ${card().Handicap}`;
  $("#gps-previous-hole").disabled = state.holeIndex === 0;
  const gpsNextHole = $("#gps-next-hole");
  gpsNextHole.disabled = state.holeIndex === 17 && (previewing || !holeState.tee);
  gpsNextHole.setAttribute("aria-label", !previewing && holeState.tee
    ? (state.holeIndex === 17 ? "Finish hole and complete round" : "Finish hole and go to next hole")
    : "Next hole");
  $("#gps-round-total").textContent = previewing ? "Preview" : `${gpsRoundScore(gpsRound)} shots`;
  const showPlayMetrics = Boolean(holeState.tee && !holeState.finished);
  $("#gps-shot-metrics").hidden = !showPlayMetrics;
  $("#gps-primary-yardage").hidden = showPlayMetrics;
  $("#gps-primary-metric-label").textContent = "Playing stroke";
  $("#gps-playing-stroke-number").textContent = String(score + 1);
  $("#gps-secondary-metric-label").textContent = onGreen ? "Playing putt" : "Yards to pin";
  $("#gps-secondary-metric-number").textContent = onGreen
    ? String(holeState.putts + 1)
    : String(Math.max(0, Math.round(remainingYards)));
  $("#gps-shot-label").textContent = holeState.finished
    ? "Hole complete"
    : onGreen ? "On the green"
      : holeState.tee ? `Playing stroke ${score + 1}` : "Start the hole";
  $("#gps-distance-to-pin").textContent = onGreen && !holeState.finished
    ? String(score + 1)
    : Math.max(0, Math.round(remainingYards));
  $("#gps-distance-label").textContent = onGreen && !holeState.finished ? "playing stroke" : "yards to pin";
  $("#gps-lie-label").textContent = currentLie || "Waiting for tee location";
  $("#gps-accuracy-label").textContent = currentFix?.accuracy_meters
    ? `GPS accuracy ±${Math.round(currentFix.accuracy_meters * METERS_TO_YARDS)} yd`
    : "GPS accuracy —";

  const locationButton = $("#gps-location-button");
  const reviewingHole = holeState.finished;
  $(".gps-yardage-board").hidden = reviewingHole;
  locationButton.hidden = reviewingHole;
  $("#gps-mode-status").hidden = reviewingHole;
  locationButton.disabled = previewing || !pinGps || holeState.finished;
  $("#gps-location-title").textContent = holeState.tee ? "Ball location" : "Tee location";
  $("#gps-location-help").textContent = holeState.tee
    ? "At your ball? Tap to complete the last shot"
    : "Stand at the white tee, then tap";
  if (previewing) {
    const pageLabel = { tee: "Tee setup", shot: "Shot page", green: "Green page", complete: "Hole Review" }[state.gpsPageView];
    setGpsStatus(`${pageLabel} preview. Controls are read-only and your GPS round will not change.`);
  } else if (!calibration || calibrationError) {
    setGpsStatus(`Hole ${state.holeIndex + 1} has no GPS calibration. Add its three points in Course Mapper, then reinstall the course.`, "error");
  } else if (holeState.finished) {
    setGpsStatus("Hole saved. Use Next hole when your group moves on.");
  } else if (!holeState.tee) {
    setGpsStatus("Tee location starts this hole and does not add a stroke.");
  } else {
    setGpsStatus("Each Ball location completes the previous shot and adds one stroke.");
  }

  const lastShot = holeState.shots.at(-1);
  $("#gps-last-shot").hidden = reviewingHole || !lastShot;
  if (lastShot) {
    $("#gps-last-shot-distance").textContent = `${Math.round(lastShot.distance_yards)} yd`;
    $("#gps-last-shot-plan").textContent = lastShot.strategy?.title
      ? `${lastShot.strategy.title} · ${lastShot.strategy.club_name || "own club"}${lastShot.strategy.power ? ` · ${shotPowerLabel(lastShot.strategy.power, lastShot.strategy.club_name)}` : ""}`
      : "No caddie plan recorded";
  }

  $("#gps-lie-controls").hidden = !currentFix || onGreen || holeState.finished;
  $$('[data-gps-lie]').forEach(button => button.classList.toggle("active", button.dataset.gpsLie === currentLie));
  const ballConditions = gpsBallConditions(currentFix, currentLie);
  $("#gps-stance-select").disabled = previewing || onGreen;
  $("#gps-slope-select").disabled = previewing || onGreen;
  $("#gps-stance-select").value = ballConditions.stance;
  $("#gps-slope-select").value = ballConditions.slope;
  const roughConditionAvailable = currentLie === "Rough" || currentLie === "Heavy rough";
  $("#gps-rough-select").disabled = previewing || !roughConditionAvailable;
  $("#gps-rough-select").value = roughConditionAvailable ? ballConditions.rough_depth : "tbd";
  $("#gps-condition-summary").textContent = gpsConditionSummary(ballConditions, currentLie);
  $("#gps-condition-fields").hidden = onGreen;
  $("#gps-condition-summary").hidden = onGreen;
  const showGpsShotPlanner = Boolean(holeState.tee && !onGreen && !holeState.finished);
  const choices = holeState.finished ? [] : gpsStrategyChoices(currentPoint, currentLie, ballConditions);
  if (!holeState.pending_strategy && showGpsShotPlanner) {
    const match = recommendGpsClub(state.profile.clubs, remainingYards, {
      lie: currentLie,
      distanceMultiplier: gpsShotDistanceMultiplier(currentLie, ballConditions)
    });
    if (match) {
      holeState.pending_strategy = {
        id: "yardage-match",
        title: "Yardage match",
        club_name: match.clubName,
        club_index: match.clubIndex,
        power: match.power,
        target_label: "Pin distance",
        expected_yards: match.expectedYards,
        ball_conditions: ballConditions
      };
      if (!previewing) persistGpsRound();
    }
  }
  const gpsAnalysisKey = choices.length ? gpsStrategyAnalysisKey(currentPoint, currentLie, ballConditions, choices) : null;
  const gpsAnalysis = gpsAnalysisKey ? strategyAnalysisCache.get(gpsAnalysisKey) || null : null;
  $("#gps-caddie").hidden = !showGpsShotPlanner;
  $("#gps-caddie-toggle").hidden = !choices.length;
  $("#gps-caddie-toggle").setAttribute("aria-expanded", String(state.gpsCaddieExpanded && choices.length > 0));
  $("#gps-caddie-count").textContent = String(choices.length);
  const consideredStrategyId = holeState.pending_strategy?.id === "manual-choice"
    ? holeState.pending_strategy.considered_strategy?.id
    : null;
  $("#gps-caddie-choices").innerHTML = choices.map(choice => `
    <button class="gps-caddie-choice ${holeState.pending_strategy?.id === choice.id ? "selected" : ""} ${consideredStrategyId === choice.id ? "considered" : ""}" type="button" data-gps-strategy="${escapeHtml(choice.id)}" ${previewing ? "disabled" : ""}>
      <span>${escapeHtml(choice.title)}</span>
      <strong>${escapeHtml(choice.clubName)} · ${shotPowerLabel(choice.power, choice.clubName)}</strong>
      <small>${escapeHtml(choice.targetLabel)} · ${gpsAnalysis ? strategyOutlookLabel(gpsAnalysis.candidates[choice.id].hybrid_outlook, "hybrid") : "Comparing…"}</small>
    </button>`).join("");
  $("#gps-caddie-choices").hidden = !state.gpsCaddieExpanded || !choices.length;
  if (state.gpsCaddieExpanded && choices.length && !gpsAnalysis) {
    void loadGpsStrategyAnalysis(currentPoint, currentLie, ballConditions, choices).then(() => {
      if (!$("#gps-mode-screen").hidden && gpsStrategyAnalysisKey(currentPoint, currentLie, ballConditions, choices) === gpsAnalysisKey) renderGpsMode();
    }).catch(error => console.warn("GPS probability comparison could not be generated.", error));
  }
  const availableClubs = state.profile.clubs
    .map((club, index) => ({ ...club, index }))
    .filter(club => club.name !== "Putter");
  const pendingClubIndex = availableClubs.find(club => club.name === holeState.pending_strategy?.club_name)?.index;
  const selectedClubIndex = Number.isInteger(holeState.pending_strategy?.club_index)
    ? holeState.pending_strategy.club_index
    : pendingClubIndex ?? null;
  const selectedPower = Math.round((Number(holeState.pending_strategy?.power) || 100) / 25) * 25;
  $("#gps-club-select").innerHTML = `<option value="" disabled>Choose club</option>` + availableClubs.map(club =>
    `<option value="${club.index}">${escapeHtml(club.name)} · ${Math.round(club.carry)} yd</option>`
  ).join("");
  $("#gps-club-select").value = Number.isInteger(selectedClubIndex) ? String(selectedClubIndex) : "";
  $("#gps-club-select").disabled = previewing;
  $("#gps-power-select").value = String(selectedPower);
  $("#gps-power-select").disabled = previewing || !Number.isInteger(selectedClubIndex);
  $("#gps-manual-choice").dataset.mode = holeState.pending_strategy?.id === "manual-choice" ? "manual" : "recommended";
  $("#gps-manual-status").textContent = holeState.pending_strategy?.id === "manual-choice"
    ? `Player choice · ${holeState.pending_strategy.club_name} · ${shotPowerLabel(holeState.pending_strategy.power, holeState.pending_strategy.club_name)}.`
    : holeState.pending_strategy?.id === "yardage-match"
      ? `Yardage match · ${Math.round(remainingYards)} yd to pin · about ${Math.round(holeState.pending_strategy.expected_yards)} yd. Change it if you prefer another shot.`
    : holeState.pending_strategy
      ? `${holeState.pending_strategy.title} selected. Change club or swing to record your own choice.`
      : "Choose a club before hitting. Shots without a recorded club cannot update on-course statistics.";
  $("#gps-green-controls").hidden = !onGreen || holeState.finished;
  $("#gps-add-putt").disabled = previewing;
  $("#gps-putt-count").textContent = `${holeState.putts} putt${holeState.putts === 1 ? "" : "s"}`;

  $("#gps-hole-summary").hidden = !holeState.finished;
  if (holeState.finished) {
    renderGpsHoleReview($("#gps-hole-summary"), holeState, state.holeIndex);
  }

  $("#gps-undo").disabled = previewing || !holeState.tee;
  $("#gps-hole-review").disabled = previewing || latestCompletedGpsHoleIndex(gpsRound, state.holeIndex) < 0;
  $$('[data-gps-lie]').forEach(button => { button.disabled = previewing; });
}

function gpsReviewShotMarkup(review) {
  if (!review.shots.length) return `<p class="gps-review-empty">No GPS shots were recorded for this hole.</p>`;
  return review.shots.map(shot => `
    <div class="gps-review-shot">
      <span>${escapeHtml(shot.label)}</span>
      <strong>${escapeHtml(shot.club_name)}</strong>
      <b>${shot.distance_yards} yd</b>
    </div>`).join("");
}

function gpsHoleAiKey(holeState, holeIndex) {
  return JSON.stringify({
    round: gpsRound?.round_id || "preview",
    hole: holeIndex + 1,
    shots: (holeState.shots || []).map(shot => [
      Math.round(Number(shot.distance_yards) || 0),
      shot.strategy?.club_name || null,
      shot.strategy?.power || null,
      shot.end?.lie || null
    ]),
    putts: holeState.putts,
    final_stroke: holeState.final_stroke,
    finished: holeState.finished
  });
}

function gpsRecordedHoleSummary(review) {
  const greenText = review.green_reached_in
    ? `The green was reached in ${review.green_reached_in}`
    : "The GPS record does not show a shot finishing on the green";
  return `${review.score} strokes (${gpsScoreName(review.score, review.par)}). ${greenText}, followed by ${review.putts} putt${review.putts === 1 ? "" : "s"}.`;
}

function gpsHoleAiPayload(holeState, holeIndex, review) {
  return {
    course: { id: state.courseId, name: state.course.name },
    player: { profile_id: state.profile.id, profile_name: state.profile.name },
    hole: {
      number: holeIndex + 1,
      par: review.par,
      distance_yards: state.scorecard[holeIndex]?.[`Yards_${state.tee}`],
      handicap: state.scorecard[holeIndex]?.Handicap,
      score: review.score,
      result: gpsScoreName(review.score, review.par),
      green_in_regulation: review.green_in_regulation,
      green_reached_in: review.green_reached_in,
      putts: review.putts
    },
    shots: (holeState.shots || []).map((shot, index) => ({
      number: index + 1,
      club: shot.strategy?.club_name || null,
      swing_percent: shot.strategy?.power || null,
      plan: shot.strategy?.title || null,
      actual_distance_yards: Math.max(0, Math.round(Number(shot.distance_yards) || 0)),
      start_lie: shot.start?.lie || (index === 0 ? "Tee" : null),
      end_lie: shot.end?.lie || null
    }))
  };
}

function updateGpsHoleAiSections(key, entry) {
  $$('[data-gps-ai-summary]').filter(section => section.dataset.gpsAiKey === key).forEach(section => {
    section.dataset.aiState = entry.state;
    section.querySelector("[data-gps-ai-status]").textContent = entry.status;
    section.querySelector("[data-gps-ai-copy]").textContent = entry.copy;
  });
}

function renderGpsHoleAiSummary(container, holeState, holeIndex, review) {
  const section = container.querySelector("[data-gps-ai-summary]");
  if (!section) return;
  const key = gpsHoleAiKey(holeState, holeIndex);
  section.dataset.gpsAiKey = key;
  if (gpsPagePreviewActive()) {
    updateGpsHoleAiSections(key, { state: "preview", status: "Preview", copy: "AI Comment appears after this hole is completed on the course." });
    return;
  }
  const cached = gpsHoleAiCache.get(key);
  if (cached) {
    updateGpsHoleAiSections(key, cached);
    return;
  }
  updateGpsHoleAiSections(key, { state: "loading", status: "Reviewing…", copy: "Summarizing this hole from your recorded shots." });
  if (gpsHoleAiPending.has(key)) return;
  const pending = postAiJson("/api/ai/gps-hole-review", gpsHoleAiPayload(holeState, holeIndex, review), { retry: true })
    .then(response => response?.summary
      ? { state: "ready", status: "AI Caddie", copy: response.summary }
      : { state: "fallback", status: "Recorded summary", copy: gpsRecordedHoleSummary(review) })
    .catch(() => ({ state: "fallback", status: "Recorded summary", copy: gpsRecordedHoleSummary(review) }))
    .then(entry => {
      gpsHoleAiCache.set(key, entry);
      if (gpsHoleAiCache.size > 36) gpsHoleAiCache.delete(gpsHoleAiCache.keys().next().value);
      updateGpsHoleAiSections(key, entry);
      return entry;
    })
    .finally(() => gpsHoleAiPending.delete(key));
  gpsHoleAiPending.set(key, pending);
}

function renderGpsHoleReview(container, holeState, holeIndex) {
  const review = gpsHoleReview(holeState, state.scorecard[holeIndex]?.Par);
  const result = gpsScoreName(review.score, review.par);
  const girText = review.green_in_regulation
    ? `Yes · reached in ${review.green_reached_in}`
    : review.green_reached_in
      ? `No · reached in ${review.green_reached_in}`
      : "No";
  container.querySelector("[data-gps-review-shots]").innerHTML = gpsReviewShotMarkup(review);
  container.querySelector("[data-gps-review-gir]").textContent = girText;
  container.querySelector("[data-gps-review-putts]").textContent = String(review.putts);
  container.querySelector("[data-gps-review-result]").textContent = result;
  container.querySelector("[data-gps-review-score]").textContent = String(review.score);
  const scoreCard = container.querySelector(".gps-hole-review-score");
  scoreCard.dataset.scoreTone = review.score < review.par ? "under" : review.score === review.par ? "par" : review.score === review.par + 1 ? "over" : "high";
  scoreCard.setAttribute("aria-label", `${review.score} total strokes, ${result}, on hole ${holeIndex + 1}, par ${review.par}`);
  renderGpsHoleAiSummary(container, holeState, holeIndex, review);
}

function openGpsHoleReview() {
  const holeIndex = latestCompletedGpsHoleIndex(gpsRound, state.holeIndex);
  if (holeIndex < 0) return;
  const reviewedHole = gpsRound.holes[holeIndex];
  const dialog = $("#gps-hole-review-dialog");
  renderGpsHoleReview(dialog, reviewedHole, holeIndex);
  dialog.showModal();
}

function openGpsMode() {
  gpsRound = loadGpsRound();
  const latestHoleIndex = gpsRoundLatestHoleIndex(gpsRound);
  if (latestHoleIndex !== state.holeIndex) {
    state.holeIndex = latestHoleIndex;
    state.pinIndex = rotatingPinIndex(state.holeIndex, hole().geometries.green_complex.pin_zones.length);
  }
  setGpsSyncDisplay("Saved on phone", "local");
  state.gpsPageView = "actual";
  state.gpsCaddieExpanded = false;
  $("#gps-mode-screen").hidden = false;
  document.body.classList.add("gps-mode-open");
  renderGpsMode();
  scheduleGpsRoundSync(0);
}

function closeGpsMode(destination = "simulator") {
  scheduleGpsRoundSync(0);
  $("#gps-mode-screen").hidden = true;
  document.body.classList.remove("gps-mode-open");
  state.gpsPageView = "actual";
  window.clearTimeout(liveGpsPollTimer);
  setCourseMapMode(destination);
}

async function finalizeGpsRound() {
  if (!gpsRoundComplete(gpsRound) || gpsCompletingRound) return;
  gpsCompletingRound = true;
  window.clearTimeout(gpsSyncTimer);
  setGpsStatus("Saving the completed round to your account…");
  renderGpsMode();
  gpsSyncPromise = gpsSyncPromise.catch(() => {}).then(syncGpsRound);
  const result = await gpsSyncPromise;
  if (!result?.saved || !result.complete) {
    gpsCompletingRound = false;
    renderGpsMode();
    setGpsStatus(
      result?.offline
        ? "Round complete and saved on this phone. Connect to the server, then tap Complete round again."
        : result?.conflict
          ? "A newer server copy exists. Reopen GPS mode before completing this round."
          : "Round complete on this phone, but the server could not save it. Tap Complete round to retry.",
      "error"
    );
    return;
  }

  const completedRound = typeof structuredClone === "function"
    ? structuredClone(gpsRound)
    : JSON.parse(JSON.stringify(gpsRound));
  localStorage.removeItem(gpsRoundStorageKey());
  gpsRound = null;
  gpsCompletingRound = false;
  $("#gps-mode-screen").hidden = true;
  document.body.classList.remove("gps-mode-open");
  state.liveGpsView = true;
  state.liveGpsFollowHole = false;
  state.liveGpsRound = completedRound;
  window.clearTimeout(liveGpsPollTimer);
  resetHole();
  showMobileShotToast(
    "On-course round complete",
    `${gpsRoundScore(completedRound)} strokes saved to your account. GPS mode is ready for a new round.`
  );
}

function gpsChangeHole(index) {
  state.holeIndex = Math.max(0, Math.min(17, index));
  state.pinIndex = rotatingPinIndex(state.holeIndex, hole().geometries.green_complex.pin_zones.length);
  state.gpsCaddieExpanded = false;
  $(".gps-mode-content")?.scrollTo?.({ top: 0 });
  renderGpsMode();
}

function advanceGpsHole() {
  if (gpsPagePreviewActive()) {
    if (state.holeIndex < 17) gpsChangeHole(state.holeIndex + 1);
    return;
  }
  const holeState = gpsHoleState();
  if (holeState.tee && !holeState.finished) {
    completeGpsHole(holeState);
    persistGpsRound();
  }
  if (state.holeIndex < 17) {
    gpsChangeHole(state.holeIndex + 1);
    return;
  }
  const unfinishedHoleIndex = firstUnfinishedGpsHoleIndex(gpsRound);
  if (unfinishedHoleIndex >= 0) {
    gpsChangeHole(unfinishedHoleIndex);
    setGpsStatus(`Finish hole ${unfinishedHoleIndex + 1} before completing the round.`, "error");
    return;
  }
  void finalizeGpsRound();
}

function readCurrentPosition() {
  if (!navigator.geolocation) return Promise.reject(new Error("This browser does not provide GPS location"));
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    position => resolve({
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy_meters: position.coords.accuracy,
      recorded_at: new Date(position.timestamp || Date.now()).toISOString()
    }),
    error => reject(new Error({
      1: "Location permission is off. Allow location access for golfgame.jetta.com in your browser settings.",
      2: "Your phone could not determine its location. Move into open sky and try again.",
      3: "GPS took too long. Move into open sky and try again."
    }[error.code] || "GPS location could not be recorded")),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  ));
}

async function captureGpsLocation() {
  if (gpsPagePreviewActive()) return;
  const calibration = gpsCalibration();
  if (!calibration) return;
  const indicator = $("#gps-live-indicator");
  indicator.dataset.state = "locating";
  $("#gps-location-button").disabled = true;
  setGpsStatus("Finding your position… keep the phone still for a moment.");
  try {
    const fix = await readCurrentPosition();
    fix.course_point = gpsToCoursePoint(calibration, fix);
    fix.lie = lieAt(fix.course_point).type;
    fix.conditions = normalizeGpsBallConditions(null, fix.lie);
    const holeState = gpsHoleState();
    if (!holeState.tee) {
      holeState.tee = fix;
    } else {
      const start = gpsCurrentFix(holeState);
      holeState.shots.push({
        number: holeState.shots.length + 1,
        start,
        end: fix,
        distance_yards: gpsDistanceYards(start, fix),
        strategy: holeState.pending_strategy,
        recorded_at: fix.recorded_at
      });
      holeState.pending_strategy = null;
    }
    state.gpsCaddieExpanded = false;
    persistGpsRound();
    indicator.dataset.state = fix.accuracy_meters > 18 ? "error" : "ready";
    renderGpsMode();
    if (fix.accuracy_meters > 18) {
      setGpsStatus(`Position saved, but GPS accuracy is only ±${Math.round(fix.accuracy_meters * METERS_TO_YARDS)} yd. Use Undo last if the lie or distance looks wrong.`, "error");
    }
  } catch (error) {
    indicator.dataset.state = "error";
    setGpsStatus(error.message, "error");
    renderGpsMode();
    setGpsStatus(error.message, "error");
  }
}

function selectGpsStrategy(choiceId) {
  if (gpsPagePreviewActive()) return;
  const holeState = gpsHoleState();
  const fix = gpsCurrentFix(holeState);
  if (!fix) return;
  const conditions = gpsBallConditions(fix, fix.lie);
  const choice = gpsStrategyChoices(fix.course_point, fix.lie, conditions).find(item => item.id === choiceId);
  if (!choice) return;
  const choices = gpsStrategyChoices(fix.course_point, fix.lie, conditions);
  const analysis = runGpsStrategyAnalysis(fix.course_point, fix.lie, conditions, choices);
  const probability = analysis.candidates[choice.id];
  holeState.pending_strategy = {
    id: choice.id,
    title: choice.title,
    club_name: choice.clubName,
    club_index: choice.clubIndex,
    power: choice.power,
    target_label: choice.targetLabel,
    ball_conditions: conditions,
    hybrid_outlook: probability.hybrid_outlook,
    probability_score: probability.probability_score,
    probability_analysis: probability,
    analysis_identity: {
      version: analysis.version,
      ranking_version: analysis.ranking_version,
      seed: analysis.analysis_seed,
      sample_count: analysis.sample_count,
      recommended_choice_id: analysis.recommended_choice_id
    }
  };
  state.gpsCaddieExpanded = false;
  persistGpsRound();
  renderGpsMode();
}

function selectGpsManualShot() {
  if (gpsPagePreviewActive()) return;
  const holeState = gpsHoleState();
  const clubValue = $("#gps-club-select").value;
  if (clubValue === "") return;
  const clubIndex = Number(clubValue);
  const power = Number($("#gps-power-select").value);
  const club = state.profile.clubs[clubIndex];
  if (!club || club.name === "Putter") return;
  holeState.pending_strategy = manualGpsStrategy(holeState.pending_strategy, {
    clubName: club.name,
    clubIndex,
    power
  });
  holeState.pending_strategy.ball_conditions = gpsBallConditions();
  persistGpsRound();
  renderGpsMode();
}

function updateGpsBallCondition(field, value) {
  if (gpsPagePreviewActive()) return;
  const holeState = gpsHoleState();
  const fix = gpsCurrentFix(holeState);
  if (!fix || holeState.finished || fix.lie === "Green") return;
  fix.conditions = normalizeGpsBallConditions({ ...gpsBallConditions(fix, fix.lie), [field]: value }, fix.lie);
  if (holeState.pending_strategy?.id === "manual-choice") {
    holeState.pending_strategy.ball_conditions = fix.conditions;
  } else {
    holeState.pending_strategy = null;
  }
  persistGpsRound();
  renderGpsMode();
  setGpsStatus(`Conditions saved: ${gpsConditionSummary(fix.conditions, fix.lie)}.`);
}

function changeHole(index) {
  clearPendingAutoPlay();
  closeCompetitionComparison({ continueRound: true });
  state.holeIndex = Math.max(0, Math.min(17, index));
  if (state.competition) {
    state.competition.current_hole = state.holeIndex + 1;
    saveCompetition(localStorage, state.competition, state.player?.id);
  }
  state.pinIndex = rotatingPinIndex(state.holeIndex, hole().geometries.green_complex.pin_zones.length);
  if (state.liveGpsView) state.liveGpsFollowHole = false;
  resetHole();
  if (!state.liveGpsView) schedulePlayerRoundSync();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function replayRecordedShot(holeIndex, shotIndex) {
  const shot = state.roundHistory[holeIndex]?.[shotIndex];
  const packet = shot?.puttPacket || shot?.resultPacket;
  if (!shot || !packet || !Array.isArray(packet.path) || packet.path.length < 2) return false;

  clearPendingAutoPlay();
  clearPuttAnimation();
  clearFlightAnimation();
  state.holeIndex = bounded(holeIndex, 0, 17);
  state.pinIndex = rotatingPinIndex(state.holeIndex, hole().geometries.green_complex.pin_zones.length);
  resetHole();

  state.ball = pointArray(shot.start);
  state.currentLie = lieAt(state.ball).type;
  state.holeFinished = false;
  state.target = null;
  state.manualTargetPreview = false;
  calculateBounds();

  const strokeIndex = shotIndex + 1;
  let animation = null;
  if (shot.puttPacket) {
    animation = beginPuttAnimation(shot.puttPacket, strokeIndex, shot);
    if (animation) {
      puttAnimationTimer = window.setTimeout(() => {
        if (state.puttAnimation !== animation) return;
        puttAnimationTimer = null;
        state.puttAnimation = null;
        resetHole();
      }, animation.durationMs + 900);
    }
  } else {
    animation = beginFlightAnimation(shot.resultPacket, strokeIndex, state.bounds, shot.start, shot);
    if (animation) {
      flightAnimationTimer = window.setTimeout(() => {
        if (state.flightAnimation !== animation) return;
        flightAnimationTimer = null;
        state.flightAnimation = null;
        resetHole();
      }, animation.durationMs + 900);
    }
  }
  if (!animation) {
    resetHole();
    return false;
  }
  renderMap();
  updateShotDesk();
  window.scrollTo({ top: 0, behavior: "smooth" });
  return true;
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
  if (competitionActive()) {
    state.competition = createCompetitionRound({
      courseId: state.courseId,
      tee: state.tee,
      roundSeed: state.roundSeed,
      humanProfile: state.profile,
      pace: state.competition.pace,
      coachingEnabled: state.competition.coaching_enabled
    });
    state.competition.human_round = structuredClone(state.roundState);
    saveCompetition(localStorage, state.competition, state.player?.id);
  }
  state.pinIndex = rotatingPinIndex(0, hole().geometries.green_complex.pin_zones.length);
  state.selectedClub = 0;
  window.clearTimeout(gpsSyncTimer);
  gpsRound = createGpsRound(state.courseId);
  persistGpsRound();
  resetHole();
  updateAll();
  schedulePlayerRoundSync(0);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderProfileDialog() {
  const profiles = [...builtInProfiles, ...state.customProfiles];
  $("#profile-list").innerHTML = profiles.map(profile => `
    <button type="button" class="profile-option ${profile.id === state.profile.id ? "selected" : ""}" data-profile="${profile.id}">
      <span class="profile-badge">${escapeHtml(profile.id.startsWith("custom") ? "C" : profile.id[0])}</span>
      <span><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml(profile.description || "Your custom club distances")}</small></span>
      <span class="profile-driver">${profile.clubs[0].carry} yd driver</span>
    </button>`).join("");
  $$(".profile-option").forEach(button => button.addEventListener("click", async () => {
    if (competitionActive()) {
      window.alert("The golfer profile is locked for this competition. Return to your solo round or start a new Game Master match to change it.");
      return;
    }
    state.profile = profiles.find(p => p.id === button.dataset.profile);
    state.selectedClub = 0;
    localStorage.setItem(profileStorageKey(), state.profile.id);
    renderProfileDialog();
    updateAll();
    await savePlayerProfile(state.profile);
    schedulePlayerRoundSync();
  }));
}

function onCourseClubStat(clubName) {
  return state.onCourseClubStats?.clubs?.find(stat => stat.club_name === clubName) || null;
}

function onCourseClubStatMarkup(clubName) {
  if (state.onCourseClubStatsLoading) {
    return `<span class="on-course-stat-waiting">Reading GPS rounds…</span>`;
  }
  const stat = onCourseClubStat(clubName);
  if (!stat || !stat.attempts) {
    return `<span class="on-course-stat-waiting">No eligible full swings yet</span>`;
  }
  const carry = stat.estimated_carry_yards == null ? "—" : `${stat.estimated_carry_yards} yd`;
  const accuracy = stat.on_course_accuracy_percent == null ? "—" : `${stat.on_course_accuracy_percent}%`;
  const evidence = `${stat.attempts} attempt${stat.attempts === 1 ? "" : "s"} · ${stat.successful_shots} successful · ${stat.rounds} round${stat.rounds === 1 ? "" : "s"}`;
  return `<strong>${carry} <i>/</i> ${accuracy}</strong>
    <small>${evidence}</small>
    <footer><span data-confidence="${stat.confidence.toLowerCase()}">${escapeHtml(stat.confidence)}</span>
      <button type="button" data-apply-on-course="${escapeHtml(clubName)}" ${stat.can_apply ? "" : "disabled"}>${stat.can_apply ? "Use values" : "Need 3 successes"}</button>
    </footer>`;
}

function renderOnCourseClubStats() {
  $$("[data-on-course-club]").forEach(cell => {
    cell.innerHTML = onCourseClubStatMarkup(cell.dataset.onCourseClub);
  });
  const summary = $("#on-course-stats-summary");
  if (!summary) return;
  const copy = summary.querySelector("span");
  if (state.onCourseClubStatsLoading) {
    copy.textContent = "Loading all synchronized GPS rounds…";
    return;
  }
  if (state.onCourseClubStatsError) {
    copy.textContent = state.onCourseClubStatsError;
    return;
  }
  const stats = state.onCourseClubStats;
  const attempts = (stats?.clubs || []).reduce((total, stat) => total + stat.attempts, 0);
  const misses = (stats?.clubs || []).reduce((total, stat) => total + stat.missed_shots, 0);
  copy.textContent = attempts
    ? `${attempts} eligible full swings across ${stats.rounds_with_eligible_shots} rounds. Carry uses successful shots at GPS distance × 90%; accuracy includes ${misses} missed or outlying shots.`
    : "No eligible full-swing GPS shots have synchronized yet. Partial swings, recovery shots, and poor GPS fixes are excluded.";
}

async function loadOnCourseClubStats() {
  state.onCourseClubStatsLoading = true;
  state.onCourseClubStatsError = "";
  renderOnCourseClubStats();
  try {
    const payload = await playerApi("/api/player/gps-club-stats");
    state.onCourseClubStats = payload.statistics || null;
  } catch (error) {
    console.error("Could not load on-course club statistics", error);
    state.onCourseClubStatsError = "On-course evidence could not be loaded from the server.";
  } finally {
    state.onCourseClubStatsLoading = false;
    renderOnCourseClubStats();
  }
}

function applyOnCourseClubValues(clubName, button) {
  const stat = onCourseClubStat(clubName);
  const row = button.closest(".club-row");
  if (!stat?.can_apply || !row || stat.estimated_carry_yards == null || stat.on_course_accuracy_percent == null) return;
  const confirmed = window.confirm(
    `Use accumulated on-course values for ${clubName}?\n\n` +
    `${stat.estimated_carry_yards} yd estimated carry · ${stat.on_course_accuracy_percent}% accuracy\n` +
    `${stat.attempts} attempts · ${stat.successful_shots} successful · ${stat.rounds} rounds · ${stat.confidence} confidence\n\n` +
    "The new values are not permanent until you select Save profile."
  );
  if (!confirmed) return;
  row.querySelector('[data-profile-field="carry"]').value = String(stat.estimated_carry_yards);
  row.querySelector('[data-profile-field="accuracy"]').value = String(stat.on_course_accuracy_percent);
  button.textContent = "Applied · save profile";
  button.disabled = true;
}

function openCustomizer() {
  const clone = structuredClone(state.profile);
  const fullSwingClubs = clone.clubs.filter(club => club.name !== "Putter");
  const puttingRates = normalizePuttingMakeRates(clone);
  $("#custom-name").value = state.profile.id.startsWith("custom")
    ? personalizeCustomProfile(state.profile, state.player?.name).name
    : playerProfileName(state.player?.name);
  $("#club-editor").innerHTML = fullSwingClubs.map((club, i) => `
    <div class="club-row" data-index="${i}" data-profile-club-name="${escapeHtml(club.name)}">
      <strong>${escapeHtml(club.name)}</strong>
      <input data-profile-field="carry" type="number" inputmode="numeric" min="5" max="350" step="1" value="${club.carry}" aria-label="${escapeHtml(club.name)} carry yards" required>
      <div class="percent-field">
        <input data-profile-field="accuracy" type="number" inputmode="numeric" min="0" max="100" step="1" value="${club.accuracy}" aria-label="${escapeHtml(club.name)} accuracy percentage" required>
        <span aria-hidden="true">%</span>
      </div>
      <div class="on-course-club-stat" data-on-course-club="${escapeHtml(club.name)}">${onCourseClubStatMarkup(club.name)}</div>
    </div>`).join("");
  $$('[data-putting-distance]').forEach(input => {
    input.value = puttingRates[input.dataset.puttingDistance];
  });
  $("#profile-dialog").close();
  $("#custom-dialog").showModal();
  void loadOnCourseClubStats();
}

async function saveCustomProfile(event) {
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
    id: state.profile.id.startsWith("custom") ? state.profile.id : `custom-${Date.now()}`,
    name: $("#custom-name").value.trim(),
    description: "Personal club distances and putting statistics",
    puttingMakeRates,
    clubs
  });
  const existingIndex = state.customProfiles.findIndex(candidate => candidate.id === profile.id);
  if (existingIndex >= 0) state.customProfiles[existingIndex] = profile;
  else state.customProfiles.push(profile);
  state.profile = profile;
  state.selectedClub = 0;
  localStorage.setItem(customProfilesStorageKey(), JSON.stringify(state.customProfiles));
  localStorage.setItem(profileStorageKey(), profile.id);
  await savePlayerProfile(profile);
  $("#custom-dialog").close();
  renderProfileDialog();
  updateAll();
  schedulePlayerRoundSync();
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
        <tr class="score-row"><th>Score</th>${data.map((entry, i) => {
          const score = state.scores[i + offset];
          return `<td>${scoreMarkMarkup(score, entry.Par)}</td>`;
        }).join("")}<td class="total">${data.reduce((sum, _, i) => sum + (state.scores[i + offset] || 0), 0) || "—"}</td></tr>
      </tbody>
    </table>`;
  $("#scorecard-grid").innerHTML = scoreTallyMarkup() + section(front, 0, "Out") + section(back, 9, "In");
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
  const meaningfulHoleIndexes = new Set(meaningfulReviewHoles().map(hole => hole.index));

  const replayLibraryMarkup = shots.length ? `<details class="shot-replay-library" open>
    <summary><span>Replay every shot</span><small>${shots.length} recorded shot${shots.length === 1 ? "" : "s"}</small></summary>
    <div class="shot-replay-groups">${state.roundHistory.map((holeShots, holeIndex) => holeShots.length ? `
      <section><strong>Hole ${holeIndex + 1}</strong><div>${holeShots.map((shot, shotIndex) => {
        const replayable = Boolean((shot.puttPacket || shot.resultPacket)?.path?.length >= 2);
        return `<button class="shot-replay-button" type="button" data-replay-shot="${holeIndex}:${shotIndex}" ${replayable ? "" : "disabled"}>▶ Shot ${shotIndex + 1} · ${escapeHtml(shot.club || "Shot")}</button>`;
      }).join("")}</div></section>` : "").join("")}</div>
  </details>` : "";

  const learningReviewMarkup = shots.length ? state.roundHistory.map((holeShots, index) => {
    if (!holeShots.length || !meaningfulHoleIndexes.has(index)) return "";
    const holeCard = state.scorecard[index];
    const score = state.scores[index];
    const scoreToPar = score == null ? null : score - holeCard.Par;
    const relative = scoreToPar == null ? "Incomplete" : `${fmtScore(scoreToPar)} · ${golfScoreName(scoreToPar)}`;
    const teeYardage = holeCard[`Yards_${state.tee}`];
    const reviewedShots = holeShots.filter(shot =>
      overallQualityFromAssessment(packetAssessment(shot), shot.quality) === "bad" ||
      decisionQualityFromAssessment(packetAssessment(shot), shot.quality) === "review" ||
      executionQualityFromAssessment(packetAssessment(shot), shot.quality) === "review"
    ).length;
    const penaltyOnlyReviews = holeShots.filter(shot =>
      shot.penalty > 0 &&
      overallQualityFromAssessment(packetAssessment(shot), shot.quality) !== "bad" &&
      decisionQualityFromAssessment(packetAssessment(shot), shot.quality) !== "review" &&
      executionQualityFromAssessment(packetAssessment(shot), shot.quality) !== "review"
    ).length;
    const reviews = reviewedShots + penaltyOnlyReviews;
    const needsImprovement = reviews > 0 || (scoreToPar != null && scoreToPar >= 2);
    const reviewState = needsImprovement ? "needs-improvement" : score == null ? "review-neutral" : "review-clean";
    const reviewLabel = reviews
      ? `${reviews} to review`
      : needsImprovement
        ? "Scoring review"
        : scoreToPar != null && scoreToPar < 0
          ? "Strong hole"
          : score == null ? "In progress" : "Clean hole";
    return `<details class="review-hole ${reviewState}" ${priorityHoles.includes(index) ? "open" : ""}>
      <summary>
        <div class="review-hole-overview">
          <div class="review-hole-title"><strong>Hole ${index + 1}</strong><small>${state.tee} tee</small></div>
          <div class="review-hole-scorecard" aria-label="Hole ${index + 1} scorecard">
            <span><small>Par</small><b>${holeCard.Par}</b></span>
            <span><small>Distance</small><b>${teeYardage} yd</b></span>
            <span title="Course handicap ranking; 1 is the most difficult hole"><small>Handicap</small><b>${holeCard.Handicap}</b></span>
            <span><small>Score</small><b class="review-score-value">${scoreMarkMarkup(score, holeCard.Par)} <em>${relative}</em></b></span>
          </div>
        </div>
        <span class="hole-review-count">${reviewLabel}</span>
      </summary>
      <section class="hole-ai-insight" data-ai-hole-review="${index + 1}">
        <span>AI Caddie insight</span>
        <p>Reviewing this meaningful hole…</p>
      </section>
      ${holeShots.map((shot, shotIndex) => {
        const assessment = packetAssessment(shot);
        const quality = overallQualityFromAssessment(assessment, shot.quality);
        const decisionQuality = decisionQualityFromAssessment(assessment, shot.quality);
        const executionQuality = executionQualityFromAssessment(assessment, shot.quality);
        const strategy = strategySummary(shot);
        const learningNotes = verifiedLearningNotesForShot(shot);
        return `<div class="review-shot ${quality}">
        <div class="shot-verdict"><b>Shot ${shotIndex + 1}</b><strong>${shot.club} · ${shotPowerLabel(shot.power, shot.club)}</strong></div>
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
        ${shot.adjustmentReward?.accuracy_bonus > 0 ? `<div class="shot-reasons"><span>${escapeHtml(`${shot.adjustmentReward.grade === "excellent" ? "Excellent" : shot.adjustmentReward.grade === "sound" ? "Good" : "Useful"} adjustment · ${shot.adjustmentReward.base_accuracy}% → ${shot.adjustmentReward.effective_accuracy}% accuracy for this shot`)}</span></div>` : ""}
        ${learningNotes.length ? `<aside class="shot-learning-context"><span>Player record</span>${learningNotes.map(note => `<p>${escapeHtml(note)}</p>`).join("")}</aside>` : ""}
        <p>${shot.lesson}</p>
        <button class="shot-replay-button inline" type="button" data-replay-shot="${index}:${shotIndex}" ${Boolean((shot.puttPacket || shot.resultPacket)?.path?.length >= 2) ? "" : "disabled"}>▶ Replay this shot</button>
      </div>`;
      }).join("")}
      <button class="replay-hole-button" type="button" data-replay-hole="${index}">Reset & replay Hole ${index + 1}</button>
    </details>`;
  }).join("") : "";
  $("#round-review-list").innerHTML = replayLibraryMarkup + (learningReviewMarkup || `<div class="review-shot"><p>${shots.length
    ? "No hole from this round met the learning-review threshold. The complete round remains available in the scorecard."
    : "No shot history has been recorded for this round yet. Play a new shot to begin the learning report. Scores from rounds played before this feature do not contain shot details."}</p></div>`);
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
  $$('[data-replay-shot]').forEach(button => button.addEventListener("click", () => {
    const [holeIndex, shotIndex] = button.dataset.replayShot.split(":").map(Number);
    $("#round-review-dialog").close();
    replayRecordedShot(holeIndex, shotIndex);
  }));
  $("[data-review-scorecard]").addEventListener("click", () => {
    $("#round-review-dialog").close();
    renderScorecard();
    setRoundFileStatus("Round files include your shots, score, tee, and player profile.");
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

function renderPlayerGuide(markdown) {
  const container = $("#player-guide-content");
  const fragment = document.createDocumentFragment();
  let activeList = null;
  const appendTextElement = (tagName, text, className = "") => {
    const element = document.createElement(tagName);
    element.textContent = text;
    if (className) element.className = className;
    fragment.append(element);
    return element;
  };
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      activeList = null;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      activeList = null;
      if (heading[1].length === 1) continue;
      appendTextElement(`h${Math.min(4, heading[1].length + 1)}`, heading[2]);
      continue;
    }
    if (line.startsWith("> ")) {
      activeList = null;
      appendTextElement("div", line.slice(2), "guide-principle");
      continue;
    }
    const orderedItem = /^\d+\.\s+(.+)$/.exec(line);
    const bulletItem = /^-\s+(.+)$/.exec(line);
    if (orderedItem || bulletItem) {
      const listTag = orderedItem ? "OL" : "UL";
      if (!activeList || activeList.tagName !== listTag) {
        activeList = document.createElement(listTag.toLowerCase());
        fragment.append(activeList);
      }
      const item = document.createElement("li");
      item.textContent = (orderedItem || bulletItem)[1];
      activeList.append(item);
      continue;
    }
    activeList = null;
    appendTextElement("p", line);
  }
  container.replaceChildren(fragment);
}

async function openPlayerGuide() {
  const dialog = $("#player-guide-dialog");
  dialog.showModal();
  const container = $("#player-guide-content");
  if (container.dataset.loaded === "true") return;
  try {
    const response = await fetch("USERGUIDE.md", { cache: "no-store" });
    if (!response.ok) throw new Error(`Guide request failed with ${response.status}`);
    renderPlayerGuide(await response.text());
    container.dataset.loaded = "true";
  } catch (error) {
    container.textContent = "The player guide could not be loaded here. Use Open Markdown file below to read it directly.";
    console.error(error);
  }
}

function updatePlayerAccountUI() {
  if (!state.player) return;
  const initial = state.player.name.trim().charAt(0).toUpperCase() || "P";
  $("#account-monogram").textContent = initial;
  $("#account-name").textContent = state.player.name;
  $("#account-dialog-name").textContent = state.player.name;
  updateAccountProfileSummary();
}

function updateAccountProfileSummary() {
  if (!state.profile) return;
  const driver = state.profile.clubs.find(club => club.name === "Driver") || state.profile.clubs[0];
  const putting = normalizePuttingMakeRates(state.profile);
  const name = $("#account-profile-name");
  const summary = $("#account-profile-summary");
  if (name) name.textContent = state.profile.name;
  if (summary) summary.textContent = `${driver.name} ${Math.round(driver.carry)} yd · 3-foot putts ${putting[3]}%`;
}

function historyDateParts(isoValue) {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return { day: "Saved", year: "round" };
  return {
    day: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date),
    year: new Intl.DateTimeFormat(undefined, { year: "numeric" }).format(date)
  };
}

function renderRoundHistory(rounds) {
  const list = $("#round-history-list");
  $("#round-history-count").textContent = String(rounds.length);
  if (!rounds.length) {
    list.innerHTML = `<div class="round-history-empty">
      <strong>Your first finished round will appear here.</strong>
      <span>Complete all 18 holes. The game will preserve the result automatically—no export or extra save button is required.</span>
    </div>`;
    return;
  }
  list.innerHTML = rounds.map(round => {
    const date = historyDateParts(round.completed_at);
    const relative = Number.isInteger(round.score_to_par) ? fmtScore(round.score_to_par) : "—";
    const parCopy = Number.isInteger(round.total_par) ? `Par ${round.total_par}` : "Par unavailable";
    const management = Number.isInteger(round.strategy_score) ? round.strategy_score : "—";
    const managementCopy = Number.isInteger(round.scored_shots)
      ? `${round.scored_shots} decisions`
      : "Awaiting scored shots";
    return `<article class="history-round" data-round-id="${escapeHtml(round.id)}">
      <time class="history-round-date" datetime="${escapeHtml(round.completed_at)}"><strong>${escapeHtml(date.day)}</strong><span>${escapeHtml(date.year)}</span></time>
      <div class="history-round-course"><strong>${escapeHtml(round.course_name || round.course_id)}</strong><span>${escapeHtml(round.tee || "White")} tee · 18 holes</span></div>
      <div class="history-round-stat history-round-strokes"><span>Strokes</span><strong>${Number.isInteger(round.total_strokes) ? round.total_strokes : "—"}</strong><small>${parCopy}</small></div>
      <div class="history-round-stat history-round-relative"><span>To par</span><strong>${relative}</strong><small>Round score</small></div>
      <div class="history-round-stat history-round-management"><span>Course management</span><strong>${management}</strong><small>${managementCopy}</small></div>
    </article>`;
  }).join("");
}

async function openRoundHistory() {
  $("#account-dialog").close();
  const dialog = $("#round-history-dialog");
  $("#round-history-count").textContent = "—";
  $("#round-history-list").innerHTML = `<div class="round-history-empty"><strong>Opening your record…</strong></div>`;
  dialog.showModal();
  try {
    const payload = await playerApi("/api/player/round-history?limit=100");
    renderRoundHistory(Array.isArray(payload.rounds) ? payload.rounds : []);
  } catch (error) {
    console.error("Could not load round history", error);
    $("#round-history-list").innerHTML = `<div class="round-history-empty">
      <strong>Round history could not be loaded.</strong>
      <span>${escapeHtml(error.message)} Close this window and try again.</span>
    </div>`;
  }
}

function renderLeaderboard(leaders) {
  const list = $("#leaderboard-list");
  if (!leaders.length) {
    list.innerHTML = `<li class="round-history-empty">
      <strong>The board is waiting for its first scored round.</strong>
      <span>Finish all 18 holes with a Course Management score to enter the ranking.</span>
    </li>`;
    return;
  }
  list.innerHTML = leaders.map((leader, index) => {
    const rank = index + 1;
    const relative = Number.isInteger(leader.score_to_par) ? fmtScore(leader.score_to_par) : "—";
    const course = leader.course_name || leader.course_id || "Completed round";
    return `<li class="leaderboard-row" data-rank="${rank}">
      <span class="leaderboard-rank"><b>${rank}</b></span>
      <div class="leaderboard-player"><strong>${escapeHtml(leader.player_name || "Player")}</strong><span>${escapeHtml(course)} · ${escapeHtml(leader.tee || "White")} tee · ${relative}</span></div>
      <strong class="leaderboard-strokes">${Number.isInteger(leader.total_strokes) ? leader.total_strokes : "—"}</strong>
      <strong class="leaderboard-management">${Number.isInteger(leader.strategy_score) ? leader.strategy_score : "—"}</strong>
    </li>`;
  }).join("");
}

async function openLeaderboard() {
  $("#account-dialog").close();
  const dialog = $("#leaderboard-dialog");
  $("#leaderboard-list").innerHTML = `<li class="round-history-empty"><strong>Reading the clubhouse board…</strong></li>`;
  dialog.showModal();
  try {
    const payload = await playerApi("/api/player/leaderboard");
    renderLeaderboard(Array.isArray(payload.leaders) ? payload.leaders : []);
  } catch (error) {
    console.error("Could not load leaderboard", error);
    $("#leaderboard-list").innerHTML = `<li class="round-history-empty">
      <strong>The rank board could not be loaded.</strong>
      <span>${escapeHtml(error.message)} Close this window and try again.</span>
    </li>`;
  }
}

function learningPatternCopy(pattern) {
  const evidence = `${pattern.sample_size} shots across ${pattern.round_count} rounds`;
  if (pattern.kind === "lie_strength" || pattern.kind === "lie_improvement") {
    return {
      tone: pattern.kind === "lie_strength" ? "strength" : "review",
      label: pattern.kind === "lie_strength" ? "Verified strength" : "Practice priority",
      title: formatStrategyCategory(pattern.key),
      copy: `${evidence}. Average course-management decision ${pattern.decision_score}.`
    };
  }
  if (pattern.kind === "sidehill_strength" || pattern.kind === "sidehill_improvement") {
    return {
      tone: pattern.kind === "sidehill_strength" ? "strength" : "review",
      label: pattern.kind === "sidehill_strength" ? "Verified strength" : "Practice priority",
      title: "Sidehill adjustments",
      copy: `${pattern.success_rate}% correct on ${pattern.sample_size} shots across ${pattern.round_count} rounds.`
    };
  }
  return {
    tone: "review",
    label: "Recurring decision",
    title: formatStrategyReason(pattern.key),
    copy: `Appeared on ${evidence}. This verified pattern can now support caddie explanations and reviews.`
  };
}

function renderRecentDecisionForm(progress) {
  const rounds = Array.isArray(progress?.rounds) ? progress.rounds : [];
  const scoredRounds = Number(progress?.scored_rounds || rounds.length);
  const roundsNeeded = Number(progress?.rounds_needed || 0);
  const change = Number(progress?.change);
  const hasComparison = Number.isFinite(change) && progress?.recent_average !== null && progress?.previous_average !== null;
  const form = {
    improving: {
      title: "Your decisions are improving",
      copy: `Your latest three-round average is ${progress?.recent_average}, up from ${progress?.previous_average}.`,
      badge: `+${change}`
    },
    needs_attention: {
      title: "Recent decisions need attention",
      copy: `Your latest three-round average is ${progress?.recent_average}, down from ${progress?.previous_average}. Review the verified priorities below.`,
      badge: String(change)
    },
    steady: {
      title: "Your decision score is holding steady",
      copy: `Your latest three-round average is ${progress?.recent_average}; the previous three averaged ${progress?.previous_average}.`,
      badge: change > 0 ? `+${change}` : String(change)
    }
  }[progress?.status] || {
    title: scoredRounds ? `${scoredRounds} of 6 scored rounds` : "Finish a round to start your form card",
    copy: scoredRounds
      ? `Complete ${roundsNeeded} more scored ${roundsNeeded === 1 ? "round" : "rounds"} before the game compares two three-round decision windows.`
      : "Only completed-round Course Management scores appear here.",
    badge: scoredRounds ? `${roundsNeeded} to go` : "Building"
  };
  const roundCards = rounds.length
    ? `<div class="learning-form-rounds" role="list" aria-label="Course Management scores from oldest to newest">${rounds.map((round, index) => {
      const date = historyDateParts(round.completed_at);
      const latest = index === rounds.length - 1;
      return `<article class="learning-form-round${latest ? " latest" : ""}" role="listitem">
        <time datetime="${escapeHtml(round.completed_at || "")}">${escapeHtml(date.day)}</time>
        <strong>${Number.isInteger(round.strategy_score) ? round.strategy_score : "—"}</strong>
        <span>${escapeHtml(round.course_name || "Completed round")}</span>
        <small>${latest ? "Latest" : escapeHtml(round.tee || "White")}</small>
      </article>`;
    }).join("")}</div>`
    : "";
  return `<section class="learning-form ${escapeHtml(progress?.status || "building")}" aria-labelledby="recent-decision-form-title">
    <header>
      <div><span class="eyebrow">Recent decision form</span><strong id="recent-decision-form-title">${escapeHtml(form.title)}</strong></div>
      <b>${escapeHtml(form.badge)}</b>
    </header>
    <p>${escapeHtml(form.copy)}</p>
    ${roundCards}
    <footer>${hasComparison ? "Change compares the latest three rounds with the previous three." : "Six scored rounds are required for a trend."} Course Management only—simulated execution is excluded.</footer>
  </section>`;
}

function renderPlayerLearning(learning) {
  const content = $("#player-learning-content");
  const patterns = Array.isArray(learning?.verified_patterns) ? learning.verified_patterns : [];
  const rounds = Number(learning?.rounds_with_observations || 0);
  const shots = Number(learning?.observation_count || 0);
  const adjustmentCount = Number(learning?.coverage?.adjustments_recorded || 0);
  const statusTitle = patterns.length
    ? `${patterns.length} verified ${patterns.length === 1 ? "pattern" : "patterns"}`
    : "Building a trustworthy record";
  const statusCopy = patterns.length
    ? "Only findings that cleared the evidence gate appear below. These facts may now support caddie explanations."
    : `No pattern has cleared the evidence gate yet. Keep playing normally; the game needs at least ${learning?.minimums?.pattern_samples || 8} comparable shots across ${learning?.minimums?.pattern_rounds || 3} completed rounds.`;
  content.innerHTML = `
    <section class="learning-ledger-head">
      <div><span class="eyebrow">Current evidence</span><strong>${escapeHtml(statusTitle)}</strong><p>${escapeHtml(statusCopy)}</p></div>
      <div class="learning-tally"><strong>${shots}</strong><span>scored shots</span><small>${rounds} rounds · ${adjustmentCount} player notes</small></div>
    </section>
    <section class="learning-gate" aria-label="Player learning confidence rule">
      <span>Evidence gate</span>
      <strong>${learning?.minimums?.pattern_samples || 8} comparable shots</strong>
      <i aria-hidden="true">+</i>
      <strong>${learning?.minimums?.pattern_rounds || 3} completed rounds</strong>
    </section>
    ${renderRecentDecisionForm(learning?.recent_progress || {})}
    ${patterns.length ? `<div class="learning-pattern-list">${patterns.map(pattern => {
      const item = learningPatternCopy(pattern);
      return `<article class="learning-pattern ${item.tone}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.copy)}</p></article>`;
    }).join("")}</div>` : `<div class="learning-waiting"><strong>No guesses—only evidence.</strong><p>Your rounds are saved, and every authoritative shot is counted. The view will change automatically when one strategic situation has enough repeat evidence.</p></div>`}`;
}

async function openPlayerLearning() {
  $("#account-dialog").close();
  const dialog = $("#player-learning-dialog");
  $("#player-learning-content").innerHTML = `<div class="round-history-empty"><strong>Reading your completed rounds…</strong></div>`;
  dialog.showModal();
  try {
    const payload = await playerApi("/api/player/learning");
    state.playerLearning = payload.learning || null;
    renderPlayerLearning(state.playerLearning || {});
  } catch (error) {
    console.error("Could not load player learning", error);
    $("#player-learning-content").innerHTML = `<div class="round-history-empty"><strong>Player learning could not be loaded.</strong><span>${escapeHtml(error.message)} Close this window and try again.</span></div>`;
  }
}

const FEEDBACK_CATEGORY_LABELS = {
  bug: "Bug",
  suggestion: "Suggestion",
  feature: "Feature request",
  course_map: "Course / map",
  ai_caddie: "AI Caddie",
  other: "Other"
};

const FEEDBACK_STATUS_LABELS = {
  received: "Received",
  under_review: "Under review",
  planned: "Planned",
  implemented: "Implemented",
  closed: "Closed"
};

function feedbackContext() {
  return {
    game_version: "20260816-225",
    course_id: state.courseId,
    course_name: state.course?.shortName || state.course?.name || state.courseId,
    hole_number: state.holeIndex + 1,
    mode: document.body.classList.contains("gps-mode-open") ? "gps" : state.liveGpsView ? "live" : "game",
    lie: currentLieType(),
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    browser: navigator.userAgent.slice(0, 220)
  };
}

function feedbackContextMarkup(context = {}) {
  const values = [
    context.course_name && `${context.course_name} · Hole ${context.hole_number || "—"}`,
    context.mode && `${String(context.mode).toUpperCase()} mode`,
    context.lie && `Lie: ${context.lie}`,
    context.viewport && `Screen ${context.viewport}`
  ].filter(Boolean);
  return values.length ? `<div class="feedback-context">${values.map(value => `<span>${escapeHtml(value)}</span>`).join("")}</div>` : "";
}

function feedbackThreadMarkup(messages = []) {
  if (!messages.length) return "";
  return `<div class="feedback-thread">${messages.map(message => {
    const date = historyDateParts(message.created_at);
    return `<article class="feedback-message" data-role="${escapeHtml(message.sender_role || "player")}">
      <strong>${escapeHtml(message.sender_name || (message.sender_role === "developer" ? "Developer" : "Player"))}</strong><time datetime="${escapeHtml(message.created_at || "")}">${escapeHtml(`${date.day} ${date.year}`)}</time>
      <p>${escapeHtml(message.body || "")}</p>
    </article>`;
  }).join("")}</div>`;
}

function feedbackAttachmentMarkup(attachments = []) {
  return attachments.map(attachment => `<button class="feedback-attachment-link" type="button" data-feedback-attachment="${escapeHtml(attachment.id)}">View ${escapeHtml(attachment.file_name || "screenshot")}</button>`).join("");
}

function playerFeedbackMarkup(item) {
  const date = historyDateParts(item.created_at);
  return `<article class="feedback-item${item.has_unread ? " unread" : ""}">
    <header class="feedback-item-head">
      <span class="feedback-category">${escapeHtml(FEEDBACK_CATEGORY_LABELS[item.category] || item.category)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <time datetime="${escapeHtml(item.created_at || "")}">${escapeHtml(`${date.day} ${date.year}`)}</time>
      <span class="feedback-status">${escapeHtml(FEEDBACK_STATUS_LABELS[item.status] || item.status)}</span>
    </header>
    <div class="feedback-item-body">
      <p>${escapeHtml(item.body)}</p>
      ${feedbackContextMarkup(item.context)}
      ${feedbackAttachmentMarkup(item.attachments)}
      ${feedbackThreadMarkup(item.messages)}
      <form class="feedback-thread-reply" data-feedback-reply="${escapeHtml(item.id)}">
        <textarea maxlength="4000" rows="2" aria-label="Reply about ${escapeHtml(item.title)}" placeholder="Reply to the developer"></textarea>
        <button class="secondary-action" type="submit">Reply</button>
      </form>
    </div>
  </article>`;
}

function renderPlayerFeedback() {
  const list = $("#player-feedback-list");
  const items = Array.isArray(state.feedbackData?.items) ? state.feedbackData.items : [];
  list.innerHTML = items.length
    ? items.map(playerFeedbackMarkup).join("")
    : `<div class="round-history-empty"><strong>Your mailbox is empty.</strong><span>Send a suggestion, feature request, course correction, or bug report. The developer can reply here.</span></div>`;
}

function syncFeedbackBadge() {
  const unread = Number(state.feedbackData?.unread_count || 0);
  const accountBadge = $("#feedback-unread-badge");
  const tabBadge = $("#feedback-tab-unread");
  for (const badge of [accountBadge, tabBadge]) {
    if (!badge) continue;
    badge.textContent = String(unread);
    badge.hidden = unread < 1;
  }
}

function syncFeedbackRating() {
  const rating = Number(state.feedbackRatingDraft || 0);
  $$('[data-feedback-stars]').forEach(button => {
    const selected = Number(button.dataset.feedbackStars) <= rating;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(Number(button.dataset.feedbackStars) === rating));
  });
}

async function loadPlayerFeedback() {
  const payload = await playerApi("/api/player/feedback");
  state.feedbackData = {
    rating: payload.rating || null,
    items: Array.isArray(payload.items) ? payload.items : [],
    unread_count: Number(payload.unread_count || 0)
  };
  state.feedbackRatingDraft = Number(state.feedbackData.rating?.stars || 0);
  $("#feedback-rating-comment").value = state.feedbackData.rating?.comment || "";
  syncFeedbackRating();
  syncFeedbackBadge();
  renderPlayerFeedback();
  return state.feedbackData;
}

async function markPlayerFeedbackRead() {
  if (!state.feedbackData?.unread_count) return;
  await playerApi("/api/player/feedback/read", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ read: true })
  });
  state.feedbackData.unread_count = 0;
  state.feedbackData.items.forEach(item => { item.has_unread = false; });
  syncFeedbackBadge();
  renderPlayerFeedback();
}

async function refreshFeedbackBadge() {
  try {
    await loadPlayerFeedback();
  } catch (error) {
    console.error("Could not check player feedback", error);
  }
}

function setFeedbackTab(tab) {
  const allowed = state.player?.is_developer ? ["send", "mine", "developer"] : ["send", "mine"];
  state.feedbackTab = allowed.includes(tab) ? tab : "send";
  $$('[data-feedback-tab]').forEach(button => button.setAttribute("aria-pressed", String(button.dataset.feedbackTab === state.feedbackTab)));
  $$('[data-feedback-panel]').forEach(panel => { panel.hidden = panel.dataset.feedbackPanel !== state.feedbackTab; });
  if (state.feedbackTab === "mine") void markPlayerFeedbackRead();
  if (state.feedbackTab === "developer") void loadDeveloperFeedback();
}

async function openFeedbackCenter(tab = "send") {
  $("#account-dialog").close();
  $("#feedback-developer-tab").hidden = !state.player?.is_developer;
  $("#feedback-dialog").showModal();
  setFeedbackTab(tab);
  try {
    await loadPlayerFeedback();
    if (state.feedbackTab === "mine") await markPlayerFeedbackRead();
  } catch (error) {
    console.error("Could not load Feedback Center", error);
    $("#player-feedback-list").innerHTML = `<div class="round-history-empty"><strong>Feedback could not be loaded.</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The screenshot could not be read."));
    reader.readAsDataURL(file);
  });
}

async function compressedFeedbackAttachment(file) {
  if (!file) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error("Choose a JPEG, PNG, or WebP screenshot.");
  let blob = file;
  if (file.size > 900_000) {
    const sourceUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = sourceUrl;
      await image.decode();
      const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .76));
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  }
  if (!blob || blob.size > 1_500_000) throw new Error("The screenshot is still too large. Crop it and try again.");
  const dataUrl = await fileAsDataUrl(blob);
  return {
    name: String(file.name || "feedback-screenshot.jpg").slice(0, 100),
    mime_type: blob.type || file.type,
    data: String(dataUrl).split(",", 2)[1]
  };
}

function developerFeedbackMarkup(item) {
  const date = historyDateParts(item.created_at);
  const statusOptions = Object.entries(FEEDBACK_STATUS_LABELS).map(([value, label]) => `<option value="${value}"${item.status === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
  return `<article class="feedback-item">
    <header class="feedback-item-head">
      <span class="feedback-category">${escapeHtml(FEEDBACK_CATEGORY_LABELS[item.category] || item.category)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <time datetime="${escapeHtml(item.created_at || "")}">${escapeHtml(`${date.day} ${date.year}`)}</time>
      <span class="feedback-status">${escapeHtml(FEEDBACK_STATUS_LABELS[item.status] || item.status)}</span>
    </header>
    <div class="feedback-item-body">
      <div class="feedback-player-line">${escapeHtml(item.player_name || "Player")}${item.player_email ? ` · ${escapeHtml(item.player_email)}` : ""}</div>
      <p>${escapeHtml(item.body)}</p>
      ${feedbackContextMarkup(item.context)}
      ${feedbackAttachmentMarkup(item.attachments)}
      ${feedbackThreadMarkup(item.messages)}
      <form class="feedback-developer-action" data-developer-feedback="${escapeHtml(item.id)}">
        <label>Status <select>${statusOptions}</select></label>
        <label>Reply <textarea maxlength="4000" rows="2" placeholder="Optional reply to player"></textarea></label>
        <button class="primary-action" type="submit">Update</button>
      </form>
    </div>
  </article>`;
}

async function loadDeveloperFeedback() {
  if (!state.player?.is_developer) return;
  const list = $("#developer-feedback-list");
  list.innerHTML = `<div class="round-history-empty"><strong>Opening the developer inbox…</strong></div>`;
  const parameters = new URLSearchParams({ limit: "200" });
  const status = $("#feedback-status-filter").value;
  const category = $("#feedback-category-filter").value;
  if (status) parameters.set("status", status);
  if (category) parameters.set("category", category);
  try {
    const payload = await playerApi(`/api/developer/feedback?${parameters}`);
    const items = Array.isArray(payload.items) ? payload.items : [];
    $("#feedback-developer-count").textContent = `${items.length} ${items.length === 1 ? "request" : "requests"}`;
    const count = Number(payload.rating_summary?.count || 0);
    $("#feedback-rating-summary").textContent = count
      ? `${Number(payload.rating_summary.average).toFixed(1)} average from ${count} ${count === 1 ? "rating" : "ratings"}`
      : "No ratings yet";
    list.innerHTML = items.length
      ? items.map(developerFeedbackMarkup).join("")
      : `<div class="round-history-empty"><strong>No feedback matches these filters.</strong></div>`;
  } catch (error) {
    list.innerHTML = `<div class="round-history-empty"><strong>Developer feedback could not be loaded.</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

async function openFeedbackAttachment(attachmentId) {
  const preview = window.open("", "_blank");
  try {
    const requestOptions = { headers: {} };
    if (supabaseAuth) {
      const token = await supabaseAuth.getAccessToken();
      if (token) requestOptions.headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`/api/player/feedback-attachment?id=${encodeURIComponent(attachmentId)}`, requestOptions);
    if (!response.ok) throw new Error("The screenshot could not be opened.");
    const objectUrl = URL.createObjectURL(await response.blob());
    if (preview) preview.location = objectUrl;
    else window.open(objectUrl, "_blank");
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    preview?.close();
    window.alert(error.message);
  }
}

async function playerApi(path, options = {}) {
  const requestOptions = { ...options, headers: { ...(options.headers || {}) } };
  if (supabaseAuth) {
    const accessToken = await supabaseAuth.getAccessToken();
    if (accessToken) requestOptions.headers.Authorization = `Bearer ${accessToken}`;
  }
  let response = await fetch(path, requestOptions);
  if (response.status === 401 && supabaseAuth?.loadSession()?.refresh_token) {
    const refreshed = await supabaseAuth.refreshSession();
    if (refreshed?.access_token) {
      requestOptions.headers.Authorization = `Bearer ${refreshed.access_token}`;
      response = await fetch(path, requestOptions);
    }
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `player account request failed (${response.status})`);
  return payload;
}

async function initializeAuthentication() {
  const response = await fetch("/api/auth/config", { cache: "no-store" });
  if (!response.ok) throw new Error("The player login configuration could not be loaded.");
  authConfig = await response.json();
  if (authConfig.provider !== "supabase") return;
  supabaseAuth = createSupabaseAuth(authConfig);
  const redirect = supabaseAuth.consumeRedirect();
  if (redirect) {
    authRecoveryMode = redirect.type === "recovery";
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
}

function configureLoginForm() {
  const form = $("#player-login-form");
  const nameField = $("#player-name-field");
  const nameInput = $("#player-name-input");
  const emailField = $("#player-email-field");
  const emailInput = $("#player-email-input");
  const passwordInput = $("#player-pin-input");
  const forgot = $("#forgot-password-button");
  const loginButton = $('[data-player-action="login"]');
  const registerButton = $('[data-player-action="register"]');
  if (authConfig.provider === "supabase") {
    nameField.hidden = false;
    emailField.hidden = false;
    emailInput.required = !authRecoveryMode;
    nameInput.required = false;
    passwordInput.minLength = 8;
    passwordInput.autocomplete = authRecoveryMode ? "new-password" : "current-password";
    forgot.hidden = authRecoveryMode;
    form.dataset.mode = authRecoveryMode ? "recovery" : "supabase";
    $("#player-password-label").textContent = authRecoveryMode ? "New password" : "Password";
    loginButton.textContent = authRecoveryMode ? "Set new password" : "Continue round";
    registerButton.hidden = authRecoveryMode;
    registerButton.onclick = authRecoveryMode ? null : event => {
      if (form.dataset.mode !== "supabase") return;
      event.preventDefault();
      form.dataset.mode = "register";
      $("#player-login-status").textContent = "Enter your player name, email, and password, then choose Create new player.";
      nameInput.focus();
    };
    $("#login-note").textContent = authRecoveryMode
      ? "Choose a new password with at least eight characters."
      : "Use the same email and password on every device. Supabase protects your login; rounds stay on this golf-game server.";
  } else {
    nameField.hidden = false;
    emailField.hidden = true;
    emailInput.required = false;
    nameInput.required = true;
    passwordInput.minLength = 4;
    passwordInput.autocomplete = "current-password";
    forgot.hidden = true;
    registerButton.onclick = null;
    form.dataset.mode = "local";
    $("#player-password-label").textContent = "Private PIN";
    $("#login-note").textContent = "Use the same name and PIN on every device. Accounts stay on this golf-game server.";
  }
}

function waitForPlayerLogin() {
  const dialog = $("#player-login-dialog");
  const form = $("#player-login-form");
  const status = $("#player-login-status");
  configureLoginForm();
  dialog.showModal();
  window.setTimeout(() => {
    (authConfig.provider === "supabase" && !authRecoveryMode
      ? $("#player-email-input")
      : authRecoveryMode
        ? $("#player-pin-input")
        : $("#player-name-input"))?.focus();
  }, 0);
  return new Promise(resolve => {
    $("#forgot-password-button").onclick = async () => {
      const email = $("#player-email-input").value.trim();
      if (!email) {
        status.textContent = "Enter your email address first, then choose Forgot password.";
        $("#player-email-input").focus();
        return;
      }
      status.textContent = "Sending a password-reset email…";
      try {
        await supabaseAuth.sendPasswordReset(email, `${window.location.origin}${window.location.pathname}`);
        status.textContent = "Check your email for the password-reset link.";
      } catch (error) {
        status.textContent = error.message;
      }
    };
    form.onsubmit = async event => {
      event.preventDefault();
      const action = event.submitter?.dataset.playerAction || "login";
      const submitButtons = [...form.querySelectorAll("button[type='submit']")];
      submitButtons.forEach(button => { button.disabled = true; });
      status.textContent = action === "register" ? "Creating your player…" : "Finding your round…";
      try {
        let payload;
        if (supabaseAuth) {
          const email = $("#player-email-input").value.trim();
          const password = $("#player-pin-input").value;
          if (authRecoveryMode) {
            status.textContent = "Updating your password…";
            await supabaseAuth.updatePassword(password);
            authRecoveryMode = false;
          } else if (action === "register") {
            if (form.dataset.mode !== "register") {
              form.dataset.mode = "register";
              status.textContent = "Enter the name you want shown in the game, then choose Create new player again.";
              $("#player-name-input").focus();
              return;
            }
            const displayName = $("#player-name-input").value.trim();
            if (displayName.length < 2) throw new Error("Enter the player name you want shown in the game.");
            const result = await supabaseAuth.signUp(
              email,
              password,
              displayName,
              `${window.location.origin}${window.location.pathname}`
            );
            if (!result.session) {
              status.textContent = "Check your email to confirm the new player, then return here to continue.";
              $("#player-pin-input").value = "";
              return;
            }
          } else {
            await supabaseAuth.signIn(email, password);
          }
          payload = await playerApi("/api/player/session");
          if (!payload.player) throw new Error("Supabase signed in, but the player account could not be opened.");
        } else {
          payload = await playerApi(`/api/player/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: $("#player-name-input").value,
              pin: $("#player-pin-input").value
            })
          });
        }
        state.player = payload.player;
        updatePlayerAccountUI();
        form.reset();
        dialog.close();
        resolve(state.player);
      } catch (error) {
        status.textContent = error.message;
      } finally {
        submitButtons.forEach(button => { button.disabled = false; });
      }
    };
  });
}

async function ensurePlayerAccount() {
  try {
    const payload = await playerApi("/api/player/session");
    state.player = payload.player;
  } catch (error) {
    console.error("Could not check player session", error);
  }
  if (authRecoveryMode || !state.player) await waitForPlayerLogin();
  updatePlayerAccountUI();
}

async function savePlayerProfile(profile) {
  if (!state.player || !profile) return;
  setAccountSyncStatus("Saving statistics…", "Keeping your club and putting numbers ready on every device.", "saving");
  try {
    await playerApi("/api/player/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile })
    });
    setAccountSyncStatus("Statistics saved", "Your playing profile is available anywhere you sign in.");
  } catch (error) {
    console.error("Could not sync player profile", error);
    setAccountSyncStatus("Saved on this device", "Your statistics could not reach the server. Try again when it is available.", "error");
  }
}

async function restorePlayerProfile() {
  try {
    const payload = await playerApi("/api/player/profile");
    if (!payload.profile) return false;
    const profileId = storeImportedProfile(payload.profile);
    localStorage.setItem(profileStorageKey(), profileId);
    return true;
  } catch (error) {
    console.error("Could not restore player profile", error);
    return false;
  }
}

async function restorePlayerLearning() {
  try {
    const payload = await playerApi("/api/player/learning");
    state.playerLearning = payload.learning || null;
    return state.playerLearning;
  } catch (error) {
    state.playerLearning = null;
    console.error("Could not restore player learning", error);
    return null;
  }
}

async function restorePlayerRound() {
  const payload = await playerApi("/api/player/active-round");
  const portableSave = payload.round;
  if (!portableSave) {
    state.courseId = preferredCourseId(new URLSearchParams(window.location.search).get("course")
      || localStorage.getItem(playerStorageKey("course"))
      || "meadows");
    state.holeIndex = 0;
    state.pinIndex = 0;
    return false;
  }
  const restoredCourseId = preferredCourseId(portableSave.course_id);
  if (!courseCatalog[restoredCourseId]) {
    throw new Error(`Your saved course “${portableSave.course_id}” is not installed on this server.`);
  }
  if (restoredCourseId !== portableSave.course_id) {
    // Editor-installed replacements use newly authored geometry. Do not apply
    // obsolete shot coordinates to the new map; start a clean round there.
    state.courseId = restoredCourseId;
    state.holeIndex = 0;
    state.pinIndex = 0;
    localStorage.setItem(playerStorageKey("course"), restoredCourseId);
    return false;
  }
  const profileId = storeImportedProfile(portableSave.player_profile);
  saveRoundState(localStorage, portableSave.round_state, state.player.id);
  localStorage.setItem(profileStorageKey(), profileId);
  localStorage.setItem(playerStorageKey("course"), portableSave.course_id);
  localStorage.setItem(
    playerStorageKey(`${portableSave.course_id}-round-seed`),
    String(portableSave.round_state.round_seed)
  );
  state.courseId = portableSave.course_id;
  state.holeIndex = portableSave.current_hole_index;
  state.pinIndex = portableSave.pin_index;
  return true;
}

async function logoutPlayer() {
  window.clearTimeout(roundSyncTimer);
  window.clearTimeout(gpsSyncTimer);
  window.clearTimeout(liveGpsPollTimer);
  try {
    await roundSyncPromise.catch(() => {});
    await syncPlayerRound();
    await gpsSyncPromise.catch(() => {});
    await syncGpsRound();
    if (supabaseAuth) await supabaseAuth.signOut();
    else await playerApi("/api/player/logout", { method: "POST" });
  } catch (error) {
    console.error("Player sign out did not finish cleanly", error);
  }
  window.location.reload();
}

function bindEvents() {
  $("#competition-button").addEventListener("click", () => {
    renderCompetitionSetup();
    $("#competition-dialog").showModal();
  });
  $("#competition-form").addEventListener("submit", event => {
    void startCompetitionFromSetup(event).catch(error => {
      console.error("Could not start competition", error);
      $("#competition-setup-status").textContent = error.message;
    });
  });
  $("#competition-exit").addEventListener("click", () => void exitCompetition());
  $("#competition-score-header").addEventListener("click", () => {
    renderCompetitionScorecard();
    $("#competition-scorecard-dialog").showModal();
  });
  $("#competition-why").addEventListener("click", () => {
    const copy = $("#comparison-why-copy");
    copy.hidden = !copy.hidden;
    $("#competition-why").textContent = copy.hidden ? "Why?" : "Hide why";
  });
  $("#competition-continue").addEventListener("click", () => closeCompetitionComparison());
  $("#competition-comparison-close").addEventListener("click", () => closeCompetitionComparison());
  $("#competition-comparison-grip").addEventListener("click", () => closeCompetitionComparison());
  window.addEventListener("online", () => {
    if (gpsRound) scheduleGpsRoundSync(0);
    if (state.liveGpsView) void refreshLiveGpsRound({ silent: true });
  });
  window.addEventListener("offline", () => {
    if (gpsRound) setGpsSyncDisplay("Offline · on phone", "error");
  });
  $("#player-guide-button").addEventListener("click", () => void openPlayerGuide());
  $("#gm-voice-toggle").addEventListener("click", toggleGmVoice);
  $("#account-button").addEventListener("click", () => {
    updatePlayerAccountUI();
    $("#account-dialog").showModal();
  });
  $("#account-edit-profile").addEventListener("click", () => {
    $("#account-dialog").close();
    renderProfileDialog();
    $("#profile-dialog").showModal();
  });
  $("#round-history-button").addEventListener("click", () => void openRoundHistory());
  $("#player-learning-button").addEventListener("click", () => void openPlayerLearning());
  $("#leaderboard-button").addEventListener("click", () => void openLeaderboard());
  $("#feedback-center-button").addEventListener("click", () => void openFeedbackCenter());
  $("[data-close-feedback]").addEventListener("click", () => $("#feedback-dialog").close());
  $$('[data-feedback-tab]').forEach(button => button.addEventListener("click", () => setFeedbackTab(button.dataset.feedbackTab)));
  $$('[data-feedback-stars]').forEach(button => button.addEventListener("click", () => {
    state.feedbackRatingDraft = Number(button.dataset.feedbackStars);
    syncFeedbackRating();
  }));
  $("#feedback-rating-save").addEventListener("click", async event => {
    const button = event.currentTarget;
    if (!state.feedbackRatingDraft) {
      button.textContent = "Choose 1–5 stars";
      window.setTimeout(() => { button.textContent = "Save rating"; }, 1800);
      return;
    }
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const payload = await playerApi("/api/player/rating", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stars: state.feedbackRatingDraft, comment: $("#feedback-rating-comment").value })
      });
      state.feedbackData.rating = payload.rating;
      button.textContent = "Rating saved";
    } catch (error) {
      button.textContent = error.message;
    } finally {
      window.setTimeout(() => { button.disabled = false; button.textContent = "Save rating"; }, 1800);
    }
  });
  $("#feedback-submit-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const status = $("#feedback-submit-status");
    submit.disabled = true;
    status.textContent = "Preparing your message…";
    try {
      const attachment = await compressedFeedbackAttachment($("#feedback-screenshot").files[0]);
      status.textContent = "Sending privately to the developer…";
      await playerApi("/api/player/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: $("#feedback-category").value,
          title: $("#feedback-title").value,
          body: $("#feedback-body").value,
          context: feedbackContext(),
          attachment
        })
      });
      form.reset();
      status.textContent = "Feedback sent. You can follow it in My feedback.";
      await loadPlayerFeedback();
      setFeedbackTab("mine");
    } catch (error) {
      status.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  $("#player-feedback-list").addEventListener("submit", async event => {
    const form = event.target.closest("[data-feedback-reply]");
    if (!form) return;
    event.preventDefault();
    const textarea = form.querySelector("textarea");
    const button = form.querySelector("button");
    if (textarea.value.trim().length < 2) return;
    button.disabled = true;
    try {
      await playerApi("/api/player/feedback/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback_id: form.dataset.feedbackReply, body: textarea.value })
      });
      await loadPlayerFeedback();
    } catch (error) {
      window.alert(error.message);
    } finally {
      button.disabled = false;
    }
  });
  $("#feedback-dialog").addEventListener("click", event => {
    const attachment = event.target.closest("[data-feedback-attachment]");
    if (attachment) void openFeedbackAttachment(attachment.dataset.feedbackAttachment);
  });
  $("#feedback-status-filter").addEventListener("change", () => void loadDeveloperFeedback());
  $("#feedback-category-filter").addEventListener("change", () => void loadDeveloperFeedback());
  $("#developer-feedback-list").addEventListener("submit", async event => {
    const form = event.target.closest("[data-developer-feedback]");
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "Updating…";
    try {
      await playerApi("/api/developer/feedback", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback_id: form.dataset.developerFeedback,
          status: form.querySelector("select").value,
          reply: form.querySelector("textarea").value
        })
      });
      await loadDeveloperFeedback();
    } catch (error) {
      window.alert(error.message);
      button.disabled = false;
      button.textContent = "Update";
    }
  });
  $("#player-logout-button").addEventListener("click", () => void logoutPlayer());
  $("#course-select").addEventListener("change", async event => {
    const nextCourse = event.target.value;
    if (nextCourse === state.courseId) return;
    if (competitionActive()) {
      window.alert("Finish or leave the active Game Master competition before switching courses.");
      event.target.value = state.courseId;
      return;
    }
    const hasActiveRound = state.scores.some(score => score != null) || state.shots.length > 0;
    if (hasActiveRound && !window.confirm(`Switch to ${courseCatalog[nextCourse].name}? Your current course progress will be saved.`)) {
      event.target.value = state.courseId;
      return;
    }
    state.liveGpsView = false;
    state.liveGpsRound = null;
    window.clearTimeout(liveGpsPollTimer);
    await loadData(nextCourse);
    localStorage.setItem(playerStorageKey("course"), nextCourse);
    state.holeIndex = 0;
    state.pinIndex = rotatingPinIndex(0, hole().geometries.green_complex.pin_zones.length);
    resetHole();
    schedulePlayerRoundSync(0);
  });
  $$(".tee-switch button").forEach(button => button.addEventListener("click", () => {
    state.tee = button.dataset.tee;
    if (state.roundState) {
      state.roundState = { ...state.roundState, tee: state.tee };
      persistRoundState();
    }
    if (state.competition) {
      state.competition.tee = state.tee;
      state.competition.strategist_round.tee = state.tee;
      saveCompetition(localStorage, state.competition, state.player?.id);
    }
    resetHole();
  }));
  $("#pin-select").addEventListener("change", event => {
    state.pinIndex = Number(event.target.value);
    state.target = null;
    state.manualTargetPreview = false;
    state.shotDraft.target = false;
    state.structuredShot = { aim: "", adjustment: "none", offset: 1, selectedTarget: null };
    clearStrategyPlan();
    updateAll();
    schedulePlayerRoundSync();
  });
  $("#club-select").addEventListener("change", event => {
    setSelectedClub(event.target.value);
  });
  $("#desktop-caddie-toggle").addEventListener("click", toggleDesktopCaddieChoices);
  $("#mobile-club-select").addEventListener("change", event => {
    setSelectedClub(event.target.value);
  });
  $("#mobile-carousel-previous").addEventListener("click", () => setMobileCarouselPage(state.mobileCarouselPage - 1));
  $("#mobile-carousel-next").addEventListener("click", () => setMobileCarouselPage(state.mobileCarouselPage + 1));
  $("#mobile-carousel-viewport").addEventListener("wheel", onMobileCarouselWheel, { passive: false });
  $("#mobile-carousel-viewport").addEventListener("pointerdown", onMobileCarouselPointerDown);
  $("#mobile-carousel-viewport").addEventListener("pointerup", onMobileCarouselPointerUp);
  $("#mobile-carousel-viewport").addEventListener("pointercancel", onMobileCarouselPointerCancel);
  $("#mobile-carousel-viewport").addEventListener("keydown", onMobileCarouselKeyDown);
  $("#mobile-map-plan-drag").addEventListener("pointerdown", onMobileMapPlanPointerDown);
  window.addEventListener("pointermove", onMobileMapPlanPointerMove, { passive: false });
  window.addEventListener("pointerup", onMobileMapPlanPointerUp);
  window.addEventListener("pointercancel", onMobileMapPlanPointerUp);
  window.visualViewport?.addEventListener("resize", keepMobileMapPlanInView);
  window.visualViewport?.addEventListener("scroll", keepMobileMapPlanInView);
  window.visualViewport?.addEventListener("resize", positionLiveRoundPanel);
  window.addEventListener("resize", refreshMapAfterViewportWidthChange);
  window.addEventListener("resize", positionLiveRoundPanel);
  $("#desktop-power-slider").addEventListener("input", event => {
    setSwingPowerFromMobile(event.target.value);
  });
  $("#mobile-power-slider").addEventListener("input", event => {
    setSwingPowerFromMobile(event.target.value);
  });
  $$('[data-shot-field]').forEach(control => control.addEventListener("change", event => {
    updateStructuredShotField(event.currentTarget.dataset.shotField, event.currentTarget.value);
  }));
  $("#mobile-gm-form").addEventListener("submit", event => {
    event.preventDefault();
    ensureAudio();
    playStructuredShot("mobile");
  });
  $("#mobile-scorecard-button").addEventListener("click", () => {
    renderScorecard();
    setRoundFileStatus("Round files include your shots, score, tee, and player profile.");
    $("#scorecard-dialog").showModal();
  });
  $("#mobile-review-button").addEventListener("click", openRoundReview);
  $("#reset-view").addEventListener("click", openResetHoleDialog);
  $("#mobile-reset-view").addEventListener("click", openResetHoleDialog);
  $("#enlarge-green").addEventListener("click", openEnlargedGreen);
  $("#mobile-enlarge-green").addEventListener("click", openEnlargedGreen);
  $("#close-enlarged-green").addEventListener("click", closeEnlargedGreen);
  $$('[data-green-view]').forEach(button => button.addEventListener("click", () => setGreenViewMode(button.dataset.greenView)));
  $("#green-zoom").addEventListener("change", event => {
    state.greenZoom = bounded(Number(event.target.value) / 100, 1, 5);
    renderMap();
  });
  $("#green-caddie-read-toggle").addEventListener("click", toggleGreenCaddieRead);
  $("#green-player-view").addEventListener("click", showBallToPinGreenView);
  $("#green-rotate-view").addEventListener("click", rotateGreenViewQuarterTurn);
  $("#green-putt-power").addEventListener("input", event => {
    setSwingPowerFromMobile(event.target.value);
  });
  $("#green-shot-club-select").addEventListener("change", event => {
    state.selectedClub = Number(event.target.value);
    state.manualTargetPreview = false;
    state.shotDraft.club = true;
    updateAll();
  });
  $("#green-putt-aim-form").addEventListener("submit", event => {
    event.preventDefault();
    const input = $("#green-putt-aim-input");
    if (applyEnlargedGreenAimInstruction(input.value)) {
      input.value = "";
      input.blur();
      document.body.classList.remove("green-aim-editing");
    } else {
      input.focus();
    }
  });
  $("#green-putt-aim-input").addEventListener("focus", () => {
    if (!state.greenEnlarged) return;
    document.body.classList.add("green-aim-editing");
    window.requestAnimationFrame(keepGreenAimPanelInView);
  });
  $("#green-putt-aim-input").addEventListener("blur", () => {
    window.setTimeout(() => {
      if (!$("#green-putt-aim-form").contains(document.activeElement)) {
        document.body.classList.remove("green-aim-editing");
      }
    }, 180);
  });
  $("#green-putt-drag-handle").addEventListener("pointerdown", onGreenAimPanelPointerDown);
  window.addEventListener("pointermove", onGreenAimPanelPointerMove, { passive: false });
  window.addEventListener("pointerup", onGreenAimPanelPointerUp);
  window.addEventListener("pointercancel", onGreenAimPanelPointerUp);
  window.visualViewport?.addEventListener("resize", keepGreenAimPanelInView);
  window.visualViewport?.addEventListener("scroll", keepGreenAimPanelInView);
  $("#green-putt-play").addEventListener("click", () => {
    if (!state.target) return;
    playCurrentShotFromMobile();
    updateEnlargedPuttControls();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.greenEnlarged) closeEnlargedGreen();
  });
  window.addEventListener("pointermove", onTargetPointerMove, { passive: false });
  window.addEventListener("pointerup", onTargetPointerUp);
  window.addEventListener("pointercancel", onTargetPointerUp);
  window.addEventListener("pointermove", onGreenOrbitPointerMove, { passive: false });
  window.addEventListener("pointerup", onGreenOrbitPointerUp);
  window.addEventListener("pointercancel", onGreenOrbitPointerUp);
  $("#previous-hole").addEventListener("click", () => changeHole(state.holeIndex - 1));
  $("#next-hole").addEventListener("click", () => changeHole(state.holeIndex + 1));
  $("#mobile-previous-hole").addEventListener("click", () => changeHole(state.holeIndex - 1));
  $("#mobile-next-hole").addEventListener("click", () => changeHole(state.holeIndex + 1));
  $("#mobile-round-current").addEventListener("click", () => {
    renderRoundNavigation();
    $("#round-nav-dialog").showModal();
  });
  $("#gps-mode-button").addEventListener("click", openGpsMode);
  $$('[data-course-map-mode]').forEach(button => button.addEventListener("click", () => setCourseMapMode(button.dataset.courseMapMode)));
  $("#live-round-refresh").addEventListener("click", () => {
    state.liveGpsFollowHole = true;
    void refreshLiveGpsRound();
  });
  $("#live-round-move").addEventListener("pointerdown", onLivePanelPointerDown);
  window.addEventListener("pointermove", onLivePanelPointerMove, { passive: false });
  window.addEventListener("pointerup", onLivePanelPointerUp);
  window.addEventListener("pointercancel", onLivePanelPointerUp);
  $("#live-round-collapse").addEventListener("click", event => {
    event.stopPropagation();
    setLivePanelCollapsed(!state.livePanelCollapsed);
  });
  $("#live-round-panel").addEventListener("click", () => {
    if (state.livePanelCollapsed) setLivePanelCollapsed(false);
  });
  $("#live-round-open-gps").addEventListener("click", openGpsMode);
  $("#gps-exit").addEventListener("click", () => closeGpsMode("simulator"));
  $("#gps-exit-live").addEventListener("click", () => closeGpsMode("live"));
  $("#gps-previous-hole").addEventListener("click", () => gpsChangeHole(state.holeIndex - 1));
  $("#gps-next-hole").addEventListener("click", advanceGpsHole);
  $("#gps-page-view").addEventListener("change", event => {
    state.gpsPageView = GPS_PAGE_VIEWS.has(event.target.value) ? event.target.value : "actual";
    state.gpsCaddieExpanded = false;
    $(".gps-mode-content")?.scrollTo?.({ top: 0 });
    renderGpsMode();
  });
  $("#gps-location-button").addEventListener("click", () => void captureGpsLocation());
  $("#gps-undo").addEventListener("click", () => {
    if (gpsPagePreviewActive()) return;
    const action = undoGpsHoleAction(gpsHoleState());
    if (!action) return;
    persistGpsRound();
    renderGpsMode();
    setGpsStatus(`Removed the last ${action}.`);
  });
  $("#gps-hole-review").addEventListener("click", openGpsHoleReview);
  $("#gps-add-putt").addEventListener("click", () => {
    if (gpsPagePreviewActive()) return;
    const holeState = gpsHoleState();
    if (holeState.finished) return;
    holeState.putts += 1;
    persistGpsRound();
    renderGpsMode();
  });
  $("#gps-lie-controls").addEventListener("click", event => {
    if (gpsPagePreviewActive()) return;
    const button = event.target.closest("[data-gps-lie]");
    if (!button) return;
    const fix = gpsCurrentFix();
    if (!fix) return;
    fix.lie = button.dataset.gpsLie;
    fix.conditions = normalizeGpsBallConditions(fix.conditions, fix.lie);
    const holeState = gpsHoleState();
    if (holeState.pending_strategy?.id === "manual-choice") {
      holeState.pending_strategy.ball_conditions = fix.conditions;
    } else {
      holeState.pending_strategy = null;
    }
    persistGpsRound();
    renderGpsMode();
  });
  $("#gps-stance-select").addEventListener("change", event => updateGpsBallCondition("stance", event.target.value));
  $("#gps-slope-select").addEventListener("change", event => updateGpsBallCondition("slope", event.target.value));
  $("#gps-rough-select").addEventListener("change", event => updateGpsBallCondition("rough_depth", event.target.value));
  $("#gps-caddie-choices").addEventListener("click", event => {
    const button = event.target.closest("[data-gps-strategy]");
    if (button) selectGpsStrategy(button.dataset.gpsStrategy);
  });
  $("#gps-caddie-toggle").addEventListener("click", () => {
    state.gpsCaddieExpanded = !state.gpsCaddieExpanded;
    renderGpsMode();
  });
  $("#gps-club-select").addEventListener("change", selectGpsManualShot);
  $("#gps-power-select").addEventListener("change", selectGpsManualShot);
  document.addEventListener("click", event => {
    const strategyChoice = event.target.closest("[data-strategy-choice]");
    if (strategyChoice) {
      selectStrategyChoice(strategyChoice.dataset.strategyChoice);
      return;
    }
    const strategyHelp = event.target.closest("[data-strategy-help]");
    if (strategyHelp) {
      showStrategyExplanation(strategyHelp.dataset.strategyHelp);
      return;
    }
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
  $("#club-editor").addEventListener("click", event => {
    const button = event.target.closest("[data-apply-on-course]");
    if (button) applyOnCourseClubValues(button.dataset.applyOnCourse, button);
  });
  $("#custom-form").addEventListener("submit", saveCustomProfile);
  $$("[data-close-custom]").forEach(button => button.addEventListener("click", () => $("#custom-dialog").close()));
  $("#scorecard-button").addEventListener("click", () => {
    renderScorecard();
    setRoundFileStatus("Round files include your shots, score, tee, and player profile.");
    $("#scorecard-dialog").showModal();
  });
  $("#save-round-file").addEventListener("click", () => {
    void exportRoundFile();
  });
  $("#load-round-file").addEventListener("click", () => {
    $("#round-file-input").click();
  });
  $("#round-file-input").addEventListener("change", event => {
    const [file] = event.target.files;
    event.target.value = "";
    void importRoundFile(file);
  });
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
  $("#reset-hole-dialog").addEventListener("close", () => {
    if ($("#reset-hole-dialog").returnValue === "confirm") resetCurrentHole();
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
    playStructuredShot("desktop");
  });
  $$("[data-gm-suggestion]").forEach(button => button.addEventListener("click", () => {
    ensureAudio();
    interpretGmInstruction(button.dataset.gmSuggestion);
  }));
}

async function init() {
  try {
    await initializeAuthentication();
    await loadMappedCourseCatalog();
    await ensurePlayerAccount();
    restoreGmVoicePreference();
    await restorePlayerLearning();
    const hasSavedPlayerProfile = await restorePlayerProfile();
    const resumed = await restorePlayerRound();
    await loadData(state.courseId);
    const competitionResumed = await restoreCompetitionRound();
    const pinCount = hole().geometries.green_complex.pin_zones.length;
    state.pinIndex = rotatingPinIndex(state.holeIndex, pinCount);
    resetHole();
    bindEvents();
    updateAll();
    void refreshFeedbackBadge();
    schedulePlayerRoundSync(0);
    $("#app").hidden = false;
    $("#loading").style.opacity = 0;
    setTimeout(() => $("#loading").remove(), 500);
    if (competitionResumed) {
      addGmMessage(state.competitionRecoveryMessage || "Game Master match resumed from the latest paired turn.");
      if (state.competitionComparisonTurnId) {
        window.setTimeout(showCompetitionComparison, 0);
      }
      setAccountSyncStatus(
        "Game Master match resumed",
        `${state.course.shortName}, hole ${state.holeIndex + 1}, was restored on this device.`
      );
    } else if (resumed) {
      if (!hasSavedPlayerProfile) await savePlayerProfile(state.profile);
      setAccountSyncStatus(
        "Round resumed",
        `${state.course.shortName}, hole ${state.holeIndex + 1}, was restored from your player account.`
      );
    } else if (!hasSavedPlayerProfile) {
      renderProfileDialog();
      $("#profile-dialog").showModal();
    }
  } catch (error) {
    $("#loading").innerHTML = `<div class="loading-mark">!</div><p>Course data could not be loaded.<br>Run this app through a local web server.</p>`;
    console.error(error);
  }
}

export { normalizeProfile, puttingMakeProbability };

init();
