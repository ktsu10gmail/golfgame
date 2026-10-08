# Jetta Mapper --- Course Request Queue + OpenStreetMap Import

## Beta V3 Codex Specification

**Status:** Beta implementation specification\
**Target:** `https://golfmapper.jetta.com/editor.html`\
**Scope:** Jetta Coach Beta\
**Systems:** Jetta App Server + Jetta Golf Mapper

------------------------------------------------------------------------

# 1. Beta Objective

Build only what is needed for the Jetta Coach Beta.

The operational goal is:

> Coaches and Players identify the courses they need. Jetta Mapper shows
> those requested courses in first-requested-first-served order. The
> operator builds each course using OpenStreetMap first, uses Golf
> Intelligence only when needed, finishes the course in the existing
> Mapper, and installs it through the existing Install Course workflow.

Do not turn this into a generalized course-operations platform.

The Beta workflow is:

``` text
COACH / PLAYER
selects a course they play
        |
        v
COURSE REQUEST
        |
        v
JETTA APP SERVER
aggregates demand
        |
        v
MAPPER REQUEST QUEUE
oldest request first
        |
        v
[ Build Course ]
        |
        v
IN_PROGRESS
        |
        v
OPENSTREETMAP
preferred first
        |
        | if insufficient
        v
GOLF INTELLIGENCE
explicit fallback
        |
        v
EXISTING JETTA DRAFT
golf-course-map-v1
        |
        v
EXISTING MAP EDITOR
        |
        v
human review / correction
        |
        v
existing per-hole readiness validation
        |
        v
existing final game-map preview
        |
        v
existing explicit Install Course
        |
        v
JETTA APP SERVER
        |
        v
READY
```

------------------------------------------------------------------------

# 2. Beta Product Decision

For Beta:

> Adding a course through the Coach/Player course-selection experience
> means the user wants that course available in Jetta.

Do not add a second "Request this course" confirmation step.

The UI should make the behavior understandable, for example:

``` text
YOUR COURSES

Which courses do you and your students play most often?

[ Search courses... ]

Adding a course also lets Jetta know
you'd like it available for play.
```

The backend must persist the context from which the request was made:

``` text
PLAYER
or
COACH
```

Do not infer request context later from current account roles because a
Coach can also have the PLAYER role.

------------------------------------------------------------------------

# 3. Keep Preference and Request Concepts Separate

The existing `player_course_preferences` data is not sufficient by
itself to represent production demand.

It currently records conceptually:

``` text
player_id
directory_course_id
added_at
```

For Beta, preserve existing preference behavior but create explicit
request evidence.

Conceptually:

``` text
player_course_preferences
        |
        +--> user likes/uses this course

course_requests
        |
        +--> user asked Jetta to make it available
```

A single Beta UI action may create/update both records.

Minimum request information:

``` text
requester_id
directory_course_id
requester_context   PLAYER | COACH
requested_at
active
```

Exact schema must follow repository conventions.

Prevent duplicate active requests from the same account/context/course.

------------------------------------------------------------------------

# 4. Immutable Directory Course Identity

This is required for Beta.

Do not use mutable display fields as permanent identity.

The current directory identity derived from normalized:

``` text
course name + state + city
```

is not sufficiently durable because names and locations may be
corrected.

Each directory course must have an immutable Jetta-owned:

``` text
directory_course_id
```

Human-readable attributes remain mutable:

``` text
course_name
country_code
state_code
city
type
```

For the current U.S. directory, API values should use the existing
codes:

``` text
country_code = US
state_code = NJ
```

Display labels may be generated separately if useful.

Do not build a large alias/merge-management system for Beta.

If existing directory rows need immutable IDs, perform the smallest safe
migration/backfill required.

------------------------------------------------------------------------

# 5. Course Request Aggregation

Multiple requests for the same `directory_course_id` create one
production queue item.

Example:

``` text
Coach A ------+
Coach B ------+
Player 1 -----+----> directory_course_id ABC123
Player 2 -----+
```

Mapper displays:

``` text
Mercer Oaks West
West Windsor, NJ

First requested: Sep 30, 2026
Coaches: 2
Players: 2

Status: REQUESTED

[ Build Course ]
```

Do not create one production job per requester.

------------------------------------------------------------------------

# 6. Beta FIFO

Default order:

``` text
first_requested_at ASC
```

Use a deterministic tie-breaker:

``` text
first_requested_at ASC,
directory_course_id ASC
```

This implements:

> First requested, first served.

For Beta, alternate sorting is optional.

Do not build complex priority scoring.

The operator may manually choose another visible request when necessary.

------------------------------------------------------------------------

# 7. Beta Production State

Use only:

``` text
REQUESTED
IN_PROGRESS
READY
```

No additional workflow states are required for Beta.

Do not add:

``` text
FAILED
BLOCKED
QA
APPROVED
ON_HOLD
AWAITING_OSM
AWAITING_GI
```

If useful for diagnostics, a production item may contain:

``` text
last_error
last_activity_at
```

without adding workflow states.

------------------------------------------------------------------------

# 8. Build Course

When the operator selects:

``` text
[ Build Course ]
```

the App Server should transition:

``` text
REQUESTED -> IN_PROGRESS
```

and preserve:

``` text
production_item_id
directory_course_id
started_at
started_by
```

Because Beta is expected to have a very small number of
course-production operators, do not build elaborate claim/reassignment
workflow.

However, the transition should still be safe against accidental
concurrent claims.

Use a conditional server-side transition equivalent to:

``` sql
UPDATE course_production_items
SET status = 'IN_PROGRESS',
    started_at = ?,
    started_by = ?
WHERE id = ?
  AND status = 'REQUESTED';
```

If no row changes, return a conflict rather than silently claiming it
twice.

For Beta, provide a simple operator mechanism to return an abandoned
item to:

``` text
REQUESTED
```

Do not build sophisticated assignment management.

------------------------------------------------------------------------

# 9. Mapper Course Request Queue

Add a small Course Requests / Course Queue surface to the existing
Mapper.

Example:

``` text
COURSE REQUESTS

1. Mercer Oaks West
   West Windsor, NJ
   First requested: Sep 30
   Coaches: 2
   Players: 4
   REQUESTED
   [ Build Course ]

2. Makefield Highlands
   Yardley, PA
   First requested: Oct 1
   Coaches: 1
   Players: 2
   REQUESTED
   [ Build Course ]

3. Princeton Country Club
   Princeton, NJ
   First requested: Oct 2
   Coaches: 1
   Players: 1
   IN PROGRESS
   [ Continue ]
```

Do not build a large Back Office course-production application for Beta.

Mapper itself is the production inbox.

------------------------------------------------------------------------

# 10. Queue API

The Jetta App Server owns request truth.

Mapper obtains it through a narrow authenticated API.

Minimum conceptual response:

``` json
{
  "requests": [
    {
      "production_item_id": "production-id",
      "directory_course_id": "immutable-directory-id",
      "course_name": "Mercer Oaks West",
      "country_code": "US",
      "state_code": "NJ",
      "city": "West Windsor",
      "type": "Public",
      "first_requested_at": "2026-09-30T...",
      "coach_request_count": 2,
      "player_request_count": 4,
      "status": "REQUESTED"
    }
  ]
}
```

Exact API shape must follow repository conventions.

For Beta, use bounded pagination only if the existing API framework
makes it straightforward. Do not build elaborate pagination UX for a
queue expected to contain tens of courses.

------------------------------------------------------------------------

# 11. Mapper-to-App Authentication

Keep this simple and secure.

Preferred flow based on the current architecture:

``` text
Browser
  |
  | authenticated operator token
  v
Mapper backend
  |
  | authenticated request
  v
Jetta App Server queue/install APIs
```

Both services must verify authorization appropriately.

No shared secret should be exposed to the browser.

Use the existing operator authorization model rather than inventing
`COURSE_OPERATOR` for Beta.

Codex must determine whether the existing DEVELOPER or ADMIN policy is
the least disruptive correct choice and use it consistently for:

``` text
Queue
Build Course
Import
Refresh
Commit
Install
```

------------------------------------------------------------------------

# 12. Security Prerequisite

The prior repository audit found that:

``` text
/api/course-mapper/install
```

currently reaches:

``` text
install_package(..., force=True)
```

without an application-layer authorization check.

Fix this before production OSM functionality is exposed.

Protect consistently:

``` text
Import
Refresh
Commit
Install
```

Do not trust browser-supplied:

``` text
OSM endpoint
filesystem path
install destination
privileged identity
canonical course ownership
```

This is required Beta hardening, not optional enterprise work.

------------------------------------------------------------------------

# 13. OpenStreetMap Is the V1 Label

Use:

``` text
OpenStreetMap
```

in the Mapper UI.

Do not label the V1 source "Open GIS" because Beta is specifically
implementing OSM.

Internally, retain provider-neutral architecture so other providers can
be added later.

------------------------------------------------------------------------

# 14. Import Provider Architecture

Extend the existing importer.

``` text
Existing Golf Intelligence adapter ----+
                                       |
New OpenStreetMap adapter --------------+--> provider-neutral orchestration
                                       |
                                       v
                              golf-course-map-v1
                                       |
                                       v
                              Existing Map Editor
```

Do not rewrite the Golf Intelligence importer.

Do not create an OSM-specific editor.

Golf Intelligence credit/paid-call controls remain GI-specific.

------------------------------------------------------------------------

# 15. OSM Resolution --- Beta Scope

Do not solve generalized global geocoding for Beta.

For the OSM proof of concept and initial Beta workflow, use the simplest
reliable mechanism supported by the existing Mapper:

``` text
known/manual map location
        |
        v
bounded OSM query
        |
        v
candidate course
        |
        v
operator confirms
```

Wishlist data provides useful confirmation evidence:

``` text
course_name
country_code
state_code
city
type
```

Ambiguous results always require operator selection.

Do not silently introduce public Nominatim as a production dependency.

A more automated production geocoder can be added after Beta if course
volume proves it necessary.

------------------------------------------------------------------------

# 16. OSM Facility and Hole Identity

Do not assume:

``` text
leisure=golf_course
```

always equals one playable course.

Treat it as a facility/bounding candidate.

Where available:

-   prefer explicit course grouping/relations;
-   use `ref=*` on `golf=hole` as authoritative hole-number evidence;
-   accept useful legacy structures with warnings;
-   never invent hole numbers;
-   never assign interleaved holes to a course solely because they are
    nearby.

------------------------------------------------------------------------

# 17. OSM Coordinates

Preserve the existing Mapper architecture.

``` text
OSM lon/lat
    |
    v
Jetta {lat, lng}
    |
    v
golf-course-map-v1
    |
    v
Existing Map Editor
    |
    v
Existing export transformation
```

Do not introduce OSM-specific local/game coordinates during import.

------------------------------------------------------------------------

# 18. OSM Feature Mapping

Starting mapping, subject to repository confirmation:

``` text
golf=green                  -> green
golf=fairway                -> fairway
golf=tee                    -> tee polygon/candidate
golf=bunker                 -> bunker
natural=water / water=*     -> water
golf=water_hazard           -> supported water/hazard
golf=lateral_water_hazard   -> supported water/hazard
golf=hole                   -> hole route
leisure=golf_course         -> facility/boundary candidate
```

Only create types supported by the existing Jetta course model.

------------------------------------------------------------------------

# 19. Tee Handling

Existing readiness validation requires Jetta-specific tee information.

OSM may not provide it.

Do not guess.

Specifically:

-   do not invent blue/white/forward identities;
-   do not manufacture yardages;
-   use explicit source information only when trustworthy;
-   use hole-route endpoint evidence only where existing Mapper behavior
    supports it;
-   tell the operator what remains incomplete.

OSM is a draft generator.

Human completion in Mapper is expected.

------------------------------------------------------------------------

# 20. Ambiguous Features

Do not add an `unassigned_features` schema for Beta.

If a feature cannot be safely assigned:

``` text
skip it
+
show a warning
+
retain OSM ID in diagnostics where useful
```

Example:

``` text
Skipped
OSM way 123456
Fairway
Ambiguous hole assignment
```

The operator can add/fix the geometry manually.

------------------------------------------------------------------------

# 21. Multipolygon Scope

Keep V1 bounded to the existing simple-polygon model.

``` text
Closed way
SUPPORTED

Multipolygon outer rings
SUPPORTED where safely assembled;
emit one feature per valid outer ring

Inner rings
SKIP + WARNING unless current tested utilities already support them

Broken/missing/cyclic relation geometry
SKIP/REJECT + WARNING
```

Do not expand the editor geometry model for Beta solely to support rare
OSM cases.

------------------------------------------------------------------------

# 22. OSM Import Preview

This is preview #1.

It occurs before importing the OSM draft into the editor.

Example:

``` text
OPENSTREETMAP IMPORT PREVIEW

Mercer Oaks West
West Windsor, NJ

Found
Hole Routes       18
Greens            18
Fairways          16
Tee Polygons      24
Bunkers           37
Water              6

Needs Work
2 fairways missing
Tee identities incomplete
Yardages incomplete

Skipped
3 ambiguous features

[ Import Draft ]
[ Cancel ]
[ Use Golf Intelligence ]
```

All counts/warnings must be deterministic.

No subjective quality score.

------------------------------------------------------------------------

# 23. Existing Final Game-Map Preview

This is preview #2.

After human editing and readiness validation, preserve the existing
final game-map preview before installation.

Do not confuse:

``` text
OSM Import Preview
```

with:

``` text
Existing Final Game-Map Preview
```

The first describes imported source coverage.

The second represents the final Jetta course before Install Course.

------------------------------------------------------------------------

# 24. Golf Intelligence Fallback

Golf Intelligence remains available as:

``` text
[ Use Golf Intelligence ]
```

The operator explicitly chooses it.

Never automatically call GI because OSM:

-   has poor coverage;
-   times out;
-   returns ambiguity;
-   misses tees;
-   misses fairways;
-   contains invalid geometry.

Preserve current GI behavior.

------------------------------------------------------------------------

# 25. Re-Import Protection

Reuse existing replacement confirmation and undo/history behavior.

Do not silently overwrite human edits when:

``` text
Refresh from OpenStreetMap
```

or:

``` text
Use Golf Intelligence
```

is selected.

No automatic OSM/GI merge in Beta.

------------------------------------------------------------------------

# 26. OSM Cache

Use existing provider-keyed cache architecture.

Ensure cache validity accounts for importer/normalizer changes.

Minimum conceptual identity:

``` text
provider = OSM
external_id
normalizer_version
```

Use source version/timestamp where easily available.

Provide:

``` text
[ Refresh from OpenStreetMap ]
```

Do not overbuild cache infrastructure for Beta.

------------------------------------------------------------------------

# 27. Defensive Limits

OSM input is external data.

Implement reasonable hard limits for:

-   response bytes;
-   element count;
-   points per feature;
-   total points;
-   relation depth;
-   coordinate range;
-   request timeout;
-   retry count.

Use a server-configured/allowlisted OSM endpoint.

No browser-provided arbitrary endpoint URLs.

------------------------------------------------------------------------

# 28. Directory Identity Through Production

When Build Course starts, preserve:

``` text
production_item_id
directory_course_id
```

through the Mapper project/import/install workflow.

Do not rely on the mutable course name or name-derived slug as the only
production identity.

Provider provenance remains separate:

``` text
OSM source IDs
Golf Intelligence source IDs
```

------------------------------------------------------------------------

# 29. Installed Course Mapping --- Beta Minimum

The App Server needs an explicit mapping between the stable directory
identity and installed Jetta course identity.

Minimum conceptual record:

``` text
directory_course_id
installed_course_id / installed_course_ids
production_item_id
installed_version
installed_at
installed_by
```

For multi-route/three-nine facilities, multiple installed course IDs may
map to one directory/facility identity.

Do not infer READY by fuzzy name matching.

Do not build a large facility-management system for Beta.

Use the smallest schema that safely supports current installation
patterns.

------------------------------------------------------------------------

# 30. Existing Installed Courses

The currently installed courses may not have `directory_course_id`.

For Beta, use a one-time operator-assisted backfill/link for existing
courses that matter.

Do not build automatic fuzzy migration infrastructure.

Once linked, use explicit identity.

------------------------------------------------------------------------

# 31. Install and READY

Preserve the existing course-completion workflow:

``` text
Review / edit
      |
      v
Per-hole readiness validation
      |
      v
Existing final game-map preview
      |
      v
Explicit Install Course
      |
      v
Installation verification
      |
      v
READY
```

There is no need to introduce an APPROVED state.

READY requires successful installation.

For multi-package installations:

> If any required package fails, the production item must not become
> READY.

At minimum verify:

-   all expected packages succeeded;
-   expected installed IDs exist;
-   installed IDs are linked to the expected `directory_course_id`.

Do not turn Beta OSM work into a wholesale installation-engine rewrite.

If partial installation occurs:

``` text
NOT READY
```

and expose the failure for operator correction/retry.

------------------------------------------------------------------------

# 32. Request Removal --- Beta Policy

Keep this simple.

If the user removes a course from the same Beta course-selection
experience that created the preference/request:

``` text
preference becomes inactive/removed
associated active request is withdrawn
```

Then:

### If production is REQUESTED and active demand becomes zero

Remove it from the active Mapper queue but retain enough history/audit
data to preserve original timestamps if it is requested again.

### If production is IN_PROGRESS

Do not automatically discard work.

Leave it IN_PROGRESS for the operator to finish or manually release.

### If course is READY

Removing a preference/request does nothing to the installed course.

READY is installation truth, not current demand.

Do not build generalized request-withdrawal workflows beyond this Beta
behavior.

------------------------------------------------------------------------

# 33. New Request for an Already READY Course

If a Coach/Player selects a course already explicitly mapped to an
installed Jetta course:

``` text
course preference/request
        |
        v
installed mapping found
        |
        v
course already available
```

Do not create a new production job.

The user should see the course as available.

------------------------------------------------------------------------

# 34. Attribution / ODbL

OSM licensing remains a release requirement.

Before public Beta release of OSM-derived courses, document:

-   Mapper attribution;
-   product/game attribution where required;
-   provenance in course files/packages where required;
-   treatment of OSM-derived normalized/editable data.

Do not delay the POC while trying to build generalized licensing
infrastructure.

Do retain enough source provenance to make the release decision
correctly.

------------------------------------------------------------------------

# 35. Beta POC

Before building generalized OSM search UX, test one existing Jetta
course with useful OSM coverage.

Choose a course containing several of:

``` text
holes
greens
fairways
tees
bunkers
water
relation geometry
```

Use known/manual location for the POC.

Compare:

``` text
Feature             OSM Imported     Existing Jetta
----------------------------------------------------
Hole routes              X                X
Greens                   X                X
Fairways                 X                X
Tee polygons             X                X
Bunkers                  X                X
Water                    X                X
```

Also report manual work still required.

Primary Beta question:

> Does OpenStreetMap materially reduce course-production time?

------------------------------------------------------------------------

# 36. Beta Implementation Sequence

## Phase 0 --- Final repository-grounded plan

Codex should return exact files/schema/routes/tests before coding.

## Phase 1 --- Security

Fix authorization for the relevant Mapper Import/Refresh/Commit/Install
endpoints.

## Phase 2 --- Minimal request model

Add only what is required for:

``` text
preference
+
explicit request context
+
immutable directory identity
+
aggregated production item
```

## Phase 3 --- Mapper Course Queue

Implement:

``` text
REQUESTED
IN_PROGRESS
READY
```

with FIFO default and Build Course.

## Phase 4 --- OSM backend POC

Implement:

-   provider;
-   parser;
-   fixtures;
-   bounded geometry support;
-   WGS84 normalization;
-   warnings;
-   resource limits.

No large UI work yet.

## Phase 5 --- Evaluate one real course

Determine whether OSM saves enough Mapper work to continue.

## Phase 6 --- OSM Import UI

If POC succeeds, add:

-   OpenStreetMap source;
-   course confirmation;
-   OSM Import Preview;
-   Import Draft;
-   Refresh;
-   explicit Use Golf Intelligence fallback.

## Phase 7 --- Installation identity loop

Persist directory identity through installation and transition to READY
only after verified successful install.

## Phase 8 --- Beta regression/release

Run relevant:

-   request tests;
-   auth tests;
-   GI tests;
-   Mapper tests;
-   install tests;
-   game tests;
-   attribution/release checks.

------------------------------------------------------------------------

# 37. Required Beta Tests

Require tests for:

### Requests

-   Player request context.
-   Coach request context.
-   Coach who also has PLAYER role.
-   Duplicate request by same account/course.
-   Multiple requesters aggregate correctly.
-   FIFO uses first request.
-   Final active request removed while REQUESTED.
-   New request for READY course does not create production work.

### Identity

-   Directory display-name change does not change immutable identity.
-   Two similarly named courses remain distinct.
-   Production retains directory identity.
-   Installed mapping uses explicit directory identity.

### Queue

-   REQUESTED -\> IN_PROGRESS.
-   Concurrent Build Course attempts do not double-claim.
-   Simple release back to REQUESTED.
-   READY not inferred from course name.

### OSM

-   known/manual location query;
-   ambiguous course confirmation;
-   greens/fairways/tees/bunkers/water/hole routes;
-   unsupported geometry warnings;
-   no invented tee identities;
-   no invented yardages;
-   no invented hole numbers;
-   resource limits;
-   cache normalizer version.

### Installation

-   unauthorized Import/Refresh/Commit/Install rejected;
-   operator identity preserved;
-   successful installation produces READY;
-   partial/multi-route installation failure does not produce READY;
-   explicit directory identity linked to installed course IDs.

### Regression

-   existing Golf Intelligence import still works;
-   existing Mapper editing still works;
-   existing readiness validation still works;
-   existing final game-map preview still works;
-   existing Install Course still works;
-   game packages remain compatible.

------------------------------------------------------------------------

# 38. Explicitly Deferred Until After Beta

Do not implement these unless repository evidence shows one is
absolutely required for the Beta workflow:

-   generalized multi-operator assignment system;
-   COURSE_OPERATOR role;
-   sophisticated claim expiration;
-   large course-production Back Office;
-   complex queue analytics;
-   complex priority scoring;
-   generalized directory alias management UI;
-   automated directory merge UI;
-   automatic fuzzy installed-course linking;
-   generalized global geocoder infrastructure;
-   public Nominatim dependency;
-   self-hosted national OSM infrastructure;
-   automatic OSM/GI merge;
-   unresolved-feature workspace;
-   general inner-ring polygon editor;
-   automatic tee classification;
-   automatic yardage generation;
-   continuous OSM synchronization;
-   generalized provider marketplace;
-   major Install Course rewrite;
-   complex transactional staging system unless required to prevent
    existing corruption;
-   large pagination UX;
-   course-production notifications;
-   SLA/workflow reporting;
-   unrelated licensing/payment work;
-   unrelated gameplay features.

------------------------------------------------------------------------

# 39. Acceptance Criteria --- Beta

Beta is complete when:

1.  Adding a course through the Beta Coach/Player course-selection flow
    creates explicit production demand.
2.  PLAYER vs COACH request context is persisted at request time.
3.  Directory courses have immutable IDs.
4.  Duplicate demand aggregates by immutable directory ID.
5.  Mapper shows requested courses oldest-first.
6.  Build Course transitions the item safely to IN_PROGRESS.
7.  Mapper can return an abandoned item to REQUESTED.
8.  OpenStreetMap is available as the preferred first import source.
9.  OSM creates a useful `golf-course-map-v1` draft for at least the
    selected POC course.
10. OSM never invents tee colors, yardages, or hole numbers.
11. Ambiguous/unsupported geometry produces warnings rather than corrupt
    drafts.
12. Golf Intelligence remains available as explicit fallback.
13. Existing Mapper remains the editing system.
14. OSM Import Preview and final game-map preview remain distinct.
15. Existing readiness validation remains unchanged.
16. Existing explicit Install Course remains the installation workflow.
17. Relevant Import/Refresh/Commit/Install operations are authorized.
18. `directory_course_id` survives production and installation.
19. Installed courses are explicitly mapped to directory identity.
20. Partial multi-package installation does not produce READY.
21. Verified successful installation transitions the production item to
    READY.
22. A request for an already READY course does not create duplicate
    production work.
23. Existing GI/Mapper/install/game regressions pass.
24. OSM attribution/provenance requirements are addressed before public
    Beta release.

------------------------------------------------------------------------

# 40. Instruction to Codex

This is a **Beta scope document**.

Do not optimize for a future large operations team.

Do not add infrastructure merely because it might someday be useful.

Before coding, return one final repository-grounded implementation plan
containing:

``` text
1. Exact existing files/components to reuse
2. Minimal schema changes
3. Immutable directory ID migration/backfill
4. Minimal course_requests model
5. Minimal course_production_items model
6. Mapper queue API and UI
7. Authorization fix
8. OSM POC implementation
9. OSM parser/normalizer boundaries
10. Directory identity through Mapper/install
11. Installed-course mapping
12. READY reconciliation
13. Exact tests
14. Deployment order
15. Anything in this document that can be made even smaller
```

If the repository already provides a safe mechanism for one of these
requirements, reuse it instead of adding another mechanism.

If a requested feature is not necessary for the Coach Beta, call it out
and recommend deferring it.

Do not begin implementation until the plan has been reviewed.

## Final Beta Guardrails

``` text
Simple demand collection.
Simple FIFO queue.
Immutable identity.
OpenStreetMap first.
Golf Intelligence fallback.
Existing Mapper.
Existing readiness validation.
Existing preview.
Existing Install Course.
Verified install = READY.
No unnecessary platform building.
```
