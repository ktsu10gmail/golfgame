# Phase 2 — Full-Shot Engine

Phase 1 remains the playable browser prototype. Phase 2 builds the authoritative,
framework-independent simulation engine alongside it so the UI can migrate in
small, testable slices.

## Work package 1: deterministic engine foundation

Implemented in this package:

- canonical immutable contracts for clubs, lies, intent, environment, geometry,
  result packets, and audit records;
- versioned 80+, 90+, and 100+ calibration fixtures;
- target-line and perpendicular coordinate projection;
- bounded carry and lateral distributions;
- seeded quality states and correlated quality modifiers;
- lie, slope, elevation, wind, surface, and intent modifiers;
- derived per-shot seeds from round, hole, and stroke identity;
- trace samples and priority-based landing-surface resolution;
- deterministic replay, geometry, modifier, fixture, and calibration smoke tests.

The engine owns numerical facts. The browser UI and future AI Game Master must
consume its Result Packet and may not rewrite the outcome.

## Work package 2: real course-data adapter

Completed in `packages/golf_domain/course_adapter.py`:

- one validated adapter for the native Middlesex and Warrenbrook JSON schemas;
- canonical meter-to-yard conversion for routes, regions, and declared distance;
- immutable adapted-hole contracts for all 72 holes across four courses;
- explicit priorities for overlapping tee, fairway, rough, green, bunker, water,
  out-of-bounds, and native/obstruction regions;
- tee and pin playable-surface validation;
- clear source-qualified errors for malformed course data;
- seeded engine integration tests against real course greens and browser-surface
  checks for Meadows, Warrenbrook, Cranbury, and Galloping Hill.

## Explicitly deferred

- persistent player progression and multi-round trend dashboards;
- fully course-specific strategy exceptions.

## Work package 3: browser Result Packet integration

Completed in `packages/simulation/browser_engine.mjs` and `app.js`:

- full-shot requests use canonical yard coordinates and engine contracts;
- Python and browser engines share the same `full-shot-v3` seed and random stream;
- each full shot produces one authoritative landing, surface, remaining distance,
  trace, and audit packet;
- per-round seeds persist in browser storage;
- saved shot history retains both the packet and its complete replay request;
- golden parity, exact replay, both-course, and water-surface browser tests pass;
- prototype putting remains isolated for the later authoritative putting package.

## Work package 4: authoritative penalty and relief workflows

Completed in both simulation runtimes and the browser:

- `penalty-relief-v1` records carry the reason, penalty strokes, relief method,
  reference point, resolved ball position, and resulting surface/region;
- water uses a deterministic last-boundary-crossing relief position;
- out of bounds uses stroke-and-distance;
- playable balls can be declared unplayable through a one-stroke browser action;
- scoring, next-shot position, narration, and saved history consume the relief
  record instead of calculating a provisional 72% drop;
- the numerical engine remains `full-shot-v3`, preserving every existing replay
  seed and ball-flight result.

## Work package 5: persistent round state and transactional shot handling

Completed in `packages/simulation/round_state.mjs` and `app.js`:

- versioned round-state documents persist one append-only history per course;
- legacy `history`, `scores`, and `round-seed` browser keys migrate into the
  canonical round document on load;
- full shots and declared unplayable relief commit as transactional append-only
  events with replayable payloads;
- browser hole recovery, replay reset, and full round reset rebuild from the
  reducer instead of scattered mutable fields;
- reload recovery, replay identity, and reset behavior are covered in the Node
  browser-state test suite.

## Work package 6: authoritative putting

Completed in `packages/simulation/putting.py`,
`packages/simulation/browser_putting.mjs`, and `app.js`:

- deterministic `putt-v1` packets now replace the browser-only putting path;
- Python and browser runtimes share seed identity, pace variation, lateral
  dispersion, make probability, and landing resolution for putts;
- putting packets record landing, remaining distance, decision quality inputs,
  and immutable audit identity;
- browser putt analysis and saved shot history now consume the authoritative
  putting packet rather than prototype-only randomness;
- Python and browser parity tests cover deterministic replay and canonical
  golden-putt output.

## Work package 7: deterministic decision scoring and round analysis

Completed in both simulation runtimes and `app.js`:

- every new full shot and putt stores a `decision-score-v1` strategy packet;
- decision quality remains independent from execution and luck;
- putts grade line plan, pace plan, and three-putt avoidance;
- `round-strategy-v1` applies stable shot-type weights and produces hole scores,
  a round score, category subscores, strengths, priorities, key moments, and
  repeated strategic patterns;
- old saved rounds without strategy packets remain readable without fabricated
  grades;
- the round-review UI and AI payload consume the same deterministic analysis;
- Python and JavaScript golden fixtures verify aggregation parity.

## Verification

The Python suite has no third-party runtime dependencies:

```bash
python3 -m unittest discover -v
```

The browser Result Packet tests use Node's built-in test runner and have no
package dependencies:

```bash
node --test tests/*.test.mjs
```

## Next work package

Move the remaining browser-local greenside chip simulator into the authoritative
cross-runtime engine so every gameplay outcome comes from an engine packet.
