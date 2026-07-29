# Middlesex — The Strategy Round

A dependency-free, browser-based strategic golf game with four 18-hole courses:

- The Meadows at Middlesex
- Warrenbrook Golf Course
- Cranbury Golf Club
- Galloping Hill Golf Course

## Run locally

From this folder:

```bash
python3 scripts/serve.py --port 8080
```

Then open `http://localhost:8080`.

The app must be served over HTTP because browsers do not allow JavaScript modules to load course JSON from a `file://` page.

### Gemini-backed AI narration

To enable Gemini as the primary Game Master provider, start the server with:

```bash
export GEMINI_API_KEY="your-key"
export GEMINI_MODEL="gemini-2.5-flash"
python3 scripts/serve.py --port 8080
```

If `GEMINI_API_KEY` is not set, the app still works and falls back to its
built-in local commentary heuristics.

## Included

- All 72 supplied hole layouts across four courses
- Course selection with separate saved rounds
- Reference imagery for every hole at all four courses
- Scorecard-authoritative par, handicap, and Blue/White/forward-tee yardages
- Multiple tee positions, including correctly labeled Gold tees at Cranbury and
  Galloping Hill
- 80+, 90+, and 100+ player profiles
- Customizable copied profiles saved in the browser
- Club selection, aim preview, shot dispersion, lie effects, penalties, scoring, pin positions, and round scorecard

## Phase 2 engine foundation

The production-oriented, deterministic full-shot engine is being developed in
`packages/` alongside the Phase 1 browser prototype. It currently includes
versioned player and lie fixtures, bounded shot distributions, seeded quality
states, coordinate projection, environment and lie modifiers, path samples,
landing-surface resolution, replay data, immutable audit packets, and a validated
yard-based adapter for all 72 real course holes. Browser full shots now consume
the same deterministic Result Packet contract and retain their complete replay
identity and canonical request. Water, out-of-bounds, and declared-unplayable
outcomes now use versioned authoritative relief records rather than provisional
browser drops.

Run its dependency-free test suite with:

```bash
python3 -m unittest discover -v
node --test tests/browser_engine.test.mjs tests/round_state.test.mjs
```

See `docs/PHASE_2.md` for the work-package boundary and next integration step.
See `docs/PROJECT_PHASES.md` for the current project phase, completion criteria,
and progress history.

## Course data layout

Each course is self-contained under `data/<course-id>/`:

```text
data/themeadow/
  scorecard.csv
  hole1.json … hole18.json
  images/hole1.png … hole18.png

data/warrenbrook/
  scorecard.csv
  hole1.json … hole18.json
  images/hole1.png … hole18.png

data/cranbury/
  scorecard.csv
  scorecard-source.txt / scorecard-source.png
  hole1.json … hole18.json
  images/hole1.png … hole18.png

data/gallopinghills/
  scorecard.csv
  scorecard-source.txt / scorecard-source.png
  hole1.json … hole18.json
  images/hole1.png … hole18.png
```

Shared engine calibration fixtures remain in `data/fixtures/`.
