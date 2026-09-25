import {
  buildGameCoursePackages,
  buildGameHoleJson,
  buildHoleGpsCalibration,
  buildAutoDraft,
  alignSecondaryTeesFromWhite,
  buildTreeBrushPolygon,
  createUprightGpsViewTransform,
  createMapperProject,
  configureMapperCourseStructure,
  distanceMeters,
  gpsDeltaMeters,
  holeMappingStatus,
  offsetGpsPoint,
  parseGpsCoordinatePair,
  parseMapperProject,
  parseScorecardText,
  mapperHoleCount,
  mapperNineLoops,
  MAPPER_COURSE_STRUCTURES,
  polygonsOverlap,
  quarterTurnGpsBounds,
  resampleGpsPolygon,
  restoreMappedHoleFromGame,
  roundedGpsBounds,
  roundedGpsRectangle,
  rotateGpsPolygon,
  scaleGpsPolygon,
  scaleGpsPointAround,
  uprightHoleViewTarget,
  validateMapperProject
} from "./packages/editor/course_mapper.mjs?v=20260829-1";
import { createUndoHistory } from "./packages/editor/undo_history.mjs?v=20260801-1";
import { unionSimplePolygons } from "./packages/editor/polygon_union.mjs?v=20260812-1";
import { renderGameMapPreview } from "./packages/editor/game_map_preview.mjs?v=20260828-2";
import { ensureHazardFreePinZones, generatedGreenHole } from "./packages/simulation/browser_green_generator.mjs?v=20260810-2";
import { buildCorridorMask, buildPolygonMask, detectTreeRegions } from "./packages/editor/hazard_detection.mjs?v=20260815-17";
import { createSupabaseAuth } from "./packages/accounts/browser_supabase_auth.mjs?v=20260804-1";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const REQUESTED_PRESET_ID = new URLSearchParams(window.location.search).get("course");
const AUTOSAVE_KEY = REQUESTED_PRESET_ID
  ? `golf-course-mapper-autosave-${REQUESTED_PRESET_ID}`
  : "golf-course-mapper-autosave";
const YARDS_PER_METER = 1.09361;
const EDITOR_MAX_ZOOM = 20;
const EDITOR_ROUTE_HEIGHT_RATIO = .75;
const TREE_CANOPY_ASSET = "assets/tree-canopy-top.png?v=20260812-2";
const COURSE_PRESETS = {
  "the-meadow-at-middlesex-golf-course": {
    name: "The Meadow at Middlesex Golf Course",
    courseId: "the-meadow-at-middlesex-golf-course",
    address: "",
    center: { lat: 40.5206, lng: -74.4143 },
    scorecardText: "data/the-meadow-at-middlesex-golf-course/scorecard.csv",
    scorecardImage: null,
    holeData: holeNumber => `data/the-meadow-at-middlesex-golf-course/hole${holeNumber}.json`,
    holeImage: holeNumber => `data/the-meadow-at-middlesex-golf-course/illustrations/hole${holeNumber}.jpg`,
    legacyHoleImage: () => ""
  }
};

const FEATURE_STYLE = {
  tee_blue: { name: "Blue tee box", color: "#2468c9", length: 14, width: 8, shape: "box" },
  tee_white: { name: "White tee box", color: "#f6f3e8", length: 14, width: 8, shape: "box" },
  tee_forward: { name: "Forward tee box", color: "#e65b9a", length: 14, width: 8, shape: "box" },
  fairway: { name: "Fairway", color: "#78a866", length: 105, width: 38, shape: "box" },
  rough: { name: "Rough", color: "#4c704f", length: 125, width: 72, shape: "box" },
  bunker: { name: "Sand bunker", color: "#d2b66f", length: 19, width: 9, shape: "oval", points: 8 },
  bunker_circle: { name: "Circle bunker", color: "#d2b66f", length: 15, width: 15, shape: "oval", points: 8, type: "bunker" },
  green_oval: { name: "Green", color: "#a6cd77", length: 29, width: 22, shape: "oval", type: "green" },
  green_circle: { name: "Green", color: "#a6cd77", length: 25, width: 25, shape: "oval", type: "green" },
  water: { name: "Water", color: "#4f91a8", length: 48, width: 28, shape: "oval", points: 8 },
  penalty_area_unknown: { name: "Penalty area — needs review", color: "#bb713e", length: 48, width: 28, shape: "oval", points: 8 },
  hole_outline: { name: "Hole outline", color: "#d9673f", length: 130, width: 70, shape: "box" },
  trees_circle: { name: "Trees circle", color: "#244f32", length: 30, width: 30, shape: "oval", points: 16, type: "trees" },
  out_of_bounds: { name: "Out of bounds", color: "#d9673f", length: 130, width: 20, shape: "box" }
};

const FEATURE_COLORS = {
  ...Object.fromEntries(Object.entries(FEATURE_STYLE).map(([tool, style]) => [style.type || tool, style.color])),
  cart_path: "#aaa89f"
};

const TOOL_LABELS = {
  ...Object.fromEntries(Object.entries(FEATURE_STYLE).map(([tool, style]) => [tool, `Place ${style.name.toLowerCase()}`])),
  marker_blue_tee: "Mark blue tee",
  marker_white_tee: "Mark white tee / starting ball",
  marker_forward_tee: "Mark forward tee",
  marker_pin: "Mark pin",
  route_point_1: "Place route point 1",
  route_point_2: "Place route point 2",
  measure: "Measure: click first point",
  box_select: "Box select trees · drag around the tree shapes",
  tree_brush: "Tree brush · drag to paint one cluster",
  stream_brush: "Stream / ditch brush · fixed 3-yard width",
  cart_path_brush: "Cart path brush · fixed 4-yard width"
};

let project = loadAutosave();
let currentHoleNumber = 1;
let map = null;
let localImageLayer = null;
let imageryRenderToken = 0;
const rotatedArtworkCache = new Map();
let activeTool = null;
let autoDraftSetupPending = false;
let selectedFeatureId = null;
let selectedFeatureIds = new Set();
let selectedPlayPoint = null;
let selectedFeatureMode = "points";
let featureOverlays = new Map();
let featureDragProxies = new Map();
let pointMarkers = [];
let routeLine = null;
let measurements = [];
let measurementStart = null;
let featureCommitTimer = null;
let boxSelectionStart = null;
let boxSelectionLayer = null;
let boxSelectionType = null;
let surfaceBrushPoints = [];
let surfaceBrushPreview = null;
let surfaceBrushCursor = null;
const draggingFeatureIds = new Set();
const undoHistory = createUndoHistory({ limit: 50 });
let referencePanelOpen = Boolean(REQUESTED_PRESET_ID);
let uprightViewCache = null;
let mapResizeFrame = null;
let editorSupabaseAuth = null;
let courseImportServerStatus = null;
let selectedExternalCourse = null;
let externalImportJobId = null;

async function initializeEditorAuth() {
  try {
    const response = await fetch("/api/auth/config", { cache: "no-store" });
    const config = response.ok ? await response.json() : {};
    editorSupabaseAuth = config.provider === "supabase" ? createSupabaseAuth(config) : null;
  } catch {
    editorSupabaseAuth = null;
  }
}

async function editorApiFetch(url, options = {}) {
  const requestOptions = { ...options, headers: { ...(options.headers || {}) } };
  if (editorSupabaseAuth) {
    const token = await editorSupabaseAuth.getAccessToken();
    if (token) requestOptions.headers.Authorization = `Bearer ${token}`;
  }
  let response = await fetch(url, requestOptions);
  if (response.status === 401 && editorSupabaseAuth?.loadSession()?.refresh_token) {
    const refreshed = await editorSupabaseAuth.refreshSession().catch(() => null);
    if (refreshed?.access_token) {
      requestOptions.headers.Authorization = `Bearer ${refreshed.access_token}`;
      response = await fetch(url, requestOptions);
    }
  }
  return response;
}

async function courseImportRequest(path, payload) {
  const response = await editorApiFetch(path, {
    method: payload === undefined ? "GET" : "POST",
    headers: payload === undefined ? {} : { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    cache: "no-store"
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Course import server returned ${response.status}`);
  return result;
}

function setCourseImportStatus(message, tone = "error") {
  const status = $("#course-import-status");
  status.textContent = message;
  status.dataset.tone = tone;
}

function renderCourseImportServerStatus(status) {
  courseImportServerStatus = status;
  const guard = $(".course-import-guard");
  const toggle = $("#course-import-paid-toggle");
  const search = $("#search-external-course");
  const ready = Boolean(status?.ready_for_search);
  const paid = Boolean(status?.paid_calls_allowed);
  guard.dataset.ready = String(ready);
  guard.dataset.paid = String(paid);
  toggle.checked = paid;
  toggle.disabled = !ready;
  search.disabled = !ready;
  const continueButton = $("#continue-external-import");
  const gpsRecoveryButton = $("#continue-gps-only-import");
  if (continueButton && selectedExternalCourse) {
    const cached = Boolean(selectedExternalCourse.cache?.available);
    const recovery = !cached && (status?.gps_only_recovery_public_ids || []).includes(selectedExternalCourse.external_id);
    continueButton.disabled = recovery || (!cached && !paid);
    if (gpsRecoveryButton) gpsRecoveryButton.disabled = !paid;
  }
  $("#course-import-guard-title").textContent = status?.authorization_required
    ? "Developer access required"
    : !status?.enabled
    ? "Golf Intelligence is disabled"
    : !status?.credentials_configured
      ? "Waiting for server credentials"
      : paid ? "Connected · paid calls allowed" : "Connected · paid calls OFF";
  $("#course-import-provider-note").textContent = status?.authorization_required
    ? "Sign in through the game with an authorized developer account."
    : !ready
    ? "Add the Client ID and Active Token to .env, then restart the server."
    : "Import Mode only · published rounds make zero provider calls.";
}

async function loadCourseImportServerStatus() {
  try {
    const status = await courseImportRequest("/api/v1/course-import/golf-intelligence/status");
    renderCourseImportServerStatus(status);
    setCourseImportStatus(status.ready_for_search
      ? "Ready. Search does not use credits."
      : "The importer is installed. Add credentials later to enable live search.", "success");
  } catch (error) {
    const authorizationRequired = error.message.includes("developer") || error.message.includes("login");
    renderCourseImportServerStatus({
      enabled: !authorizationRequired,
      authorization_required: authorizationRequired,
      credentials_configured: false,
      paid_calls_allowed: false
    });
    setCourseImportStatus(authorizationRequired
      ? "Sign in with an authorized developer account to import courses."
      : error.message);
  }
}

function resetCourseImportSelection() {
  selectedExternalCourse = null;
  externalImportJobId = null;
  $("#course-import-confirm").hidden = true;
  $("#course-import-preview").hidden = true;
  $("#course-import-gps-recovery").hidden = true;
}

function externalCourseLocation(course) {
  return [course.city, course.region, course.country].filter(Boolean).join(", ") || "Location not supplied";
}

function renderExternalCourseResults(results) {
  const container = $("#course-import-results");
  container.innerHTML = results.length ? results.map((course, index) => `
    <button class="course-import-result" type="button" data-external-course-index="${index}" data-cached="${Boolean(course.cache?.available)}">
      <span><strong>${escapeHtml(course.name)}</strong><span>${escapeHtml(externalCourseLocation(course))}</span></span>
      <small>${course.cache?.available ? "Cached · 0 credits" : `${course.course_count || 1} course${course.course_count === 1 ? "" : "s"} · ${course.gps_count || 0} GPS records`}</small>
    </button>
  `).join("") : `<p class="empty-copy">No matching courses were returned. Try the facility's full name or city.</p>`;
  $$('[data-external-course-index]').forEach(button => {
    button.addEventListener("click", () => selectExternalCourse(results[Number(button.dataset.externalCourseIndex)]));
  });
}

function selectExternalCourse(course) {
  selectedExternalCourse = course;
  externalImportJobId = null;
  $("#course-import-preview").hidden = true;
  $("#course-import-confirm-title").textContent = course.name;
  $("#course-import-confirm-location").textContent = externalCourseLocation(course);
  const cached = Boolean(course.cache?.available);
  const gpsRecovery = !cached && (courseImportServerStatus?.gps_only_recovery_public_ids || []).includes(course.external_id);
  const credits = cached ? 0 : Number(courseImportServerStatus?.full_detail_credit_estimate ?? 3);
  $("#course-import-credit-cost").textContent = `${credits} credit${credits === 1 ? "" : "s"}`;
  $("#course-import-cache-note").textContent = cached
    ? "Using the saved course record; no provider download"
    : "Full scorecard + GPS geometry";
  $("#continue-external-import").textContent = cached
    ? "Open cached preview"
    : gpsRecovery ? "Full detail unavailable" : "Continue to preview";
  $("#continue-external-import").disabled = gpsRecovery || (!cached && !courseImportServerStatus?.paid_calls_allowed);
  $("#course-import-gps-credit-cost").textContent = `${Number(courseImportServerStatus?.gps_only_credit_estimate ?? 2)} credits`;
  $("#course-import-gps-recovery").hidden = !gpsRecovery;
  $("#continue-gps-only-import").disabled = !courseImportServerStatus?.paid_calls_allowed;
  $("#course-import-confirm").hidden = false;
  $("#course-import-confirm").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function searchExternalCourses() {
  const keywords = $("#course-import-query").value.trim();
  if (keywords.length < 2) {
    setCourseImportStatus("Enter at least two characters of the course name.");
    return;
  }
  const button = $("#search-external-course");
  button.disabled = true;
  button.textContent = "Searching…";
  resetCourseImportSelection();
  $("#course-import-results").innerHTML = "";
  setCourseImportStatus("Searching Golf Intelligence · 0 credits…", "success");
  try {
    const result = await courseImportRequest("/api/v1/course-import/golf-intelligence/search", {
      keywords,
      rows: 10,
      offset: 0
    });
    renderExternalCourseResults(result.results || []);
    setCourseImportStatus(`${result.results?.length || 0} matching course${result.results?.length === 1 ? "" : "s"}. Select one to continue.`, "success");
  } catch (error) {
    setCourseImportStatus(error.message);
  } finally {
    button.disabled = !courseImportServerStatus?.ready_for_search;
    button.textContent = "Search";
  }
}

function renderExternalImportPreview(result) {
  const preview = result.preview;
  externalImportJobId = result.job_id;
  $("#course-import-preview-title").textContent = preview.course;
  $("#course-import-completeness").textContent = `${preview.geometry_completeness}% geometry`;
  const labels = {
    scorecard: "Scorecard",
    tees: "Tee geometry",
    fairways: "Fairways",
    greens: "Greens",
    bunkers: "Bunkers present",
    penalty_areas: "Penalty areas present",
    hole_outlines: "Hole outlines"
  };
  $("#course-import-checks").innerHTML = Object.entries(labels).map(([key, label]) => `
    <div><dt>${label}</dt><dd data-present="${Boolean(preview.checks?.[key])}">${preview.checks?.[key] ? "YES" : "NO"}</dd></div>
  `).join("");
  const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
  const warningPanel = $("#course-import-warnings");
  warningPanel.hidden = warnings.length === 0;
  warningPanel.querySelector("ul").innerHTML = warnings.slice(0, 80).map(warning => `<li>${escapeHtml(warning)}</li>`).join("");
  $("#course-import-confirm").hidden = true;
  $("#course-import-preview").hidden = false;
  $("#course-import-preview").scrollIntoView({ block: "nearest", behavior: "smooth" });
  setCourseImportStatus(result.cache_hit
    ? "Loaded the cached course record · 0 credits used."
    : `Course detail downloaded · estimated ${result.estimated_credits_used} credits used.`, "success");
}

async function previewExternalCourse() {
  if (!selectedExternalCourse) return;
  const cached = Boolean(selectedExternalCourse.cache?.available);
  if (!cached && !courseImportServerStatus?.paid_calls_allowed) {
    setCourseImportStatus("Turn on “Allow paid API calls” before continuing.");
    return;
  }
  const button = $("#continue-external-import");
  button.disabled = true;
  button.textContent = cached ? "Opening cache…" : "Downloading…";
  setCourseImportStatus(cached ? "Loading the saved course record…" : "Downloading the selected scorecard and GPS geometry…", "success");
  try {
    const result = await courseImportRequest("/api/v1/course-import/golf-intelligence/preview", {
      public_id: selectedExternalCourse.external_id,
      confirm_paid: !cached
    });
    renderExternalImportPreview(result);
  } catch (error) {
    try {
      const status = await courseImportRequest("/api/v1/course-import/golf-intelligence/status");
      renderCourseImportServerStatus(status);
    } catch {
      // Keep the original provider error visible if status refresh also fails.
    }
    setCourseImportStatus(error.message);
  } finally {
    button.disabled = !cached && !courseImportServerStatus?.paid_calls_allowed;
    button.textContent = cached ? "Open cached preview" : "Continue to preview";
  }
}

async function previewGpsOnlyRecovery() {
  if (!selectedExternalCourse) return;
  if (!courseImportServerStatus?.paid_calls_allowed) {
    setCourseImportStatus("Turn on “Allow paid API calls” before downloading GPS geometry.");
    return;
  }
  const button = $("#continue-gps-only-import");
  button.disabled = true;
  button.textContent = "Downloading GPS…";
  setCourseImportStatus("Downloading Warrenbrook GPS geometry and pairing it with the installed scorecard…", "success");
  try {
    const result = await courseImportRequest("/api/v1/course-import/golf-intelligence/preview-gps-only", {
      public_id: selectedExternalCourse.external_id,
      confirm_gps_only: true
    });
    try {
      const status = await courseImportRequest("/api/v1/course-import/golf-intelligence/status");
      renderCourseImportServerStatus(status);
    } catch {
      courseImportServerStatus = { ...courseImportServerStatus, paid_calls_allowed: false };
      renderCourseImportServerStatus(courseImportServerStatus);
    }
    renderExternalImportPreview(result);
  } catch (error) {
    try {
      const status = await courseImportRequest("/api/v1/course-import/golf-intelligence/status");
      renderCourseImportServerStatus(status);
    } catch {
      // Preserve the GPS recovery error if status refresh also fails.
    }
    setCourseImportStatus(error.message);
  } finally {
    button.textContent = "Download GPS only";
    button.disabled = !courseImportServerStatus?.paid_calls_allowed;
  }
}

async function commitExternalCourse() {
  if (!externalImportJobId) return;
  if (!window.confirm("Open this imported course in Course Mapper? Your current workspace will be replaced; save it first if needed.")) return;
  const button = $("#commit-external-import");
  button.disabled = true;
  button.textContent = "Opening…";
  try {
    const result = await courseImportRequest("/api/v1/course-import/golf-intelligence/import", {
      job_id: externalImportJobId
    });
    const loadedProject = validateMapperProject(result.project);
    recordUndo("import Golf Intelligence course");
    project = loadedProject;
    currentHoleNumber = 1;
    autoDraftSetupPending = false;
    referencePanelOpen = false;
    selectedFeatureId = null;
    selectedFeatureIds.clear();
    selectedPlayPoint = null;
    $("#course-name").value = project.course_name;
    $("#course-structure").value = project.course_structure;
    syncNineLoopNameFields();
    renderHoleSwitcherOptions();
    persistProject();
    renderHoleForm();
    await applyImagerySource();
    fitMappedHole();
    $("#course-import-dialog").close();
    setStatus(`Imported ${project.course_name}. Review every warning, then preview and install the finished course.`, "success");
  } catch (error) {
    setCourseImportStatus(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Open in Course Mapper";
  }
}

async function loadRequestedPreset() {
  const preset = COURSE_PRESETS[REQUESTED_PRESET_ID];
  if (!preset) return false;
  const existingProject = Boolean(localStorage.getItem(AUTOSAVE_KEY));
  const [scorecardResponse, holeResponses] = await Promise.all([
    fetch(preset.scorecardText),
    Promise.all(Array.from({ length: 18 }, (_, index) => fetch(preset.holeData(index + 1))))
  ]);
  if (!scorecardResponse.ok || holeResponses.some(response => !response.ok)) {
    throw new Error(`could not load the ${preset.name} source package`);
  }
  const rows = parseScorecardText(await scorecardResponse.text());
  const holeData = await Promise.all(holeResponses.map(response => response.json()));
  if (!existingProject) {
    project = createMapperProject({
      courseName: preset.name,
      courseId: preset.courseId,
      address: preset.address
    });
  }
  project.map_view = { center: preset.center, zoom: 16 };
  project.imagery_source = "User-aligned local illustrated hole images";
  project.reference_images ||= {};
  project.reference_image_bounds ||= {};
  project.hole_imagery ||= {};
  project.scorecard_source_image = preset.scorecardImage;
  project.source_package = `${preset.name} installed map and illustrated hole set`;
  rows.forEach(row => {
    const source = holeData[row.hole - 1];
    const holeKey = String(row.hole);
    const currentSource = project.reference_images[holeKey];
    if (!currentSource || currentSource === preset.legacyHoleImage(row.hole)) {
      project.reference_images[holeKey] = preset.holeImage(row.hole);
    }
    project.hole_imagery[holeKey] = "local";
    let hole = project.holes[holeKey];
    if (!hole.features.length) {
      const restored = restoreMappedHoleFromGame(source, row, preset.center);
      hole = restored.hole;
      project.holes[holeKey] = hole;
      project.reference_image_bounds[holeKey] = restored.imageBounds;
    }
    hole.par = row.par;
    hole.handicap = row.handicap;
    hole.yardages = { blue: row.blue, white: row.white, forward: row.forward };
    hole.layout_type = source.hole_metadata?.layout_type || "Mapped from supplied image";
    hole.elevation_change_meters = Number(source.elevation_profile?.points?.at(-1)?.elevation_m) || 0;
  });
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
  return !existingProject;
}

function loadAutosave() {
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (!raw) return createMapperProject();
  try {
    return parseMapperProject(raw);
  } catch (error) {
    console.warn("Ignored invalid mapper autosave.", error);
    return createMapperProject();
  }
}

function currentHole() {
  return project.holes[String(currentHoleNumber)];
}

function editorViewTransform() {
  const hole = currentHole();
  const tee = hole?.markers?.white_tee;
  const target = uprightHoleViewTarget(hole);
  if (!tee || !target) return null;
  const targetKind = hole.route_points?.[0] ? "route-1" : "pin";
  const key = [currentHoleNumber, tee.lat, tee.lng, targetKind, target.lat, target.lng].join(":");
  if (uprightViewCache?.key === key) return uprightViewCache.transform;
  try {
    const transform = createUprightGpsViewTransform(tee, target);
    uprightViewCache = { key, transform };
    return transform;
  } catch {
    return null;
  }
}

function rawGpsLiteral(position) {
  if (!position) return null;
  return {
    lat: typeof position.lat === "function" ? position.lat() : position.lat,
    lng: typeof position.lng === "function" ? position.lng() : position.lng
  };
}

function displayGps(position) {
  const literal = rawGpsLiteral(position);
  return literal && editorViewTransform()?.toView(literal) || literal;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "course";
}

function setStatus(message, tone = "neutral") {
  const status = $("#editor-status");
  status.textContent = message;
  status.dataset.tone = tone;
}

function setAutosaveStatus(label, state = "saved") {
  const status = $("#autosave-status");
  if (!status) return;
  status.dataset.state = state;
  if (state !== "saved") {
    status.textContent = label;
    return;
  }
  const savedAt = new Date(project.updated_at);
  const time = Number.isNaN(savedAt.getTime())
    ? ""
    : savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  status.textContent = time ? `${label} · ${time}` : label;
}

function updateUndoControl() {
  const button = $("#undo-editor");
  if (!button) return;
  button.disabled = undoHistory.size === 0;
  button.title = undoHistory.nextLabel ? `Undo ${undoHistory.nextLabel}` : "Nothing to undo";
}

function recordUndo(label, key = null) {
  const added = undoHistory.push({ project, currentHoleNumber }, label, { key });
  if (added) updateUndoControl();
}

function undoPreviousStep() {
  const entry = undoHistory.pop();
  if (!entry) return;
  window.clearTimeout(featureCommitTimer);
  featureCommitTimer = null;
  project = entry.state.project;
  currentHoleNumber = entry.state.currentHoleNumber;
  selectedFeatureId = null;
  selectedFeatureIds.clear();
  activeTool = null;
  autoDraftSetupPending = false;
  clearMeasurements();
  $("#course-name").value = project.course_name;
  $("#course-structure").value = project.course_structure;
  renderHoleSwitcherOptions();
  syncNineLoopNameFields();
  if (map && project.map_view?.center) {
    map.setView(displayGps(project.map_view.center), Math.min(project.map_view.zoom || 17, EDITOR_MAX_ZOOM), { animate: false });
  }
  renderHoleForm();
  void applyImagerySource({ fit: true });
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
  setActiveTool(null);
  updateUndoControl();
  setStatus(`Undid ${entry.label}.`, "success");
}

function persistProject(label = "Autosaved") {
  const updateAutosaveIndicator = typeof label === "string";
  if (!updateAutosaveIndicator) label = "Autosaved";
  project.updated_at = new Date().toISOString();
  if (map) {
    const center = gpsLiteral(map.getCenter());
    project.map_view = {
      center,
      zoom: map.getZoom()
    };
  }
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
  } catch (error) {
    console.error("Could not autosave Course Mapper project.", error);
    updateValidation();
    setAutosaveStatus("Autosave failed", "error");
    setStatus("Autosave failed. Use Save project to download a copy; browser storage may be full.", "error");
    return false;
  }
  updateValidation();
  if (updateAutosaveIndicator) setAutosaveStatus(label);
  return true;
}

function saveHoleForm(recordChange = false, autosaveLabel = "Autosaved") {
  const hole = currentHole();
  const next = {
    par: Number($("#hole-par").value) || 4,
    handicap: Number($("#hole-handicap").value) || currentHoleNumber,
    yardages: {
    blue: Number($("#yards-blue").value) || 0,
    white: Number($("#yards-white").value) || 0,
    forward: Number($("#yards-forward").value) || 0
    },
    elevation_change_meters: Number($("#elevation-change").value) || 0,
    layout_type: $("#layout-type").value.trim() || "Mapped from local hole image"
  };
  const changed = hole.par !== next.par || hole.handicap !== next.handicap ||
    JSON.stringify(hole.yardages) !== JSON.stringify(next.yardages) ||
    hole.elevation_change_meters !== next.elevation_change_meters || hole.layout_type !== next.layout_type;
  if (recordChange && changed) recordUndo(`Hole ${currentHoleNumber} card change`, `hole-card-${currentHoleNumber}`);
  Object.assign(hole, next);
  const teeAlignment = changed ? alignSecondaryTeesFromWhite(hole) : { aligned: [] };
  const fairwayTool = $('[data-tool="fairway"]');
  if (fairwayTool) {
    fairwayTool.disabled = hole.par === 3;
    fairwayTool.title = hole.par === 3 ? "Par-3 holes do not use fairway shapes" : "";
  }
  if (hole.par === 3) {
    const fairwayCount = hole.features.filter(feature => feature.type === "fairway").length;
    if (fairwayCount) {
      hole.features = hole.features.filter(feature => feature.type !== "fairway");
      selectedFeatureIds = new Set([...selectedFeatureIds].filter(id => hole.features.some(feature => feature.id === id)));
      if (selectedFeatureId && !selectedFeatureIds.has(selectedFeatureId)) selectedFeatureId = [...selectedFeatureIds].at(-1) || null;
      renderMappedHole();
      setStatus(`Removed ${fairwayCount} fairway shape${fairwayCount === 1 ? "" : "s"} from this par-3 hole.`, "success");
    }
  }
  if (teeAlignment.aligned.length) renderMappedHole();
  return persistProject(autosaveLabel);
}

function renderHoleForm() {
  const hole = currentHole();
  const fairwayTool = $('[data-tool="fairway"]');
  if (fairwayTool) {
    fairwayTool.disabled = Number(hole.par) === 3;
    fairwayTool.title = Number(hole.par) === 3 ? "Par-3 holes do not use fairway shapes" : "";
  }
  $("#hole-par").value = String(hole.par);
  $("#hole-handicap").value = String(hole.handicap);
  $("#yards-blue").value = hole.yardages.blue || "";
  $("#yards-white").value = hole.yardages.white || "";
  $("#yards-forward").value = hole.yardages.forward || "";
  $("#elevation-change").value = String(hole.elevation_change_meters || 0);
  $("#layout-type").value = hole.layout_type || "";
  selectedFeatureId = null;
  selectedFeatureIds.clear();
  selectedPlayPoint = null;
  renderSelectedFeature();
  renderGpsCalibration();
  if (map) renderMappedHole();
  renderImageryControls();
  renderReferenceImage();
  updateValidation();
}

function gpsInputValue(point) {
  return point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    ? `${point.lat.toFixed(7)}, ${point.lng.toFixed(7)}`
    : "";
}

function renderGpsCalibration() {
  const hole = currentHole();
  const controls = hole.gps_control_points || {};
  const bunkers = hole.features.filter(feature => feature.type === "bunker");
  const bunkerSelect = $("#gps-bunker-feature");
  bunkerSelect.innerHTML = `<option value="">Select bunker…</option>${bunkers.map((feature, index) =>
    `<option value="${escapeHtml(feature.id)}">${escapeHtml(feature.label || `Sand bunker ${index + 1}`)}</option>`
  ).join("")}`;
  bunkerSelect.value = bunkers.some(feature => feature.id === controls.bunker_feature_id)
    ? controls.bunker_feature_id
    : "";
  $("#gps-white-tee").value = gpsInputValue(controls.white_tee);
  $("#gps-green-center").value = gpsInputValue(controls.green_center);
  $("#gps-bunker-center").value = gpsInputValue(controls.bunker_center);
  const mark = $("#gps-calibration-mark");
  const status = $("#gps-calibration-status");
  try {
    const calibration = buildHoleGpsCalibration(hole);
    mark.textContent = "GPS";
    mark.dataset.ready = "true";
    status.dataset.tone = "success";
    status.textContent = `Calibrated · tee to green ${Math.round(calibration.check.tee_to_green_meters * YARDS_PER_METER)} yd · saved with this hole.`;
  } catch (error) {
    mark.textContent = "—";
    mark.dataset.ready = "false";
    status.dataset.tone = controls.white_tee || controls.green_center || controls.bunker_center ? "error" : "neutral";
    status.textContent = controls.white_tee || controls.green_center || controls.bunker_center
      ? error.message
      : "Optional. This does not move your artwork or calculation shapes.";
  }
}

function gpsCalibrationFormState() {
  const values = {
    whiteTee: $("#gps-white-tee").value.trim(),
    greenCenter: $("#gps-green-center").value.trim(),
    bunkerCenter: $("#gps-bunker-center").value.trim(),
    bunkerFeatureId: $("#gps-bunker-feature").value
  };
  return {
    ...values,
    any: Boolean(values.whiteTee || values.greenCenter || values.bunkerCenter || values.bunkerFeatureId),
    complete: Boolean(values.whiteTee && values.greenCenter && values.bunkerCenter && values.bunkerFeatureId)
  };
}

function saveGpsCalibration({ quiet = false } = {}) {
  try {
    const form = gpsCalibrationFormState();
    if (!form.complete) throw new Error("complete all three coordinates and select the matching bunker");
    const controls = {
      white_tee: parseGpsCoordinatePair(form.whiteTee),
      green_center: parseGpsCoordinatePair(form.greenCenter),
      bunker_center: parseGpsCoordinatePair(form.bunkerCenter),
      bunker_feature_id: form.bunkerFeatureId,
      calibrated_at: new Date().toISOString()
    };
    const calibration = buildHoleGpsCalibration({ ...currentHole(), gps_control_points: controls });
    const previous = currentHole().gps_control_points;
    const same = previous && JSON.stringify({ ...previous, calibrated_at: null }) === JSON.stringify({ ...controls, calibrated_at: null });
    if (!same) recordUndo(`save Hole ${currentHoleNumber} GPS calibration`);
    currentHole().gps_control_points = controls;
    persistProject();
    renderGpsCalibration();
    if (!quiet) setStatus(`Hole ${currentHoleNumber} GPS calibration saved. Tee-to-green check: ${Math.round(calibration.check.tee_to_green_meters * YARDS_PER_METER)} yd.`, "success");
    return true;
  } catch (error) {
    $("#gps-calibration-status").dataset.tone = "error";
    $("#gps-calibration-status").textContent = error.message;
    if (!quiet) setStatus(`GPS calibration was not saved: ${error.message}.`, "error");
    return false;
  }
}

function prepareGpsCalibrationForHandoff() {
  const form = gpsCalibrationFormState();
  if (!form.any) return true;
  if (!form.complete) {
    setStatus(`Hole ${currentHoleNumber} GPS calibration is incomplete. Complete all three points before installation.`, "error");
    return false;
  }
  return saveGpsCalibration({ quiet: true });
}

function renderReferenceImage() {
  const source = project.reference_images?.[String(currentHoleNumber)] || null;
  const localBackgroundActive = currentImageryMode() === "local";
  const toggle = $("#reference-image-toggle");
  const panel = $("#reference-image-panel");
  toggle.hidden = !source || referencePanelOpen || localBackgroundActive;
  panel.hidden = !source || !referencePanelOpen || localBackgroundActive;
  if (!source) return;
  $("#reference-image-title").textContent = `${editorHoleLabel(currentHoleNumber)} reference`;
  const image = $("#reference-hole-image");
  image.src = source;
  image.alt = `${project.course_name} ${editorHoleLabel(currentHoleNumber)} supplied aerial reference`;
  $("#reference-previous-hole").disabled = currentHoleNumber <= 1;
  $("#reference-next-hole").disabled = currentHoleNumber >= mapperHoleCount(project);
  $("#view-source-scorecard").hidden = !project.scorecard_source_image;
}

function showReferenceDialog(source, title, alt) {
  if (!source) return;
  $("#reference-dialog-title").textContent = title;
  const image = $("#reference-dialog-image");
  image.src = source;
  image.alt = alt;
  $("#reference-image-dialog").showModal();
}

function currentImageryMode() {
  return "local";
}

function renderImageryControls() {
  const holeKey = String(currentHoleNumber);
  const hasLocalImage = Boolean(project.reference_images?.[holeKey]);
  const opacity = Number(project.background_opacity?.[holeKey]) || 82;
  const rotation = artworkRotation(holeKey);
  $("#choose-local-image").textContent = hasLocalImage ? "Replace image" : "Choose image";
  $("#background-opacity").value = String(opacity);
  $("#background-opacity-value").textContent = `${opacity}%`;
  $("#image-rotation-value").textContent = `${rotation}°`;
  $("#rotate-image-left").disabled = !hasLocalImage;
  $("#rotate-image-right").disabled = !hasLocalImage;
  $("#map").setAttribute("aria-label", "Local hole artwork editor");
  const upright = Boolean(editorViewTransform());
  const orientationLabel = currentHole().route_points?.[0] ? "first leg" : "tee-to-pin line";
  $("#map-source-note").textContent = upright
    ? hasLocalImage
      ? `Tee-down view · ${orientationLabel} points north · artwork and calculation layer stay aligned.`
      : `Tee-down view · ${orientationLabel} points north · GPS geometry is unchanged.`
    : hasLocalImage
      ? "Set the White tee and pin to turn this hole upright automatically."
      : "Choose a hole image, then set the White tee and pin to turn the hole upright.";
  $(".map-stage").classList.toggle("no-hole-artwork", !hasLocalImage);
  renderMeasurements();
}

function literalImageBounds(bounds) {
  if (!bounds?.southWest || !bounds?.northEast) return null;
  const corners = [
    bounds.southWest,
    { lat: bounds.southWest.lat, lng: bounds.northEast.lng },
    bounds.northEast,
    { lat: bounds.northEast.lat, lng: bounds.southWest.lng }
  ].map(displayGps);
  return L.latLngBounds(corners);
}

function artworkRotation(holeKey = String(currentHoleNumber)) {
  const raw = Number(project.reference_image_rotation?.[holeKey]) || 0;
  return ((Math.round(raw / 90) * 90) % 360 + 360) % 360;
}

async function createLocalImageBounds(source, rotation = 0) {
  const image = await loadCrossOriginImage(source, "The local image could not be opened");
  const hole = currentHole();
  const center = map?.getCenter() || project.map_view?.center || { lat: 40.5206, lng: -74.4143 };
  const yardage = Number(hole.yardages.white || hole.yardages.blue || hole.yardages.forward) || 300;
  const heightMeters = Math.max(180, Math.min(780, yardage * .9144 * 1.35));
  const turnsSideways = rotation % 180 !== 0;
  const imageWidth = turnsSideways ? image.naturalHeight : image.naturalWidth;
  const imageHeight = turnsSideways ? image.naturalWidth : image.naturalHeight;
  const aspectRatio = Math.max(.3, Math.min(2.5, imageWidth / imageHeight));
  const widthMeters = heightMeters * aspectRatio;
  return {
    southWest: offsetGpsPoint(gpsLiteral(center), -widthMeters / 2, -heightMeters / 2),
    northEast: offsetGpsPoint(gpsLiteral(center), widthMeters / 2, heightMeters / 2)
  };
}

async function renderedArtworkDataUrl(source, rotation, maxDimension = 1600, quality = .84) {
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const variantKey = `${normalizedRotation}:${maxDimension}:${quality}`;
  const sourceCache = rotatedArtworkCache.get(source);
  if (sourceCache?.has(variantKey)) return sourceCache.get(variantKey);
  const image = await loadCrossOriginImage(source, "The hole artwork could not be prepared");
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const radians = normalizedRotation * Math.PI / 180;
  const outputWidth = Math.abs(sourceWidth * Math.cos(radians)) + Math.abs(sourceHeight * Math.sin(radians));
  const outputHeight = Math.abs(sourceWidth * Math.sin(radians)) + Math.abs(sourceHeight * Math.cos(radians));
  const scale = Math.min(1, maxDimension / Math.max(outputWidth, outputHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(outputWidth * scale));
  canvas.height = Math.max(1, Math.round(outputHeight * scale));
  const context = canvas.getContext("2d");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(normalizedRotation * Math.PI / 180);
  context.drawImage(image, -sourceWidth * scale / 2, -sourceHeight * scale / 2, sourceWidth * scale, sourceHeight * scale);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  canvas.width = 1;
  canvas.height = 1;
  const variants = sourceCache || new Map();
  variants.set(variantKey, dataUrl);
  rotatedArtworkCache.set(source, variants);
  return dataUrl;
}

async function applyImagerySource({ fit = false } = {}) {
  if (!map) return;
  const token = ++imageryRenderToken;
  renderImageryControls();
  renderReferenceImage();
  if (localImageLayer) {
    localImageLayer.remove();
    localImageLayer = null;
  }
  const holeKey = String(currentHoleNumber);
  const source = project.reference_images?.[holeKey];
  if (!source) {
    if (fit) fitMappedHole();
    return;
  }
  try {
    const rotation = artworkRotation(holeKey);
    const viewRotation = editorViewTransform()?.bearing_degrees || 0;
    const displaySource = await renderedArtworkDataUrl(source, rotation - viewRotation);
    project.reference_image_bounds ||= {};
    let storedBounds = project.reference_image_bounds[holeKey];
    if (!storedBounds) {
      storedBounds = await createLocalImageBounds(source, rotation);
      project.reference_image_bounds[holeKey] = storedBounds;
      persistProject();
    }
    if (token !== imageryRenderToken) return;
    const bounds = literalImageBounds(storedBounds);
    localImageLayer = L.imageOverlay(displaySource, bounds, {
      opacity: (Number(project.background_opacity?.[holeKey]) || 82) / 100,
      interactive: false,
      crossOrigin: true
    }).addTo(map);
    localImageLayer.bringToBack();
    if (fit) {
      fitMappedHole();
    }
  } catch (error) {
    renderImageryControls();
    renderReferenceImage();
    setStatus(`Hole artwork could not be displayed: ${error.message}.`, "error");
  }
}

async function imageFileDataUrl(file) {
  if (!file.type.startsWith("image/")) throw new Error("choose a PNG, JPEG, or WebP image");
  if (file.size > 20 * 1024 * 1024) throw new Error("image files must be smaller than 20 MB");
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("the image file could not be read"));
    reader.readAsDataURL(file);
  });
  const image = await loadCrossOriginImage(source, "The selected image could not be opened");
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", .84);
}

function buildPlayableGamePackages() {
  return buildGameCoursePackages(project).map(payload => ({
    ...payload,
    artwork_mode: "generated_from_geometry"
  }));
}

function projectNineLoops() {
  return mapperNineLoops(project);
}

function syncNineLoopNameFields() {
  const panel = $("#nine-loop-names");
  const threeNines = project.course_structure === MAPPER_COURSE_STRUCTURES.THREE_NINES;
  panel.hidden = !threeNines;
  if (!threeNines) return;
  projectNineLoops().forEach(loop => {
    const input = $(`[data-nine-loop-id="${loop.id}"]`);
    if (input && document.activeElement !== input) input.value = loop.name;
  });
}

function editorHoleLabel(holeNumber) {
  if (project.course_structure !== MAPPER_COURSE_STRUCTURES.THREE_NINES) return `Hole ${holeNumber}`;
  const loop = projectNineLoops().find(item => holeNumber >= item.start && holeNumber <= item.end);
  return loop ? `${loop.name} ${holeNumber - loop.start + 1}` : `Hole ${holeNumber}`;
}

function renderHoleSwitcherOptions() {
  if (project.course_structure === MAPPER_COURSE_STRUCTURES.THREE_NINES) {
    $("#hole-number").innerHTML = projectNineLoops().map(loop => `
      <optgroup label="${escapeHtml(loop.name)} nine">
        ${Array.from({ length: 9 }, (_, index) => {
          const holeNumber = loop.start + index;
          return `<option value="${holeNumber}">${escapeHtml(loop.name)} ${index + 1}</option>`;
        }).join("")}
      </optgroup>`).join("");
  } else {
    $("#hole-number").innerHTML = Array.from({ length: 18 }, (_, index) =>
      `<option value="${index + 1}">Hole ${index + 1}</option>`
    ).join("");
  }
  $("#hole-number").value = String(Math.min(currentHoleNumber, mapperHoleCount(project)));
}

function switchHole(holeNumber) {
  if (holeNumber < 1 || holeNumber > mapperHoleCount(project) || holeNumber === currentHoleNumber) return;
  const departingHoleNumber = currentHoleNumber;
  const departingHoleLabel = editorHoleLabel(departingHoleNumber);
  const destinationHoleLabel = editorHoleLabel(holeNumber);
  if (!saveHoleForm(false, `Saved ${departingHoleLabel}`)) {
    $("#hole-number").value = String(departingHoleNumber);
    return;
  }
  currentHoleNumber = holeNumber;
  autoDraftSetupPending = false;
  setActiveTool(null);
  $("#hole-number").value = String(holeNumber);
  clearMeasurements();
  renderHoleForm();
  void applyImagerySource({ fit: true });
  setStatus(`${departingHoleLabel} autosaved. Editing ${destinationHoleLabel}.`, "success");
}

function updateValidation() {
  const status = holeMappingStatus(project, currentHoleNumber);
  $("#hole-status-mark").textContent = status.ready ? "Ready to export" : "Incomplete";
  $("#hole-status-mark").classList.toggle("ready", status.ready);
  $("#hole-validation").textContent = status.ready
    ? "The required datum and playing surfaces are mapped."
    : `Still needed: ${status.problems.join(", ")}.`;
}

function downloadText(text, filename, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function templatePoints(center, style) {
  if (style.shape === "rounded_box") {
    return roundedGpsRectangle(center, style.width, style.length, .22);
  }
  if (style.shape === "box") {
    const halfLength = style.length / 2;
    const halfWidth = style.width / 2;
    return [
      offsetGpsPoint(center, -halfWidth, -halfLength),
      offsetGpsPoint(center, halfWidth, -halfLength),
      offsetGpsPoint(center, halfWidth, halfLength),
      offsetGpsPoint(center, -halfWidth, halfLength)
    ];
  }
  const pointCount = style.points || 16;
  return Array.from({ length: pointCount }, (_, index) => {
    const angle = 2 * Math.PI * index / pointCount;
    return offsetGpsPoint(
      center,
      Math.sin(angle) * style.width / 2,
      Math.cos(angle) * style.length / 2
    );
  });
}

function featureName(feature) {
  return feature.label || Object.values(FEATURE_STYLE).find(style => (style.type || "") === feature.type)?.name ||
    FEATURE_STYLE[feature.type]?.name || feature.type.replaceAll("_", " ");
}

function gpsPolygonAreaMeters(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  const origin = points[0];
  const meters = points.map(point => gpsDeltaMeters(origin, point));
  return Math.abs(meters.reduce((sum, point, index) => {
    const next = meters[(index + 1) % meters.length];
    return sum + point.east * next.north - next.east * point.north;
  }, 0) / 2);
}

function setActiveTool(tool) {
  if (tool === "box_select") {
    boxSelectionType = "trees";
  } else if (activeTool === "box_select") {
    boxSelectionType = null;
  }
  if (boxSelectionLayer) boxSelectionLayer.remove();
  boxSelectionLayer = null;
  boxSelectionStart = null;
  clearSurfaceBrushPreview();
  activeTool = tool;
  measurementStart = null;
  $$("[data-tool]").forEach(button => button.classList.toggle("active", button.dataset.tool === tool));
  $("#active-tool-label").textContent = tool === "box_select" && boxSelectionType
    ? "Box select trees · drag around the tree shapes"
    : tool ? TOOL_LABELS[tool] : "Pan and inspect";
  $("#cancel-tool").hidden = !tool;
  if (map) {
    map.getContainer().style.cursor = tool ? "crosshair" : "grab";
    map.getContainer().classList.toggle("mapper-box-selection", tool === "box_select");
    if (tool === "box_select" || ["tree_brush", "stream_brush", "cart_path_brush"].includes(tool)) map.dragging.disable();
    else map.dragging.enable();
  }
  if (tool) {
    clearFeatureDragProxies();
    for (const [id, overlay] of featureOverlays) {
      overlay.pm.disableLayerDrag?.();
      overlay.pm.disable();
      const keepSelected = tool === "box_select" && selectedFeatureIds.has(id);
      overlay.setStyle({ weight: keepSelected ? 4 : 2 });
      overlay.getElement()?.classList.toggle("mapper-feature-selected", keepSelected);
    }
  } else if (selectedFeatureId && featureOverlays.has(selectedFeatureId)) {
    refreshFeatureSelection();
  }
}

function surfaceBrushConfig() {
  if (activeTool === "cart_path_brush") {
    return { type: "cart_path", name: "cart path", label: "Painted cart path", source: "cart_path_brush", fixedWidthYards: 4, sampleFactor: 1.5, maxSamples: 180, edge: "#f0eee7", fill: "#aaa89f" };
  }
  if (activeTool === "stream_brush") {
    return { type: "water", name: "stream / ditch", label: "Painted stream / ditch", source: "stream_brush", fixedWidthYards: 3, sampleFactor: 1.5, maxSamples: 180, edge: "#b9ecf2", fill: "#4f91a8" };
  }
  return { type: "trees", name: "tree cluster", label: "Painted tree cluster", source: "tree_brush", width: "#tree-brush-width", sampleFactor: .45, maxSamples: 80, edge: "#d8e8b8", fill: "#315f39" };
}

function surfaceBrushRadiusMeters() {
  const config = surfaceBrushConfig();
  if (config.fixedWidthYards) return config.fixedWidthYards * .9144 / 2;
  return Math.max(2, Number($(config.width)?.value || 20) * .9144 / 2);
}

function surfaceBrushActive() {
  return ["tree_brush", "stream_brush", "cart_path_brush"].includes(activeTool);
}

function clearSurfaceBrushPreview() {
  surfaceBrushPreview?.remove();
  surfaceBrushCursor?.remove();
  surfaceBrushPreview = null;
  surfaceBrushCursor = null;
  surfaceBrushPoints = [];
}

function beginSurfaceBrush(event) {
  if (!surfaceBrushActive() || Number(event.originalEvent?.button || 0) !== 0) return;
  const config = surfaceBrushConfig();
  surfaceBrushPoints = [gpsLiteral(event.latlng)];
  surfaceBrushPreview = L.layerGroup().addTo(map);
  L.circle(event.latlng, {
    pane: "surveyPane", radius: surfaceBrushRadiusMeters(), color: config.edge, weight: 1,
    fillColor: config.fill, fillOpacity: .42, interactive: false
  }).addTo(surfaceBrushPreview);
  L.DomEvent.preventDefault(event.originalEvent);
}

function updateSurfaceBrush(event) {
  if (!surfaceBrushActive()) return;
  const config = surfaceBrushConfig();
  surfaceBrushCursor?.remove();
  surfaceBrushCursor = L.circle(event.latlng, {
    pane: "surveyPane", radius: surfaceBrushRadiusMeters(), color: config.edge, weight: 1,
    dashArray: "4 3", fillColor: config.fill, fillOpacity: .16, interactive: false
  }).addTo(map);
  if (!surfaceBrushPoints.length) return;
  const point = gpsLiteral(event.latlng);
  const last = surfaceBrushPoints.at(-1);
  const delta = gpsDeltaMeters(last, point);
  const distance = Math.hypot(delta.east, delta.north);
  const spacing = surfaceBrushRadiusMeters() * config.sampleFactor;
  if (distance < spacing || surfaceBrushPoints.length >= config.maxSamples) return;
  const steps = Math.ceil(distance / spacing);
  for (let step = 1; step <= steps && surfaceBrushPoints.length < config.maxSamples; step += 1) {
    const sample = offsetGpsPoint(last, delta.east * step / steps, delta.north * step / steps);
    surfaceBrushPoints.push(sample);
    L.circle(displayGps(sample), {
      pane: "surveyPane", radius: surfaceBrushRadiusMeters(), color: "transparent", weight: 0,
      fillColor: config.fill, fillOpacity: .42, interactive: false
    }).addTo(surfaceBrushPreview);
  }
}

function buildWaterBrushPolygon(points, radiusMeters, maxPoints = 64) {
  if (points.length < 2) return buildTreeBrushPolygon(points, radiusMeters);
  const origin = points[0];
  const circles = points.map(point => resampleGpsPolygon(buildTreeBrushPolygon([point], radiusMeters), 12).map(vertex => {
    const local = gpsDeltaMeters(origin, vertex);
    return [local.east, local.north];
  }));
  try {
    const [outer] = unionSimplePolygons(circles);
    if (!outer?.length) throw new Error("water brush union was empty");
    const polygon = outer.map(([east, north]) => offsetGpsPoint(origin, east, north));
    return polygon.length > maxPoints ? resampleGpsPolygon(polygon, maxPoints) : polygon;
  } catch (error) {
    console.warn("Water brush circles could not be merged; using the stroke outline.", error);
    return buildTreeBrushPolygon(points, radiusMeters);
  }
}

function finishSurfaceBrush() {
  if (!surfaceBrushActive() || !surfaceBrushPoints.length) return;
  const config = surfaceBrushConfig();
  const radiusMeters = surfaceBrushRadiusMeters();
  const points = config.type !== "trees"
    ? buildWaterBrushPolygon(surfaceBrushPoints, radiusMeters, config.source === "stream_brush" ? 96 : 64)
    : buildTreeBrushPolygon(surfaceBrushPoints, radiusMeters);
  const sameTypeCount = currentHole().features.filter(feature => feature.type === config.type).length;
  const feature = {
    id: `${config.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: config.type,
    label: `${config.label}${sameTypeCount ? ` ${sameTypeCount + 1}` : ""}`,
    source: config.source,
    points
  };
  recordUndo(`paint ${config.name}`);
  currentHole().features.push(feature);
  selectedFeatureId = feature.id;
  selectedFeatureIds = new Set([feature.id]);
  selectedFeatureMode = "points";
  clearSurfaceBrushPreview();
  setActiveTool(null);
  persistProject();
  renderMappedHole();
  setStatus(`Painted one editable ${config.name}. Drag its points to refine the edge.`, "success");
}

function refreshFeatureSelection() {
  selectedFeatureId = selectedFeatureIds.has(selectedFeatureId)
    ? selectedFeatureId
    : [...selectedFeatureIds].at(-1) || null;
  clearFeatureDragProxies();
  for (const [id, overlay] of featureOverlays) {
    const selected = selectedFeatureIds.has(id);
    overlay.setStyle({ weight: selected ? 4 : 2 });
    overlay.getElement()?.classList.toggle("mapper-feature-selected", selected);
    applyFeatureInteraction(overlay, selected && selectedFeatureIds.size === 1);
  }
  for (const [id, overlay] of featureOverlays) {
    setupDirectFeatureDrag(currentHole().features.find(feature => feature.id === id), overlay);
  }
  renderFeatureList();
  renderSelectedFeature();
}

function beginBoxSelection(event) {
  if (activeTool !== "box_select" || Number(event.originalEvent?.button || 0) !== 0) return;
  boxSelectionStart = event.latlng;
  if (boxSelectionLayer) boxSelectionLayer.remove();
  boxSelectionLayer = L.rectangle(L.latLngBounds(boxSelectionStart, boxSelectionStart), {
    pane: "surveyPane",
    color: "#d9673f",
    weight: 2,
    dashArray: "7 5",
    fillColor: "#d9673f",
    fillOpacity: .1,
    interactive: false
  }).addTo(map);
}

function updateBoxSelection(event) {
  if (activeTool !== "box_select" || !boxSelectionStart || !boxSelectionLayer) return;
  boxSelectionLayer.setBounds(L.latLngBounds(boxSelectionStart, event.latlng));
}

function finishBoxSelection(event) {
  if (activeTool !== "box_select" || !boxSelectionStart) return;
  const bounds = L.latLngBounds(boxSelectionStart, event.latlng);
  const rectangle = [
    bounds.getSouthWest(),
    bounds.getSouthEast(),
    bounds.getNorthEast(),
    bounds.getNorthWest()
  ].map(gpsLiteral);
  const selectionType = boxSelectionType;
  const matches = currentHole().features.filter(feature =>
    (!selectionType || feature.type === selectionType) && polygonsOverlap(feature.points, rectangle)
  );
  const additive = Boolean(event.originalEvent?.shiftKey);
  selectedFeatureIds = additive
    ? new Set([...selectedFeatureIds, ...matches.map(feature => feature.id)])
    : new Set(matches.map(feature => feature.id));
  selectedFeatureId = matches.at(-1)?.id || [...selectedFeatureIds].at(-1) || null;
  setActiveTool(null);
  refreshFeatureSelection();
  if (!matches.length) {
    setStatus("No tree shapes touched that selection box.", "error");
    return;
  }
  const types = new Set(matches.map(feature => feature.type));
  const typeLabel = matches[0].type === "trees" ? "tree" : matches[0].type.replaceAll("_", " ");
  setStatus(types.size === 1
    ? `Selected ${selectedFeatureIds.size} ${typeLabel} shape${selectedFeatureIds.size === 1 ? "" : "s"}.`
    : `Selected ${matches.length} shapes. Make one cluster requires shapes of the same type.`, "success");
}

function addFeature(tool, center) {
  const style = FEATURE_STYLE[tool];
  const type = style.type || tool;
  const sameTypeCount = currentHole().features.filter(feature => feature.type === type).length;
  const feature = {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    label: `${style.name}${sameTypeCount ? ` ${sameTypeCount + 1}` : ""}`,
    points: templatePoints(center, style)
  };
  recordUndo(`add ${style.name.toLowerCase()}`);
  currentHole().features.push(feature);
  if (type === "tee_white") alignSecondaryTeesFromWhite(currentHole());
  selectedFeatureId = feature.id;
  selectedFeatureIds = new Set([feature.id]);
  selectedFeatureMode = "points";
  persistProject();
  renderMappedHole();
  setActiveTool(null);
}

function markerKeyForTool(tool) {
  return {
    marker_blue_tee: "blue_tee",
    marker_white_tee: "white_tee",
    marker_forward_tee: "forward_tee",
    marker_pin: "pin"
  }[tool] || null;
}

async function placeSurveyPoint(tool, position) {
  const markerKey = markerKeyForTool(tool);
  const routeIndex = {
    route_point_1: 0,
    route_point_2: 1
  }[tool];
  if (routeIndex === 1 && !currentHole().route_points[0]) {
    setStatus("Place Route point 1 before Route point 2 so the playing line stays in order.", "error");
    setActiveTool(null);
    return;
  }
  recordUndo(markerKey
    ? `place ${TOOL_LABELS[tool].replace(/^Mark /, "").toLowerCase()}`
    : `place route point ${routeIndex + 1}`);
  if (markerKey) {
    currentHole().markers[markerKey] = position;
    if (markerKey === "white_tee" || markerKey === "pin") alignSecondaryTeesFromWhite(currentHole());
  } else if (Number.isInteger(routeIndex)) {
    currentHole().route_points[routeIndex] = position;
  }
  persistProject();
  const orientationChanged = markerKey === "white_tee"
    || routeIndex === 0
    || (markerKey === "pin" && !currentHole().route_points[0]);
  if (orientationChanged && currentHole().markers.white_tee && uprightHoleViewTarget(currentHole())) {
    renderMappedHole();
    await applyImagerySource({ fit: true });
  } else {
    renderPointMarkers();
  }
  if (autoDraftSetupPending && currentHole().markers.white_tee && currentHole().markers.pin) {
    autoDraftSetupPending = false;
    setActiveTool(null);
    autoDraftCurrentHole();
    return;
  }
  if (autoDraftSetupPending && markerKey === "white_tee") {
    setActiveTool("marker_pin");
    $("#active-tool-label").textContent = "Auto-draft 2/2 · click the pin";
    setStatus("Auto-draft setup: now click the pin on the image.", "success");
    return;
  }
  setActiveTool(null);
}

function handleMapClick(event) {
  if (!activeTool) return;
  if (activeTool === "box_select") return;
  if (surfaceBrushActive()) return;
  const position = gpsLiteral(event.latlng);
  if (FEATURE_STYLE[activeTool]) {
    addFeature(activeTool, position);
    return;
  }
  if (activeTool === "measure") {
    handleMeasurementClick(position);
    return;
  }
  void placeSurveyPoint(activeTool, position);
}

function handleMeasurementClick(position) {
  if (!measurementStart) {
    measurementStart = position;
    $("#active-tool-label").textContent = "Measure: click second point";
    return;
  }
  const meters = distanceMeters(measurementStart, position);
  const line = L.polyline([displayGps(measurementStart), displayGps(position)], {
    pane: "surveyPane",
    color: "#d9673f",
    opacity: 1,
    weight: 3
  }).addTo(map);
  measurements.push({ id: `tape-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, start: measurementStart, end: position, meters, line });
  measurementStart = null;
  renderMeasurements();
  setActiveTool(null);
}

function syncFeatureFromOverlay(feature, overlay, { record = true } = {}) {
  if (record) recordUndo(`reshape ${featureName(feature).toLowerCase()}`, `reshape-${feature.id}`);
  markFeatureManual(feature);
  feature.points = overlay.getLatLngs()[0].map(gpsLiteral);
  const teeAlignment = feature.type === "tee_white"
    ? alignSecondaryTeesFromWhite(currentHole())
    : { aligned: [] };
  window.clearTimeout(featureCommitTimer);
  featureCommitTimer = window.setTimeout(() => {
    featureCommitTimer = null;
    persistProject();
    if (teeAlignment.aligned.length) renderMappedHole();
    else {
      renderFeatureList();
      renderSelectedFeature();
      renderGpsCalibration();
    }
  }, 140);
}

function applyFeatureInteraction(overlay, selected) {
  overlay.pm.disableLayerDrag?.();
  overlay.pm.disable();
  if (!selected) return;
  if (selectedFeatureMode === "points") {
    overlay.pm.enable({ allowSelfIntersection: false, snappable: false });
  } else {
    overlay.pm.enableLayerDrag?.();
  }
}

function clearFeatureDragProxies() {
  for (const proxy of featureDragProxies.values()) proxy.remove();
  featureDragProxies = new Map();
}

function setupDirectFeatureDrag(feature, overlay) {
  const selected = selectedFeatureIds.has(feature?.id);
  if (!feature || activeTool || (selected && (selectedFeatureMode !== "points" || selectedFeatureIds.size > 1)) || featureDragProxies.has(feature.id)) return;
  const proxy = L.polygon(overlay.getLatLngs()[0], {
    pane: "featureDragPane",
    color: "transparent",
    opacity: 0,
    weight: 0,
    fillColor: "#000",
    fillOpacity: .001,
    interactive: true
  }).addTo(map);
  proxy.on("click", event => {
    L.DomEvent.stopPropagation(event);
    selectFeature(feature.id, { additive: Boolean(event.originalEvent?.shiftKey) });
  });
  proxy.on("dblclick", event => L.DomEvent.stopPropagation(event));
  proxy.on("pm:dragstart", () => {
    draggingFeatureIds.add(feature.id);
    recordUndo(`move ${featureName(feature).toLowerCase()}`, `move-${feature.id}`);
    if (selectedFeatureId === feature.id) overlay.pm.disable();
    overlay.setStyle({ weight: 4 });
  });
  proxy.on("pm:change", () => overlay.setLatLngs(proxy.getLatLngs()));
  proxy.on("pm:dragend", () => {
    overlay.setLatLngs(proxy.getLatLngs());
    syncFeatureFromOverlay(feature, overlay, { record: false });
    draggingFeatureIds.delete(feature.id);
    proxy.remove();
    featureDragProxies.delete(feature.id);
    selectFeature(feature.id);
    setStatus(`Moved ${featureName(feature)}.`, "success");
  });
  proxy.pm.enableLayerDrag?.();
  window.requestAnimationFrame(() => proxy.getElement()?.classList.add("mapper-feature-drag-proxy"));
  featureDragProxies.set(feature.id, proxy);
}

function selectFeature(featureId, { additive = false } = {}) {
  selectedPlayPoint = null;
  if (!additive) {
    selectedFeatureIds = new Set([featureId]);
  } else if (selectedFeatureIds.has(featureId)) {
    selectedFeatureIds.delete(featureId);
  } else {
    selectedFeatureIds.add(featureId);
  }
  selectedFeatureId = selectedFeatureIds.has(featureId) ? featureId : [...selectedFeatureIds].at(-1) || null;
  selectedFeatureMode = "points";
  refreshFeatureSelection();
  renderPointMarkers();
}

function applyEditorTreeCanopy(overlay) {
  const element = overlay.getElement();
  const svg = element?.ownerSVGElement;
  if (!element || !svg) return;
  const namespace = "http://www.w3.org/2000/svg";
  const patternId = "mapper-tree-canopy-pattern";
  if (!svg.querySelector(`#${patternId}`)) {
    const defs = document.createElementNS(namespace, "defs");
    const pattern = document.createElementNS(namespace, "pattern");
    pattern.setAttribute("id", patternId);
    pattern.setAttribute("patternUnits", "userSpaceOnUse");
    pattern.setAttribute("width", "180");
    pattern.setAttribute("height", "180");
    const image = document.createElementNS(namespace, "image");
    image.setAttribute("href", TREE_CANOPY_ASSET);
    image.setAttribute("width", "180");
    image.setAttribute("height", "180");
    image.setAttribute("preserveAspectRatio", "xMidYMid slice");
    pattern.append(image);
    defs.append(pattern);
    svg.prepend(defs);
  }
  element.classList.add("mapper-tree-canopy");
  element.setAttribute("fill", `url(#${patternId})`);
}

function createFeatureOverlay(feature) {
  const color = FEATURE_COLORS[feature.type] || "#d9673f";
  const pane = feature.type === "cart_path"
    ? "cartPathPane"
    : ["trees", "bunker", "water", "penalty_area_unknown"].includes(feature.type)
    ? "topFeaturePane"
    : ["rough", "hole_outline"].includes(feature.type)
      ? "roughPane"
      : feature.type === "fairway"
        ? "fairwayPane"
        : "featurePane";
  const overlay = L.polygon(feature.points.map(displayGps), {
    pane,
    color: feature.type === "tee_white" ? "#24322a" : color,
    opacity: .95,
    weight: selectedFeatureIds.has(feature.id) ? 4 : 2,
    fillColor: color,
    fillOpacity: ["out_of_bounds", "hole_outline"].includes(feature.type) ? .12 : .48
  }).addTo(map);
  if (feature.type === "trees") applyEditorTreeCanopy(overlay);
  overlay.on("click", event => {
    L.DomEvent.stopPropagation(event);
    if (activeTool) handleMapClick({ latlng: event.latlng });
    else selectFeature(feature.id, { additive: Boolean(event.originalEvent?.shiftKey) });
  });
  overlay.on("dblclick", event => L.DomEvent.stopPropagation(event));
  overlay.on("pm:dragstart", () => {
    draggingFeatureIds.add(feature.id);
    recordUndo(`move ${featureName(feature).toLowerCase()}`, `move-${feature.id}`);
  });
  overlay.on("pm:dragend", () => {
    syncFeatureFromOverlay(feature, overlay, { record: false });
    draggingFeatureIds.delete(feature.id);
    setStatus(`Moved ${featureName(feature)}.`, "success");
  });
  ["pm:change", "pm:vertexadded", "pm:vertexremoved"].forEach(eventName => {
    overlay.on(eventName, () => {
      featureDragProxies.get(feature.id)?.setLatLngs(overlay.getLatLngs());
      syncFeatureFromOverlay(feature, overlay, {
        record: !draggingFeatureIds.has(feature.id)
      });
    });
  });
  if (selectedFeatureIds.has(feature.id)) {
    applyFeatureInteraction(overlay, selectedFeatureIds.size === 1);
    window.requestAnimationFrame(() => overlay.getElement()?.classList.add("mapper-feature-selected"));
  }
  featureOverlays.set(feature.id, overlay);
  setupDirectFeatureDrag(feature, overlay);
}

function clearFeatureOverlays() {
  clearFeatureDragProxies();
  for (const overlay of featureOverlays.values()) overlay.remove();
  featureOverlays = new Map();
  draggingFeatureIds.clear();
}

function renderMappedHole() {
  clearFeatureOverlays();
  currentHole().features.forEach(createFeatureOverlay);
  renderPointMarkers();
  renderFeatureList();
  renderSelectedFeature();
  renderGpsCalibration();
}

function gpsLiteral(position) {
  const literal = rawGpsLiteral(position);
  return literal && editorViewTransform()?.fromView(literal) || literal;
}

function createPointMarker(position, { title, label, kind, pointId, onMove }) {
  const isSelected = selectedPlayPoint?.id === pointId;
  const icon = L.divIcon({
    className: "mapper-marker-host",
    html: `<div class="mapper-point ${kind} ${isSelected ? "selected" : ""}"><span>${escapeHtml(label)}</span></div>`,
    iconSize: [25, 25],
    iconAnchor: [4, 22]
  });
  const marker = L.marker(displayGps(position), {
    title,
    icon,
    draggable: true,
    pane: "markerPane"
  }).addTo(map);
  marker.on("click", event => {
    L.DomEvent.stopPropagation(event);
    if (activeTool) {
      handleMapClick({ latlng: event.latlng });
      return;
    }
    selectedFeatureId = null;
    selectedFeatureIds.clear();
    selectedPlayPoint = { id: pointId, title };
    refreshFeatureSelection();
    renderPointMarkers();
    setStatus(`${title} selected. Press Delete or Backspace to remove it.`, "success");
  });
  marker.on("dragend", () => {
    recordUndo(`move ${title.toLowerCase()}`);
    const rerender = onMove(gpsLiteral(marker.getLatLng()));
    persistProject();
    if (rerender) {
      renderMappedHole();
      void applyImagerySource({ fit: true });
    }
    else {
      renderRouteLine();
      renderGpsCalibration();
    }
  });
  pointMarkers.push(marker);
}

function renderPointMarkers() {
  if (!map) return;
  pointMarkers.forEach(marker => marker.remove());
  pointMarkers = [];
  const markerDefinitions = [
    ["blue_tee", "Blue tee", "B", "tee"],
    ["white_tee", "White tee / starting ball", "W", "tee"],
    ["forward_tee", "Forward tee", "F", "tee"],
    ["pin", "Pin", "P", "pin"]
  ];
  markerDefinitions.forEach(([key, title, label, kind]) => {
    const position = currentHole().markers[key];
    if (!position) return;
    createPointMarker(position, {
      title,
      label,
      kind,
      pointId: `marker:${key}`,
      onMove: next => {
        currentHole().markers[key] = next;
        if (key === "white_tee" || key === "pin") {
          alignSecondaryTeesFromWhite(currentHole());
          return true;
        }
        return false;
      }
    });
  });
  currentHole().route_points.forEach((position, index) => {
    createPointMarker(position, {
      title: `Route control ${index + 1}`,
      label: String(index + 1),
      kind: "route",
      pointId: `route:${index}`,
      onMove: next => {
        currentHole().route_points[index] = next;
        return index === 0;
      }
    });
  });
  renderRouteLine();
}

function deleteSelectedPlayPoint() {
  if (!selectedPlayPoint) return false;
  const hole = currentHole();
  const { id, title } = selectedPlayPoint;
  recordUndo(`delete ${title.toLowerCase()}`);
  if (id.startsWith("marker:")) {
    const key = id.slice("marker:".length);
    if (!Object.hasOwn(hole.markers, key) || !hole.markers[key]) return false;
    hole.markers[key] = null;
  } else if (id.startsWith("route:")) {
    const index = Number(id.slice("route:".length));
    if (!Number.isInteger(index) || !hole.route_points[index]) return false;
    hole.route_points.splice(index, 1);
  } else {
    return false;
  }
  selectedPlayPoint = null;
  persistProject();
  renderMappedHole();
  setStatus(`Deleted ${title}. Use Undo to restore it.`, "success");
  return true;
}

function renderRouteLine() {
  if (routeLine) routeLine.remove();
  routeLine = null;
  const hole = currentHole();
  if (!hole.markers.white_tee || !hole.markers.pin) return;
  routeLine = L.polyline([hole.markers.white_tee, ...hole.route_points, hole.markers.pin].map(displayGps), {
    pane: "surveyPane",
    color: "#f3f0e5",
    opacity: .92,
    weight: 3,
    dashArray: "9 7"
  }).addTo(map);
}

function renderFeatureList() {
  const features = currentHole().features;
  $("#feature-count").textContent = String(features.length);
  $("#clear-field-shapes").disabled = features.length === 0;
  $("#feature-list").innerHTML = features.length
    ? features.map(feature => `
      <button class="feature-row ${selectedFeatureIds.has(feature.id) ? "active" : ""}" type="button" data-feature-id="${feature.id}" style="--feature-color:${FEATURE_COLORS[feature.type] || "#d9673f"}">
        <i></i><span>${escapeHtml(featureName(feature))}</span><small>${feature.points.length} pts</small>
      </button>
    `).join("")
    : `<p class="empty-copy">No shapes on this hole yet.</p>`;
  $$("[data-feature-id]").forEach(button => {
    button.addEventListener("click", event => selectFeature(button.dataset.featureId, { additive: event.shiftKey }));
  });
}

function selectedFeature() {
  return currentHole().features.find(feature => feature.id === selectedFeatureId) || null;
}

function selectedFeatures() {
  return currentHole().features.filter(feature => selectedFeatureIds.has(feature.id));
}

function markFeatureManual(feature) {
  if (!feature) return;
  feature.manual_override = true;
  feature.last_manual_edit_at = new Date().toISOString();
}

function deleteSelectedFeatures() {
  const features = selectedFeatures();
  if (!features.length) {
    const feature = selectedFeature();
    if (feature) features.push(feature);
  }
  if (!features.length) return false;
  const ids = new Set(features.map(feature => feature.id));
  const description = features.length === 1
    ? featureName(features[0]).toLowerCase()
    : `${features.length} selected shapes`;
  recordUndo(`delete ${description}`);
  currentHole().features = currentHole().features.filter(feature => !ids.has(feature.id));
  if (ids.has(currentHole().gps_control_points?.bunker_feature_id)) {
    currentHole().gps_control_points.bunker_feature_id = null;
  }
  selectedFeatureId = null;
  selectedFeatureIds.clear();
  persistProject();
  renderMappedHole();
  setStatus(`Deleted ${description}. Use Undo to restore ${features.length === 1 ? "it" : "them"}.`, "success");
  return true;
}

function duplicateSelectedFeature() {
  const feature = selectedFeature();
  if (!feature) return false;
  recordUndo(`duplicate ${featureName(feature).toLowerCase()}`);
  const duplicate = structuredClone(feature);
  duplicate.id = `${feature.type}-${Date.now()}-copy`;
  duplicate.label = `${featureName(feature)} copy`;
  duplicate.source = "manual_copy";
  duplicate.manual_override = true;
  duplicate.last_manual_edit_at = new Date().toISOString();
  duplicate.points = duplicate.points.map(point => offsetGpsPoint(point, 4, 4));
  currentHole().features.push(duplicate);
  selectedFeatureId = duplicate.id;
  selectedFeatureIds = new Set([duplicate.id]);
  persistProject();
  renderMappedHole();
  setStatus(`Duplicated ${featureName(feature).toLowerCase()}.`, "success");
  return true;
}

function polygonBounds(polygon) {
  return polygon.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point[0]),
    minY: Math.min(bounds.minY, point[1]),
    maxX: Math.max(bounds.maxX, point[0]),
    maxY: Math.max(bounds.maxY, point[1])
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function boundsOverlap(first, second) {
  return first.minX <= second.maxX && first.maxX >= second.minX &&
    first.minY <= second.maxY && first.maxY >= second.minY;
}

function polygonOverlapGroups(polygons) {
  const bounds = polygons.map(polygonBounds);
  const visited = new Set();
  const groups = [];
  polygons.forEach((polygon, start) => {
    if (visited.has(start)) return;
    const indexes = [];
    const pending = [start];
    visited.add(start);
    while (pending.length) {
      const index = pending.pop();
      indexes.push(index);
      polygons.forEach((candidate, candidateIndex) => {
        if (visited.has(candidateIndex) || !boundsOverlap(bounds[index], bounds[candidateIndex])) return;
        visited.add(candidateIndex);
        pending.push(candidateIndex);
      });
    }
    groups.push(indexes.map(index => polygons[index]));
  });
  return groups;
}

async function mergeSelectedFeatures() {
  const features = selectedFeatures();
  if (features.length < 2) return;
  const types = new Set(features.map(feature => feature.type));
  if (types.size !== 1) {
    setStatus("Select shapes of the same type before making one cluster.", "error");
    return;
  }
  const type = features[0].type;
  const origin = features[0].points[0];
  const localPolygons = features.map(feature => feature.points.map(point => {
    const local = gpsDeltaMeters(origin, point);
    return [local.east, local.north];
  }));
  const mergeButton = $("#merge-features");
  mergeButton.disabled = true;
  const mergeTypeLabel = type === "trees" ? "tree" : type.replaceAll("_", " ");
  setStatus(`Combining ${features.length} ${mergeTypeLabel} shapes…`, "neutral");
  await new Promise(resolve => window.requestAnimationFrame(resolve));
  let union;
  try {
    if (type === "trees") {
      union = polygonOverlapGroups(localPolygons).flatMap(group => {
        if (group.length === 1) return group;
        try {
          return unionSimplePolygons(group);
        } catch (error) {
          console.warn("A tree overlap could not be simplified; preserving its original contours.", error);
          return group;
        }
      });
    } else {
      union = unionSimplePolygons(localPolygons);
    }
  } catch (error) {
    mergeButton.disabled = false;
    setStatus(`Those shapes could not be combined: ${error.message}.`, "error");
    return;
  }
  if (!union.length) {
    mergeButton.disabled = false;
    setStatus("Those shapes could not be combined. Their original shapes were left unchanged.", "error");
    return;
  }
  if (union.length !== 1 && type !== "trees") {
    mergeButton.disabled = false;
    setStatus("The selected shapes must touch or overlap before they can become one editable cluster.", "error");
    return;
  }
  const polygons = union
    .map(loop => loop.map(point => offsetGpsPoint(origin, point[0], point[1])))
    .filter(points => points.length >= 3);
  if (!polygons.length) {
    mergeButton.disabled = false;
    return;
  }
  recordUndo(`merge ${features.length} ${featureName(features[0]).toLowerCase()} shapes`);
  const clusterGroup = `${type}-cluster-${Date.now()}`;
  const baseLabel = `${featureName(features[0]).replace(/\s+\d+$/, "")} cluster`;
  const merged = polygons.map((points, index) => ({
    id: `${clusterGroup}-${index + 1}`,
    type,
    label: polygons.length === 1 ? baseLabel : `${baseLabel} ${index + 1}`,
    source: "manual_cluster",
    cluster_group: clusterGroup,
    points
  }));
  const ids = new Set(features.map(feature => feature.id));
  currentHole().features = currentHole().features.filter(feature => !ids.has(feature.id));
  currentHole().features.push(...merged);
  if (type === "bunker" && ids.has(currentHole().gps_control_points?.bunker_feature_id)) {
    currentHole().gps_control_points.bunker_feature_id = merged[0].id;
  }
  selectedFeatureIds = new Set(merged.map(feature => feature.id));
  selectedFeatureId = merged.at(-1).id;
  persistProject();
  renderMappedHole();
  setStatus(polygons.length === 1
    ? `Combined ${features.length} ${type.replaceAll("_", " ")} shapes into one editable cluster.`
    : `Combined ${features.length} tree shapes into one cluster with ${polygons.length} separate contours. Overlaps were removed.`, "success");
}

function rotateSelectedFeature(degrees) {
  const feature = selectedFeature();
  if (!feature) return;
  recordUndo(`rotate ${featureName(feature).toLowerCase()}`);
  markFeatureManual(feature);
  feature.points = rotateGpsPolygon(feature.points, degrees);
  persistProject();
  renderMappedHole();
  setStatus(`Rotated ${featureName(feature)} ${Math.abs(degrees)}° ${degrees > 0 ? "left" : "right"}.`, "success");
}

function scaleSelectedFeature(scale) {
  const feature = selectedFeature();
  if (!feature) return;
  const direction = scale > 1 ? "enlarge" : "shrink";
  recordUndo(`${direction} ${featureName(feature).toLowerCase()}`);
  markFeatureManual(feature);
  feature.points = scaleGpsPolygon(feature.points, scale);
  persistProject();
  renderMappedHole();
  setStatus(`${featureName(feature)} is ${scale > 1 ? "5% larger" : "5% smaller"}.`, "success");
}

async function rotateHoleArtwork(degrees) {
  const holeKey = String(currentHoleNumber);
  if (!project.reference_images?.[holeKey]) {
    setStatus("Choose a hole image before rotating it.", "error");
    return;
  }
  recordUndo(`rotate Hole ${currentHoleNumber} artwork`);
  project.reference_image_rotation ||= {};
  project.reference_image_rotation[holeKey] = artworkRotation(holeKey) + degrees;
  if (project.reference_image_bounds?.[holeKey]) {
    project.reference_image_bounds[holeKey] = quarterTurnGpsBounds(project.reference_image_bounds[holeKey]);
  }
  persistProject();
  await applyImagerySource({ fit: true });
  setStatus(`Hole ${currentHoleNumber} artwork rotated ${degrees > 0 ? "right" : "left"} 90°.`, "success");
}

function renderSelectedFeature() {
  const features = selectedFeatures();
  const feature = selectedFeature();
  $("#selected-empty").hidden = Boolean(feature);
  $("#selected-controls").hidden = !feature;
  const multiple = features.length > 1;
  const clusterGroups = new Set(features.map(item => item.cluster_group).filter(Boolean));
  const groupedCluster = multiple && clusterGroups.size === 1 && features.every(item => item.cluster_group === [...clusterGroups][0]);
  $("#selected-controls").classList.toggle("multi-selection", multiple);
  $("#cluster-actions").hidden = !multiple || groupedCluster;
  $("#selected-name").textContent = groupedCluster
    ? `Tree cluster · ${features.length} contours`
    : multiple ? `${features.length} shapes selected` : feature ? featureName(feature) : "Nothing selected";
  if (!feature) return;
  if (multiple) {
    if (groupedCluster) {
      $("#feature-edit-help").textContent = "This cluster keeps separate tree contours while removing overlaps.";
      return;
    }
    const sameType = new Set(features.map(item => item.type)).size === 1;
    $("#merge-features").disabled = !sameType;
    $("#cluster-help").textContent = sameType
      ? `Shift-click to add or remove shapes. These ${features.length} shapes will become one editable cluster.`
      : "Choose shapes of the same type—for example, trees with trees.";
    return;
  }
  $("#feature-label").value = feature.label || "";
  $("#feature-type").value = feature.type;
  $("#feature-points").textContent = String(feature.points.length);
  const area = gpsPolygonAreaMeters(feature.points);
  $("#feature-area").textContent = `${Math.round(area)} m²`;
  $("#move-feature-mode").classList.toggle("active", selectedFeatureMode === "move");
  $("#edit-feature-points-mode").classList.toggle("active", selectedFeatureMode === "points");
  $("#feature-edit-help").textContent = selectedFeatureMode === "move"
    ? "Drag anywhere inside the shape to move the whole shape."
    : "Shift-click adds another shape. Drag a solid point to reshape, or a faint midpoint to add another point.";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function renderMeasurements() {
  const localCalibrationAvailable = currentImageryMode() === "local";
  const knownWhiteYards = Number(currentHole().yardages.white) || "";
  $("#measurement-list").innerHTML = measurements.length
    ? measurements.map((measurement, index) => `
      <article class="measurement-item">
        <div class="measurement-summary"><span>Tape ${index + 1}</span><strong>${Math.round(measurement.meters * YARDS_PER_METER)} yd · ${Math.round(measurement.meters)} m</strong></div>
        ${localCalibrationAvailable ? `<form class="measurement-calibration" data-calibrate-measurement="${measurement.id}">
          <label>White tee → pin yardage<input name="known-yards" type="number" min="30" max="800" step="1" value="${knownWhiteYards}" required /></label>
          <button type="submit">Set scale</button>
          <small>Rescales this local image and places Blue and Forward from the scorecard.</small>
        </form>` : ""}
      </article>
    `).join("")
    : `<p class="empty-copy">${localCalibrationAvailable
      ? "Measure the white tee to the pin, then enter its scorecard yardage to set the image scale."
      : "Choose “Measure two points,” then click both ends on the map."}</p>`;
}

function scaleCurrentHoleGeometry(origin, scale) {
  const hole = currentHole();
  Object.keys(hole.markers).forEach(key => {
    if (hole.markers[key]) hole.markers[key] = scaleGpsPointAround(origin, hole.markers[key], scale);
  });
  hole.route_points = hole.route_points.map(point => scaleGpsPointAround(origin, point, scale));
  hole.features.forEach(feature => {
    feature.points = feature.points.map(point => scaleGpsPointAround(origin, point, scale));
  });
  const bounds = project.reference_image_bounds?.[String(currentHoleNumber)];
  if (bounds) {
    bounds.southWest = scaleGpsPointAround(origin, bounds.southWest, scale);
    bounds.northEast = scaleGpsPointAround(origin, bounds.northEast, scale);
  }
}

async function calibrateLocalImage(measurementId, knownYards) {
  if (currentImageryMode() !== "local") {
    setStatus("Yardage calibration requires a local hole image.", "error");
    return;
  }
  const measurement = measurements.find(candidate => candidate.id === measurementId);
  const targetYards = Number(knownYards);
  if (!measurement || measurement.meters < 1) {
    setStatus("Measure two distinct points before setting the image scale.", "error");
    return;
  }
  if (!Number.isFinite(targetYards) || targetYards < 30 || targetYards > 800) {
    setStatus("Enter a white tee-to-pin yardage from 30 to 800 yards.", "error");
    return;
  }
  const measuredYards = measurement.meters * YARDS_PER_METER;
  const scale = targetYards / measuredYards;
  if (scale < .2 || scale > 5) {
    setStatus("That calibration changes the image scale too much. Remeasure the white tee and pin more precisely.", "error");
    return;
  }
  recordUndo(`calibrate Hole ${currentHoleNumber} image scale`);
  scaleCurrentHoleGeometry(measurement.start, scale);
  const hole = currentHole();
  hole.yardages.white = Math.round(targetYards);
  const teeAlignment = alignSecondaryTeesFromWhite(hole);
  hole.local_image_calibration = {
    white_tee_to_pin_yards: hole.yardages.white,
    measured_before_yards: Math.round(measuredYards * 10) / 10,
    scale_factor: Math.round(scale * 10000) / 10000,
    calibrated_at: new Date().toISOString()
  };
  clearMeasurements();
  persistProject();
  renderHoleForm();
  await applyImagerySource({ fit: true });
  const teeSummary = teeAlignment.aligned.length
    ? ` Aligned ${teeAlignment.aligned.join(" and ")} tee boxes from the scorecard.`
    : " Add the White tee box and marker to generate the other tees.";
  setStatus(`Local image calibrated to ${hole.yardages.white} yd from white tee to pin.${teeSummary}`, "success");
}

function clearMeasurements() {
  measurements.forEach(measurement => measurement.line.remove());
  measurements = [];
  measurementStart = null;
  renderMeasurements();
}

function fitMappedHole() {
  if (!map) return;
  const hole = currentHole();
  if (hole.markers.white_tee && hole.markers.pin) {
    const size = map.getSize();
    const verticalPadding = Math.max(12, Math.round(size.y * (1 - EDITOR_ROUTE_HEIGHT_RATIO) / 2));
    const horizontalPadding = Math.max(12, Math.round(size.x * .04));
    map.fitBounds(
      L.latLngBounds([
        hole.markers.white_tee,
        ...hole.route_points,
        hole.markers.pin
      ].map(displayGps)),
      {
        paddingTopLeft: [horizontalPadding, verticalPadding],
        paddingBottomRight: [horizontalPadding, verticalPadding],
        maxZoom: EDITOR_MAX_ZOOM,
        animate: false
      }
    );
    return;
  }
  const imageBounds = literalImageBounds(project.reference_image_bounds?.[String(currentHoleNumber)]);
  if (imageBounds) {
    map.fitBounds(imageBounds, { padding: [12, 12], maxZoom: EDITOR_MAX_ZOOM, animate: false });
    return;
  }
  const points = [];
  currentHole().features.forEach(feature => points.push(...feature.points));
  Object.values(currentHole().markers).forEach(point => { if (point) points.push(point); });
  points.push(...currentHole().route_points);
  if (!points.length) {
    setStatus("Place a marker or shape before fitting the hole.", "error");
    return;
  }
  map.fitBounds(L.latLngBounds(points.map(displayGps)), { padding: [60, 60], maxZoom: EDITOR_MAX_ZOOM });
}

async function artworkScanFrame(maxDimension = 720) {
  const holeKey = String(currentHoleNumber);
  const source = project.reference_images?.[holeKey];
  const storedBounds = project.reference_image_bounds?.[holeKey];
  if (!source || !storedBounds) throw new Error("choose local hole artwork before using guided scan");
  const displaySource = await renderedArtworkDataUrl(source, artworkRotation(holeKey), maxDimension, .84);
  const image = await loadCrossOriginImage(displaySource, "The hole image could not be scanned");
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  canvas.width = 1;
  canvas.height = 1;
  const { southWest, northEast } = storedBounds;
  return {
    data: pixels,
    width,
    height,
    gpsToPixel: point => ({
      x: (point.lng - southWest.lng) / (northEast.lng - southWest.lng) * (width - 1),
      y: (northEast.lat - point.lat) / (northEast.lat - southWest.lat) * (height - 1)
    }),
    pixelToGps: point => ({
      lat: northEast.lat - point.y / Math.max(1, height - 1) * (northEast.lat - southWest.lat),
      lng: southWest.lng + point.x / Math.max(1, width - 1) * (northEast.lng - southWest.lng)
    })
  };
}

async function detectTreesFromCurrentArtwork(hole) {
  const holeKey = String(currentHoleNumber);
  if (!project.reference_images?.[holeKey] || !project.reference_image_bounds?.[holeKey]) return [];
  const frame = await artworkScanFrame(360);
  const regions = detectTreeRegions({
    data: frame.data,
    width: frame.width,
    height: frame.height,
    minimumPixels: Math.max(22, Math.round(frame.width * frame.height * .0012))
  }).slice(0, 8);
  return regions.map((region, index) => ({
    id: `auto-trees-${Date.now()}-${index + 1}`,
    type: "trees",
    label: `Auto-draft trees ${index + 1}`,
    source: "auto_draft",
    confidence: Number(region.confidence.toFixed(2)),
    points: roundedGpsBounds(region.points.map(frame.pixelToGps), .22)
  })).filter(feature => feature.points.length >= 3);
}

function featureCenter(feature) {
  if (!feature?.points?.length) return null;
  return feature.points.reduce((center, point) => ({
    lat: center.lat + point.lat / feature.points.length,
    lng: center.lng + point.lng / feature.points.length
  }), { lat: 0, lng: 0 });
}

function treeDetectionRoute(hole) {
  const green = hole.features.find(feature => feature.type === "green");
  const greenCenter = featureCenter(green) || hole.markers.pin;
  return [hole.markers.white_tee, ...hole.route_points, greenCenter].filter(Boolean);
}

function corridorRadiusPixels(frame, route, corridorYards) {
  const middle = route[Math.floor(route.length / 2)];
  const meters = corridorYards / YARDS_PER_METER;
  const center = frame.gpsToPixel(middle);
  const east = frame.gpsToPixel(offsetGpsPoint(middle, meters, 0));
  const north = frame.gpsToPixel(offsetGpsPoint(middle, 0, meters));
  const eastPixels = Math.hypot(east.x - center.x, east.y - center.y);
  const northPixels = Math.hypot(north.x - center.x, north.y - center.y);
  return Math.max(2, (eastPixels + northPixels) / 2);
}

function fitTreeOutsideProtected(feature, protectedPolygons) {
  if (!protectedPolygons.some(polygon => polygonsOverlap(feature.points, polygon))) return feature;
  for (let scale = .94; scale >= .34; scale -= .06) {
    const points = scaleGpsPolygon(feature.points, scale);
    if (!protectedPolygons.some(polygon => polygonsOverlap(points, polygon))) {
      return { ...feature, points, clipped_from_playing_surface: true };
    }
  }
  return null;
}

async function autoCreateTreeClusters() {
  if (!map) {
    setStatus("Wait for the map to load before creating trees.", "error");
    return;
  }
  saveHoleForm();
  const hole = currentHole();
  const holeKey = String(currentHoleNumber);
  if (!project.reference_images?.[holeKey] || !project.reference_image_bounds?.[holeKey]) {
    setStatus("Choose a local hole image before automatically creating trees.", "error");
    return;
  }
  const route = treeDetectionRoute(hole);
  if (route.length < 2) {
    setStatus("Mark the white tee and add a green before automatically creating trees.", "error");
    return;
  }
  const automaticSources = new Set(["auto_draft", "auto_tree_corridor"]);
  const priorAutomatic = hole.features.filter(feature => feature.type === "trees" && automaticSources.has(feature.source));
  if (priorAutomatic.length && !window.confirm(
    `Replace ${priorAutomatic.length} previously generated tree cluster${priorAutomatic.length === 1 ? "" : "s"} on Hole ${currentHoleNumber}? Manually added trees will remain.`
  )) return;
  const button = $("#auto-create-trees");
  button.disabled = true;
  try {
    setStatus(`Scanning Hole ${currentHoleNumber} for tree clusters within 50 yards of the playing route…`);
    const frame = await artworkScanFrame(1080);
    const pixelRoute = route.map(frame.gpsToPixel);
    const touchMask = buildCorridorMask(
      frame.width,
      frame.height,
      pixelRoute,
      corridorRadiusPixels(frame, route, 50)
    );
    const protectedFeatures = hole.features.filter(feature =>
      ["green", "fairway", "tee_blue", "tee_white", "tee_forward", "bunker", "water", "cart_path"].includes(feature.type)
    );
    const rejectMask = buildPolygonMask(
      frame.width,
      frame.height,
      protectedFeatures.map(feature => feature.points.map(frame.gpsToPixel))
    );
    const treeAllowedMask = Uint8Array.from(rejectMask, value => value ? 0 : 1);
    const regions = detectTreeRegions({
      data: frame.data,
      width: frame.width,
      height: frame.height,
      allowedMask: treeAllowedMask,
      touchMask,
      minimumPixels: 8
    }).slice(0, 200);
    const stamp = Date.now();
    const detectedCandidates = regions.map((region, index) => {
      const contour = region.points.map(frame.pixelToGps);
      return {
        id: `auto-tree-corridor-${stamp}-${index + 1}`,
        type: "trees",
        label: `Auto tree cluster ${index + 1}`,
        source: "auto_tree_corridor",
        detection_corridor_yards: 50,
        confidence: Number(region.confidence.toFixed(2)),
        points: resampleGpsPolygon(contour, 16)
      };
    }).filter(feature => feature.points.length >= 3);
    const protectedPolygons = protectedFeatures.map(feature => feature.points);
    const detected = detectedCandidates
      .map(feature => fitTreeOutsideProtected(feature, protectedPolygons))
      .filter(Boolean);
    const clippedCount = detected.filter(feature => feature.clipped_from_playing_surface).length;
    const rejectedCount = detectedCandidates.length - detected.length;
    recordUndo(`auto-create Hole ${currentHoleNumber} trees`);
    hole.features = hole.features.filter(feature =>
      feature.type !== "trees" || !automaticSources.has(feature.source)
    );
    hole.features.push(...detected);
    selectedFeatureIds = new Set(detected.map(feature => feature.id));
    selectedFeatureId = detected.at(-1)?.id || null;
    persistProject();
    renderMappedHole();
    setStatus(detected.length
      ? `Created ${detected.length} editable tree cluster${detected.length === 1 ? "" : "s"} touching the 50-yard playing corridor. ${clippedCount ? `Trimmed ${clippedCount} edge cluster${clippedCount === 1 ? "" : "s"} to keep playing surfaces clear. ` : ""}${rejectedCount ? `Rejected ${rejectedCount} candidate${rejectedCount === 1 ? "" : "s"} that could not be separated from fairway, green, tee, bunker, or water. ` : ""}Manual trees were preserved.`
      : "No confident tree clusters touched the 50-yard playing corridor. Try Scan trees here for areas the automatic scan missed.",
    detected.length ? "success" : "error");
  } catch (error) {
    setStatus(`Trees could not be created automatically: ${error.message}.`, "error");
  } finally {
    button.disabled = false;
  }
}

async function autoDraftCurrentHole() {
  if (!map) {
    setStatus("Wait for the map to load before drafting a hole.", "error");
    return;
  }
  saveHoleForm();
  const hole = currentHole();
  if (!hole.markers.white_tee) {
    autoDraftSetupPending = true;
    setActiveTool("marker_white_tee");
    $("#active-tool-label").textContent = hole.markers.pin
      ? "Auto-draft · click the white tee"
      : "Auto-draft 1/2 · click the white tee";
    setStatus("Auto-draft setup: click the white tee on the image.", "success");
    return;
  }
  if (!hole.markers.pin) {
    autoDraftSetupPending = true;
    setActiveTool("marker_pin");
    $("#active-tool-label").textContent = "Auto-draft 2/2 · click the pin";
    setStatus("Auto-draft setup: click the pin on the image.", "success");
    return;
  }
  autoDraftSetupPending = false;
  const hasPriorDraft = hole.features.some(feature => feature.source === "auto_draft");
  if (hasPriorDraft && !window.confirm("Redraft this hole? Existing auto-drafted shapes will be replaced; hand-drawn shapes will remain.")) return;
  try {
    const draft = buildAutoDraft(hole);
    setStatus("Auto-drafting playing surfaces…");
    recordUndo(`auto-draft Hole ${currentHoleNumber}`);
    hole.markers = draft.markers;
    hole.features = draft.features;
    selectedFeatureId = null;
    selectedFeatureIds.clear();
    persistProject();
    renderMappedHole();
    fitMappedHole();
    const skipped = draft.skippedTypes.length
      ? ` Kept your hand-drawn ${draft.skippedTypes.join(", ")} instead.`
      : "";
    setStatus(`Auto-drafted ${draft.generatedCount} editable playing shapes.${skipped}`, "success");
  } catch (error) {
    setStatus(`Could not auto-draft: ${error.message}.`, "error");
  }
}

function loadCrossOriginImage(url, failureMessage = "The hole artwork could not be opened") {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => reject(new Error(`${failureMessage} (timed out)`)), 30000);
    image.crossOrigin = "anonymous";
    image.onload = () => {
      window.clearTimeout(timeout);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error(failureMessage));
    };
    image.src = url;
  });
}

function initializeMap() {
  if (!globalThis.L) throw new Error("The Leaflet map library could not load.");
  const initialCenter = displayGps(project.map_view?.center || { lat: 40.5206, lng: -74.4143 });
  map = L.map("map", {
    zoomControl: true,
    // Geoman's polygon edit and layer-drag handles require an interactive SVG
    // path. Canvas draws the shape, but leaves no draggable path in the DOM.
    preferCanvas: false,
    doubleClickZoom: false,
    zoomSnap: .01,
    zoomDelta: .25,
    maxZoom: EDITOR_MAX_ZOOM,
    minZoom: 3
  }).setView(initialCenter, Math.min(project.map_view?.zoom || 17, EDITOR_MAX_ZOOM));
  map.doubleClickZoom.disable();
  map.getContainer().addEventListener("dblclick", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  [
    ["cartPathPane", 425],
    ["roughPane", 410],
    ["fairwayPane", 420],
    ["featurePane", 430],
    ["topFeaturePane", 440],
    ["surveyPane", 450],
    ["featureDragPane", 455]
  ].forEach(([name, zIndex]) => {
    map.createPane(name);
    map.getPane(name).style.zIndex = String(zIndex);
  });
  L.control.scale({ metric: true, imperial: true, maxWidth: 130 }).addTo(map);
  map.pm.setGlobalOptions({ markerStyle: { draggable: true }, snappable: false });
  map.on("click", handleMapClick);
  map.on("mousedown", beginBoxSelection);
  map.on("mousedown", beginSurfaceBrush);
  map.on("mousemove", updateBoxSelection);
  map.on("mousemove", updateSurfaceBrush);
  map.on("mouseup", finishBoxSelection);
  map.on("mouseup", finishSurfaceBrush);
  map.on("moveend", persistProject);
  if (globalThis.ResizeObserver) {
    const observer = new ResizeObserver(() => {
      if (mapResizeFrame !== null) cancelAnimationFrame(mapResizeFrame);
      mapResizeFrame = requestAnimationFrame(() => {
        mapResizeFrame = null;
        map.invalidateSize({ animate: false });
        fitMappedHole();
      });
    });
    observer.observe(map.getContainer());
  }
  project.imagery_source = "User-selected local hole images";
  renderMappedHole();
  setStatus("Choose a hole image, then align the calculation shapes and play points.", "success");
}

function selectedScorecardHoleCount() {
  return Number($('[name="scorecard-hole-count"]:checked')?.value) === 9 ? 9 : 18;
}

function scorecardNineDestinations() {
  if (project.course_structure === MAPPER_COURSE_STRUCTURES.THREE_NINES) {
    return projectNineLoops().map(loop => ({ value: loop.start - 1, label: `${loop.name} nine` }));
  }
  return [
    { value: 0, label: "Front nine · Holes 1–9" },
    { value: 9, label: "Back nine · Holes 10–18" }
  ];
}

function selectedScorecardTargetStart() {
  return selectedScorecardHoleCount() === 9 ? Number($("#scorecard-nine-target").value) || 0 : 0;
}

function updateScorecardImportChoice() {
  const holeCount = selectedScorecardHoleCount();
  const destination = $("#scorecard-nine-destination");
  const target = $("#scorecard-nine-target");
  const priorTarget = target.value;
  target.innerHTML = scorecardNineDestinations()
    .map(option => `<option value="${option.value}">${option.label}</option>`)
    .join("");
  const validPriorTarget = [...target.options].some(option => option.value === priorTarget);
  if (validPriorTarget) target.value = priorTarget;
  else if (project.course_structure === MAPPER_COURSE_STRUCTURES.THREE_NINES) {
    const currentLoop = projectNineLoops().find(loop => currentHoleNumber >= loop.start && currentHoleNumber <= loop.end);
    target.value = String((currentLoop?.start || 1) - 1);
  }
  destination.hidden = holeCount !== 9;
  $('[name="scorecard-hole-count"][value="9"] + span small').textContent =
    project.course_structure === MAPPER_COURSE_STRUCTURES.THREE_NINES
      ? `Choose ${projectNineLoops().map(loop => loop.name).join(", ")}`
      : "Fill one nine";
  $('[name="scorecard-hole-count"][value="18"] + span small').textContent =
    project.course_structure === MAPPER_COURSE_STRUCTURES.THREE_NINES
      ? `Fill ${projectNineLoops().slice(0, 2).map(loop => loop.name).join(" + ")}`
      : "Fill Holes 1–18";
  $("#scorecard-import-eyebrow").textContent = `${holeCount}-hole setup`;
  $("#scorecard-import-title").textContent = holeCount === 9
    ? "Paste one nine-hole scorecard"
    : "Paste the scorecard once";
  $("#scorecard-import-copy").textContent = holeCount === 9
    ? "Paste one nine-hole CSV, spreadsheet selection, HTML table, or copied scorecard. The other nines stay unchanged."
    : project.course_structure === MAPPER_COURSE_STRUCTURES.THREE_NINES
      ? `Paste an 18-hole card into ${projectNineLoops().slice(0, 2).map(loop => loop.name).join(" + ")}. ${projectNineLoops()[2].name} stays unchanged.`
      : "Paste CSV, a spreadsheet selection, an HTML table snippet, or a copied scorecard with holes across the top.";
  $("#scorecard-paste").placeholder = [
    "Hole,Par,Handicap,Blue_Yards,White_Yards,Red_Yards",
    "1,4,7,410,395,340",
    "2,3,15,180,165,140",
    `…all ${holeCount} holes`
  ].join("\n");
  $("#import-scorecard").textContent = `Fill all ${holeCount} holes`;
  $("#scorecard-import-status").textContent = "";
}

function bindEvents() {
  renderHoleSwitcherOptions();
  syncNineLoopNameFields();
  $("#course-name").value = project.course_name;
  $("#course-structure").value = project.course_structure;
  $("#open-course-import").addEventListener("click", () => {
    resetCourseImportSelection();
    $("#course-import-results").innerHTML = "";
    $("#course-import-dialog").showModal();
    void loadCourseImportServerStatus();
    window.setTimeout(() => $("#course-import-query").focus(), 0);
  });
  $("#course-import-shell").addEventListener("submit", event => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    void searchExternalCourses();
  });
  $("#search-external-course").addEventListener("click", () => void searchExternalCourses());
  $("#course-import-paid-toggle").addEventListener("change", async event => {
    const toggle = event.currentTarget;
    const desired = toggle.checked;
    toggle.disabled = true;
    try {
      const status = await courseImportRequest("/api/v1/course-import/golf-intelligence/paid-calls", { allowed: desired });
      renderCourseImportServerStatus(status);
      setCourseImportStatus(desired
        ? "Paid calls are allowed. No credits have been used."
        : "Paid calls are OFF.", "success");
    } catch (error) {
      toggle.checked = !desired;
      setCourseImportStatus(error.message);
    } finally {
      toggle.disabled = !courseImportServerStatus?.ready_for_search;
    }
  });
  $("#cancel-external-selection").addEventListener("click", resetCourseImportSelection);
  $("#continue-external-import").addEventListener("click", () => void previewExternalCourse());
  $("#continue-gps-only-import").addEventListener("click", () => void previewGpsOnlyRecovery());
  $("#discard-external-preview").addEventListener("click", resetCourseImportSelection);
  $("#commit-external-import").addEventListener("click", () => void commitExternalCourse());
  $("#choose-local-image").addEventListener("click", () => $("#local-image-file").click());
  $("#choose-local-image-panel").addEventListener("click", () => $("#local-image-file").click());
  $("#rotate-image-left").addEventListener("click", () => void rotateHoleArtwork(-90));
  $("#rotate-image-right").addEventListener("click", () => void rotateHoleArtwork(90));
  $("#background-opacity").addEventListener("input", event => {
    const value = Number(event.target.value);
    $("#background-opacity-value").textContent = `${value}%`;
    if (localImageLayer) localImageLayer.setOpacity(value / 100);
  });
  $("#background-opacity").addEventListener("change", event => {
    const holeKey = String(currentHoleNumber);
    recordUndo(`change Hole ${currentHoleNumber} artwork opacity`, `artwork-opacity-${holeKey}`);
    project.background_opacity ||= {};
    project.background_opacity[holeKey] = Number(event.target.value);
    persistProject();
  });
  $("#local-image-file").addEventListener("change", async event => {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;
    const holeKey = String(currentHoleNumber);
    try {
      setStatus(`Preparing ${file.name}…`);
      const source = await imageFileDataUrl(file);
      recordUndo(`choose Hole ${currentHoleNumber} local image`);
      project.reference_images ||= {};
      project.reference_image_bounds ||= {};
      project.reference_image_rotation ||= {};
      project.hole_imagery ||= {};
      project.reference_images[holeKey] = source;
      delete project.reference_image_bounds[holeKey];
      project.reference_image_rotation[holeKey] = 0;
      rotatedArtworkCache.clear();
      project.hole_imagery[holeKey] = "local";
      project.imagery_source = "User-selected local hole images";
      referencePanelOpen = false;
      persistProject();
      await applyImagerySource({ fit: true });
      setStatus(`Hole ${currentHoleNumber} is using ${file.name}. Confirm critical distances with Measure two points.`, "success");
    } catch (error) {
      setStatus(`Local image could not be used: ${error.message}.`, "error");
    }
  });
  $("#reference-image-toggle").addEventListener("click", () => {
    referencePanelOpen = true;
    renderReferenceImage();
  });
  $("#close-reference-image").addEventListener("click", () => {
    referencePanelOpen = false;
    renderReferenceImage();
  });
  $("#enlarge-reference-image").addEventListener("click", () => {
    const source = project.reference_images?.[String(currentHoleNumber)];
    showReferenceDialog(
      source,
      `${project.course_name} · Hole ${currentHoleNumber}`,
      `${project.course_name} Hole ${currentHoleNumber} supplied aerial reference`
    );
  });
  $("#view-source-scorecard").addEventListener("click", () => {
    showReferenceDialog(
      project.scorecard_source_image,
      `${project.course_name} · Source scorecard`,
      `${project.course_name} supplied scorecard`
    );
  });
  $("#reference-previous-hole").addEventListener("click", () => switchHole(currentHoleNumber - 1));
  $("#reference-next-hole").addEventListener("click", () => switchHole(currentHoleNumber + 1));
  $("#undo-editor").addEventListener("click", undoPreviousStep);
  document.addEventListener("keydown", event => {
    const isTextControl = Boolean(event.target?.closest?.("input, textarea, select, [contenteditable='true']"));
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z" && !isTextControl) {
      event.preventDefault();
      undoPreviousStep();
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "d" &&
      !isTextControl && !activeTool && !document.querySelector("dialog[open]")
    ) {
      if (duplicateSelectedFeature()) event.preventDefault();
      return;
    }
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      !event.ctrlKey && !event.metaKey && !event.altKey &&
      !isTextControl && !document.querySelector("dialog[open]")
    ) {
      if (deleteSelectedPlayPoint() || deleteSelectedFeatures()) event.preventDefault();
    }
  });
  $("#course-name").addEventListener("change", event => {
    const nextName = event.target.value.trim() || "New golf course";
    if (nextName !== project.course_name) recordUndo("course name change");
    project.course_name = nextName;
    project.course_id = slug(project.course_name);
    persistProject();
  });
  $("#course-structure").addEventListener("change", event => {
    saveHoleForm();
    const nextStructure = event.target.value === MAPPER_COURSE_STRUCTURES.THREE_NINES
      ? MAPPER_COURSE_STRUCTURES.THREE_NINES
      : MAPPER_COURSE_STRUCTURES.STANDARD;
    if (nextStructure === project.course_structure) return;
    recordUndo("course layout change");
    configureMapperCourseStructure(project, nextStructure);
    currentHoleNumber = Math.min(currentHoleNumber, mapperHoleCount(project));
    renderHoleSwitcherOptions();
    syncNineLoopNameFields();
    if (nextStructure === MAPPER_COURSE_STRUCTURES.THREE_NINES) {
      const nineOption = $('[name="scorecard-hole-count"][value="9"]');
      if (nineOption) nineOption.checked = true;
    }
    persistProject();
    renderHoleForm();
    setStatus(nextStructure === MAPPER_COURSE_STRUCTURES.THREE_NINES
      ? `${projectNineLoops().map(loop => loop.name).join(", ")} are ready for separate nine-hole scorecards.`
      : "Course layout set to a standard 18 holes.", "success");
  });
  $$('[data-nine-loop-id]').forEach(input => input.addEventListener("change", event => {
    const loop = project.nine_loops.find(item => item.id === event.target.dataset.nineLoopId);
    if (!loop) return;
    const fallback = projectNineLoops().find(item => item.id === loop.id)?.name || "Nine";
    const nextName = event.target.value.trim() || fallback;
    if (nextName === loop.name) return;
    recordUndo(`${loop.name} nine name change`);
    loop.name = nextName;
    event.target.value = nextName;
    renderHoleSwitcherOptions();
    updateScorecardImportChoice();
    persistProject();
    setStatus(`Renamed the nine-hole course to ${nextName}.`, "success");
  }));
  $("#open-scorecard-import").addEventListener("click", () => {
    $("#scorecard-import-status").textContent = "";
    updateScorecardImportChoice();
    $("#scorecard-import-dialog").showModal();
    window.setTimeout(() => $("#scorecard-paste").focus(), 0);
  });
  $$('[name="scorecard-hole-count"]').forEach(input => input.addEventListener("change", updateScorecardImportChoice));
  $("#import-scorecard").addEventListener("click", () => {
    try {
      const holeCount = selectedScorecardHoleCount();
      const rows = parseScorecardText($("#scorecard-paste").value, { holeCount });
      const targetStart = selectedScorecardTargetStart();
      recordUndo("scorecard import");
      rows.forEach(row => {
        const destinationHoleNumber = targetStart + row.hole;
        const hole = project.holes[String(destinationHoleNumber)];
        if (!hole) throw new Error(`${editorHoleLabel(destinationHoleNumber)} is unavailable in this course layout`);
        hole.par = row.par;
        hole.handicap = row.handicap;
        hole.yardages = { blue: row.blue, white: row.white, forward: row.forward };
        alignSecondaryTeesFromWhite(hole);
        if (row.par === 3) hole.features = hole.features.filter(feature => feature.type !== "fairway");
      });
      persistProject();
      renderHoleForm();
      $("#scorecard-import-dialog").close();
      const destinationLabel = holeCount === 9
        ? $("#scorecard-nine-target").selectedOptions[0]?.textContent || `Holes ${targetStart + 1}–${targetStart + 9}`
        : project.course_structure === MAPPER_COURSE_STRUCTURES.THREE_NINES
          ? projectNineLoops().slice(0, 2).map(loop => loop.name).join(" + ")
          : "Holes 1–18";
      setStatus(`Imported par, handicap, and three tee yardages for ${destinationLabel}.`, "success");
    } catch (error) {
      $("#scorecard-import-status").textContent = error.message;
    }
  });
  $("#hole-number").addEventListener("change", event => {
    switchHole(Number(event.target.value));
  });
  ["#hole-par", "#hole-handicap", "#yards-blue", "#yards-white", "#yards-forward", "#elevation-change", "#layout-type"]
    .forEach(selector => $(selector).addEventListener("change", () => saveHoleForm(true)));
  $$("[data-tool]").forEach(button => {
    button.addEventListener("click", () => {
      if (!map) {
        setStatus("Wait for the map to load before selecting a mapping tool.", "error");
        return;
      }
      autoDraftSetupPending = false;
      setActiveTool(button.dataset.tool);
    });
  });
  $("#cancel-tool").addEventListener("click", () => {
    autoDraftSetupPending = false;
    setActiveTool(null);
  });
  $("#zoom-in").addEventListener("click", () => { if (map) map.setZoom(Math.min(EDITOR_MAX_ZOOM, map.getZoom() + 1)); });
  $("#zoom-out").addEventListener("click", () => { if (map) map.setZoom(Math.max(2, map.getZoom() - 1)); });
  $("#fit-hole").addEventListener("click", fitMappedHole);
  $("#auto-draft-hole").addEventListener("click", autoDraftCurrentHole);
  $("#clear-route").addEventListener("click", () => {
    if (!currentHole().route_points.length) return;
    if (!window.confirm("Clear every route control on this hole? Tee and pin markers will remain.")) return;
    recordUndo("clear route points");
    currentHole().route_points = [];
    persistProject();
    renderPointMarkers();
  });
  $("#clear-play-points").addEventListener("click", () => {
    const hole = currentHole();
    const markerCount = Object.values(hole.markers).filter(Boolean).length;
    const routeCount = hole.route_points.length;
    if (!markerCount && !routeCount) {
      setStatus(`Hole ${currentHoleNumber} has no play points to clear.`, "error");
      return;
    }
    if (!window.confirm(`Clear all tee markers, the pin, route points, and the center line from Hole ${currentHoleNumber}? Field shapes and scorecard data will remain.`)) return;
    recordUndo(`clear Hole ${currentHoleNumber} play points`);
    hole.markers = {
      blue_tee: null,
      white_tee: null,
      forward_tee: null,
      pin: null
    };
    hole.route_points = [];
    selectedPlayPoint = null;
    autoDraftSetupPending = false;
    setActiveTool(null);
    persistProject();
    renderMappedHole();
    setStatus(`Cleared all play points and the center line from Hole ${currentHoleNumber}. Use Undo to restore them.`, "success");
  });
  $("#feature-label").addEventListener("input", event => {
    const feature = selectedFeature();
    if (!feature) return;
    recordUndo(`rename ${featureName(feature).toLowerCase()}`, `rename-${feature.id}`);
    markFeatureManual(feature);
    feature.label = event.target.value;
    persistProject();
    renderFeatureList();
    $("#selected-name").textContent = featureName(feature);
  });
  $("#feature-type").addEventListener("change", event => {
    const feature = selectedFeature();
    if (!feature || feature.type === event.target.value) return;
    recordUndo(`classify ${featureName(feature).toLowerCase()}`);
    feature.type = event.target.value;
    feature.label = FEATURE_STYLE[feature.type]?.name || feature.type.replaceAll("_", " ");
    markFeatureManual(feature);
    persistProject();
    renderMappedHole();
    setStatus(`Classified the selected shape as ${featureName(feature).toLowerCase()}.`, "success");
  });
  $("#delete-feature").addEventListener("click", () => {
    deleteSelectedFeatures();
  });
  $("#clear-field-shapes").addEventListener("click", () => {
    const hole = currentHole();
    const count = hole.features.length;
    if (!count) return;
    if (!window.confirm(`Clear all ${count} field shapes from Hole ${currentHoleNumber}? Tee, pin, route points, hole card, and artwork will remain.`)) return;
    recordUndo(`clear Hole ${currentHoleNumber} field shapes`);
    hole.features = [];
    if (hole.gps_control_points) hole.gps_control_points.bunker_feature_id = null;
    selectedFeatureId = null;
    selectedFeatureIds.clear();
    persistProject();
    renderMappedHole();
    setStatus(`Cleared all ${count} field shapes from Hole ${currentHoleNumber}. Use Undo to restore them.`, "success");
  });
  $("#move-feature-mode").addEventListener("click", () => {
    if (!selectedFeatureId) return;
    selectedFeatureMode = "move";
    selectFeature(selectedFeatureId);
    setStatus("Move mode: drag inside the selected shape.", "success");
  });
  $("#edit-feature-points-mode").addEventListener("click", () => {
    if (!selectedFeatureId) return;
    selectedFeatureMode = "points";
    selectFeature(selectedFeatureId);
    setStatus("Point mode: drag the handles to reshape the selected shape.", "success");
  });
  $("#rotate-feature-left").addEventListener("click", () => rotateSelectedFeature(5));
  $("#rotate-feature-right").addEventListener("click", () => rotateSelectedFeature(-5));
  $("#shrink-feature").addEventListener("click", () => scaleSelectedFeature(.95));
  $("#enlarge-feature").addEventListener("click", () => scaleSelectedFeature(1.05));
  $("#merge-features").addEventListener("click", mergeSelectedFeatures);
  $("#duplicate-feature").addEventListener("click", () => {
    duplicateSelectedFeature();
  });
  $("#clear-measurements").addEventListener("click", clearMeasurements);
  $("#save-gps-calibration").addEventListener("click", () => saveGpsCalibration());
  ["#gps-white-tee", "#gps-green-center", "#gps-bunker-center", "#gps-bunker-feature"].forEach(selector => {
    $(selector).addEventListener("change", () => {
      if (gpsCalibrationFormState().complete) saveGpsCalibration({ quiet: true });
    });
  });
  $("#clear-gps-calibration").addEventListener("click", () => {
    if (!currentHole().gps_control_points) return;
    recordUndo(`clear Hole ${currentHoleNumber} GPS calibration`);
    delete currentHole().gps_control_points;
    persistProject();
    renderGpsCalibration();
    setStatus(`Cleared Hole ${currentHoleNumber} GPS calibration.`, "success");
  });
  $("#measurement-list").addEventListener("submit", event => {
    const form = event.target.closest("[data-calibrate-measurement]");
    if (!form) return;
    event.preventDefault();
    void calibrateLocalImage(form.dataset.calibrateMeasurement, form.elements.namedItem("known-yards")?.value);
  });
  $("#new-project").addEventListener("click", () => {
    if (!window.confirm("Start a new mapping project? Save the current project first if you need it.")) return;
    recordUndo("new project");
    project = createMapperProject();
    currentHoleNumber = 1;
    autoDraftSetupPending = false;
    referencePanelOpen = false;
    localStorage.removeItem(AUTOSAVE_KEY);
    setAutosaveStatus("Autosave ready", "ready");
    $("#course-name").value = project.course_name;
    $("#course-structure").value = project.course_structure;
    syncNineLoopNameFields();
    renderHoleSwitcherOptions();
    renderHoleForm();
    void applyImagerySource();
    setStatus("New mapping project started.", "success");
  });
  $("#save-project").addEventListener("click", () => {
    saveHoleForm();
    validateMapperProject(project);
    downloadText(
      `${JSON.stringify(project, null, 2)}\n`,
      `${project.course_id || "course"}.golfmap`
    );
    setStatus("Mapping project saved.", "success");
  });
  $("#load-project").addEventListener("click", () => $("#project-file").click());
  $("#project-file").addEventListener("change", async event => {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;
    try {
      const loadedProject = parseMapperProject(await file.text());
      recordUndo("load project");
      project = loadedProject;
      currentHoleNumber = 1;
      autoDraftSetupPending = false;
      referencePanelOpen = Boolean(project.reference_images);
      $("#course-name").value = project.course_name;
      $("#course-structure").value = project.course_structure;
      syncNineLoopNameFields();
      renderHoleSwitcherOptions();
      persistProject();
      renderHoleForm();
      if (map && project.map_view?.center) {
        map.setView(displayGps(project.map_view.center), Math.min(project.map_view.zoom || 17, EDITOR_MAX_ZOOM), { animate: false });
      }
      void applyImagerySource({ fit: true });
      setStatus(`Loaded ${project.course_name}.`, "success");
    } catch (error) {
      setStatus(`Could not load project: ${error.message}.`, "error");
    }
  });
  $("#export-hole").addEventListener("click", () => {
    saveHoleForm();
    try {
      const payload = buildGameHoleJson(project, currentHoleNumber);
      downloadText(
        `${JSON.stringify(payload, null, 2)}\n`,
        `hole${currentHoleNumber}.json`
      );
      setStatus(`Exported game JSON for Hole ${currentHoleNumber}.`, "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
  $("#preview-game-map").addEventListener("click", () => {
    saveHoleForm();
    try {
      const gameHole = ensureHazardFreePinZones(generatedGreenHole(buildGameHoleJson(project, currentHoleNumber), {
        courseId: project.course_id,
        holeNumber: currentHoleNumber,
        targetWidthYards: 40,
        courseUnitsPerYard: 1 / YARDS_PER_METER
      }));
      $("#game-preview-title").textContent = `Hole ${currentHoleNumber} game map`;
      $("#game-preview-canvas").innerHTML = renderGameMapPreview(gameHole);
      $("#game-preview-dialog").showModal();
      setStatus(`Previewing Hole ${currentHoleNumber} at the game’s full-hole scale.`, "success");
    } catch (error) {
      setStatus(`Game preview is not ready: ${error.message}.`, "error");
    }
  });
  $("#export-package").addEventListener("click", async () => {
    if (!prepareGpsCalibrationForHandoff()) return;
    saveHoleForm();
    try {
      setStatus("Preparing geometry and generated course artwork…");
      const payloads = buildPlayableGamePackages();
      payloads.forEach(payload => downloadText(
        `${JSON.stringify(payload, null, 2)}\n`,
        `${payload.course_id}.golfcourse.json`
      ));
      setStatus(payloads.length === 1
        ? `Exported ${Object.keys(payloads[0].holes).length} ready holes with scorecard.`
        : `Exported ${payloads.length} playable 18-hole combinations.`, "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  });
  $("#install-game").addEventListener("click", async event => {
    if (!prepareGpsCalibrationForHandoff()) return;
    saveHoleForm();
    const button = event.currentTarget;
    const originalLabel = button.textContent;
    button.disabled = true;
    let payloads;
    try {
      button.textContent = "Preparing map…";
      setStatus("Preparing geometry and generated course artwork for installation…");
      payloads = buildPlayableGamePackages();
    } catch (error) {
      setStatus(`The course was not installed: ${error.message}.`, "error");
      window.alert(`The course was not installed. ${error.message}. Check each hole's “Ready to export” status.`);
      button.disabled = false;
      button.textContent = originalLabel;
      return;
    }
    const missingHoles = Array.from({ length: mapperHoleCount(project) }, (_, index) => index + 1)
      .filter(holeNumber => !holeMappingStatus(project, holeNumber).ready)
      .map(editorHoleLabel);
    if (missingHoles.length) {
      setStatus(`Install stopped. Finish these holes first: ${missingHoles.join(", ")}.`, "error");
      window.alert(`The course was not installed. Finish these holes first: ${missingHoles.join(", ")}.`);
      button.disabled = false;
      button.textContent = originalLabel;
      return;
    }
    const installDescription = payloads.length === 1
      ? project.course_name
      : `${project.course_name} as all six ordered combinations of ${projectNineLoops().map(loop => loop.name).join(", ")}`;
    if (!window.confirm(`Install ${installDescription} in the golf game now? Existing game data for these routes will be replaced.`)) {
      button.disabled = false;
      button.textContent = originalLabel;
      setStatus("Installation canceled. Your mapped project remains saved.");
      return;
    }
    button.textContent = "Installing…";
    setStatus(payloads.length === 1
      ? `Validating and installing all 18 ${project.course_name} holes…`
      : `Validating 27 holes and installing six ordered 18-hole routes…`);
    try {
      const results = [];
      for (const payload of payloads) {
        button.textContent = payloads.length === 1 ? "Installing…" : `Installing ${results.length + 1}/${payloads.length}…`;
        const response = await fetch("/api/course-mapper/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`${payload.course_name}: ${result.error || `server returned ${response.status}`}`);
        results.push(result);
      }
      const verification = await fetch(`/data/mapped_courses.json?verify=${Date.now()}`, { cache: "no-store" });
      const installedCourses = verification.ok ? await verification.json() : [];
      const installed = Array.isArray(installedCourses) && results.every(result => installedCourses.some(course =>
        course.id === result.course_id && course.dataVersion === result.map_updated_at
      ));
      if (!installed) throw new Error("the server did not confirm the installed map");
      setStatus(results.length === 1
        ? `Installed all 18 ${results[0].course_name} holes in the game. Reload the game page to use them.`
        : `Installed all six ordered ${project.course_name} 18-hole routes. Reload the game page to choose one.`, "success");
      window.alert(results.length === 1
        ? `${results[0].course_name} was installed and verified. Reload the game to use it.`
        : `${project.course_name} was installed in both directions for every pair of nines. Reload the game and choose the route from the course menu.`);
    } catch (error) {
      setStatus(`Game installation failed: ${error.message}.`, "error");
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
  updateUndoControl();
}

async function initializeEditor() {
  let presetError = null;
  await initializeEditorAuth();
  try {
    await loadRequestedPreset();
  } catch (error) {
    presetError = error;
  }
  bindEvents();
  initializeMap();
  renderHoleForm();
  await applyImagerySource({ fit: true });
  if (presetError) {
    setStatus(`Course workspace could not load: ${presetError.message}.`, "error");
  }
}

void initializeEditor();
