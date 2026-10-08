# Automated Course Builder Beta — implementation record

## Repository-grounded approach

Reuse `OpenStreetMapImportService.search/preview/commit`, its bounded provider
and response cache, `golf-course-map-v1`, editor readiness functions, the
existing password/session + loopback service boundary, and explicit game
installation. Do not invoke Golf Intelligence or spend credits automatically.

Input: `Courses/jetta_us_course_directory_latlon_10022026_0123pm.csv`.
CSV columns currently lack Course ID, so resolve existing directory IDs using
the established directory identity algorithm; persist an intake identity for
any unmatched entry. Later changed names/coordinates are reviewed, not erased.

Create `packages/course_import/library.py`, a private SQLite ledger and
immutable `.golfmap` revisions under `Courses/drafts` / `Courses/projects`;
write summaries under `Courses/reports`. Create a bounded validation script
calling existing JS project/readiness functions, and deterministic tests.
Modify `scripts/serve.py`, `scripts/mapper_access.py`, `editor.html/js/css`,
`.gitignore`, OSM completeness diagnostics, and installation tracking.

Protected `/api/v1/course-library/` endpoints provide listing/search, intake,
bounded queueing, pause, explicit retry/reimport, open, revision save, and
reports. App owns the ledger/worker; Mapper only proxies authenticated calls.
One background worker, finite attempts, delayed retries, persisted claims,
restart recovery, explicit operator start, no unattended publication.

UI: reuse Mapper survey-sheet colors/typography. Library rows have separate
mapping and installation columns. Its signature is a two-stage status strip
(`Draft → Game`), not one misleading Done badge. Responsive rows and keyboard
focus retain existing UI tokens; no new fonts or decorative dashboard charts.

## Known limits / rollout gates

The current editor supports 18 or three nines (27). 36-hole or ambiguous
numbering must be preserved and flagged, not converted silently. No working
OpenGolfAPI adapter exists in this repository; provider credentials/data
contract and licensing must be established before combined-source enrichment.
Do not invent scorecard values. Tree-row/woodland geometry is not evidence of
surveyed trees. Missing enrichment cannot be labelled complete.

Initial rollout stages the CSV only. Starting live OSM batches requires an
operator action; default batch size is small. Daily intake scheduling is not
enabled until upload path/schedule/retention are approved. Excel remains
unsupported at this initial CSV-first milestone.

Existing installer writes multiple files/packages sequentially. Atomic
multi-package publication, game rollback and historical geometry versioning
require further implementation before claiming that aspect of the full spec
complete. Project revision history alone is not live-game rollback.

## Reviewed source updates (second milestone)

`packages/course_import/review.py` implements geometry-only three-way review;
`library_source_baselines` and `library_source_updates` extend the private ledger
without modifying account/licensing schemas. The existing single worker also
processes bounded fresh-source checks, with independent run controls so source
checks do not implicitly resume paused initial imports. Pause stops both queues;
explicit Resume resumes both. Pending checks/reviews are unique per course.

Protected API additions: `check-source`, `source-review`, `source-project`,
`apply-source`, `discard-source`, `history`, `restore-revision`, and `resume`.
`project` accepts a revision for historical downloads. Geometry acceptance is
explicit, removals are never automatic, scorecard/identity fields remain local,
and stale reviews/restores are rejected. Source checks do not touch live installs.
History is immutable; project restore creates another draft revision.

The three-way comparison baseline advances after an explicit completed review
even if some source changes are declined, so ignored changes are not proposed
again every day. Future source changes still conflict with retained local edits.
No-change source observations do not create timestamp-only project revisions.
Candidate drafts are stored privately under `Courses/drafts/<id>/source-*.golfmap`.

## OpenGolfAPI scorecard enrichment

`packages/course_import/opengolfapi.py` adds bounded, server-side OpenGolfAPI
reads. Initial CSV/OSM imports attempt an exact name/state match within 15 km;
missing, unavailable, or ambiguous scorecards never stop an OSM draft. The
Course Library also provides an explicit **Import scorecard** action for saved
drafts. The API key is read only from `.env`, sent as a Bearer token, and never
returned to the browser.

The merge imports official par, handicap index, supported named tee yardages,
and tee rating/slope metadata with field provenance. It never substitutes a
GPS-calculated distance for an official yardage and never copies a different
tee's distance into a missing Blue, White, or Forward field. Missing tee sets
remain a readiness issue. OpenGolfAPI identity stays separate from OSM and
Jetta course identities.

Tests cover CSV validation/idempotence, unchanged daily intake, duplicate
provider identity, retry exhaustion/recovery, partial source data, immutable
revisions/concurrent save conflicts, private paths, existing auth boundary,
existing Mapper and installer regressions. No secrets/runtime data committed.

Final verification, 2026-10-02: 80 Python regression tests passed; the existing
Mapper Node test file (41 declared cases) passed; JavaScript syntax and Git
whitespace checks passed. Both application services were restarted and verified
active. Local protected-API smoke checks verified the library and blocked private
CSV/database/report paths. Browser checks verified real revision history and,
using browser-only fixtures with all library requests intercepted, unchecked
review defaults, safe-only selection and the mobile review layout. No installed
course was changed by these checks. Both import and source queues remain paused.
