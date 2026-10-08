# Mapper and game owner session progress — 2026-10-08

## Scope and evidence

This report records user-requested owner development in `/home/ksu/golfgame` and local runtime work from this chat. The NAS coordination folder contains knowledge, not application source. This is a session report, not an independent acceptance or a replacement for frozen WP11 checkpoints. Existing unrelated owner changes were preserved; no release commit was created. No credentials or account data are included.

IMPLEMENTED: items below in owner source. TESTED: targeted checks below. APPROVED: user requested these changes; no independent release acceptance claimed. DEPLOYED: selected changes loaded in local game/Mapper services. PUBLICLY_AVAILABLE: UNKNOWN; automated public-site access returned HTTP 403. Do not infer public availability from local checks.

## Implemented behavior

- Imported OSM start tees default to blue B, with black P for the route endpoint. Mapper supports choosing blue, white, or forward as the starting tee. Secondary markers and boxes are generated from available scorecard yardages during preview/preparation.
- Calibration input uses Blue tee → Green Center yardage and blue scorecard values instead of white values. Automatic per-hole scaling to scorecard distances was discussed, but NOT implemented. Straight tee-to-pin distance, green-center distance, and dogleg route distance remain distinct.
- Removed automatic green enlargement; render mapped green geometry at its supplied size.
- Added a five-yard light-rough first cut around fairways, with regular default rough beyond. Mapper and Python course validation no longer require explicit rough polygons when default rough applies; tee/green and other readiness checks remain.
- Added shared illustrated renderer and all-hole Mapper previews: flat green style requested by the user, varied canopy imagery and shadows, decorative trees kept clear of playing features and tee-to-green corridors. Current prototype density is 0.3 and canopy scale 1.5; Alta Vista Hole 3 has an additional 2x canopy scale. Par-three holes without fairways receive trees beside their approach corridor. Decorative trees do not alter gameplay collision geometry.
- Game full-hole/terrain rendering uses installed geometry and the shared decorative tree layer rather than legacy baked artwork. Existing GPS/replay and close-up interactions remain.
- Fixed Mapper startup module access by adding renderer and first-cut modules to the static-file allowlist.
- Normalized empty production context to null during package export, preserving rejection of malformed supplied identities.
- Optional scorecard tees: one, two, or three sets are supported. Readiness requires markers/boxes only for tees with positive yardages. Missing colors are not assigned invented yardages. Preview/export use an available tee when white is absent; legacy white-origin calibration anchor keys remain for compatibility.
- Fixed Mapper dotted route to use the selected start tee rather than requiring white. Blue-only courses can show the route to the pin.
- Added state suffix to Mapper Library list, selection accessibility labels, revision-history and source-review titles. This does NOT change the editable course-name field or game course menu. User reported state still missing; exact display location remains unresolved.
- Existing Selected geometry → Feature type already supports reclassifying polygons as tee, fairway, rough, green, bunker, water, trees, cart path, hole outline or out of bounds. Instructions supplied; no new category implementation was needed.

## Local course installation

Alta Vista Country Club saved Library revision 3 was exported and installed through the existing mapped-course CLI as `osm-relation-3568943`. Local catalog and all 18 hole files were verified; Library install verification returned true. Mapper/game services were restarted. This owner-session action is separate from the isolated WP11D release-boundary work and does not establish that its staged-install/publication model has been merged, accepted or deployed. Coordination checkpoints describe an isolated boundary; runtime parity remains an audit question.

## Validation recorded during the session

- Optional-tee change: 62 Mapper tests passed, including blue-only, blue/forward, white-only and forward-only export/preview, deterministic GPS calibration and missing scorecard columns.
- Dotted-route follow-up: 63 Mapper tests passed; editor JavaScript syntax check passed.
- Python mapped-course import and static-file tests: 13 passed with local socket access. An initial sandbox run could not open sockets; rerun passed.
- Live local Mapper served the optional-tee module with HTTP 200. Mapper restarts completed for optional tees and dotted-route fixes.
- Earlier renderer/game checks recorded 132 targeted passing checks; backend installation-fix run recorded 20 Python checks. These are separate runs, not an additive whole-repository acceptance total.
- Earlier desktop/mobile renderer inspection found no horizontal overflow at 390px viewport. Screenshot artifacts predate later tree-density adjustments.
- State-suffix change passed JavaScript syntax check; visual confirmation is outstanding.

## Pending and investigated issues

1. CSV source change was STOPPED at user request before any config/data changes. Old clean directory and proposed NAS `jetta_us_course_directory_latlon.csv` each have 14,567 rows. Proposed file adds Latitude/Longitude; 9,173 rows have both coordinates. Existing preferred-course importer requires exactly five base columns, so merely changing its path would reject the new format. No new intake or source switch was completed in this task.
2. Pebble Beach Golf Linkstm CA: Library status Needs review, revision 0, one attempt; note says zero exact facility matches. Trailing `tm` is a possible name-matching cause, not verified source truth. Manual verified OSM match is still required; no facility substitution was made.
3. Bunker Hill Golf Course NJ: saved revisions 3 and 4 contain forward yardages, with blue/white zero. Example Hole 1: forward 366 yards. User states OpenGolfAPI has no scorecard; pasted snippet must work independently. Requested the actual snippet to diagnose tee-column mapping; no correction yet.
4. All-18-hole automatic scorecard scaling: feasibility discussed only. Needs explicit handling of straight/route/green-center distance before implementation.
5. State suffix visibility: Library display code updated, but user still reports missing state. Determine whether they mean Library, editable name, or game menu before extending the change.

## Relevant owner files

`packages/editor/course_mapper.mjs`, `packages/editor/game_map_preview.mjs`, `packages/editor/illustrated_hole_prototype.mjs`, `packages/simulation/fairway_first_cut.mjs`, `packages/golf_domain/course_adapter.py`, `scripts/public_files.py`, `editor.js`, `editor.html`, `app.js`, `tests/course_mapper.test.mjs`, `tests/test_mapped_course_import.py`, `tests/test_public_files.py`, `docs/COURSE_MAPPER.md`, `docs/COURSE_VISUAL_RENDERER_PROTOTYPE.md`.
