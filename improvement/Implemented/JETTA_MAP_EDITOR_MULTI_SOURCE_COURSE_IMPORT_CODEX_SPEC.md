# Jetta Map Editor --- Multi-Source Course Import

**Status:** V1 Design / Codex Specification\
**Target:** `https://golfmapper.jetta.com/editor.html`\
**Goal:** Add Open GIS / OpenStreetMap as the preferred first
course-import source while preserving Golf Intelligence as an explicit
fallback/premium source.

## 1. Product Flow

``` text
                    COURSE OPERATIONS
                           |
                    Select Course
                           |
                           v
                    IMPORT COURSE
                           |
              +------------+------------+
              v                         v
        OPEN GIS / OSM          GOLF INTELLIGENCE
        preferred first          fallback / premium
              |                         |
              +------------+------------+
                           v
                 NORMALIZATION LAYER
                           v
                  JETTA COURSE DRAFT
                           v
                 EXISTING MAP EDITOR
                           v
                  Review / Correct
                           v
                       APPROVE
                           v
                CANONICAL JETTA COURSE
                           v
             EXISTING INSTALL COURSE FLOW
                           v
                 JETTA APPLICATION SERVER
```

## 2. Core Rule

**Jetta owns the canonical course model. Import providers are
replaceable inputs.**

Open GIS/OSM and Golf Intelligence must both normalize into the Map
Editor's existing Jetta draft/course representation. Do not create a
second editor, canonical schema, or installation pipeline.

## 3. Preserve Golf Intelligence

The existing Golf Intelligence importer must remain operational. Do not
remove or replace it.

The intended change is:

``` text
Import Course
├── Open GIS / OSM        preferred first
└── Golf Intelligence     existing fallback/premium
```

If a provider abstraction already exists, extend it. If not, introduce
the smallest safe abstraction around current behavior without rewriting
working Golf Intelligence functionality unnecessarily.

## 4. Import Strategy

Normal workflow:

``` text
Select course
      v
Try Open GIS / OSM
      v
Review draft
      |
      +-- Good enough --> Existing Map Editor --> Correct --> Approve
      |
      +-- Not good enough
                 v
       Operator explicitly chooses
          Golf Intelligence
                 v
          Existing GI import
                 v
          Existing Map Editor
                 v
              Approve
```

**Never automatically fall back to Golf Intelligence.** An Open GIS
miss, partial result, validation warning, or provider error must not
silently trigger a commercial Golf Intelligence operation.

## 5. Import Source UI

Extend the existing Import Course workflow rather than redesigning it.

Conceptually:

``` text
IMPORT COURSE

Course
Makefield Highlands Golf Club
Yardley, Pennsylvania

Import Source

● Open GIS / OpenStreetMap
  Preferred first source

○ Golf Intelligence
  Premium / fallback source

[ Import Course ]
```

Exact UI must follow the existing Map Editor.

## 6. Open GIS / OSM Import

Open GIS should create a useful **draft**, not a guaranteed finished
course.

Attempt to import whatever supported course geometry is available,
potentially including:

-   course/facility boundary;
-   hole routing;
-   tees;
-   fairways;
-   greens;
-   bunkers;
-   water;
-   other features already supported by the Jetta Map Editor.

Coverage will vary by course. Partial imports are valid if they provide
useful editable geometry.

## 7. Conceptual OSM Mapping

This is conceptual only. Codex must reconcile it with the actual editor
schema and real OSM tagging.

``` text
Open GIS / OSM              Existing Jetta feature
---------------------------------------------------
golf=green                  green
golf=fairway                fairway
golf=tee                    tee
golf=bunker                 bunker
water / natural=water       water
golf=hole                   hole/routing information
leisure=golf_course         facility/course boundary
```

Do not blindly translate tags. Validate geometry and only create feature
types the existing editor understands. Unsupported data should be
ignored or reported, not converted into speculative Jetta objects.

## 8. Normalization Layer

Both sources feed the same Jetta draft format:

``` text
Open GIS / OSM
      |
Open GIS Adapter
      |
      +------------+
                   v
          JETTA NORMALIZED
            COURSE DRAFT
                   ^
      +------------+
      |
Golf Intelligence Adapter
      |
Golf Intelligence
```

Reuse the editor's existing:

-   course and hole identifiers;
-   geometry types;
-   coordinate transformations;
-   surface classifications;
-   validation rules;
-   draft persistence;
-   approval format;
-   installation format.

**Do not invent a new course schema before auditing the existing
implementation.**

## 9. Course Identity

Provider identities are separate:

``` text
OpenGolfAPI ID
OSM ID
Golf Intelligence ID
Jetta Course ID
```

None should be assumed equal.

Provider identifiers may be retained as provenance/mapping metadata, but
the canonical Jetta course ID remains authoritative.

## 10. Import Result

After Open GIS import, show factual information useful for deciding
whether to continue.

Example:

``` text
OPEN GIS IMPORT COMPLETE

Greens              18
Fairways             17
Tees                  9
Bunkers              31
Water Features        5
Hole Routing         Partial

Warnings
- Hole 6 fairway not found
- Tee geometry incomplete

[ Open Draft in Map Editor ]

Need another source?
[ Import Using Golf Intelligence ]
```

Do not invent completeness percentages or quality scores unless
calculated deterministically from known requirements.

## 11. Golf Intelligence Fallback

Golf Intelligence is an explicit operator decision.

``` text
Open GIS insufficient
        v
[ Import Using Golf Intelligence ]
        v
Existing Golf Intelligence importer
        v
Same Jetta draft/editor model
```

The Open GIS importer must not call Golf Intelligence APIs.

Preserve existing Golf Intelligence credentials, provider behavior, and
commercial-operation controls.

## 12. Re-Import and Human Edits

V1 does not require automatic merging of Open GIS and Golf Intelligence
datasets.

If a second import would replace an existing draft, make that explicit
and warn before overwriting meaningful edits.

Once a human begins editing:

``` text
Provider
   v
IMPORT
   v
Jetta Draft
   v
Human Editing
```

later provider activity must not silently overwrite those edits.

Treat Open GIS primarily as an import source, **not a continuous
synchronization system**.

## 13. Existing Map Editor Remains Authoritative

After import, return to the current Map Editor.

Do not build provider-specific editors.

The existing editor remains responsible for the capabilities it already
owns, including applicable geometry correction, adding/deleting
features, hole assignment, validation, course metadata, approval, and
installation.

## 14. Approval

A successful provider import creates a draft, not a playable course.

``` text
IMPORT
  v
DRAFT
  v
MAP EDITOR
  v
HUMAN REVIEW / CORRECTION
  v
APPROVE
  v
CANONICAL JETTA COURSE
```

Neither Open GIS nor Golf Intelligence may bypass existing
review/approval semantics.

## 15. Installation to the Jetta App Server

The **existing Map Editor Install Course workflow** is authoritative.

After approval:

``` text
Approved canonical Jetta course
             v
Existing Map Editor
Install Course
             v
Jetta application server
             v
Course available to Jetta
```

The Open GIS feature must terminate in the same
draft/editor/approval/install path already used by the Map Editor.

Do not move course construction to the app server. Do not create a new
installation API or deployment mechanism unless repository evidence
proves it necessary.

## 16. Separation of Responsibilities

**Course Operations / Wishlist:** Which course does Jetta need?

**Open GIS:** What open geometry can provide a useful first draft?

**Golf Intelligence:** If Open GIS is insufficient, can the existing
commercial source provide a better draft?

**Map Editor:** What should the finished Jetta course contain?

**App Server:** Which approved, installed courses are available to
players?

## 17. Provenance

Investigate retaining enough provenance to understand imported data,
such as:

``` text
import_source
provider/source course identity
import_timestamp
source revision/version when available
```

For OSM-derived features, retain source identifiers/version metadata
where practical. Preserve whatever Golf Intelligence provenance the
current importer already uses.

## 18. Open-Data Licensing

Open GIS/OSM must be used according to applicable license and
attribution requirements.

Before production, document:

-   data source;
-   applicable license;
-   attribution requirements;
-   derivative/database obligations relevant to Jetta;
-   provenance retained;
-   required attribution placement.

Do not copy or trace geometry from proprietary imagery/map services
unless Jetta has explicit rights to derive and store it. Satellite
imagery licensing is separate from OSM vector-data licensing.

This specification is an engineering design, not a legal determination;
production licensing assumptions must be verified.

## 19. Failure Handling

Open GIS should fail safely with states/messages equivalent to:

``` text
COURSE NOT FOUND
NO USEFUL GEOMETRY
PARTIAL IMPORT
PROVIDER ERROR
```

None automatically invokes Golf Intelligence.

The operator decides whether to retry, continue with partial data, edit
manually, or explicitly use Golf Intelligence.

## 20. Operational Measurement

Where inexpensive, capture enough information to learn whether Open GIS
reduces course-production work:

-   Open GIS attempts;
-   successful/usable Open GIS drafts;
-   Golf Intelligence fallback count;
-   provider failures;
-   imported feature counts.

If existing workflow data permits it later, Jetta can compare editing
effort for Open GIS, Golf Intelligence, and manual builds. Do not build
a new analytics subsystem for V1.

## 21. Security

Keep all commercial provider credentials, installation credentials,
administrative tokens, and app-server credentials server-side.

Reuse existing Map Editor authentication and authorization.

Open GIS access should use an architecture appropriate for production,
CORS, rate limits, provider policy, and operational control.

## 22. Open GIS Infrastructure

Use public/community OSM infrastructure responsibly.

During audit, determine the appropriate implementation for Jetta's
expected course-production volume:

-   responsible query endpoint;
-   production-oriented OSM service;
-   cached extracts;
-   regional downloads;
-   or a Jetta-hosted derived open-data layer.

Do not prematurely build large infrastructure, but do not design
production behavior that abuses community endpoints.

## 23. V1 Non-Goals

Do not implement:

-   automatic Open GIS → Golf Intelligence fallback;
-   automatic provider merging;
-   automatic conflict resolution;
-   automatic publishing;
-   automatic installation immediately after import;
-   replacement of Golf Intelligence;
-   replacement of the Map Editor;
-   continuous OSM synchronization;
-   silent overwrite of human edits;
-   a new canonical course schema;
-   a new app-server course format;
-   Coach-facing GIS controls;
-   unrelated Wishlist functionality;
-   licensing/subscription/payment changes.

## 24. Phase 0 Repository Audit --- Before Coding

Codex must inspect the Map Editor repository and determine:

1.  Where the Map Editor code lives.
2.  How `editor.html` is structured.
3.  How Import Course currently works.
4.  Exact UI → API → service flow for Golf Intelligence.
5.  Existing provider/service abstraction, if any.
6.  Which Golf Intelligence operations are currently called.
7.  Existing provider IDs/provenance.
8.  Current Jetta course draft schema.
9.  Geometry types supported by the editor.
10. Coordinate systems/transformations.
11. Hole/feature/surface representation.
12. Existing validation rules.
13. How imported data becomes editable.
14. Existing approval workflow.
15. Exact Install Course → Jetta app-server workflow.
16. Which installation components must remain untouched.
17. Existing tests for import/approval/installation.
18. Existing GIS/OSM code or dependencies.
19. Existing backend/proxy/cache infrastructure suitable for Open GIS.
20. Exact files expected to change.
21. Whether any schema/storage change is actually necessary.
22. Security implications.
23. Deployment implications.

**Do not implement during Phase 0.**

## 25. Questions Codex Must Answer

### Provider boundary

Can the current Golf Intelligence importer be adapted behind a
provider-neutral boundary without a risky rewrite?

### Normalized draft

What exact existing Jetta draft structure should Open GIS produce?

### Geometry mapping

Which OSM feature types can safely map to existing Jetta feature types?

### Course resolution

How should the editor locate the correct OSM course using course
name/location?

### Partial imports

How should missing/incomplete geometry be represented?

### Re-import

What happens when Open GIS has already been imported/edited and the
operator chooses Golf Intelligence?

### Installation

How do we guarantee the existing approved-course installation workflow
remains unchanged?

### Provenance/licensing

What metadata must be retained for attribution and traceability?

## 26. Testing Requirements

Regression-test the existing Golf Intelligence import, existing editor
behavior, approval, and Install Course flow.

Add tests for:

-   Open GIS course resolution;
-   ambiguous/no-match handling;
-   provider/network failures;
-   supported geometry normalization;
-   unsupported-feature safety;
-   partial imports;
-   explicit provider selection;
-   no automatic Golf Intelligence fallback;
-   re-import/human-edit protection;
-   provider-ID/Jetta-ID separation;
-   import does not automatically publish/install;
-   approved course continues through the existing Install Course
    workflow.

## 27. Acceptance Criteria

V1 is complete when:

1.  Open GIS/OSM is available as an import source in the existing Map
    Editor.
2.  The existing Golf Intelligence importer remains operational.
3.  Open GIS is the preferred first attempt.
4.  Golf Intelligence remains an explicit fallback/premium option.
5.  Open GIS failure never automatically triggers Golf Intelligence.
6.  Both sources feed the existing Jetta draft/editor model.
7.  Partial Open GIS imports can be corrected in the existing Map
    Editor.
8.  Import never bypasses human review/approval.
9.  Human edits are not silently overwritten.
10. Provider IDs remain separate from canonical Jetta identity.
11. Open-data provenance is retained appropriately.
12. Existing approval remains authoritative.
13. Existing **Install Course** remains the mechanism that installs the
    ready course on the Jetta app server.
14. No second canonical schema or installation pipeline is introduced.
15. Existing Golf Intelligence and installation regression tests pass.

## 28. Product Principle

The goal is not to eliminate Golf Intelligence.

The goal is to give Jetta a lower-cost/open first source while
preserving a proven commercial fallback:

``` text
Open GIS first
      |
      v
Good enough?
  |         |
 YES        NO
  |         |
  v         v
Editor   Golf Intelligence
  |         |
  |         v
  |       Editor
  |         |
  +----+----+
       v
    Approve
       v
Existing Install Course
       v
Jetta App Server
```

Jetta's durable asset is the **canonical course model + Map Editor +
human validation + installation workflow**.

Import providers are replaceable inputs.

## 29. Instruction to Codex

Audit the existing Jetta Map Editor repository against this
specification.

**Do not code yet.**

Return:

-   current Import Course architecture;
-   current Golf Intelligence flow;
-   current normalized/draft representation;
-   current geometry model;
-   current approval flow;
-   current Install Course → app-server flow;
-   recommended minimal provider abstraction;
-   proposed Open GIS/OSM architecture;
-   proposed OSM → Jetta feature mapping;
-   course-resolution strategy;
-   partial-import behavior;
-   re-import/replacement behavior;
-   provenance/licensing considerations;
-   exact files expected to change;
-   schema/storage changes, if any;
-   test plan;
-   deployment implications;
-   risks/open questions;
-   recommended implementation phases.

### Guardrails

-   Preserve Golf Intelligence.
-   Preserve the existing Map Editor.
-   Preserve the existing Jetta course schema unless repository evidence
    requires change.
-   Preserve approval.
-   Preserve Install Course to the Jetta app server.
-   No automatic Golf Intelligence fallback.
-   No automatic publish/install.
-   No second course-production pipeline.
-   No unrelated Coach Wishlist, licensing, payment, or gameplay work.

Wait for approval before implementation.
