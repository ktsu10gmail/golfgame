# Jetta Back Office Analytics — Implementation Plan

## Status

Planning document only. Analytics implementation has not started.

This plan describes how to implement:

```text
improvement/JETTA_BACK_OFFICE_ANALYTICS_CODEX_SPEC_V2.md
```

The specification is the target design, but every repository assumption must be
verified again before code or database changes are made.

## Repository Checkpoint

The existing gameplay and post-round work was checkpointed before creating the
analytics branch.

```text
Branch: feature/back-office-analytics
Base commit: bcf406a
Commit description: Improve Game Master and post-round feedback
GitHub branches updated: main and feature/back-office-analytics
```

Verification completed at the checkpoint:

```text
Python:     191 passed, 9 skipped
JavaScript: 330 passed
```

The analytics work should remain on the dedicated feature branch until the
implementation and acceptance tests are complete.

---

## Implementation Strategy

Do not implement this feature as one large change. Build it in small,
independently testable batches. The application must remain usable after every
batch.

The sequence is:

```text
Preflight and business decisions
        ↓
Account classification
        ↓
Analytics storage and event policy
        ↓
Product sessions
        ↓
Authoritative server events
        ↓
Browser interaction events
        ↓
Admin authorization and APIs
        ↓
Admin dashboard
        ↓
Validation and controlled deployment
```

No phase should begin if a decision from the preceding phase would materially
change its data model or meaning.

---

## Phase 0 — Preflight and Decision Gate

### Repository verification

Before changing code:

1. Confirm the current branch, commit, and clean working tree.
2. Reinspect the `players` schema and Supabase identity mapping.
3. Confirm the current SQLite schema-initialization mechanism.
4. Confirm the Supabase bearer-token verification path.
5. Inspect `_require_developer()` without reusing it automatically for admins.
6. Identify the exact persistence paths for:
   - simulation rounds
   - GPS rounds
   - three-hole challenges
   - eighteen-hole competition
   - player profiles
7. Identify the exact browser entry points for:
   - Replay
   - Golf Academy
   - learning-report views
   - learning-report exports
8. Recheck known production, test, internal, and legacy accounts.
9. Report any mismatch with the V2 specification before proceeding.

### Business decisions requiring confirmation

Proposed initial account classifications:

| Account | Proposed classification |
|---|---|
| Primary Jetta owner/admin account | `INTERNAL` |
| Confirmed outside beta/player accounts | `REAL` |
| Older local account without Supabase identity | `LEGACY` |
| GM UI and automated test accounts | `TEST` |

Additional recommended decisions:

- Use the primary owner Supabase UUID as the first analytics administrator.
- Start event-derived analytics at deployment; do not fabricate a historical
  backfill.
- Use UTC for storage and date-filter boundaries.
- Adopt 24 months as the initial documented event-retention policy.
- Do not create an automated deletion job in V1 until the retention policy is
  formally approved.
- Defer eighteen-hole match metrics if the mode cannot be identified and
  completed reliably.
- Defer recent-activity and individual-user-detail endpoints unless the core
  dashboard demonstrates a real need for them.

### Phase 0 deliverable

A short preflight report containing:

- current branch and commit
- exact files expected to change
- exact tables expected to be added
- account-classification proposal
- initial administrator identity mechanism
- supported and deferred metrics
- material differences from the V2 specification

No implementation starts until ambiguous account classifications are resolved.

---

## Phase 1 — Account Classification

### Approach

Prefer a separate classification table keyed to `players.id` rather than
destructively rewriting or deleting player accounts.

Conceptual schema:

```sql
CREATE TABLE player_account_classifications (
    player_id INTEGER PRIMARY KEY,
    account_type TEXT NOT NULL,
    classified_at TEXT NOT NULL,
    FOREIGN KEY (player_id) REFERENCES players(id)
);
```

Supported values:

```text
REAL
TEST
INTERNAL
LEGACY
```

Implementation must validate these values even if the final SQLite schema uses
a different constraint arrangement.

### Rules

- Default business metrics include only `REAL` accounts.
- An unclassified account must not silently count as a real user.
- Existing accounts are classified explicitly through an idempotent operation.
- Test, internal, and legacy accounts remain available; they are not deleted.
- New Supabase-authenticated accounts need a documented classification rule.
- The dashboard may show an internal warning when unclassified accounts exist.

### Test gate

- `REAL` accounts are included.
- `TEST`, `INTERNAL`, and `LEGACY` accounts are excluded by default.
- Unclassified accounts are not silently included.
- Reapplying the classification operation is safe.

---

## Phase 2 — Analytics Storage Foundation

### Storage

Add the SQLite-compatible `user_events` table and indexes specified by V2.
Schema changes must be additive and repeat-safe.

Add an analytics configuration or schema-metadata record containing the UTC
tracking launch timestamp.

### Analytics service responsibilities

Create a focused analytics package rather than expanding unrelated gameplay
modules.

Expected new modules may include:

```text
packages/analytics/__init__.py
packages/analytics/store.py
packages/analytics/policy.py
```

Responsibilities:

- generate event UUIDs
- create canonical UTC timestamps
- validate event names
- validate event-specific metadata
- enforce metadata size limits
- insert events
- handle dedupe conflicts as harmless no-ops
- calculate date boundaries
- provide the canonical active-user query
- provide summary, feature-usage, and user-table queries

### Idempotency

Authoritative state transitions use stable dedupe keys, such as:

```text
simulation_round_completed:<round-id>
gps_round_started:<gps-round-id>
gps_round_completed:<gps-round-id>
match_3_hole_completed:<challenge-id>
product_session_started:<session-id>
```

Repeated interaction events must not be deduplicated unless the metric is
explicitly defined as one occurrence per entity/session.

### Transaction policy

When an event represents an authoritative domain transition, write it in the
same SQLite transaction as the domain update whenever practical. This avoids a
saved completion with a missing analytics event.

### Test gate

- Schema initializes on a new database.
- Schema initializes safely on an existing database.
- Valid events persist.
- Invalid event types and metadata are rejected.
- Duplicate authoritative events do not inflate counts.
- UTC timestamps sort and filter correctly.
- Analytics metadata cannot contain prohibited fields.

---

## Phase 3 — Product Sessions

### Definition

A product session is an authenticated Jetta app visit. A new product session
begins after at least 30 minutes without observed activity from that
authenticated browser session.

### Browser behavior

A small browser analytics module will:

- generate a random session ID with browser cryptography
- associate its local state with the signed-in player
- keep the session while inactivity is below 30 minutes
- create a new session after the inactivity threshold
- update its last-activity marker on defined app activity
- submit `product_session_started` once for each session

Likely new module:

```text
packages/analytics/browser_analytics.mjs
```

### Server behavior

- Authenticate the bearer token.
- Resolve the local player from the authenticated Supabase identity.
- Never accept `player_id` from the browser.
- Validate the session ID format and length.
- Deduplicate the start event by product session ID.
- Do not count Supabase token refreshes or routine API calls as new sessions.

### Test gate

- Reopening within 30 minutes reuses the session.
- Activity after 30 minutes starts a new session.
- Token refresh does not start a new product session.
- A second submission of the same session start is deduplicated.
- Sessions cannot be attributed to a browser-supplied player identity.

---

## Phase 4 — Server-Authoritative Events

Instrument trusted persistence paths before adding browser interaction events.

Initial candidates:

```text
profile_updated
simulation_round_started
simulation_round_completed
gps_round_started
gps_round_completed
match_3_hole_started
match_3_hole_completed
```

### Transition rules

- `simulation_round_completed` is emitted only when a completed round is newly
  archived.
- GPS start is emitted only when the GPS round is first persisted.
- GPS completion is emitted only when its state changes from incomplete to
  complete.
- Challenge start is emitted only when a challenge is first persisted.
- Challenge completion is emitted only on the transition to complete.
- Profile updates are legitimate repeated behavior and normally are not
  globally deduplicated.
- Simulation-round start must use a stable round identity and a documented
  definition. If the server cannot determine it reliably, use a validated
  browser event instead.

### Likely existing files involved

```text
packages/accounts/store.py
scripts/serve.py
tests/test_player_store.py
```

Exact changes depend on whether event insertion can share the existing domain
transaction without creating unwanted coupling.

### Test gate

- Autosaves do not create duplicate starts or completions.
- Retries do not inflate counts.
- Failed domain saves do not create success events.
- A completed domain record and its authoritative event stay consistent.

---

## Phase 5 — Browser Interaction Telemetry

Add telemetry only for useful actions not already represented by authoritative
tables.

Initial candidates:

```text
replay_opened
academy_session_started
academy_session_completed
learning_report_viewed
learning_report_exported
```

### Event definitions

- Replay opens only after replay data loads successfully.
- Academy starts only after the lesson/scenario is successfully prepared.
- Academy completion remains disabled until a precise completion definition is
  confirmed.
- A report view represents a real rendered report, not every rerender.
- A report export represents a user-requested download.
- Eighteen-hole match events remain disabled until discovery confirms reliable
  start/completion identities.

### Telemetry endpoint

Add an authenticated endpoint such as:

```text
POST /api/analytics/events
```

It must:

- accept only the browser-event allowlist
- authenticate the request
- derive `player_id` server-side
- validate metadata by event type
- cap request and metadata sizes
- reject or strip unknown fields according to one documented policy
- reject arbitrary event names
- avoid logging sensitive request bodies

### Privacy rules

Never copy the following into analytics:

- access or refresh tokens
- API or service keys
- passwords or PIN material
- latitude or longitude
- detailed GPS paths
- shot coordinates
- free-form report narrative
- free-form coaching notes
- complete gameplay payloads

### Test gate

- Unknown events are rejected.
- Invalid and oversized metadata are rejected.
- Browser-supplied identity is rejected or ignored safely.
- Successful UI actions emit once according to their definition.
- Failed UI actions do not emit success events.

---

## Phase 6 — Analytics Admin Authorization

Create a separate authorization policy:

```text
_require_admin()
```

Do not equate developer access with analytics access.

### Bootstrap

Use stable Supabase UUIDs configured server-side:

```text
GOLFGAME_ADMIN_SUPABASE_USER_IDS
```

The normal player-session response should not expose a full Supabase UUID merely
to support admin authorization. Keep the stable identity in the internal server
authentication context or otherwise filter public session responses.

### Required behavior

- Unauthenticated admin API request: `401 Unauthorized`
- Authenticated non-admin request: `403 Forbidden`
- Approved administrator: request proceeds
- Missing or malformed admin configuration: fail closed
- Bearer tokens are never written to logs

### Test gate

Authorization tests must cover all three access states and prove that changing
browser-supplied identifiers cannot obtain admin access.

---

## Phase 7 — Admin APIs

Initial API surface:

```text
GET /api/admin/summary?range=30d
GET /api/admin/feature-usage?range=30d
GET /api/admin/users?range=30d&search=&page=1&page_size=50
```

Defer this route unless a clear V1 need remains:

```text
GET /api/admin/users/:playerId
```

### Query rules

- Use parameterized SQL only.
- Use UTC boundaries calculated by one helper.
- Use one canonical active-user definition.
- Include only `REAL` accounts by default.
- Default `page_size` to 50 and cap it at 100.
- Use stable server-side ordering.
- Bound search length and normalize it before querying.
- Return only fields required by the dashboard.
- Include the analytics tracking start date in relevant responses.

### Metrics

Expose only trustworthy metrics:

- Total Jetta Users
- New Jetta Users for the selected period
- Active Users
- Product Sessions
- Simulation Round Starts/Completions
- GPS Round Starts/Completions
- Replay Opens
- Academy Starts
- Three-Hole Match Starts/Completions
- Learning Report Views/Exports

Feature usage must show:

```text
total uses
unique users
percentage of active users
```

Do not show eighteen-hole match metrics until reliably measured.

### Test gate

- Date ranges have correct UTC boundaries.
- All summary routes agree on active-user counts.
- Heavy usage by one player does not increase unique-user counts.
- Pagination is bounded and stable.
- Search is parameterized.
- API responses contain no secrets or unnecessary private gameplay details.

---

## Phase 8 — `/admin` Dashboard

Keep the dashboard separate from the large gameplay application module.

Expected new files:

```text
admin.html
admin.js
admin.css
```

The exact paths may be adjusted after inspecting current frontend conventions.

### Security model

The `/admin` HTML shell contains no private analytics data. It obtains the
existing Supabase browser session and calls protected `/api/admin/*` endpoints.

API authorization remains mandatory even if the UI hides admin navigation from
normal players.

### Initial UI

- Jetta Admin header
- Authenticated admin identity
- Today / 7 days / 30 days / all-time filter
- Trustworthy summary cards
- Feature-usage table
- Searchable, paginated user table
- Visible analytics tracking-start notice
- Clear loading, empty, unauthorized, and failure states

### Deferred UI

- charts
- CSV export
- recent activity feed
- cohort tools
- custom date ranges
- comparison periods
- administrator management

### UI test gate

- Admin can load data.
- Non-admin sees an access-denied state without private data.
- Expired authentication is handled safely.
- Date changes refresh all dependent sections consistently.
- Search and pagination work together.
- The page is usable on desktop and mobile.
- Keyboard navigation, labels, table semantics, and focus states are present.

---

## Phase 9 — Full Validation

### Automated tests

Run targeted tests after each phase, followed by the complete suites:

```text
python3 -m unittest discover -v
node --test tests/*.test.mjs
```

Expected new tests may include:

```text
tests/test_analytics_store.py
tests/test_admin_api.py
tests/browser_analytics.test.mjs
```

Existing account/store and Supabase tests should be expanded only where the new
behavior intersects those modules.

### Data reconciliation

Create controlled test activity and compare:

- completion events against `completed_rounds`
- GPS events against `gps_rounds`
- challenge events against `player_challenges`
- dashboard account totals against explicit classifications
- feature uses and unique users against direct event queries

### Regression requirements

- Existing login and logout behavior remains unchanged.
- Existing player session responses do not leak additional identity data.
- Normal gameplay does not fail if analytics logging is disabled.
- Analytics failure does not corrupt authoritative gameplay records.
- Existing round, GPS, replay, Academy, and challenge behavior continues to
  pass its tests.

---

## Deployment Plan

### Feature flag

Recommended configuration:

```text
GOLFGAME_ANALYTICS_ENABLED
```

The first deployment can include code and additive schema while tracking remains
disabled. Enable tracking only after admin authorization and classification are
verified.

### Deployment sequence

1. Confirm the analytics branch is clean and fully tested.
2. Review the final diff and implementation report.
3. Back up `data/player_accounts.sqlite3` using a SQLite-safe backup operation.
4. Deploy the additive schema and code with analytics disabled.
5. Configure the approved admin Supabase UUID.
6. Verify authentication and `401`/`403` behavior.
7. Apply and verify account classifications.
8. Record the UTC analytics launch timestamp.
9. Enable analytics tracking.
10. Generate controlled activity for each enabled event.
11. Compare dashboard values with direct database queries.
12. Monitor server logs for SQLite locking, validation failures, and unexpected
    event volume.

### Rollback

- Disable analytics through the feature flag.
- Roll back application code if required.
- Leave additive analytics tables in place; they do not affect gameplay.
- Do not delete events or classifications during an emergency rollback.
- Restore the database backup only if authoritative data was actually damaged,
  not merely because the dashboard is disabled.

---

## Commit Plan

Use focused commits so each layer can be reviewed independently:

1. `Add analytics schema and account classification`
2. `Add validated analytics event service`
3. `Track authenticated product sessions`
4. `Instrument authoritative gameplay events`
5. `Add browser interaction telemetry`
6. `Add analytics admin authorization and APIs`
7. `Add Jetta analytics dashboard`
8. `Document analytics deployment and validation`

Commit names may change to match the actual implementation, but unrelated
gameplay changes must not be mixed into these commits.

---

## Expected File Scope

Likely existing files to modify:

```text
scripts/serve.py
packages/accounts/store.py
app.js
tests/test_player_store.py
```

Likely new files:

```text
packages/analytics/__init__.py
packages/analytics/store.py
packages/analytics/policy.py
packages/analytics/browser_analytics.mjs
admin.html
admin.js
admin.css
tests/test_analytics_store.py
tests/test_admin_api.py
tests/browser_analytics.test.mjs
```

This list is provisional. Phase 0 must confirm it before implementation.

---

## Completion Criteria

The implementation is ready to merge only when:

1. Approved admins are authorized by stable Supabase identity.
2. Unauthenticated and non-admin users cannot obtain analytics data.
3. Real-user totals exclude known test, internal, legacy, and unclassified
   accounts by default.
4. Product sessions follow the documented 30-minute inactivity rule.
5. Authoritative events are idempotent.
6. Browser events are allowlisted, authenticated, and schema-validated.
7. Player identity is always derived server-side.
8. Feature usage includes uses, unique users, and percent of active users.
9. UTC filtering is consistent across endpoints.
10. The user table is server-paginated.
11. Analytics metadata contains no secrets, GPS paths, detailed coordinates, or
    free-form report content.
12. The dashboard clearly identifies when event tracking began.
13. Existing gameplay behavior and tests remain healthy.
14. Controlled dashboard totals reconcile with authoritative database records.
15. The implementation report documents changes, tests, limitations, and
    deferred work.

---

## V1 Boundaries

Do not expand this implementation into:

- a data warehouse
- PostgreSQL migration
- browser access to Supabase service-role credentials
- exact Supabase signup reporting
- a role-management UI
- per-hole or per-shot telemetry
- GPS coordinate collection
- session replay
- marketing attribution
- advanced cohorts
- revenue analytics without authoritative billing
- coach/student analytics without an authoritative relationship model

The V1 objective is a trustworthy, small measurement layer—not collection of
every available data point.
