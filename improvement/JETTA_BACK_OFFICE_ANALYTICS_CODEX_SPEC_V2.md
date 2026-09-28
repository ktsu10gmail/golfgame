# Jetta Back Office Analytics Dashboard Spec — V2

## Status

**Implementation-ready design after repository review, but Codex must still verify exact current source locations before changing code.**

This V2 incorporates the findings from the App-server Codex review of the original analytics spec and adapts the design to Jetta's current architecture.

Do **not** implement the PostgreSQL examples from V1.

---

## 1. Goal

Create a private back-office analytics dashboard in the Jetta app server so Jetta admins can understand:

- Jetta app user growth
- authenticated product sessions
- active users
- round activity
- feature adoption
- learning-report usage
- broad product usage patterns

Recommended URL:

```text
https://golfgame.jetta.com/admin
```

This belongs in the **Jetta app server**, not the WordPress marketing site.

The app server is authoritative for:

- Jetta player accounts
- Supabase-authenticated app users
- rounds
- GPS rounds
- replay
- challenges
- gameplay state
- learning reports
- product interaction telemetry

The marketing website must not directly access the app database.

---

## 2. Current Architecture Confirmed by Repository Review

The current Jetta application uses **SQLite**, not PostgreSQL, for the relevant local player/account data.

Current identity mapping:

```text
players.id
    Internal numeric Jetta player/user ID

players.supabase_user_id
    Unique Supabase Auth UUID

players.email
    Normalized email address

players.created_at
    First time the authenticated Supabase user was seen by the Jetta app
```

Important interpretation:

```text
players.created_at != guaranteed Supabase signup timestamp
```

Therefore V1 analytics must describe these accounts as:

- Jetta Users
- Jetta App Users
- Users First Seen by Jetta

Do **not** label `players.created_at` as the exact Supabase signup time.

### Existing persisted product data

Repository review found:

| Area | Current state |
|---|---|
| Numeric Jetta user ID | `players.id` |
| Supabase mapping | `players.supabase_user_id`, uniquely indexed |
| Email | `players.email` |
| Last active | Not currently stored as a dedicated field |
| Simulation rounds | Latest state in `player_rounds`; completed history in `completed_rounds` |
| GPS rounds | Persisted in `gps_rounds` |
| Replay | Persisted through replay index and hole tables |
| Three-hole matches | Persisted in `player_challenges` |
| Academy sessions | Not persisted as independent sessions |
| 18-hole matches | Not clearly distinguishable as a separate persisted mode |
| Learning-report views | Not currently tracked |

Codex must re-check these names against the current branch immediately before implementation in case the repository has changed.

---

## 3. Core Principles

1. Supabase Auth remains the authentication authority.
2. `players.id` is the local Jetta identity used by analytics relationships.
3. Never trust a browser-supplied `player_id`.
4. Server derives the player from the authenticated Supabase identity.
5. Never expose Supabase service-role keys in browser code.
6. Never log passwords, JWTs, refresh tokens, API keys, service keys, or secrets.
7. Keep analytics metadata minimal.
8. Do not copy detailed gameplay data into analytics.
9. Prefer aggregated product statistics over unnecessary private user detail.
10. Event logging must be idempotent where an event represents an authoritative state transition.
11. Historical event analytics are authoritative only from the analytics launch date forward.
12. Use UTC consistently in V1.
13. Keep V1 small. Do not build an analytics warehouse.

---

## 4. Account Classification Before Publishing User Totals

The existing player database contains real users, legacy/local accounts, internal users, and automated test accounts.

A raw:

```sql
SELECT COUNT(*) FROM players;
```

must **not** be presented as the number of real Jetta users.

Before exposing user totals, establish an account-classification policy.

Recommended field:

```text
account_type
```

Recommended initial values:

```text
REAL
TEST
INTERNAL
LEGACY
```

If modifying `players` is inappropriate after repository inspection, use a small separate classification table keyed by `players.id`.

Default business/product analytics must count only:

```text
account_type = REAL
```

The admin UI may later provide an explicit toggle:

```text
Include test/internal/legacy accounts
```

Default: OFF.

Do not silently delete legacy or test accounts merely to clean analytics.

---

## 5. V1 Dashboard Metrics

### 5.1 User Metrics

Use these labels:

- Total Jetta Users
- New Jetta Users Today
- New Jetta Users — Last 7 Days
- New Jetta Users — Last 30 Days
- Active Users — Last 7 Days
- Active Users — Last 30 Days

Definition:

```text
New Jetta User =
a REAL player whose players.created_at falls inside the selected UTC period
```

This means **first seen by the Jetta app**, not guaranteed Supabase registration time.

Definition:

```text
Active User =
a distinct REAL player associated with at least one qualifying product
session or qualifying analytics event during the selected UTC period
```

Codex should implement one canonical helper/query for active-user calculation so different dashboard cards cannot disagree.

### 5.2 Usage Metrics

Recommended V1 cards:

- Product Sessions
- Simulation Rounds Started
- Simulation Rounds Completed
- GPS Rounds Started
- GPS Rounds Completed
- Replay Opens
- Golf Academy Starts
- 3-Hole Match Starts
- 3-Hole Match Completions
- 18-Hole Match Starts — only if this mode can be identified reliably
- Learning Report Views
- Learning Report Exports

Do not display a metric if Jetta cannot define or measure it reliably.

### 5.3 Feature Popularity

For each major feature show at minimum:

```text
Feature
Total Uses
Unique Users
% of Active Users
```

Recommended initial features:

- GPS On-Course
- PC Replay
- Golf Academy
- 3-Hole Match
- 18-Hole Match, if reliably identifiable
- Simulation Round
- Learning Reports

Do not rank popularity using event count alone.

One heavy user must not make a feature appear broadly adopted.

### 5.4 User Table

Create a searchable, paginated admin table.

Recommended columns:

- Jetta numeric user ID
- shortened/masked Supabase UUID
- email
- display name / username / nickname if an authoritative field exists
- account type
- first seen by Jetta
- last active
- product sessions
- rounds started
- rounds completed
- GPS rounds
- replay opens
- Academy starts
- match activity
- report views

Requirements:

- paginate server-side
- cap page size
- do not return unnecessary fields
- do not expose tokens or secrets
- do not show sensitive gameplay detail merely because it exists

### 5.5 Date Filters

V1:

- Today
- Last 7 Days
- Last 30 Days
- All Time

Use UTC boundaries consistently.

Future:

- custom start/end
- previous-period comparison
- cohorts
- CSV export

---

## 6. Product Session Definition

“Session” must have one explicit product definition.

For V1:

> A product session is an authenticated Jetta app visit. A new session begins when no activity from that authenticated browser session has been observed for at least 30 minutes.

Recommended approach:

1. Browser maintains/generates a random product `session_id`.
2. The server associates events for that session with the authenticated Jetta player.
3. After 30 minutes of inactivity, the client begins a new product session.
4. Do not create a new session merely because an API endpoint verifies a bearer token.
5. Supabase token refreshes are not new product sessions.
6. Repeated API calls are not logins.

Do not call these “Supabase sessions” because Jetta is defining a product-analytics session.

Recommended event:

```text
product_session_started
```

The event should be deduplicated by the product session ID.

---

## 7. Analytics Event Model — SQLite

Add a lightweight event table only if repository inspection confirms there is no equivalent telemetry table.

Suggested table:

```sql
CREATE TABLE user_events (
    id TEXT PRIMARY KEY,
    player_id INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    event_source TEXT,
    session_id TEXT,
    entity_type TEXT,
    entity_id TEXT,
    dedupe_key TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (player_id) REFERENCES players(id)
);
```

Recommended indexes:

```sql
CREATE INDEX user_events_created_at_idx
ON user_events(created_at);

CREATE INDEX user_events_player_id_idx
ON user_events(player_id);

CREATE INDEX user_events_type_created_idx
ON user_events(event_type, created_at);

CREATE INDEX user_events_session_id_idx
ON user_events(session_id);

CREATE INDEX user_events_entity_idx
ON user_events(entity_type, entity_id);

CREATE UNIQUE INDEX user_events_dedupe_key_uidx
ON user_events(dedupe_key)
WHERE dedupe_key IS NOT NULL;
```

### Field definitions

#### `id`

Generate a random UUID in application code and store it as TEXT.

Do not depend on PostgreSQL UUID functions.

#### `player_id`

Required.

References:

```text
players.id
```

The server derives it from authenticated identity.

The browser must never be allowed to select another player's `player_id`.

#### `event_type`

Allowlisted stable event name.

#### `event_source`

Recommended values:

```text
server
browser
```

Additional values may be added only if they have a clear purpose.

#### `session_id`

Product analytics session identifier.

Do not store Supabase access tokens here.

#### `entity_type`

Optional domain entity.

Examples:

```text
round
gps_round
challenge
learning_report
academy_session
```

#### `entity_id`

Identifier for the relevant entity.

Do not store an entire object.

#### `dedupe_key`

Used when the same logical event must occur only once.

Examples:

```text
round_completed:<round-id>
gps_round_started:<gps-round-id>
gps_round_completed:<gps-round-id>
match_3_hole_completed:<challenge-id>
product_session_started:<session-id>
```

For interaction events that legitimately can occur repeatedly, dedupe behavior should match the product question.

Example:

```text
learning_report_viewed:<round-id>:<session-id>
```

could represent one report view per product session rather than every browser render.

#### `metadata_json`

Valid JSON serialized as TEXT.

Metadata must be allowlisted and minimal.

#### `created_at`

ISO-8601 UTC timestamp stored as TEXT.

Use one canonical application helper for formatting timestamps.

---

## 8. Idempotency Requirements

Autosave, browser retries, duplicate network requests, refreshes, and reconnects must not inflate authoritative analytics.

Authoritative state-transition events should use stable dedupe keys.

Example:

```text
round_completed:8f2a...
```

If the same completion code executes twice, the second insert should become a harmless no-op or equivalent duplicate-handled result.

Repository review indicates the existing round-save path already knows whether a completed round was newly archived. Prefer logging `round_completed` there rather than inferring completion from the browser.

Do not use dedupe keys to suppress legitimate repeated behavior when repeated behavior itself is the metric.

---

## 9. Authoritative Events vs Interaction Events

This distinction is required.

### 9.1 Server-Authoritative Events

Generate these from trusted server-side state changes whenever possible.

Examples:

```text
profile_updated
simulation_round_completed
gps_round_started
gps_round_completed
match_3_hole_completed
```

Add `simulation_round_started` server-side only if there is a reliable authoritative start transition. Otherwise it may be a validated browser interaction.

Use existing persisted state instead of inventing parallel analytics truth.

### 9.2 Browser Interaction Events

Some useful product interactions are not currently persisted as domain entities.

Examples:

```text
replay_opened
academy_session_started
learning_report_viewed
learning_report_exported
match_18_hole_started
```

Browser telemetry endpoint requirements:

- authenticated request required
- server verifies Supabase bearer token
- server maps Supabase UUID to `players.id`
- client cannot submit `player_id`
- event name must be allowlisted
- metadata schema must be validated by event type
- metadata size must be capped
- unknown fields should be rejected or stripped according to one documented policy
- rate limit appropriately
- do not accept arbitrary event names

---

## 10. Recommended V1 Event Allowlist

Keep V1 deliberately small.

### Account / product session

```text
product_session_started
profile_updated
```

### Simulation

```text
simulation_round_started
simulation_round_completed
```

### GPS

```text
gps_round_started
gps_round_completed
```

### Replay

```text
replay_opened
```

### Academy

```text
academy_session_started
academy_session_completed
```

Only emit `academy_session_completed` after a real completion definition exists.

### Three-hole challenge

```text
match_3_hole_started
match_3_hole_completed
```

### Eighteen-hole match

```text
match_18_hole_started
match_18_hole_completed
```

Do not enable these until the mode can be reliably distinguished.

### Learning reports

```text
learning_report_viewed
learning_report_exported
```

If report generation is already an authoritative persisted operation and useful to measure:

```text
learning_report_generated
```

may be added.

### Explicitly defer from V1 unless a product question requires them

```text
profile_opened
gps_hole_started
gps_shot_logged
gps_hole_completed
replay_hole_viewed
replay_shot_reviewed
```

These create high event volume without currently answering a critical business question.

---

## 11. Analytics Metadata Policy

Analytics is telemetry, not a second gameplay database.

### Allowed examples

For a replay open:

```json
{
  "course_id": "cranbury",
  "holes_recorded": 18
}
```

For Academy:

```json
{
  "academy_mode": "approach",
  "scenario_id": "water-carry-approach"
}
```

For a report view:

```json
{
  "report_version": "2"
}
```

### Do not store in analytics metadata

- latitude / longitude
- detailed GPS paths
- every shot coordinate
- free-form coach notes
- free-form report narrative
- access tokens
- refresh tokens
- passwords
- API keys
- Supabase service-role keys
- unnecessary email copies
- full private gameplay payloads

If analytics needs a gameplay object, store an entity reference and query the authoritative table under proper authorization.

---

## 12. Admin Authorization

Jetta already has a developer email allowlist and `_require_developer()`.

Analytics admin authorization must be a **separate policy**.

Create:

```text
_require_admin()
```

Do not automatically make every developer an analytics admin unless explicitly configured.

### V1 bootstrap

Recommended environment configuration:

```text
GOLFGAME_ADMIN_SUPABASE_USER_IDS
```

containing approved stable Supabase UUIDs.

If operationally useful, email may be used only as a bootstrap convenience, but runtime authorization should resolve to and rely on the stable Supabase UUID.

Optional later migration:

```text
admin_allowlist
```

SQLite-compatible example:

```sql
CREATE TABLE admin_allowlist (
    id TEXT PRIMARY KEY,
    supabase_user_id TEXT NOT NULL UNIQUE,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL
);
```

Do not build an admin-management UI in V1.

### Authorization behavior

Every `/api/admin/*` endpoint:

1. requires authenticated Supabase identity
2. verifies token server-side
3. resolves the authenticated identity
4. checks `_require_admin()`
5. returns `401` when unauthenticated
6. returns `403` when authenticated but unauthorized

Do not rely on hiding an Admin menu item.

---

## 13. `/admin` HTML Shell vs Protected Data

A normal browser navigation to:

```text
/admin
```

does not automatically attach Jetta's Supabase bearer token as an Authorization header.

Therefore V1 may use this architecture:

```text
/admin
    Loads a non-sensitive application shell
        ↓
Browser obtains existing Supabase session
        ↓
Browser requests /api/admin/*
        ↓
Server verifies identity + admin authorization
        ↓
Sensitive dashboard data returned only after authorization
```

The HTML shell itself must contain no private analytics data.

If Jetta later requires the HTML route itself to be inaccessible before render, introduce a server-managed secure admin session/cookie design as a separate change.

Do not weaken API authorization to make `/admin` navigation easier.

---

## 14. Admin API

Suggested routes:

```text
GET /api/admin/summary?range=30d

GET /api/admin/feature-usage?range=30d

GET /api/admin/users?range=30d&search=&page=1&page_size=50

GET /api/admin/users/:playerId
```

Optional browser telemetry endpoint:

```text
POST /api/analytics/events
```

Do not expose an unrestricted generic event ingestion API.

The telemetry endpoint must enforce the browser-event allowlist.

### User pagination

Requirements:

```text
default page_size = 50
maximum page_size = 100
```

Exact values may follow existing Jetta API conventions.

Search should be bounded and parameterized.

Never build SQL by concatenating raw search input.

---

## 15. Dashboard Layout

Recommended V1:

### Header

```text
Jetta Admin
Date range
Authenticated admin identity
```

### Summary cards

```text
Jetta Users
Active Users
Product Sessions
Rounds Completed
GPS Rounds
Replay Opens
Academy Starts
Learning Report Views
```

Only show metrics that are currently trustworthy.

### Feature Usage

Table:

| Feature | Uses | Unique Users | % Active Users |
|---|---:|---:|---:|

Charts are not required in V1.

### User Activity Table

Searchable, sortable where practical, paginated.

### Recent Important Activity

Optional if inexpensive:

- last 50 important events
- no high-volume noisy telemetry
- no private GPS paths
- no tokens
- no free-form report content

If this adds unnecessary V1 complexity, defer it.

---

## 16. SQLite Query Guidance

Use parameterized SQLite queries and UTC ISO-8601 timestamps.

Do not copy PostgreSQL `interval` or `date_trunc` syntax from V1.

### Example: event totals by type

```sql
SELECT event_type, COUNT(*) AS total
FROM user_events
WHERE created_at >= ?
GROUP BY event_type
ORDER BY total DESC;
```

The application calculates the UTC boundary and binds it as a parameter.

### Example: feature usage with unique users

```sql
SELECT
    event_type,
    COUNT(*) AS usage_count,
    COUNT(DISTINCT player_id) AS unique_users
FROM user_events
WHERE created_at >= ?
  AND event_type IN (
      'gps_round_started',
      'replay_opened',
      'academy_session_started',
      'match_3_hole_started',
      'simulation_round_started',
      'learning_report_viewed'
  )
GROUP BY event_type
ORDER BY unique_users DESC, usage_count DESC;
```

### Active users

Prefer one documented definition and one reusable query/helper.

Do not independently calculate “active” differently in multiple API routes.

---

## 17. Last Active

Jetta does not currently have a dedicated authoritative `last_active` field.

For V1, derive last activity from qualifying analytics events after launch:

```sql
MAX(user_events.created_at)
```

If no event exists for a player:

- show `—`, `Unknown`, or `No analytics activity`
- do not invent a last-active timestamp

Do not rewrite historical last-active values based on guesses.

If future performance requires a denormalized `players.last_active_at`, add it only after measuring need and define exactly which events update it.

---

## 18. Historical Data and Analytics Launch Boundary

Event-based analytics will not reconstruct perfect historical usage.

The dashboard must internally record an analytics launch timestamp/version.

Recommended configuration or migration metadata:

```text
ANALYTICS_EVENT_TRACKING_STARTED_AT
```

For event-derived metrics, UI/help text should make clear:

```text
Usage tracking available from <date>
```

Do not present zero events before analytics launch as evidence that users did not use a feature.

Existing authoritative domain tables may be used for historical totals where their semantics are reliable.

Clearly distinguish:

```text
Historical persisted domain data
```

from:

```text
Event telemetry collected after analytics launch
```

Do not mix them into a single metric unless the aggregation semantics are documented and tested.

---

## 19. Event Retention

Define a retention policy before event volume grows.

Recommended V1 starting policy:

```text
Keep lightweight analytics events for 24 months.
```

This is an operational starting point, not a permanent legal/data-retention policy.

Before automated deletion is implemented, confirm whether Jetta needs a different retention period for business, privacy, legal, or investor reporting purposes.

Deletion must affect analytics telemetry only, not authoritative rounds or required account records.

---

## 20. V1 Business Questions the Dashboard Must Answer

Every V1 metric should help answer one of these questions:

1. How many real Jetta app users do we have?
2. How many are active?
3. Are users returning in multiple product sessions?
4. Which major features are being used?
5. How many unique users use each feature?
6. Are users starting and completing rounds?
7. Are users using GPS?
8. Are users opening Replay?
9. Are users using Golf Academy?
10. Are users playing challenges?
11. Are users viewing learning reports?

If an event does not help answer a real V1 product/business question, do not add it yet.

---

## 21. Future Coach/Student Analytics — Not V1

Jetta's business model is coach-first, so later analytics should test the coach/student commercial hypothesis.

Do **not** fabricate these metrics before the coach/student relationship model exists.

Future dimensions should eventually answer:

- number of coaches
- coaches with at least one linked student
- students invited per coach
- students activated per coach
- active students per coach
- seat utilization
- rounds per active student
- reports viewed by coach
- coaches using reports across multiple lesson cycles
- coach retention
- student retention
- paid conversion
- revenue retention
- whether coaches with more active students retain better

These metrics should use the authoritative future coach/student relationship and billing models, not analytics metadata hacks.

---

## 22. Privacy and Security Guardrails

Required:

- admin APIs protected server-side
- Supabase UUID authorization for admins
- browser never supplies authoritative `player_id`
- no service-role key in browser
- no arbitrary browser event names
- metadata schemas validated
- metadata size capped
- parameterized SQL
- server-side pagination
- no GPS coordinates in analytics metadata
- no detailed shot paths in analytics metadata
- no free-form report text in analytics metadata
- no passwords/tokens/secrets in events
- no unnecessary duplication of email
- no raw private user data exposed merely for convenience
- log admin API failures without logging bearer tokens

---

## 23. Recommended Implementation Order

### Phase 0 — Re-verify Repository

Before modifying code:

1. confirm current branch and commit
2. inspect player schema
3. confirm current SQLite migration/schema mechanism
4. confirm Supabase token verification helper
5. inspect `_require_developer()`
6. identify exact authoritative round/GPS/challenge persistence paths
7. confirm Academy/report/replay interaction locations
8. identify current automated test accounts and legacy accounts

Report any material mismatch with this V2 before implementation.

### Phase 1 — Account Classification

1. choose `players.account_type` or separate classification table
2. classify known TEST / INTERNAL / LEGACY accounts
3. default remaining verified production users according to an explicit migration policy
4. add tests ensuring dashboard totals exclude non-REAL accounts

Do not guess account classifications silently.

If ambiguous accounts exist, report them for manual classification.

### Phase 2 — Analytics Foundation

1. create SQLite `user_events`
2. add indexes
3. add canonical UTC timestamp helper if needed
4. add event recording helper
5. implement dedupe behavior
6. add product-session semantics
7. add analytics-launch marker

### Phase 3 — Server-Authoritative Events

Instrument trusted persistence paths first:

- round completion
- GPS start/completion
- challenge completion
- profile update where useful

Do not duplicate events if existing persistence is retried.

### Phase 4 — Browser Interaction Telemetry

Add authenticated allowlisted tracking for:

- replay open
- Academy start
- learning report view/export
- other approved V1 interactions

Server derives player identity.

### Phase 5 — Admin Authorization

1. implement `_require_admin()`
2. bootstrap stable approved Supabase UUID(s)
3. verify 401/403 behavior
4. do not create admin-management UI

### Phase 6 — Admin APIs

Build:

- summary
- feature usage
- paginated users
- user detail only if V1 genuinely needs it

### Phase 7 — `/admin` UI

Build simple useful UI:

- date filter
- summary cards
- feature-usage table
- user table

No fancy charting requirement.

### Phase 8 — Validation

Validate against known test activity and compare analytics events to authoritative domain records.

---

## 24. Required Tests

### Identity and authorization

- unauthenticated admin API → `401`
- authenticated non-admin → `403`
- approved admin → success
- changing browser-supplied identifiers cannot access another player's identity
- admin authorization relies on stable configured identity

### Account metrics

- TEST excluded
- INTERNAL excluded
- LEGACY excluded by default
- REAL included
- UTC period boundaries correct

### Event ingestion

- unknown browser event rejected
- invalid metadata rejected
- oversized metadata rejected
- browser-supplied `player_id` ignored/rejected
- authenticated identity maps to correct `players.id`

### Idempotency

- duplicate `round_completed` deduped
- duplicate GPS completion deduped
- duplicate product-session start deduped
- retry does not inflate authoritative counts

### Feature usage

- total uses correct
- unique users correct
- one heavy user does not increase unique-user count
- `% active users` denominator uses canonical active-user definition

### Pagination

- page-size cap enforced
- search parameterized
- stable ordering
- no unbounded user-table response

### Privacy

- event metadata contains no access token
- admin responses contain no service key
- GPS coordinates not copied into telemetry
- report free text not copied into telemetry

---

## 25. Explicit V1 Non-Goals

Do not implement in V1:

- analytics data warehouse
- PostgreSQL migration solely for analytics
- Supabase service-role browser access
- exact Supabase registration reporting
- admin-role management UI
- advanced cohorts
- funnel builder
- custom dashboard builder
- CSV export
- elaborate charts
- per-hole analytics
- every-shot telemetry
- GPS coordinate telemetry
- session replay
- marketing attribution platform
- revenue analytics before authoritative billing exists
- coach analytics before authoritative coach/student relationships exist

---

## 26. V2 Candidates After Real Usage Exists

Possible next features:

- daily/weekly/monthly active-user trends
- DAU/WAU/MAU ratios
- repeat-feature usage
- completion rates
- Academy repeat usage
- report repeat usage
- cohort retention
- coach/student seat utilization
- coach retention
- paid conversion
- subscription metrics
- course popularity
- acquisition source
- geographic aggregation at an appropriate privacy level
- CSV export
- charts

Prioritize based on actual business questions, not dashboard aesthetics.

---

## 27. Acceptance Criteria

V1 is complete when:

1. `/admin` exists in the Jetta app.
2. Sensitive admin data is available only through protected admin APIs.
3. Approved admins are authorized by stable Supabase identity.
4. Non-admin authenticated users receive `403`.
5. Unauthenticated requests receive `401`.
6. User totals exclude known test/internal/legacy accounts by default.
7. Dashboard terminology accurately says Jetta users/first seen, not unsupported Supabase signup claims.
8. Product session has one documented 30-minute inactivity definition.
9. SQLite event storage is implemented.
10. Authoritative events are idempotent.
11. Browser events are allowlisted and authenticated.
12. Player identity is derived server-side.
13. Feature usage shows both event count and unique users.
14. User table is paginated.
15. UTC date filtering is consistent.
16. Analytics metadata excludes sensitive/private high-volume gameplay detail.
17. Historical event limitations are visible/documented.
18. Tests cover authorization, dedupe, account filtering, event validation, pagination, and privacy.

---

## 28. Instructions to App-Server Codex

Use this document as the target design, but **do not blindly implement assumptions**.

Before coding:

1. inspect the current repository
2. report the current branch/commit
3. identify the exact files/modules/tables that will be modified
4. report any material mismatch with this V2
5. propose the smallest migration and implementation plan
6. do not change unrelated gameplay logic
7. do not migrate Jetta to PostgreSQL for this feature
8. do not introduce Supabase service-role credentials unless separately reviewed and approved
9. preserve existing authentication and gameplay behavior

Then implement in small reviewable steps.

### Required implementation report

After implementation, report:

- files changed
- schema/migrations added
- events instrumented
- admin authorization mechanism
- account-classification policy used
- API routes added
- UI added
- tests added
- test results
- analytics tracking start date
- known limitations
- deferred V2 items

---

# Final Design Summary

The V1 Jetta back-office dashboard should be:

```text
Existing Supabase authentication
        ↓
Stable Supabase UUID
        ↓
players.supabase_user_id
        ↓
players.id (Jetta numeric identity)
        ↓
SQLite authoritative gameplay tables
        +
small idempotent user_events table
        ↓
protected /api/admin/*
        ↓
simple /admin dashboard
```

The objective is not to collect everything.

The objective is to create a trustworthy measurement layer that can answer:

```text
Who is actually using Jetta?
Are they returning?
Which major features are adopted?
Are users completing meaningful golf activities?
Are they consuming the learning experience?
```

Later, when the coach/student commercial model is implemented, this same foundation can measure the questions that matter most to Jetta's business:

```text
Coach → Students → Activity → Learning Reports → Repeat Use → Retention → Revenue
```
