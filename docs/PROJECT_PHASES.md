# Project Phase Status

Last updated: 2026-07-29

This is the project-level source of truth for phase progress. Update this file
whenever a phase or major work package is completed.

## Current position

**Active phase:** Phase 2 — Authoritative Golf Engine  
**Current work package:** Add decision scoring and AI Game Master narration  
**Verification baseline:** 95 automated tests defined (71 Python, 24 browser)

The browser now consumes deterministic, cross-runtime Result Packets for full
shots and putting, including authoritative penalty strokes and relief
positions. Persistent round-state recovery and authoritative putting are now
complete. The next work package is decision scoring and AI Game Master
narration driven by engine results.

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

**Status: In progress**

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

### Remaining Phase 2 work

1. Add persistent round state and transactional shot handling. **Complete**
2. Add putting to the authoritative engine. **Complete**
3. Add decision scoring and AI Game Master narration based on engine results. **Next**

Phase 2 is complete only when the browser consumes authoritative engine result
packets for full gameplay rather than calculating outcomes independently.

## Phase 3

**Status: Not yet defined**

Define Phase 3 after Phase 2 integration is stable and its remaining product
goals can be prioritized with evidence from gameplay testing.

## Update log

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
