# Golf Intelligence Course Import Integration
## Codex Implementation Specification

**Project:** Golf Strategy Simulator  
**Feature:** Import golf-course scorecard and GPS geometry from Golf Intelligence into the application's existing canonical Jetta course/hole format and editor.

---

# 1. Goal

Add a Golf Intelligence import workflow so an authorized user can search for a golf course, retrieve complete course detail, normalize the returned scorecard and GPS geometry into the application's existing internal format, review/correct the imported course in the existing editor, and publish it for gameplay.

The objective is to reduce manual course creation from hours to minutes.

> **Core rule:** Golf Intelligence is an external data provider. The application's existing Jetta course/hole schema remains the source of truth used by the editor and game engine.

Do not make the simulation engine depend directly on Golf Intelligence response objects.

---

# 2. Current Golf Intelligence API Facts

Host:

```text
https://api.golfintelligence.com
```

Authentication:

```text
OAuth2 client_credentials
```

Token endpoint:

```http
POST /auth/authenticateToken
```

Authentication request:

```text
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
code=YOUR_ACTIVE_TOKEN
client_id=YOUR_CLIENT_ID
```

The `Active Token` from the Golf Intelligence console is **not** a Bearer token. Exchange it first for an access token.

Subsequent API calls use:

```http
Authorization: Bearer YOUR_ACCESS_TOKEN
```

Official docs:

```text
https://golfintelligence.com/docs/
```

Swagger:

```text
https://api.golfintelligence.com/swagger/index.html
```

---

# 3. Production Endpoints

Current documented routes include:

```text
POST /courses/searchCourseGroups
GET  /courses/getCourseGroupScorecard
GET  /courses/getCourseGroupGPS
GET  /courses/getCourseGroupDetail
GET  /greens/getSlopeImage
GET  /greens/getElevationImage
GET  /holeProfile/getGeoHashElevation
```

For Phase 1, use only:

```text
POST /courses/searchCourseGroups
GET  /courses/getCourseGroupDetail
```

Phase 2 may add slope, elevation, and lie-elevation endpoints.

---

# 4. Credit-Aware Usage

Current documented credit behavior:

```text
Course search:      0 credits
Scorecard only:     1 credit
GPS only:           2 credits
Full course detail: 3 credits
Slope image:        1 credit
Elevation image:    1 credit
```

Rules:

- Always search first.
- Search is free.
- Do not hydrate every search result.
- Only call full detail after the user selects a course and confirms import.
- Reuse cached course detail when valid.
- Do not repeatedly call paid endpoints for unchanged course data.

---

# 5. Licensing / Usage Guardrails

Do not implement:

```text
bulk catalog scraping
A-Z crawling
catalog mirroring
training an AI model on provider data
RAG indexing of provider data
third-party resale
```

Treat provider data as licensed application data.

Preserve Golf Intelligence's current caching and usage restrictions.

Add:

```text
docs/golf_intelligence_usage_notes.md
```

with links to the official API docs and Terms.

---

# 6. Environment Variables

Add server-side configuration:

```text
GOLF_INTELLIGENCE_BASE_URL=https://api.golfintelligence.com
GOLF_INTELLIGENCE_CLIENT_ID=
GOLF_INTELLIGENCE_ACTIVE_TOKEN=
GOLF_INTELLIGENCE_ENABLED=true
GOLF_INTELLIGENCE_TIMEOUT_SECONDS=20
GOLF_INTELLIGENCE_CACHE_TTL_DAYS=365
```

Never expose credentials or Bearer tokens to the browser.

Do not commit real secrets to Git.

---

# 7. Architecture

```text
Browser
   ↓
Jetta Backend API
   ↓
GolfIntelligenceProvider
   ↓
Golf Intelligence API
   ↓
Provider DTOs
   ↓
GI → Jetta Normalizer
   ↓
Existing Jetta Course/Hole Schema
   ↓
Existing Course Editor
   ↓
Review / Correct
   ↓
Illustrated Background Renderer
   ↓
Publish
   ↓
Game
```

The game engine must never call Golf Intelligence during shot simulation.

---

# 8. Provider Abstraction

Create a provider interface so additional data sources can be supported later.

```python
class CourseDataProvider(Protocol):
    async def search_courses(
        self,
        query: CourseSearchQuery,
    ) -> list[ExternalCourseSummary]:
        ...

    async def get_course_detail(
        self,
        external_course_id: str,
    ) -> ExternalCourseDetail:
        ...
```

Initial implementation:

```python
GolfIntelligenceProvider
```

Potential future providers:

```text
OpenStreetMap
OpenGolfAPI
manual upload
other commercial GPS providers
```

Do not put provider-specific logic directly into the editor or simulation engine.

---

# 9. Authentication Client

Create:

```text
golf_intelligence/auth.py
```

Responsibilities:

- exchange Active Token + Client ID for Bearer access token
- cache token server-side
- refresh when expired
- retry once after 401
- never log credentials

Suggested interface:

```python
class GolfIntelligenceTokenManager:
    async def get_access_token(self) -> str:
        ...
```

---

# 10. Golf Intelligence Client

Create:

```text
golf_intelligence/client.py
```

Suggested methods:

```python
async def search_course_groups(
    keywords: str,
    rows: int = 10,
    offset: int = 0,
    country: str | None = None,
    region: str | None = None,
) -> list[GolfIntelligenceCourseSearchResult]:
    ...

async def get_course_group_detail(
    public_id: str,
) -> GolfIntelligenceCourseGroupDetail:
    ...
```

Handle:

```text
400
401
404 if returned
429 if returned
500
timeouts
invalid JSON
schema mismatch
```

Retry only safe transient failures.

Do not blindly retry paid calls multiple times.

---

# 11. Search Workflow

Frontend action:

```text
[Import Course]
```

Search UI:

```text
Search Golf Course
[ The Meadows at Middlesex           ]
[ SEARCH ]
```

Backend endpoint:

```http
POST /api/v1/course-import/golf-intelligence/search
```

Request:

```json
{
  "keywords": "The Meadows at Middlesex",
  "rows": 10,
  "offset": 0
}
```

Backend calls:

```http
POST /courses/searchCourseGroups
```

Store the returned `publicId` as the external provider ID.

---

# 12. Search Result Normalization

Normalize search results into an internal shape:

```json
{
  "provider": "golf_intelligence",
  "external_id": "PUBLIC_ID",
  "name": "The Meadows at Middlesex",
  "facility_name": "The Meadows at Middlesex",
  "city": "Plainsboro",
  "region": "NJ",
  "country": "USA",
  "latitude": 40.0,
  "longitude": -74.0,
  "available": true
}
```

Do not bind UI components directly to raw provider responses.

---

# 13. Course Selection and Paid Hydration

After search, the user selects one result.

Before downloading full detail, show:

```text
This will download the full scorecard and GPS geometry.
Estimated provider cost: 3 credits.

[Cancel] [Continue]
```

Then call:

```http
GET /courses/getCourseGroupDetail?PublicId=<PUBLIC_ID>
```

Do not automatically download every search result.

---

# 14. Import Preview

Before committing the course, show a preview based on actual returned data:

```text
IMPORT PREVIEW

Course                  The Meadows at Middlesex
Provider                Golf Intelligence
Holes                   18
Scorecard               ✓
Tees                    ✓
Fairways                ✓
Greens                  ✓
Bunkers                 ✓
Penalty Areas           ✓
Hole Outlines           ✓

Geometry completeness   92%

[Cancel]   [Import Course]
```

Do not invent absent features.

---

# 15. Normalization Layer

Create:

```text
course_import/golf_intelligence_normalizer.py
```

Flow:

```text
Golf Intelligence DTOs
        ↓
Canonical External Course Model
        ↓
Existing Jetta Course/Hole Model
```

Do not change the existing Jetta schema merely to mirror provider fields.

Provider-specific metadata should remain at the integration boundary.

---

# 16. Provider Metadata

Persist:

```text
provider_name = "golf_intelligence"
provider_public_id
provider_imported_at
provider_payload_version
provider_last_refresh_at
provider_source_hash
```

If raw payloads are stored, keep them separate from canonical gameplay data and only if licensing permits.

---

# 17. Scorecard Mapping

Map provider scorecard data into existing Jetta fields:

```text
course/facility name
hole number
par
tee names
tee colors if available
tee yardages
handicap/allocation
course rating if available
slope rating if available
```

Track field provenance:

```text
provider
manual
```

A future refresh must not silently overwrite manually corrected values.

---

# 18. GPS Geometry Mapping

Golf Intelligence currently documents GPS layers including:

```text
tee boxes
fairways
bunkers
penalty areas
hole outlines
green shapes
```

Map to existing Jetta geometry types:

```text
GI Tee Box
→ Jetta tee polygon

GI Fairway
→ Jetta fairway polygon

GI Bunker
→ Jetta bunker polygon

GI Penalty Area
→ Jetta penalty-area geometry

GI Hole Outline
→ Jetta hole bounds / outer geometry

GI Green Shape
→ Jetta green polygon
```

Do not infer provider semantics beyond what the response supports.

If a penalty area cannot confidently be classified as water or another type, import as:

```text
penalty_area_unknown
```

and flag for review.

---

# 19. Tee and Green Centers

If polygons exist and explicit centers are not provided:

```text
tee_center = derived from tee polygon
green_center = derived from green polygon
```

Use proper geographic geometry calculations.

Store provenance:

```text
source = derived_from_provider_polygon
```

---

# 20. Coordinate Conversion

Golf Intelligence geometry is geographic GPS data.

The existing game/editor may use local X/Y coordinates.

Create one explicit conversion service:

```text
WGS84 longitude/latitude
        ↓
Hole-local transform
        ↓
Existing editor X/Y
```

Prefer storing geographic coordinates as canonical imported source geometry, then derive local game coordinates.

Do not create multiple independent transform systems.

---

# 21. Existing Calibration Compatibility

If the project already has three-point calibration using:

```text
tee
green center
fairway anchor
```

reuse it where appropriate.

Imported GPS should reduce calibration work rather than create a competing coordinate system.

Codex must inspect the current editor transform before changing anything.

---

# 22. Geometry Validation

Validate after normalization:

```text
polygon validity
self-intersection
finite coordinates
hole number
at least one tee
at least one green
green center inside/near green
tee center inside/near tee
feature proximity to hole
invalid coordinate jumps
```

Warnings may allow import:

```text
Hole 7: no bunker geometry returned
```

Blocking errors include:

```text
invalid coordinates
corrupt geometry
missing all geometry
impossible transform
```

---

# 23. Review Status

Each imported hole gets:

```text
IMPORTED
NEEDS_REVIEW
APPROVED
PUBLISHED
```

Example:

```text
Hole 1   ✓ Ready
Hole 2   ✓ Ready
Hole 3   ⚠ Review
...
Hole 18  ✓ Ready
```

---

# 24. Existing Editor Integration

Imported holes must open in the existing editor.

Show:

```text
imported fairways
imported greens
imported bunkers
imported penalty areas
imported tee geometry
tee center
green center
reference image if present
illustrated preview if generated
```

Allow existing edit operations:

```text
drag vertex
add/remove vertex
change feature type
add missing feature
move tee center
move green center
approve hole
```

Do not create a separate Golf Intelligence editor.

---

# 25. Manual Override Protection

Track feature source and edits:

```json
{
  "source": "golf_intelligence",
  "manual_override": true,
  "provider_feature_id": "...",
  "last_manual_edit_at": "..."
}
```

Provider refreshes must never silently overwrite manual corrections.

---

# 26. Refresh Workflow

Future feature:

```text
[Check Provider for Updates]
```

Recommended flow:

```text
Fetch provider version
        ↓
Compare to local course
        ↓
Generate diff
        ↓
Show user
        ↓
Merge selected changes
```

Do not automatically overwrite production geometry.

---

# 27. Caching

Current Golf Intelligence docs state a specific course may be cached for up to one year per user.

Implement cache metadata:

```text
fetched_at
expires_at
provider_public_id
response_hash
```

Before spending credits:

```python
if valid_cached_course_exists(public_id):
    use_cache()
else:
    fetch_provider()
```

Respect current provider terms.

---

# 28. Import Database Model

Suggested tables or equivalent models:

```text
course_import_jobs
external_course_sources
external_course_cache
course_import_feature_mappings
```

Example job fields:

```text
id
provider
external_id
status
requested_by
started_at
completed_at
credit_cost_estimate
error_message
created_course_id
```

Statuses:

```text
SEARCHED
FETCHING
NORMALIZING
VALIDATING
READY_FOR_REVIEW
IMPORTED
FAILED
```

---

# 29. Backend API

Search:

```http
POST /api/v1/course-import/golf-intelligence/search
```

Preview full import:

```http
POST /api/v1/course-import/golf-intelligence/preview
```

Request:

```json
{
  "public_id": "..."
}
```

Commit import:

```http
POST /api/v1/course-import/golf-intelligence/import
```

Import status:

```http
GET /api/v1/course-import/jobs/{job_id}
```

Return normalized Jetta data, not raw provider objects, unless diagnostics explicitly require otherwise.

---

# 30. Credit Visibility

Before every paid provider call, show expected cost.

Example:

```text
This full-course download uses approximately 3 Golf Intelligence credits.

[Cancel] [Continue]
```

Optional admin diagnostics:

```text
search calls
course-detail calls
estimated credits used
cache hits
provider errors
```

---

# 31. Error Handling

### 400

```text
The selected course could not be retrieved.
Verify the course selection and try again.
```

### 401

Backend should re-authenticate once and retry once.

If it still fails:

```text
Golf Intelligence authentication failed.
Check server API credentials.
```

### 500 / timeout

Use limited retry/backoff.

Do not create duplicate import jobs or uncontrolled repeated paid requests.

---

# 32. Logging and Security

Log:

```text
provider
endpoint
public_id
request duration
HTTP status
cache hit/miss
import job id
normalization warnings
```

Never log:

```text
Active Token
Bearer token
authorization headers
```

All provider calls are server-side.

Recommended permission:

```text
course.import_external
```

Only authorized users should consume provider credits.

---

# 33. Phase 2 — Slope / Elevation

Do not implement in Phase 1.

Future endpoints:

```text
GET /greens/getSlopeImage
GET /greens/getElevationImage
GET /holeProfile/getGeoHashElevation
```

Potential use cases:

```text
green-reading UI
putting slope model
uphill/downhill lie
ball above/below feet
shot elevation adjustment
GPS/on-course mode
```

Keep the integration extensible for these later.

---

# 34. Illustrated Background Integration

After import and review:

```text
Golf Intelligence GPS
        ↓
Jetta geometry
        ↓
Existing editor review
        ↓
Illustrated Hole Background Renderer
        ↓
consistent illustrated.webp
        ↓
Game
```

Do not make the visual renderer depend directly on provider DTOs.

---

# 35. Provider Independence

Desired dependency direction:

```text
Golf Intelligence Adapter
        ↓
Canonical Course Import Model
        ↓
Jetta Golf Domain
        ↓
Editor / Renderer / Game
```

Never:

```text
Game Engine
        ↓
Golf Intelligence DTO
```

---

# 36. Tests

## Authentication

- token exchange
- token cache
- retry after 401
- secret redaction

## Search

- successful search
- empty results
- pagination
- invalid response
- provider failure

## Course Detail

- 18-hole course
- 9-hole course
- multi-layout facility
- missing bunker geometry
- missing tee geometry
- incomplete scorecard
- invalid GPS data

## Normalization

- tee mapping
- green mapping
- fairway mapping
- bunker mapping
- penalty-area mapping
- hole ordering
- tee yardages
- handicap/allocation mapping
- center derivation

## Coordinates

- GPS → local X/Y
- deterministic transform
- no geometry drift

## Editor

- imported course opens
- polygons editable
- manual overrides preserved
- save works
- publish works

## Cache

- valid cache avoids duplicate paid call
- expired cache refreshes correctly

---

# 37. Golden Import Test

Use one known course first:

```text
The Meadows at Middlesex
```

Do not hard-code or assume its provider `publicId`.

Search the live provider after credentials are configured.

Validate:

```text
18 holes
correct par
reasonable tee sets/yardages
green on each hole
tee on each hole
fairway where available
bunkers where available
penalty areas where available
editor rendering correct
Hole 1 playable end-to-end
```

---

# 38. Acceptance Criteria

- [ ] Credentials are server-side only.
- [ ] Token exchange works.
- [ ] Free course search works.
- [ ] User selects one result before hydration.
- [ ] Paid detail call requires confirmation.
- [ ] Estimated credits are displayed.
- [ ] Provider data normalizes into existing Jetta course format.
- [ ] Game engine does not consume Golf Intelligence DTOs directly.
- [ ] Scorecard imports.
- [ ] Tee data imports.
- [ ] Fairway geometry imports.
- [ ] Green geometry imports.
- [ ] Bunker geometry imports.
- [ ] Penalty-area geometry imports.
- [ ] Hole outlines import where available.
- [ ] GPS coordinates convert correctly into editor coordinates.
- [ ] Imported holes open in the existing editor.
- [ ] Manual corrections are supported and protected.
- [ ] Provider calls are cached appropriately.
- [ ] Provider outage does not break existing local courses.
- [ ] Existing single-player gameplay continues to work without provider access.
- [ ] Illustrated renderer can use imported geometry.
- [ ] Tests cover authentication, normalization, geometry, caching, and editor integration.

---

# 39. Suggested Implementation Order

```text
1. Inspect existing Jetta course JSON/schema
2. Inspect editor coordinate system
3. Add provider abstraction
4. Add Golf Intelligence configuration
5. Build token manager
6. Build provider client
7. Build free search endpoint
8. Build search UI
9. Build course-detail retrieval
10. Add provider DTO schemas
11. Build normalization layer
12. Map scorecard
13. Map GPS geometry
14. Build GPS → local coordinate conversion
15. Add geometry validation
16. Add import preview
17. Add paid-credit confirmation
18. Commit normalized course
19. Open imported course in existing editor
20. Add manual-override tracking
21. Add caching
22. Add diagnostics/logging
23. Add tests
24. Validate The Meadows at Middlesex
25. Connect to illustrated background renderer
```

---

# 40. Codex Instructions

Before modifying code:

1. Read this entire specification.
2. Inspect the existing course, hole, scorecard, polygon, and editor models.
3. Do not invent a parallel course schema if one already exists.
4. Reuse existing `golf-domain` definitions.
5. Keep provider-specific models at the integration boundary.
6. Never expose provider credentials to the browser.
7. Do not bulk-download the provider catalog.
8. Do not consume paid credits automatically for search results.
9. Preserve manually-created courses and manual edits.
10. Add migrations rather than destructive schema changes.
11. Add tests before declaring the feature complete.
12. Preserve backward compatibility.

---

# 41. Final Architecture Invariant

> **Golf Intelligence provides the data; Jetta owns the normalized course model; the existing editor owns review/correction; the existing game engine owns gameplay.**

Expected workflow:

```text
Search course
      ↓
Golf Intelligence
      ↓
Full scorecard + GPS
      ↓
GI → Jetta normalizer
      ↓
Existing Jetta course JSON/database
      ↓
Existing editor
      ↓
Review/correct only when needed
      ↓
Illustrated renderer
      ↓
Publish
      ↓
Play
```

The user should no longer need to manually trace an entire course when suitable provider geometry exists.

---

# 45. MVP Import Mode vs Play Mode

Enforce a hard separation between provider access and gameplay.

```text
IMPORT MODE
Golf Intelligence → Normalize → Persist Jetta Course → Editor → Publish

PLAY MODE
Published Jetta Course → Simulation Engine
```

**Play Mode must never call Golf Intelligence.**

An expired provider token, exhausted credits, provider outage, or disabled integration must not interrupt an already-published course. Add an automated test proving a complete 18-hole round on an imported course makes zero Golf Intelligence network requests.

This architecture does not override provider licensing or caching terms.

---

# 46. Paid API Call Protection

Add an admin/development control:

```text
Allow Paid Golf Intelligence API Calls
[ OFF ]
```

Default OFF. Before a credit-consuming request, show the selected course, operation, estimated credits, and explicit Cancel/Continue controls.

Never make a paid request merely because someone opens the editor, refreshes a page, starts a round, or loads a published course.

---

# 47. Local Playable Course Persistence

A successful import must persist everything required for gameplay into canonical Jetta models/files, including available scorecard, hole, tee, yardage, fairway, green, bunker, penalty-area, hole-outline, reference-point, and coordinate-transform data.

Once published, gameplay reads Jetta data rather than provider DTOs.

---

# 48. Course Ready for Play Validation

Before publishing:

```text
COURSE READY FOR PLAY

Scorecard             ✓
Hole definitions      ✓
Tee geometry          ✓
Fairway geometry      ✓
Green geometry        ✓
Bunker geometry       ✓ / optional if none
Penalty areas         ✓ / optional if none
Reference points      ✓
Coordinate transform  ✓
Illustrated maps      ✓ / fallback allowed
Real green elevation  optional
Real green slope      optional
```

Missing optional data must use local simulation/fallback behavior and never trigger a provider request during play.

---

# 49. Simulated Green Contours

Add a first-class subsystem named:

> **Simulated Green Contours**

Preserve the real imported green footprint while generating Jetta's own synthetic terrain for putting strategy.

```text
Green Shape / Footprint
    = real imported geometry when available

Green Contour / Elevation Surface
    = simulated by Jetta

Putting Situation
    = contour + pin position + actual ball position
```

Do not describe simulated contours as the actual surveyed contour of the real course.

---

# 50. Simulated Green Contour Pipeline

```text
Golf Intelligence Green Polygon
              ↓
       Real Green Shape
              ↓
Jetta Simulated Contour Generator
              ↓
 Synthetic Elevation Surface
              ↓
       Pin + Ball Position
              ↓
   Sample Ball-to-Cup Path
              ↓
Calculate:
- putt distance
- uphill/downhill
- longitudinal slope
- cross slope
- break direction
- break severity
- multiple-break behavior
              ↓
Putting Engine / Game Master
```

Fit/clip generated terrain to the actual green polygon.

---

# 51. Green Terrain Archetype Library

Create parameterized archetypes:

```text
GENTLE_TILT
STRONG_TILT
BACK_TO_FRONT
FRONT_TO_BACK
LEFT_TO_RIGHT
RIGHT_TO_LEFT
CROWN
BOWL
RIDGE
SADDLE
TWO_TIER
COMPLEX_UNDULATION
```

Possible parameters include rotation, slope strength, ridge position/width, bowl depth, crown height, tier height/boundary, and undulation amplitude/frequency. Keep slopes within configurable realistic gameplay limits.

---

# 52. Real Shape + Synthetic Terrain

Do not replace imported green geometry with a generic shape.

```text
Actual Hole 7 green polygon
        +
RIDGE archetype
        +
rotation 35°
        +
configured slope strength
        ↓
Hole 7 simulated terrain
```

The imported real green footprint remains authoritative.

---

# 53. Deterministic Green Generation

Contour generation must be reproducible. Use stable seed inputs such as:

```text
course_id
hole_number
green_geometry_version
contour_generator_version
```

Same polygon + archetype + parameters + seed + generator version must produce the same terrain.

---

# 54. Simulated Green Metadata

Persist simulation metadata separately from real green geometry.

```json
{
  "green_shape_source": "golf_intelligence",
  "green_contour_source": "simulated",
  "terrain_template": "RIDGE",
  "terrain_rotation_deg": 35.0,
  "max_slope_percent": 2.6,
  "seed": 182731,
  "generator_version": "1.0"
}
```

Adapt field names to existing project conventions.

---

# 55. Dynamic Pin and Ball Positions

A putting situation is:

```text
terrain + pin location + actual ball landing location
```

The same terrain can produce very different reads:

```text
12 ft downhill R→L
24 ft uphill L→R
8 ft nearly straight
35 ft over a ridge
18 ft downhill then flattening
```

Use the actual simulated shot landing point.

---

# 56. Putting Path Analysis

For ball point A to cup point B, sample the elevation field along and around the path and calculate longitudinal slope, cross slope, elevation change, break direction/severity, and major slope/ridge/tier transitions.

Suggested structured output:

```json
{
  "distance_ft": 22.4,
  "net_elevation_change_ft": 0.35,
  "average_longitudinal_slope_pct": 1.4,
  "average_cross_slope_pct": 2.1,
  "break_direction": "RIGHT_TO_LEFT",
  "break_severity": "MODERATE"
}
```

The deterministic putting engine remains authoritative.

---

# 57. Game Master Use

The Game Master receives structured putting facts and explains/coaches from them.

Example:

```text
Distance: 22 ft
Overall: slightly uphill
Primary break: right-to-left
Cross slope: moderate
Final segment: flatter
```

The LLM must not invent terrain that conflicts with the engine.

---

# 58. Optional Real Slope/Elevation Provider

Real Golf Intelligence slope/elevation is optional and is **not required for the MVP**.

```text
MVP:
Golf Intelligence → real green shape
Jetta             → simulated green contour
```

Keep the putting engine extensible so a future real-terrain provider can replace the simulated terrain source without redesigning gameplay.

---

# 59. Upgrade from Existing Rotated Single-Contour Design

Preserve backward compatibility with the current concept:

```text
one terrain template + rotation across holes
```

Upgrade to:

```text
real imported green shape
+
terrain archetype library
+
rotation
+
strength/parameters
+
dynamic pin
+
dynamic ball position
```

Manually-created courses without Golf Intelligence geometry must remain playable.

---

# 60. Simulated Green Editor Controls

Optional editor controls:

```text
Contour Source: [Simulated]
Terrain:        [RIDGE ▼]
Rotation:       [35°]
Strength:       [Moderate ▼]
Seed:           [182731]

[Regenerate] [Preview Contours] [Reset]
```

Changing contour settings must never modify the real green polygon.

---

# 61. Contour Visualization

For MVP support at least one visualization:

```text
contour lines
slope arrows
elevation heatmap
```

It must align with the green coordinate system and remain readable on mobile. Retain numerical terrain data; do not make an image the only source of simulation truth.

---

# 62. Simulated Green Tests

Add tests proving:

- terrain is clipped to the real green polygon
- generation is deterministic
- rotation changes gradient orientation
- archetypes behave qualitatively as expected
- maximum slope limits are respected
- different ball/pin positions produce different reads
- real green geometry is never mutated
- manually-created courses remain playable
- Play Mode makes zero Golf Intelligence calls

---

# 63. Updated MVP Credit Strategy

The MVP must not require purchased slope/elevation data for every green.

```text
Free course search
        ↓
Full Course Detail
        ↓
Real scorecard + GPS geometry + real green shapes
        ↓
Jetta Simulated Green Contours
        ↓
Playable 18-hole course
```

Do not hard-code provider prices because they may change.

---

# 64. Updated Final Architecture

```text
                GOLF INTELLIGENCE
                       │
                 IMPORT MODE ONLY
                       │
                       ▼
              Course Detail / GPS
                       │
                       ▼
               GI → Jetta Normalizer
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
      Real Course Geometry   Real Green Shapes
             │                   │
             │                   ▼
             │          Simulated Green Contours
             │                   │
             └─────────┬─────────┘
                       ▼
                 Existing Editor
                       │
                Review / Correct
                       │
                       ▼
               Course Ready Check
                       │
                       ▼
                    Publish
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
 Illustrated Hole Renderer      Putting Engine
          │                         │
          └────────────┬────────────┘
                       ▼
                    PLAY MODE
                       │
               Jetta Data Only
                       │
                       ▼
               Player vs Game Master
```

Final invariant:

> **Golf Intelligence is used to build/import the course. Jetta persists and runs the playable course. Real green shapes may come from the provider; green contours may be simulated locally. Published gameplay must not depend on live provider API access.**

