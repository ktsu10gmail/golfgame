# Project Phase Status

Last updated: 2026-08-11

This is the project-level source of truth for phase progress. Update this file
whenever a phase or major work package is completed.

## Current position

**Active phase:** Phase 3
**Current work package:** Work package 6 and mobile UI refinement complete — physical-device acceptance and core release readiness next
**Verification baseline:** 214 automated tests executed (82 browser and 132 Python: 205 passing, 9 Python tests skipped when optional integrations are unavailable)

The browser now consumes deterministic, cross-runtime Result Packets for full
shots and putting, including authoritative penalty strokes and relief
positions. Persistent round-state recovery, authoritative putting, deterministic
decision scoring, weighted round analysis, and AI narration integration are now
complete. Greenside chips now use the same authoritative, replayable
cross-runtime architecture, so every browser gameplay outcome is engine-owned.

## Phase 1 — Playable Testing Prototype

**Status: Complete**

Delivered:

- dependency-free browser game;
- four selectable 18-hole courses;
- desktop and mobile gameplay;
- club selection, aiming, shot dispersion, lies, penalties, and scoring;
- multiple tee and pin positions;
- built-in and customizable player profiles;
- scorecard and saved browser rounds;
- actual-hole reference images;
- self-contained course folders for scorecards, hole JSON, and images.

Phase 1 is considered good enough for gameplay testing. It remains available
while the authoritative engine is developed alongside it.

## Phase 2 — Authoritative Golf Engine

**Status: Complete**

### Work package 1 — Deterministic engine foundation

**Status: Complete**

Delivered:

- immutable contracts for clubs, lies, shot intent, environment, and geometry;
- versioned player and lie calibration fixtures;
- bounded carry and lateral shot distributions;
- deterministic seeds and exact shot replay;
- lie, slope, elevation, wind, surface, and intent modifiers;
- shot-quality states and correlated mishit effects;
- shot-path samples and landing-surface resolution;
- immutable result and audit packets;
- automated domain, geometry, simulation, and calibration tests.

### Work package 2 — Real course-data adapter

**Status: Complete**

Delivered:

- all supported course schemas load through one validated adapter;
- all 72 holes load and retain course and hole identity;
- tee, fairway, rough, green, bunker, water, and out-of-bounds regions map to
  canonical engine surfaces;
- meter coordinates and declared distances convert to canonical yards;
- every tee and pin resolves to its intended playable surface;
- representative seeded shots resolve on real Meadows, Warrenbrook, and Cranbury
  greens;
- malformed or incomplete course data produces clear validation errors;
- the engine's positive-lateral axis now correctly means golfer-right in course
  coordinates;
- adapter and real-hole integration tests pass.

### Work package 3 — Browser Result Packet integration

**Status: Complete**

Goal:

Replace the browser prototype's independent full-shot outcome calculations with
authoritative, deterministic Phase 2 Result Packets while preserving the current
playable UI.

Completion criteria:

- browser shot requests use the same canonical inputs as the engine;
- landing position, surface, remaining distance, and audit identity come from one
  authoritative Result Packet;
- browser reload or replay can reproduce a shot from its recorded seed identity;
- existing course selection, aiming, scoring, and mobile controls continue to
  work;
- integration tests cover all supported courses and representative penalty surfaces.

Delivered:

- one `full-shot-v3` deterministic algorithm shared by Python and the browser;
- exact Python/JavaScript golden-packet parity;
- canonical yard inputs for club, lie, intent, elevation, slope, and all course
  surfaces;
- authoritative landing, surface, remaining distance, trace, and audit data for
  every browser full shot;
- persistent per-round seeds plus complete saved replay requests and packets;
- real-course browser integration coverage for all four courses and water surfaces;
- existing putting UI retained on its deferred prototype path.

### Work package 4 — Authoritative penalty and relief workflows

**Status: Complete**

Delivered:

- versioned `penalty-relief-v1` records embedded in full-shot Result Packets;
- one-stroke water relief resolved near the last boundary crossing;
- one-stroke stroke-and-distance resolution for out-of-bounds shots;
- deterministic, user-declared unplayable-ball relief;
- authoritative reference point, resolved ball position, resulting surface, and
  region identity;
- browser ball placement, scoring, result copy, Game Master narration, and saved
  history driven by the relief record;
- unchanged `full-shot-v3` seed identity so existing shot replays remain exact;
- Python/browser replay coverage and validation against real course water.

### Work package 5 — Persistent round state and transactional shot handling

**Status: Complete**

Delivered:

- versioned append-only round documents keyed per course;
- legacy browser round keys migrated into the canonical round-state document on
  load;
- transactional shot and declared-unplayable event commits with replay payloads;
- reducer-driven browser hole recovery, replay reset, and full round reset;
- Node browser-state coverage for reload recovery, replay identity, and reset
  behavior.

### Work package 6 — Authoritative putting

**Status: Complete**

Delivered:

- deterministic `putt-v1` packets shared by Python and the browser;
- authoritative putt landing, remaining distance, make probability, and audit
  identity;
- browser putt analysis and saved history driven by the authoritative putting
  packet rather than prototype-only randomness;
- Python/browser parity coverage and deterministic replay for putting.

### Work package 7 — Decision scoring and round analysis

**Status: Complete**

Delivered:

- immutable full-shot and putting strategy-score contracts;
- deterministic decision and execution grades kept as separate axes;
- putting line, pace, and three-putt-avoidance scoring;
- weighted `round-strategy-v1` aggregation with hole scores, category
  subscores, key moments, and repeat-pattern detection;
- legacy saved rounds without strategy packets remain readable and unscored;
- the browser review consumes deterministic analysis instead of club-frequency
  heuristics;
- optional AI narration receives the analysis as authoritative context and
  cannot replace the local practice priority;
- Python/browser golden aggregation coverage and real-browser flow verification.

### Work package 8 — Authoritative greenside shots

**Status: Complete**

Delivered:

- immutable greenside context and result contracts;
- deterministic `greenside-chip-v3` simulation in Python and JavaScript;
- canonical carry landing, final resting position, surfaces, contour break,
  slope-adjusted rollout, assessment, and audit identity;
- complete saved request context and seed identity for exact replay;
- authoritative relief when a chip rolls into a penalty area;
- exact cross-runtime golden packets, replay tests, invalid-input coverage, and
  real-course surface integration across all four courses;
- live browser verification of a recommended rough-to-green chip and persisted
  replay packet.

### Remaining Phase 2 work

1. Add persistent round state and transactional shot handling. **Complete**
2. Add putting to the authoritative engine. **Complete**
3. Add decision scoring and AI Game Master narration based on engine results. **Complete**
4. Replace the remaining browser-local greenside chip simulation with an
   authoritative cross-runtime packet. **Complete**

Phase 2 is complete. Full shots, greenside shots, putting, penalties, relief,
round persistence, strategy scoring, and review narration now consume
authoritative engine packets throughout browser gameplay.

## Phase 3

**Status: Active**

### Work package 1 — Local AI Game Master

**Status: Complete**

Delivered:

- local Ollama is the default optional provider, using `qwen3.5:4b`;
- the model runs fully on the user's 6 GB RTX 3050 with a 4096-token context;
- shot narration and round review use Ollama structured JSON responses;
- prompts compact browser payloads while retaining authoritative engine scoring;
- the deterministic engine remains the sole owner of physics, penalties, relief,
  scoring, and strategy grades;
- Gemini remains available through `AI_PROVIDER=gemini`;
- provider failures preserve built-in commentary and do not interrupt gameplay;
- request timeouts accommodate local-model cold starts without blocking shots.

Next, evaluate narration quality during complete rounds and use that gameplay
evidence to prioritize the next Phase 3 work package.

### Work package 2 — Portable round saves

**Status: Complete**

Delivered:

- automatic per-browser round persistence remains unchanged;
- versioned `.golfround` files can be saved on desktop or through the mobile
  share sheet;
- round files restore course, current hole, tee, pin, complete shot/replay
  history, score, deterministic seed, and player profile;
- import validates the format and rejects malformed, unsupported, oversized, or
  unavailable-course files;
- loading over existing course progress requires confirmation;
- authoritative imported round state is preserved instead of being overwritten
  by legacy browser-cache migration;
- desktop and mobile scorecard flows were verified in a real browser.

### Work package 3 — Course Mapper

**Status: Complete for local-image production mapping; USGS NAIP remains an optional source**

Delivered:

- a separate `/editor.html` mapping workspace for all 18 holes;
- a choice between local course imagery and USGS NAIP imagery;
- address geocoding, satellite pan/zoom, fit-to-hole, and scale controls;
- editable polygon templates for tee boxes, fairway, rough, bunkers, greens,
  water, and out-of-bounds areas;
- draggable blue/white/forward tee, pin, and dogleg-route survey markers;
- rectangular, oval, and circular bunker tools, eight-point simplified shapes,
  five-degree rotation controls, numbered objects, deletion, and undo;
- two-point measurements with scorecard-yardage calibration so other tee
  distances scale from the entered white-tee reference;
- pasted scorecard parsing and guided local-image auto-drafting;
- automatic browser persistence and portable `.golfmap` project files;
- GPS-to-golfer-relative-meter conversion with white tee datum and pin-forward
  axis;
- game-compatible per-hole JSON and multi-hole course-package exports;
- a validated local importer that installs all 18 holes, scorecard data, and
  automatic game catalog registration;
- mapped-course discovery in the existing game without hard-coded JavaScript
  entries;
- direct **Install in game** validation and installation;
- a complete Cranbury Golf Club project built and installed through the
  local-image workflow;
- automated transform, export, validation, package, and importer coverage.

The editor uses Leaflet and Geoman editable overlays. Local hole imagery is the
preferred production workflow because it is faster and easier to align; public
USGS NAIP remains available when local imagery is unavailable. U.S. Census
street-address lookup is proxied by the local server, so no commercial map key
is required.

### Work package 4 — Click-first strategy choices

**Status: Complete**

Delivered:

- two deterministic choices when two genuinely different plans exist:
  **Aggressive** and **Safe & smart**;
- one honest **Recommended** plan when alternative calculations are too similar,
  instead of hiding the caddie panel or inventing a duplicate choice;
- partial-wedge short-game guidance inside 30 yards while putting guidance stays
  separate on the green;
- player-specific club, accuracy, power, current-lie, mapped-surface, centerline,
  and hazard inputs instead of generic club assumptions;
- distinct long-hole behavior when a preferred final approach cannot be reached
  in one shot;
- meaningful-difference filtering removes plans that do not differ enough in
  club, power, target, expected leave, surface, hazard exposure, or risk;
- every card names the actual modeled target so repeated clubs remain clearly
  different decisions rather than relabeled duplicates;
- card selection previews the target line and dispersion without playing;
- choosing a card prepares the shot; the normal **Play shot** action is the
  confirmation;
- `?` explanations disclose the plan objective, calculated recommendation rank,
  comparative 0–100 risk index, landing surface, hazard exposure, and expected distance left;
- confirmed choice metadata is retained with the authoritative shot history;
- responsive desktop cards and a mobile horizontal yardage-book strip, including
  an explicit mobile Play shot button;
- deterministic planner tests plus real-browser desktop/mobile verification.

The scoring outlook compares the distinct current plans deterministically. It
does not claim personalized strokes-gained precision. Meadows-wide rough-position
sampling verifies that eligible non-green positions now always retain at least
one caddie plan.

### Work package 5 — Player accounts, recovery, and playing profiles

**Status: Complete**

Delivered:

- Supabase email/password authentication with email verification, sign-in,
  sign-out, forgot-password email, and in-game password replacement after a
  recovery link;
- server-validated Supabase sessions mapped to local player records;
- automatic server-backed unfinished-round saving and resume across a player's
  computer and phone;
- player-scoped browser storage plus portable `.golfround` backup and import;
- account-level playing profiles containing normal full-swing carry, club
  accuracy, and 3-, 6-, and 10-foot putting make rates;
- profile setup for new players plus editing from the Player Account screen;
- active playing statistics load across devices and immediately affect
  dispersion and deterministic caddie planning;
- server-side profile validation and independent persistence outside an active
  round.
- custom playing profiles default to the signed-in player's name (for example,
  `ktsu10 profile`) rather than retaining the 80+/90+/100+ starter category;
  legacy generated labels migrate without replacing names the player chose.
- Player Account → Top 10 rank board lists each player's best completed round,
  ranks by Course Management score, breaks ties with lower strokes, and remains
  readable on desktop and mobile.

### Work package 6 — Completed-round history and lifetime player learning

**Status: Complete**

Goal:

Turn authoritative saved shot history into cautious, condition-aware player
learning without allowing the AI model to invent statistics.

Sequence:

1. Preserve every completed round under the player's account instead of keeping
   only the latest round per course. **Complete**
2. Build queryable shot observations containing distance, lie, club, power,
   intended target, player adjustment, deterministic decision grade, execution
   grade, result surface, and remaining distance. **Complete**
3. Establish minimum sample sizes and confidence rules before reporting a
   recurring course-management tendency. **Complete**
4. Calculate lie-specific decision patterns, sidehill-reading quality, and
   repeated course-management mistakes. **Complete**
5. Feed only verified player patterns into Aggressive/Safe & smart explanations,
   AI review context, and end-of-round learning moments. **Complete**
6. Add a progress view for recent-round trends and improvement priorities. **Complete**

The deterministic engine and stored Result Packets remain authoritative. The AI
may explain verified patterns but may not calculate or fabricate lifetime facts.

Delivered so far:

- completed rounds archive automatically and idempotently under the signed-in
  player without replacing earlier rounds;
- each archive retains the authoritative portable round document plus course,
  tee, strokes, par, score to par, course-management score, execution score,
  and scored-decision count;
- an authenticated round-history endpoint returns the player's newest completed
  rounds across devices;
- Player Account → Round history provides a responsive chronological ledger on
  desktop and mobile;
- unfinished rounds continue to use the existing automatic resume workflow and
  are never included in completed history.
- every authoritative scored shot in a completed round becomes a queryable
  condition-aware observation containing its engine version, distance band,
  lie, stance, slope, club, power, target/result surfaces, player adjustment,
  decision and execution scores, penalty, and remaining distance;
- lifetime findings require at least eight comparable shots across three
  completed rounds, with additional frequency checks before a recurring pattern
  is reported;
- deterministic summaries can identify lie-specific decision strengths or
  practice priorities, sidehill compensation quality, and recurring decision
  mistakes without treating simulated execution as real-world playing ability;
- Player Account → Player learning shows either verified findings or a clear
  evidence-building state on desktop and mobile.
- the browser sends possible learning context for display, but AI endpoints
  discard it and rebuild verified patterns from the signed-in player's server
  record before prompting the model;
- meaningful review shots show a restrained **Player record** evidence note only
  when their lie, sidehill response, or decision reason directly
  matches a verified lifetime pattern;
- AI strategy and round-review prompts may explain these server-verified facts
  but cannot strengthen, calculate, or invent a player tendency.
- Player Learning includes a responsive **Recent decision form** scorecard with
  the latest six completed Course Management scores in chronological order. It
  compares the latest three-round average with the previous three only after
  both windows are complete, labels a four-point-or-greater change, and states
  explicitly that simulated execution is excluded.

## Update log

- **2026-08-11:** Completed the mobile map and control-density refinement pass.
  The map fills the usable phone height; the shot carousel now docks only at Top
  or Bottom with a centered Move control and touch-safe target anchoring; the
  top application actions and hole actions use compact accessible icons.
- **2026-08-11:** Added a current-hole reset confirmation that preserves the
  round when canceled and clears only the selected hole when confirmed. Removed
  the non-putting one-yard nudge control while preserving putting refinement.
- **2026-08-11:** Rebuilt Enlarged Green controls for small Chrome viewports. The
  bottom approach panel is compact and fixed inside the visible viewport, and a
  single top toolbar now contains Top/3D, a 1×–5× zoom dropdown, and × Close.
  Node/browser verification passes 149 of 149 tests; physical iPhone acceptance
  and the complete Python release suite remain pending.

- **2026-08-05:** Repaired the persistent `golfgame.service` after a reboot had
  launched Python's static `http.server`, which returned 404 for game APIs and
  caused the generic course-load failure. The enabled user service now runs
  `scripts/serve.py` on `0.0.0.0:8080`; live auth, session, AI, and course checks
  pass.
- **2026-08-05:** Expanded mobile Game Master messages from the global 92% chat
  width to the planner's full content width, aligning their edges with the Club
  selector and adding slightly more reading padding without changing desktop.
- **2026-08-05:** Compacted the two mobile Caddie Choices into an equal-width,
  screen-fitting two-column row. Removed horizontal card scrolling and reduced
  card padding/type modestly while retaining club, power, outcome, and tappable
  explanation controls; a single recommendation still uses the full width.
- **2026-08-05:** Added a second mobile Back to Map action in the Club heading,
  replacing the redundant yardage summary above the dropdown. Club distance
  remains visible in the selected dropdown option and Power readout.
- **2026-08-05:** Moved mobile Back to Map beside the Caddie Choices heading so
  it remains visible near the planner's primary decision area. Removed the
  redundant preview hint there and balanced Scorecard/Review into two columns.
- **2026-08-05:** Made the mobile map and shot planner mutually exclusive UI
  states. Opening the full planner hides the Hole/Round chips, map actions, and
  legend and raises the planner above map overlays; returning to the map restores
  them, preventing controls from covering the planner header.
- **2026-08-05:** Simplified the mobile shot confirmation to one action. Removed
  the large duplicate Play Shot button and changed Adjustment's Apply control to
  Play; one tap now applies typed instructions and executes the shot, while an
  empty field plays the current club, power, and line.
- **2026-08-05:** Rebuilt the mobile map header as one flow-based two-row control
  group. Hole/Round information now occupies the first row and map actions the
  second, eliminating absolute-position overlap across phone widths and browser
  text settings while leaving the desktop toolbar unchanged.
- **2026-08-05:** Separated the mobile map action row from the hole-information
  chip and moved the map legend with it, preventing the Hole/Par/Yardage panel
  from covering the tops of the action buttons. The action row also has an
  explicit higher stacking level so every button remains tappable on narrow
  mobile browsers.
- **2026-08-05:** Replaced the expanded mobile shot sheet's square club tiles
  with a compact, touch-safe dropdown matching the desktop selection model.
  Club option distances and the power readout now recalculate live as swing
  power changes (for example, `80% · 176 yd`).
- **2026-08-05:** Prevented mobile Safari focus zoom in the Adjustment field by
  keeping its editing text at 16px in both base and phone layouts. A real-browser
  390px check confirmed identical shot-sheet height and viewport width before
  and after focus.
- **2026-08-05:** Completed Phase 3 work package 6 with Recent decision form.
  Added a conservative two-window Course Management trend, a clear six-round
  evidence-building state, and a responsive yardage-book scorecard verified at
  desktop and 390px mobile widths. Simulated execution never enters the trend.
  Raised the baseline to 214 tests (9 optional-integration skips) and moved the
  roadmap to core release-readiness review; future engagement and friend-match
  ideas remain deferred in `IMPROVEMENT.md`.
- **2026-08-04:** Added an authenticated Top 10 clubhouse rank board. Each player
  appears once using their best scored completed round; Course Management score
  sets the order and lower strokes break ties. Verified desktop/mobile layouts
  and raised the baseline to 211 tests.
- **2026-08-04:** Connected verified lifetime learning to deterministic caddie
  planning, `?` explanations, and meaningful-hole reviews. Added server-side
  replacement of browser-supplied learning claims, exact evidence disclosure,
  AI prompt constraints, and real-browser verification. Raised the baseline to
  210 tests and set recent-round progress trends as the next step.

- **2026-07-19:** Created the phase tracker. Recorded Phase 1 as complete, Phase 2
  work package 1 as complete, and the real course-data adapter as the next work
  package.
- **2026-07-19:** Completed Phase 2 work package 2. Added one validated adapter
  for both course schemas, canonical yard conversion, all-hole surface coverage,
  real-hole deterministic shot tests, and golfer-right axis correction. Set
  browser Result Packet integration as the next work package.
- **2026-07-20:** Completed Phase 2 work package 3. Browser full shots now use
  cross-runtime deterministic Result Packets, persistent seed identities, saved
  replay inputs, canonical surface resolution, and exact Python/browser parity.
  Set authoritative penalty and relief workflows as the next work package.
- **2026-07-20:** Added Cranbury Golf Club as a third complete 18-hole course.
  Imported its scorecard and reference imagery, generated golfer-relative
  geometry with user-confirmed left doglegs, added Blue/White/Gold tee coverage,
  and expanded authoritative adapter and browser-surface validation to 54 holes.
- **2026-07-21:** Completed Phase 2 work package 4. Added versioned,
  cross-runtime penalty and relief packets; deterministic last-crossing water
  relief; stroke-and-distance for out of bounds; user-declared unplayable-ball
  relief; browser scoring, narration, and saved-history integration; exact replay
  compatibility; and real-course water validation. Set persistent transactional
  round state as the next work package.
- **2026-07-21:** Started Phase 2 work package 5. Added
  `packages/simulation/round_state.mjs` with a versioned round document,
  per-course storage key, append-only hole events, and a reducer for recovering
  ball, lie, penalty, and hole-completion state. Recorded the remaining
  migration plan in `docs/PHASE_2.md`.
- **2026-07-21:** Completed work package 5 step 2. Browser load now migrates
  legacy per-course `history`, `scores`, and `round-seed` keys into the
  canonical round-state document, including synthesized append-only events for
  saved unplayable relief and hole completion. Added round-state migration
  coverage in the Node test suite. Next: refactor `playShot()` into one
  transactional append-only event commit.
- **2026-07-21:** Completed work package 5 step 3. Browser `playShot()` now
  appends and persists one authoritative shot event per committed stroke,
  including automatic penalty strokes, resolved ball and lie, remaining
  distance, saved replay payload, and hole completion scoring when the stroke
  ends the hole. Added round-state hole-replacement coverage so replay/reset
  flows can keep the canonical document synchronized. Next: move declared
  unplayable relief into its own append-only event.
- **2026-07-21:** Completed work package 5 step 4. Declared unplayable relief
  now persists as its own append-only round-state event instead of rewriting
  the original shot event, while the legacy browser review state remains
  synchronized for the current UI. Next: rebuild browser hole state from the
  reducer instead of scattered mutable fields.
- **2026-07-21:** Completed work package 5 step 5. Browser hole recovery now
  derives ball position, shot list, completion state, score caches, and review
  history from the persisted round-state reducer instead of rebuilding those
  fields manually on load, hole change, replay reset, and post-shot updates.
  Next: add browser-state tests for reload recovery, replay identity, and round
  reset.
- **2026-07-21:** Completed work package 5 step 6. Added browser-state tests
  for reload recovery, replay identity preservation, replay reset, and full
  round reset through shared reducer-backed browser recovery helpers. Marked the
  persistent round-state and transactional shot-handling work package complete
  and set authoritative putting as the next Phase 2 work package.
- **2026-07-21:** Completed Phase 2 work package 6. Added deterministic
  `putt-v1` simulation contracts in Python and the browser, replaced the
  prototype-only browser putting path with authoritative putt packets, added
  deterministic putting parity coverage, and advanced the next Phase 2 work
  package to decision scoring and AI Game Master narration.
- **2026-07-29:** Added Galloping Hill Golf Course as a fourth complete
  18-hole course. Preserved the supplied GPS aerials and scorecard sources,
  generated Blue/White/Gold testing-quality geometry, registered the course in
  the browser, expanded authoritative adapter and surface coverage to 72 holes,
  and raised the verified baseline to 95 automated tests.
- **2026-07-29:** Completed Phase 2 work package 7. Added deterministic putting
  strategy packets, weighted hole/round aggregation, category subscores,
  repeated-pattern detection, deterministic review priorities, structured AI
  context, cross-runtime golden tests, and browser-flow verification. Raised the
  verified baseline to 104 tests and set authoritative greenside shot migration
  as the final Phase 2 integration gap.
- **2026-07-29:** Completed Phase 2 work package 8 and Phase 2 overall. Replaced
  the browser-local chip simulator with cross-runtime `greenside-chip-v3`
  packets, saved full replay identity, added rolled-penalty relief, verified all
  four real course surface sets, completed a live browser chip flow, and raised
  the baseline to 112 automated tests.
- **2026-07-29:** Connected the standard ball-above/below-feet advice to live
  play with the cross-runtime `sidehill-v1` model. Sidehill movement now scales
  with shot distance and lie severity, natural-language left/right aim is
  supported, and `decision-score-v2` rewards correct compensation separately
  from execution. Raised the verified baseline to 119 automated tests.
- **2026-07-29:** Fixed the two-foot gimme and cup-edge boundaries to use the
  authoritative packet's hundredth-yard precision. Added shared completion
  classification coverage and verified the conceded stroke, final score, and
  “Inside two feet” browser flow. Raised the verified baseline to 120 tests.
- **2026-07-29:** Removed the ambiguous “yards just off the green” coaching
  phrase. Greenside briefings now separately identify distance to the cup,
  distance to the front edge along the direct line, carry from the ball,
  landing depth onto the green, and expected rollout. Added green-boundary
  intersection coverage and raised the verified baseline to 121 tests.
- **2026-07-29:** Started Phase 3 by integrating local Ollama narration with
  `qwen3.5:4b`. Added structured outputs, compact authoritative prompt contexts,
  configurable provider settings, explicit Gemini/off alternatives, cold-start
  browser timeouts, and provider tests. Verified the model loads 100% on the
  RTX 3050 at a 4096-token context and raised the baseline to 125 tests.
- **2026-07-30:** Added portable `.golfround` save and load controls to the
  scorecard for desktop and mobile. The versioned format carries authoritative
  round/replay state and the player profile, validates imports, confirms
  replacement of existing progress, and preserves imports across reloads.
  Verified download/upload in Playwright and raised the baseline to 128 tests.
- **2026-07-30:** Added the satellite Course Mapper companion app with editable
  field-shape templates, GPS survey markers, measurement, 18-hole projects,
  canonical coordinate conversion, game JSON/course-package exports, and a
  local installer with dynamic game registration. Added eight automated mapper
  and importer tests and raised the baseline to 136 tests. Exports now require
  rough and valid tee/pin containment, and the installer runs every hole through
  the authoritative course adapter before writing it. Live aerial interaction
  remains to be verified across additional USGS imagery regions.
- **2026-07-31:** Added the click-first three-choice strategy planner. Attack,
  Safe advance, and Smart layup use the selected golfer's carry and accuracy,
  current lie, mapped surfaces, route, and hazards. Each plan supports map
  preview, deterministic `?` explanation, explicit confirmation, and no-typing
  play on desktop and mobile. Added four planner tests, verified the responsive
  flows in Playwright, and raised the baseline to 140 tests.
- **2026-07-31:** Made strategy choices context-sensitive for long shots,
  reachable approaches, and recovery. Added actual target labels and
  meaningful-difference filtering so identical club/power/target plans collapse
  to two honest choices instead of showing a duplicate third card. Added three
  regression tests, rechecked desktop/mobile layouts, and raised the baseline to
  143 tests.
- **2026-07-31:** Corrected borderline full-shot classification after a
  227-yard Galloping Hill hole 6 fairway state collapsed to one hidden approach
  plan. Shots beyond the longest effective carry now use three distinct
  long-shot plans, with a fallback whenever approach deduplication leaves fewer
  than two choices. Added a regression test and raised the baseline to 144 tests.
- **2026-07-31:** Corrected short-approach choices after a 62-yard rough state
  ranked a 13-yard leave ahead of a pin-distance wedge. Approach scoring now
  values expected finish distance instead of the golfer's layup distance, and
  club power, map targets, cards, confirmation, and `?` explanations account
  for modeled rollout. Added regression coverage and raised the baseline to 145
  tests.
- **2026-07-31:** Completed a responsive comfort redesign around a quiet
  yardage-book visual system. Desktop now uses three calm, separated surfaces
  with the course map at center; tablet moves the shot desk below the map in a
  readable two-column layout; and mobile uses a softer, scroll-safe control
  sheet with larger targets and an unobstructed Play shot action. Reverified
  strategy selection, explanations, confirmation, and collapsed/full mobile
  states in a real browser. The automated baseline remains 145 tests.
- **2026-07-31:** Moved the live shot Result summary from the right planning
  desk into the left course panel, directly above the round card. The narrower
  stacked treatment keeps shot outcomes visible beside lie and scoring context
  while returning more vertical space to the play controls.
- **2026-07-31:** Restricted Driver to tee-shot strategy choices. Fairway,
  rough, and recovery plans now begin with the longest suitable fairway club,
  preventing Driver from being recommended after the opening shot. Added a
  tee-versus-fairway regression test, replayed Warrenbrook hole 1 in the
  browser, and raised the baseline to 146 tests.
- **2026-07-31:** Reduced the desktop and tablet Club/Power panel to roughly
  75% of its former height by tightening control padding, section spacing, the
  club selector, and the power slider without reducing label or value text.
- **2026-07-31:** Reduced the desktop/tablet map toolbar to roughly 75% of its
  former height. The Approach View hint, View actual hole, Enlarge line, and
  Reset hole controls retain their wording with tighter vertical padding and
  action spacing; mobile keeps its touch-sized toolbar treatment.
- **2026-07-31:** Corrected anomalous third-shot plans reported on Meadows hole
  1. Reachable shots no longer fall back to long-shot logic when green targets
  deduplicate, preventing partial fairway woods from replacing valid approach
  clubs. Smart layups now select and validate interior fairway points instead
  of accepting a route-line point in rough. Added two regression tests and
  raised the baseline to 148 tests.
- **2026-08-04:** Updated the Phase 3 record after completing the local-image
  Course Mapper workflow, Cranbury installation, the two-choice caddie model,
  meaningful single-plan recommendations, short-game guidance, Supabase account
  authentication and password recovery, cross-device unfinished-round resume,
  and account-level playing profiles. Verified 79 browser tests and 116 Python
  tests (9 optional-integration skips). Set account-backed completed-round
  history and condition-aware lifetime player learning as work package 6 and the
  next project milestone.
- **2026-08-04:** Started Phase 3 work package 6. Added idempotent account-backed
  completed-round archiving, authenticated retrieval, and a responsive Player
  Account round-history ledger. Verified duplicate sync protection and multiple
  distinct rounds, then raised the baseline to 198 tests (9 optional-integration
  skips). Set condition-aware shot-observation extraction and confidence rules
  as the next implementation step.
- **2026-08-04:** Completed work package 6 observation extraction, confidence
  gating, and deterministic verified-pattern calculation. Added the Player
  Learning evidence-book UI, enforced an eight-comparable-shot/three-round
  minimum, and restricted preferred-distance analysis to appropriate approach
  shot types. Raised the baseline to 204 tests (9 optional-integration skips).
  Set verified-pattern integration with caddie advice and reviews as next.
- **2026-08-04:** Removed simulated distance-band ability claims after review.
  Player Learning no longer displays distance-volume evidence, creates a
  preferred approach band from game-generated outcomes, or uses that band to
  rank and explain caddie layups. Older stored distance patterns are filtered at
  both browser and server boundaries. Learning remains focused on genuine
  course-management decisions. Verified 82 browser tests and 130 Python tests
  (9 optional-integration skips).
