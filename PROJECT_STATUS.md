# Project Status

Updated: 2026-09-01

## Current status

The working tree contains a large, uncommitted set of simulator, Game Master competition, GPS, Course Editor, course-import, UI, documentation, and test changes. Preserve all existing changes and do not assume every dirty file belongs to one feature.

The Landing Target / Rule-of-12 short-game improvement is implemented and verified. Player and Game Master execution also use independent reproducible random identities, so matching profiles and decisions do not normally produce matching shots. The Green Fringe specification has been reviewed only; no fringe code has been implemented.

Current verification is green:

- `node --check app.js`
- `node --test tests/*.test.mjs`: 248/248 passing
- `python3 -m unittest discover -s tests -p 'test_*.py'`: 179 passing, 9 skipped
- `git diff --check`
- Real-browser desktop and 390px mobile checks passed without console errors

`pytest` is not installed in the active interpreter, so use the standard-library unittest command above unless the intended Python environment is activated.

## Completed in the latest session

- Added explicit `direction_target` and `landing_target` aim semantics.
- Direction Target preserves manual swing power and treats the marker as an aim line.
- Landing Target treats the marker as intended first landing/carry, continuously calculates Auto Power from profile carry and lie, and disables manual power.
- Landing Target is available inside 100 yards and defaults for appropriate shots inside 30 yards; putting retains Direction Target behavior.
- Actual landing remains probabilistic through the existing greenside engine. A 16-yard landing target with a 50-yard full-carry sand wedge solves to 32% nominal power, but does not guarantee a 16-yard actual landing.
- Added Rule-of-12 candidate generation for supported 7I-through-wedge clubs. The heuristic proposes candidates; the existing multi-run evaluator ranks them.
- Club comparison shows Auto Power, expected carry/roll, successful-finish probability, and leave. Safe & Smart and aggressive-proximity recommendations use the same 120-shot simulation assumptions.
- Lie, bunker variability, mapped hazard clearance, landing surface, and simulated green-contour slope affect evaluation. Unreachable and unsafe selections are blocked explicitly.
- Saved shots retain aim type, landing coordinate/distance, selected club, Auto Power, expected carry/roll/finish, candidates, Rule-of-12 choice, simulation recommendation, evaluator version, seed, and sample count.
- Game Master/AI payloads and round review distinguish landing targets from direction lines and use saved engine evidence.
- Added desktop/mobile aim controls, target labels, Auto Power presentation, comparison UI, cache updates, and player-guide documentation.
- Browser validation found and fixed a bug where changing clubs could invent a new landing marker.
- Player and Game Master matching shots now have independent, reproducible participant execution identities; decision locking and profile fairness remain intact.

## Important design decisions

- Landing Target sets nominal carry, not a forced outcome. Random skill/lie dispersion remains authoritative.
- Direction Target never silently changes to landing semantics merely because a shot is short.
- Rule of 12 is explanatory prior knowledge, not physics and not the final recommendation.
- Short-game candidates reuse the existing greenside simulator and multi-run evaluator; no duplicate dispersion engine was added.
- Game Master competition fairness is based on decisions being locked before outcomes. Separate random identities produce independent executions without giving either participant information about the other's future result.
- The original landing target and evaluation evidence are persisted rather than reconstructed during replay.

## Green Fringe proposal — reviewed, not implemented

Specification: `improvement/jetta_green_fringe_surface_improvement_codex_spec.md`.

The proposal is valuable and complements Landing Target, but its core work is a shared surface-transition rollout model, not merely a new visual surface.

Repository findings:

- Python `SurfaceType.FRINGE` already exists, but there is no fringe lie catalog entry or browser gameplay mapping.
- The visible green-fringe SVG stroke is decorative only.
- Course geometry, editor tools, `lieAt`, canonical surfaces, result-lie mapping, and replay packets do not yet contain gameplay fringe.
- Greenside rollout currently applies one landing-surface factor to the entire roll and resolves only the final surface.
- Putter/putting mode currently requires the ball lie to be exactly Green.
- The repository has no robust polygon buffer/difference dependency.

Recommended fringe architecture:

1. Add versioned `fringe_zones` with imported/manual/generated source metadata, editor support, rendering, and classification.
2. Represent a generated collar as an outer green footprint overlapping the green, with precedence `out-of-bounds/water/bunker > green > fringe > fairway/rough`. This fits the current simple-polygon schema; a true polygon ring would require holes/multipolygon support.
3. Keep generated fringe opt-in for existing published courses and never overwrite manual fringe without an explicit action.
4. Build one deterministic segment-aware rollout integrator shared by greenside shots and fringe putting. It should return per-surface distances and transition order, applying green contour only while on green.
5. Feed authoritative transition evidence into Landing Target evaluation, Game Master facts, and replay.
6. Preserve the current no-fringe physics path and golden results for legacy courses.

Specification details to clarify before implementation:

- It says “two” geometry sources but lists imported, manual, and generated.
- Define whether manual fringe is an outer collar footprint, standalone strips, or both.
- Define exact boundary ownership/tolerance.
- Choose one calibrated resistance/energy contract instead of ambiguous placeholder coefficients.
- Expected surface distances should come from multi-run evaluation; actual distances should come from the authoritative result packet.

## Important files for the latest work

- `app.js`
- `index.html`
- `styles.css`
- `USERGUIDE.md`
- `packages/simulation/browser_short_game.mjs` (new)
- `packages/simulation/browser_greenside.mjs`
- `packages/simulation/competition.mjs`
- `tests/browser_short_game.test.mjs` (new)
- `tests/browser_greenside.test.mjs`
- `tests/competition.test.mjs`
- `tests/round_state.test.mjs`
- `improvement/jetta_landing_target_rule_of_12_short_game_codex_spec.md`
- `improvement/jetta_green_fringe_surface_improvement_codex_spec.md`

## Known gaps and cautions

- Green Fringe is not implemented.
- The earlier mobile competition edge case still merits an end-to-end check: player holes out while the GM needs multiple final putts, with every GM putt visible before player completion UI.
- The worktree is extensively dirty and includes pre-existing or unrelated changes. Review exact diffs before staging or committing.
- `apikey.md`, `AlienVault_OSSIM_64bits.iso`, many `output/playwright/` assets, course datasets, and other untracked files must not be staged without explicit review. `apikey.md` may contain credentials.
- `PROJECT_STATUS.md` itself is currently untracked, so persistence depends on preserving the workspace unless it is intentionally added to version control.

## Recommended next steps

1. Decide whether to implement the Green Fringe proposal and confirm the recommended overlapping outer-footprint geometry representation.
2. If approved, implement fringe in staged layers: domain/geometry/editor first, shared transition rollout second, fringe putting/strategy/evidence third, generated-course validation last.
3. Re-run the complete JavaScript and Python unittest suites after each physics layer; protect legacy no-fringe golden results.
4. Complete the outstanding mobile competition final-putt scenario.
5. Review and stage only intentional files; do not bulk-add the dirty workspace.
