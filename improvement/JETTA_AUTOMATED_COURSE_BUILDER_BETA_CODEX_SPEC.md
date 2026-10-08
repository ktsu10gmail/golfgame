# Jetta Automated Course Builder --- Beta Codex Specification

## Specification scope and approval boundary

This revision incorporates the agreed spreadsheet-driven OSM batch import,
persistent processing ledger, private project storage, Mapper Course Library,
and explicit installation/update workflow. It defines requirements only;
application implementation still requires the repository-grounded plan below.

## Objective

Minimize human effort from **Coach/Player requests a preferred course →
course is READY in `golfgame.jetta.com`**.

The system should automatically assemble the best possible Jetta course
draft from OpenGolfAPI and OpenStreetMap (OSM), then hand the draft to
the existing Golf Mapper for review, furnishing, readiness validation,
final preview, and explicit installation.

``` text
Coach / Player requests course
        ↓
Course Request Queue
        ↓
[ BUILD COURSE ]
        ↓
OpenGolfAPI + OpenStreetMap
        ↓
Automated Course Builder
        ↓
Best possible Jetta course draft
        ↓
Golf Mapper
        ↓
Operator fixes/furnishes only what is missing or wrong
        ↓
Readiness Validation
        ↓
Final Game Preview
        ↓
[ INSTALL COURSE ]
        ↓
golfgame.jetta.com
        ↓
READY
```

The goal is not to eliminate human review. The goal is to eliminate
repetitive manual course construction.

## Definition of a good automated course

Where source data supports it, the automated draft should contain:

-   Correct course identity and correctly identified 18-, 27-, or 36-hole
    layouts, with explicit nine-hole/course grouping where needed.
-   Blue, White, and Red tees.
-   Par and stroke index/handicap by hole.
-   Official yardage for each tee/hole.
-   Course rating and slope where available.
-   Course boundary and hole routes.
-   Tee locations/areas, fairways, greens, bunkers, water/hazards.
-   Individual trees, tree rows, and wooded/vegetation areas where
    available.
-   Correct geographic placement in WGS84 `{lat,lng}`.
-   Jetta-calculated tee-to-target/pin/reference distances where
    reliable.

Official scorecard yardage and Jetta-calculated geographic distance are
separate facts. Never manufacture an official scorecard yardage from
geometry.

## Source responsibilities

### OpenGolfAPI

Use primarily for structured course and scorecard information:

-   Course identity/name/location
-   Hole number
-   Par
-   Stroke index/handicap
-   Tee sets and tee names/colors
-   Hole yardages
-   Course rating/slope
-   Other useful metadata actually supplied by the source

Do not assume every field exists for every course.

### OpenStreetMap (OSM)

Use primarily for geographic/course-map information:

-   Course boundary
-   Numbered hole routes
-   Greens
-   Fairways
-   Tee areas
-   Bunkers
-   Water
-   Other golf geometry
-   Individual trees
-   Tree rows
-   Wooded/vegetation areas

Do not require OSM to contain a complete course before importing useful
geometry.

### Golf Intelligence

Golf Intelligence remains an explicit fallback. Never invoke it
automatically or spend credits automatically. The operator chooses it
when OpenGolfAPI + OSM do not provide enough useful information.

## Deterministic merge rules

Suggested Beta source ownership:

  -----------------------------------------------------------------------
  Jetta information       Preferred source        Fallback
  ----------------------- ----------------------- -----------------------
  Course identity         Jetta/OpenGolfAPI       Operator
                          directory identity      

  Course name             OpenGolfAPI             Operator

  Location                OpenGolfAPI             OSM / Operator

  Hole number             OpenGolfAPI + reliable  Operator
                          OSM `ref`               
                          reconciliation          

  Par                     OpenGolfAPI             OSM / Operator

  Stroke index            OpenGolfAPI             OSM / Operator

  Tee names               OpenGolfAPI             OSM / Operator

  Official tee yardage    OpenGolfAPI             Operator

  Rating / slope          OpenGolfAPI             Operator

  Course boundary         OSM                     Operator

  Hole route              OSM                     Operator

  Green/fairway/tee       OSM                     Operator
  geometry                                        

  Bunker/water geometry   OSM                     Operator

  Individual tree         OSM                     Operator
  locations                                       

  Tree rows / wooded      OSM                     Operator
  areas                                           
  -----------------------------------------------------------------------

If sources disagree, do not silently overwrite. Surface the conflict for
operator review.

## Course identity and OSM resolution

Begin with Jetta's immutable `directory_course_id`.

``` text
directory_course_id
        ↓
OpenGolfAPI record
        ↓
known coordinates/location
        ↓
bounded OSM query
        ↓
candidate golf facility
        ↓
operator confirmation when needed
```

Do not solve global geocoding for Beta. Do not silently select an
ambiguous OSM facility.

Keep identities separate: Jetta directory ID, OpenGolfAPI identity, OSM
identity, Mapper project identity, and installed Jetta course identity.

## Partial OSM import

Missing numbered OSM hole routes must not stop the whole import.

If OSM has a boundary, greens, fairways, bunkers, tees, water, or
vegetation, import reliable features into the Mapper even when automatic
hole assignment is incomplete.

Do not guess uncertain hole assignments based only on proximity. Surface
uncertainty for operator review.

## Trees and vegetation

Automating trees is important because manual tree creation is expensive
operator work.

### Individual trees

When OSM supplies an individual tree location, create the corresponding
editable Jetta tree at that geographic location and preserve OSM
provenance.

### Tree rows

When OSM supplies a tree-row geometry, Mapper may create an editable
vegetation/tree representation. If Jetta generates individual trees
along the row, record that they were generated from the row rather than
representing exact OSM tree measurements.

### Wooded areas

A wooded polygon means the area is wooded; it does not establish every
tree location. Jetta may create an editable/procedural vegetation
representation inside the area, but generated vegetation must remain
distinguishable from exact mapped trees.

Never represent generated trees as surveyed/exact tree locations.

Missing decorative trees alone should not necessarily prevent
installation. If vegetation materially affects gameplay,
readiness/review should surface strategically important deficiencies.

## Distance handling

Keep these separate:

**Official scorecard distance** --- provider-supplied, e.g. White Hole 7
= 391 yards from OpenGolfAPI.

**Calculated geographic distance** --- calculated by Jetta from mapped
geometry.

Never replace official scorecard distance with a calculated value and
present it as official.

Large discrepancies should produce warnings because they may indicate a
wrong tee, green, hole assignment, geometry, or source value.

## Provenance

The Mapper draft must retain enough provenance to explain where imported
information came from. Extend existing Jetta models rather than creating
a parallel course format.

Conceptually:

``` json
{
  "hole": 7,
  "par": {"value": 4, "source": "opengolfapi"},
  "white_yardage": {"value": 391, "source": "opengolfapi"},
  "green_geometry": {"source": "openstreetmap"},
  "trees": {"source": "openstreetmap"}
}
```

Providers produce import drafts. Jetta owns the canonical course model.

## Spreadsheet-driven batch import

Accept CSV as the initial baseline. Excel `.xlsx` support must be explicitly
identified in the implementation plan, including validation and dependency
cost; do not claim it is supported before implementation.

Input columns: `Course ID`, `Course Name`, `State`, `City`, `Latitude`,
`Longitude`. Validate required identity/location fields, coordinate ranges,
duplicate rows, file size and row limits before processing. Return row-level
errors without silently changing coordinates or dropping rows.

`Course ID` is a permanent input identity. Reuse `directory_course_id` for
known directory courses. Otherwise persist a local intake identity and its
directory reconciliation; do not create a different identity on every upload.
Names or row positions alone are not reliable identifiers. Keep the input ID,
directory ID, provider IDs, project ID, and installed course ID separate.

For each eligible row:

1. Resolve the course near the supplied coordinates using name/city/state
   evidence and bounded queries. Ambiguous matches require review.
2. Import reliable OSM geometry into the existing canonical Mapper draft.
   Structured source enrichment follows the existing source rules; absence
   of OpenGolfAPI data must not stop useful OSM-only imports.
3. Assess expected layout and geometry completeness.
4. Persist the draft/project and ledger outcome atomically or recoverably.
5. Make it available in Mapper without opening a browser automatically.

One upstream request at a time per configured provider across manual and batch
work. Use a durable queue, successful-response caching, bounded retry/backoff,
provider cooldowns, and visible progress. Additional workers must not bypass
shared provider limits. Distinguish local queue waiting from upstream rate
limits, outages, and permanent missing-data outcomes. Configure attempt limits
and deadlines; do not retry indefinitely or promise completion during outages.

## Persistent ledger and daily spreadsheet updates

The private application ledger is authoritative, not a spreadsheet `Done`
cell. Track input/directory identity, matched provider identity, input
fingerprint, status, attempts, timestamps, next retry time, error/review reason,
project identity/path, and last successfully saved revision.

Batch statuses are separate from production request states:

| Batch status | Meaning and next action |
| --- | --- |
| New | Eligible, not yet processed |
| Queued / Importing | Pending or active work; duplicate submissions attach to it |
| Done | Validated complete import saved; skip on later uploads |
| Incomplete | Useful partial draft saved; no automatic daily reimport |
| Retry pending | Transient failure; retry only within configured limits |
| Needs review | Ambiguous match, changed identity/location, or unresolved conflict |
| Failed | Invalid input or exhausted retries; operator action required |

`Done` means import complete and saved, not installed or published. Missing
source data is not a transient failure. Provide explicit retry/reimport actions
for incomplete/failed courses when circumstances change.

Compare each daily upload with the ledger. Process new entries and eligible
retries only. Renamed courses and reordered rows must not duplicate work;
changed coordinates/provider matches on completed entries require review.
Deduplicate confirmed identical provider facilities across different input
rows while preserving legitimate separate layouts. Removing a spreadsheet row
must not delete its existing project or installation.

Protect against simultaneous uploads, repeated clicks, and process restarts
with idempotent claims and recoverable jobs. Never overwrite operator edits
with a rerun: retain the existing revision and surface imported changes for
review/merge. Produce a results CSV with Course ID, status, processed time,
project path, and notes; do not overwrite the operator's working spreadsheet.

Support manual batch submission first. Daily unattended processing requires
an agreed private intake directory, schedule/timezone, service configuration,
and restart/recovery behavior. It is not implied by simply uploading a file.

## Project storage and completeness

Designated private base directory: `/home/ksu/golfgame/Courses/`.

- `projects/`: complete imported projects and their revisions.
- `drafts/`: incomplete projects requiring review.
- `reports/`: batch summaries and row-level results.

Keep the authoritative ledger in existing private application storage. Exclude
generated course-library artifacts from Git and public static serving. Resolve
paths server-side using safe stable identifiers; never accept arbitrary browser
paths or use course names directly as filesystem paths. Apply backups, bounded
storage/retention, and owner-only or appropriately restricted service access.
Reuse the canonical project format and existing save/open operations.

Hole count alone is insufficient evidence of completeness. Validate unique
hole numbering within identified layouts, route/tee/green assignments, usable
geometry, coordinate consistency, and all existing readiness requirements.
Boundary/hazard coverage and missing scorecard facts must be reported honestly;
absence of a mapped hazard does not prove the course has none. Do not invent
holes, markers, yardages, or assignments to pass validation.

For 27-/36-hole facilities, inspect current canonical/editor/game limits first.
Represent constituent nines and playable packages explicitly when supported.
Never truncate to 18, collide repeated hole numbers between nines, or infer
combinations silently. If unsupported, preserve useful source data and mark
Needs review rather than claiming a complete/installable course. All required
packages must be verified before the production request becomes READY.

## Mapper Course Library and installed revisions

Provide a searchable library containing all persisted imports/projects,
including incomplete drafts, with course name, city/state, layout, mapping
status, import/update time, and installation status. Search and filter by
identity/location/status, then open the selected project in the existing
editor for review, editing, validation, preview, and explicit installation.

Keep two status dimensions distinct:

- Mapping: incomplete draft, needs review, or ready to install.
- Installation: not installed, installed/current, or updated project available.

Determine installation status from the App Server's authoritative installed
mapping and revision evidence, not a local boolean or timestamps alone.
Record project revisions, installed revisions, and package membership. Failed
or unavailable installation-status queries must show unknown/stale status,
not falsely show a course as current or uninstalled.

Editing an installed course creates an unpublished project revision; it must
not change the live game. An explicit `Update installed course` action must
run readiness validation and final preview and preserve stable installed
course identity. Retain the prior installed version for authorized rollback.
The implementation plan must address existing round/replay compatibility,
atomic package updates, concurrent edits, rollback, and install-failure recovery.

## Mapper experience

After Build Course, show what automation completed and exactly what
remains.

``` text
SCORECARD
✓ 18 holes
✓ Par / stroke index
✓ Blue / White / Red tees
✓ Yardages
✓ Rating / slope

COURSE MAP
✓ Boundary
✓ 18 greens
✓ 18 hole routes
✓ Fairways
✓ Bunkers
✓ Water
⚠ 31 tee areas found — review assignments
⚠ Tree coverage appears partial

JETTA READINESS
⚠ 2 items need attention

[ OPEN & FINISH COURSE ]
```

For incomplete source data, allow `[ OPEN PARTIAL DRAFT ]` and an
explicit `[ USE GOLF INTELLIGENCE ]` fallback.

The key operational question is: **What does the operator still need to
do before this course can be installed?**

## Mapper remains the quality-control layer

Automation creates a draft. The existing Mapper remains responsible for
review/furnishing, including hole and tee assignments, routes, greens,
fairways, bunkers, water, vegetation, pins/reference points, and
yardages.

Do not bypass the existing Map Editor. Do not automatically publish.

## Readiness and installation

Preserve:

``` text
Automated Draft
      ↓
Map Editor Review
      ↓
Per-hole Readiness Validation
      ↓
Final Game Preview
      ↓
Explicit Install Course
      ↓
Jetta App Server
```

Existing readiness validation remains authoritative. Partial automated
builds must not weaken installation requirements.

If a course requires multiple packages, do not transition its production
request to READY until all expected packages are installed and verified.

Successful Install Course updates the authoritative
directory-to-installed-course mapping and transitions the production
request to READY.

## Course Request Queue integration

``` text
REQUESTED
    ↓
[ BUILD COURSE ]
    ↓
IN_PROGRESS
    ↓
Automated Course Builder
    ↓
Mapper review/furnishing
    ↓
Install Course
    ↓
READY
```

Duplicate Coach/Player demand remains aggregated into one production
item. Additional requests for the same `directory_course_id` must not
create duplicate builds. A request for an already READY course must not
create another production job.

## External-source safety

Prevent repeated clicks from creating overlapping OSM requests. Provide
useful retry information on upstream rate limits. Use bounded retries,
response/element/geometry limits, coordinate sanity checks, and
configured/allowlisted endpoints.

Never expose server credentials to browser JavaScript.

## Authentication boundary

Golf Mapper does not require a Player, Coach, Developer, Supabase, or
separate Mapper operator account merely for Beta course production.
Preserve the subsequently approved existing local single-password Mapper
access protection. This feature must not remove it or add another login system.

Do not introduce a new account/role system for this feature.

Protect privileged Mapper-backend → Jetta-App-Server communication at
the server-to-server boundary using the smallest secure mechanism
consistent with the existing deployment.

Before changing authentication, inspect existing Mapper
deployment/network protection and App Server API architecture.

## Licensing and attribution

OpenGolfAPI and OSM-derived information may carry licensing,
attribution, and database obligations. Preserve sufficient
provider/source provenance for attribution and future licensing
decisions.

Do not make unsupported legal assumptions in code. Review the
data/licensing boundary before production release.

## Beta non-goals

Do not turn this into a generalized GIS platform. Defer unless
essentially free from existing code:

-   Fully automatic global geocoding
-   Automatic resolution of ambiguous facilities
-   Guessing missing official scorecard values
-   Guessing uncertain hole assignments
-   Perfect tree reconstruction from woodland polygons
-   New Mapper account/role system
-   Complex multi-operator workflow
-   Large provider abstraction rewrite
-   Additional Course Request Queue production states beyond `REQUESTED`,
    `IN_PROGRESS`, `READY` (the separate batch ledger states above are required)
-   Automatic Golf Intelligence invocation
-   Automatic publication without Mapper review
-   Rewriting the existing installation engine solely for this feature

## Implementation principle

Extend existing Jetta systems. Do not create a parallel course model,
Map Editor, readiness validator, or installation pipeline.

Providers produce import data. Jetta owns the canonical course model.
Mapper owns review/furnishing. Existing readiness validation determines
installability. Existing Install Course remains the final publication
action.

## Required tests

Cover at minimum:

-   OpenGolfAPI scorecard import
-   OSM geometry import
-   Combined OpenGolfAPI + OSM draft
-   Stable `directory_course_id`
-   Hole-number reconciliation
-   Blue/White/Red tee handling
-   Official yardage separate from calculated distance
-   Provider conflicts surfaced
-   Missing numbered OSM routes still produce useful partial draft
-   Individual OSM tree import
-   Tree-row handling
-   Wooded/generated vegetation provenance
-   Missing geometry surfaced clearly
-   Duplicate Build Course clicks
-   OSM rate-limit handling
-   Unauthorized App Server operations rejected
-   Server credential not exposed to browser
-   Partial install does not become READY
-   Complete successful install becomes READY
-   Already-READY request does not create duplicate production work
-   Existing Golf Intelligence import remains functional
-   Existing Map Editor remains functional
-   Existing readiness validation remains authoritative
-   Daily uploads skip completed courses despite row ordering/name changes
-   Duplicate rows/provider matches and simultaneous submissions are idempotent
-   Changed coordinates/identity require review; deleted rows do not delete projects
-   Crash/restart recovery and bounded upstream retries/cooldowns
-   Incomplete source data does not cause endless daily retries
-   Reimport preserves manual edits and prior revisions
-   Filesystem traversal, private storage/static restrictions, and Git exclusions
-   Complete versus partial 18-/27-/36-hole layouts without fabricated data
-   Course Library search/open and independent mapping/installation statuses
-   Revision-based update detection, stale App Server status, explicit updates
-   Stable installed IDs, historical round compatibility, failure recovery/rollback
-   No batch operation automatically installs or spends Golf Intelligence credits

## Codex instruction --- inspect before coding

Before writing code:

1.  Inspect the Course Request Queue implementation.
2.  Inspect the OpenGolfAPI directory/source data and determine exactly
    which useful course/scorecard fields are actually available.
3.  Inspect the current OSM importer.
4.  Inspect the existing Golf Intelligence import path.
5.  Inspect `golf-course-map-v1` and normalization.
6.  Inspect Map Editor handling of tees, routes, fairways, greens,
    bunkers, water, trees/vegetation, pins/reference points, and
    yardages.
7.  Inspect existing readiness validation.
8.  Inspect Install Course and App Server installed-course mapping.
9.  Inspect existing Mapper/App Server authentication/deployment
    boundary.

Then return a **repository-grounded implementation plan before coding**.

The plan must identify existing reusable components, minimal
model/schema changes, actual OpenGolfAPI fields, OSM features required,
deterministic merge rules, matching strategy, vegetation conversion,
conflict handling, completeness/readiness UX, security implications,
tests, and anything that can be made smaller for Beta.

Also identify the exact spreadsheet contract, stable intake identities,
ledger/schema reuse, durable scheduling/recovery mechanism, storage layout,
completion rules, actual multi-layout support, Course Library endpoints/UI,
revision comparison, installed-state reconciliation, update/rollback behavior,
deployment requirements, and files to create/modify. Separate initial manual
batch support from any optional scheduled daily intake.

**Do not begin implementation until the plan has been reviewed.**

## Primary Beta metric

> **Minimize operator time from Course Request → READY while preserving
> Jetta's course-quality requirements.**

Do not optimize for the number of imported fields or for eliminating
human review. Optimize for how much repetitive course-building work the
automation removes.
