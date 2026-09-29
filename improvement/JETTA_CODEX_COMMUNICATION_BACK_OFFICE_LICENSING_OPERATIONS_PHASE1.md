# Codex Communication — Jetta Back Office Licensing Operations

**Status:** Approved requirements and implementation plan after Phase 0 repository audit
**Scope:** Back Office Licensing Operations only
**Implementation base:** Current `feature/license-model-v1` work

## Decision

The Phase 0 repository findings are accepted.

There is currently **no implemented Jetta Back Office**. Create the Back Office shell while reusing the existing identity, licensing, Coach, feedback, account, entitlement, and audit services.

Do **not** describe this work as extending an existing Back Office implementation.

The older Back Office analytics material is planning work, not an implemented system.

## 1. Implementation Boundary

Proceed with **Back Office Licensing Operations** first.

This phase includes:

```text
/admin
├── Access & Licensing
├── Users
├── Entitlement Diagnostic
├── Coaches / Subscriptions
└── Audit
```

Do **not** implement the larger Back Office Analytics/telemetry project in this phase.

Analytics will be a separate deliverable after trustworthy telemetry, account classification, metric definitions, and historical limitations are established.

## 2. Authoritative Implementation Base

Use the current licensing implementation on:

```text
feature/license-model-v1
```

as the authoritative base.

Do not begin new Back Office work from the older:

```text
feature/back-office-analytics
```

branch.

If that older branch contains useful work, inspect and reconcile it later against the current licensing branch. Do not overwrite or regress the current license model.

## 3. Reuse Existing Licensing Services

The existing licensing implementation already provides the authoritative behavior for:

- secure random `JETTA-...` code generation;
- hashed code storage;
- Individual and Coach plans;
- duration controls;
- maximum-redemption controls;
- atomic redemption;
- revocation;
- failed-attempt rate limiting;
- entitlement grants;
- Coach sponsorship;
- audit events.

The Back Office must call existing server-side services/APIs.

**Do not reproduce Access Code generation, entitlement resolution, seat logic, or authorization logic in browser JavaScript.**

Add read-only server services/API support where needed for:

- redemption history;
- creator display information;
- user search;
- player entitlement investigation;
- audit-event search;
- Coach subscription inspection;
- sponsored-seat inspection.

## 4. `/admin` Security Decision

The following design is approved.

`/admin` may return a **data-free application shell** before ADMIN authorization is known.

The shell may then request:

```text
GET /api/admin/session
```

using the normal Supabase bearer-token flow.

Every administrative data/action endpoint must independently enforce server-side ADMIN authorization:

```text
/api/admin/*
    ↓
_require_admin()
```

An unauthorized user may receive the static shell, but must receive **zero administrative data**.

This means:

```text
GET /admin
→ data-free shell is acceptable

GET /api/admin/session
→ server authorization required

GET/POST/etc. /api/admin/*
→ server authorization required independently
```

Do not undertake a new server-session exchange solely to force HTTP 403 before serving static `/admin` HTML.

Security is defined by protection of administrative APIs and data, not secrecy of static HTML/CSS/JavaScript.

The route behavior is:

```text
GET /admin
→ redirect to /admin/

GET /admin/
→ serve a data-free static shell
```

No player, Access Code, Coach, subscription, entitlement, or audit data may be
embedded in the shell or its static JavaScript/CSS assets.

Centralize the administrative API gate. `do_GET()` and `do_POST()` must route
the `/api/admin/*` prefix through dedicated admin dispatchers which call
`_require_admin()` before selecting the individual operation. Pass the
authenticated ADMIN identity returned by `_require_admin()` into every
individual operation so mutations can record the real actor and read operations
can retain an authorization-aware interface.

```text
/api/admin/*
    ↓
central GET/POST admin dispatcher
    ↓
_require_admin()
    ↓
individual operation(admin_identity, ...)
```

## 5. ADMIN Bootstrap Policy

The repository audit found that developer allowlists can result in a persistent ADMIN role.

Adopt this policy:

### Production

```text
GOLFGAME_DEVELOPER_EMAILS
```

may be used to **bootstrap/provision known ADMIN accounts**.

Once granted, ADMIN is an explicit persistent authorization in Jetta.

Removing an email from the environment variable must not be assumed to revoke an already-persisted ADMIN role.

ADMIN grant/revoke must eventually be explicit and auditable.

### Local Development

```text
GOLFGAME_DEVELOPER_NAMES
```

may remain useful for local testing.

**Do not use name-based authorization as a production ADMIN security mechanism.**

### This phase

Do not build a full ADMIN-management UI yet.

Document the current bootstrap behavior clearly and preserve existing safe behavior unless a minimal change is necessary.

If a grant/revoke mechanism is required for production readiness, propose the smallest explicit audited server-side mechanism before implementing it.

## 6. Player Account Boundary

Move administrative Access Code functionality **out of Player Account**:

- Access Code generation;
- global code listing;
- code revocation;
- global user lookup;
- global Coach/subscription inspection;
- audit records;
- product analytics.

Keep player-owned functionality in Player Account:

- current access status;
- Historical Access explanation;
- Access Code redemption;
- pending Coach invitations;
- current Coach;
- player-owned history.

Change the redemption copy to:

> **Have a Jetta Access Code?**
> Enter the code provided by Jetta.

The player must never be led to believe they should construct or choose the characters after `JETTA-`.

## 7. Coach Dashboard Boundary

Keep Coach Dashboard focused on the Coach's own coaching workflow:

- students;
- invitations;
- sponsored seats;
- release seat;
- end coaching relationship;
- student rounds;
- learning evidence.

A COACH role does not imply ADMIN.

Do not move normal Coach sponsorship operations into Jetta Back Office.

Back Office may provide Jetta administrators with **read-only operational inspection** of Coach subscriptions, relationships, seat usage, and grace state.

## 8. Initial Back Office UX

Do not build a large analytics dashboard yet.

The initial `/admin` landing page can be intentionally simple:

```text
Jetta Back Office

Users
Search accounts and investigate access.

Access & Licensing
Generate and manage Jetta Access Codes.

Coaches
Inspect Coach subscriptions and sponsored seats.

Audit
Review licensing and administrative events.
```

Prioritize operational usefulness over decorative metrics.

## 9. Access & Licensing

Create an ADMIN-only Access & Licensing surface.

Reuse the existing code-generation service.

UI should support:

```text
Generate Jetta Access Code

Access Type
○ Individual
○ Coach

Access Duration
[ 90 days ]

Maximum Redemptions
[ 1 ]

[ Generate Code ]
```

After generation, display the complete plaintext code once and make clear that it must be copied now.

Do not make plaintext recoverable later.

Code-management views may show safe metadata such as:

- type;
- status;
- created date;
- creator;
- duration;
- redemption limit;
- redemption count;
- expiration/deadline;
- final characters;
- revoked state.

Support existing revocation behavior without weakening auditing or security.

## 10. Users

Add ADMIN-only user search.

Use the existing Jetta identity mapping.

Useful operational information includes:

```text
Jetta player ID
Display name
Email
Supabase user ID
Roles
First seen / account date
Current entitlement grants
Current Coach relationship
Current play authorization
Relevant recent licensing events
```

Respect existing account classification issues.

Do not present a raw `players` count as a trustworthy customer/user metric because the table may contain local, test, internal, legacy, and Supabase accounts.

For an inspected player, use **Account** and **Identity** terminology. Finding
a player record or Supabase mapping does not prove that the player currently
has a valid authenticated session. Do not display `Authentication: Valid` for
the inspected player.

Preferred examples:

```text
Account: Exists
Identity: Supabase linked
```

```text
Account: Exists
Identity: Local development account
```

All list and search operations must be bounded server-side. Require a useful
search term, apply a conservative default limit, enforce a hard maximum, and
use stable pagination for additional results. Never return PIN hashes, salts,
session tokens, access tokens, refresh tokens, or raw authentication secrets.

## 11. Entitlement Diagnostic

Implement a deterministic ADMIN diagnostic answering:

> Why can or can't this player start new play?

The diagnostic must use the authoritative entitlement resolver and stored evidence.

The diagnostic must always report three separate fields:

```text
Entitlement Decision
Enforcement Mode
Current Runtime Result
```

This separation is required because `shadow` mode may permit new play even
when the player has no valid entitlement. The entitlement decision must answer
whether valid grants authorize play. The runtime result must then apply the
configured `off`, `shadow`, or `enforced` policy.

Example in enforced mode:

```text
Player: David Chen
Account: Exists
Identity: Supabase linked

Entitlement Decision:
DENIED — no valid grants

Enforcement Mode:
ENFORCED

Current Runtime Result:
DENIED

Valid Grants:
None

Coach Relationship:
ACTIVE

Sponsored Seat:
Released

Individual Access:
None

Result:
Historical Access
```

Or:

```text
Player: Jennifer Lee

Entitlement Decision:
ALLOWED — at least one valid grant

Enforcement Mode:
ENFORCED

Current Runtime Result:
ALLOWED

Valid Grants:
SELF_PAID
COACH_SPONSORED

Reason:
At least one valid grant permits new play.
```

Example in shadow mode without an entitlement:

```text
Entitlement Decision:
DENIED — no valid grants

Enforcement Mode:
SHADOW

Current Runtime Result:
ALLOWED — shadow-mode policy
```

Do not create a second authorization algorithm for this screen.

Do not use an LLM to determine authorization.

Implement this through a public diagnostic method on the authoritative
licensing service. Do not make Back Office code depend directly on the private
`_valid_grants()` helper or reproduce its rules.

## 12. Coach / Subscription Inspection

Provide ADMIN read-only inspection for:

- Coach identity;
- Coach subscription/access state;
- ACTIVE / PAST_DUE / grace state as supported by the implemented model;
- grace deadline;
- sponsored seats used / capacity;
- active coaching relationships;
- pending invitations;
- student sponsorship state.

Preserve the domain rule:

**Coaching relationship and sponsored entitlement are separate concepts.**

A released sponsored seat must not make an ACTIVE coaching relationship disappear.

## 13. Audit

Expose existing license/audit events through an ADMIN-only view.

Use actual event names and schema from the repository.

Do not invent duplicate event types merely to satisfy the UI.

Useful filters may include:

```text
Date
Player
Coach
Administrator
Event type
Access Code
Entitlement type
```

Administrative mutations must remain auditable.

Audit and other operational queries must be bounded and newest-first. Parse
and escape structured audit details before rendering them. The Back Office may
read audit history but must not edit or delete it.

## 13A. Initial Data-Model Decision

Make **no schema changes initially**.

Use bounded read queries against the existing authoritative tables:

```text
players
player_roles
subscriptions
access_codes
access_code_redemptions
entitlement_grants
coach_student_relationships
coach_invitations
coach_seat_assignments
license_audit_events
play_activities
```

Do not add speculative indexes before measuring the bounded operational
queries against realistic data. If later evidence shows a query needs an
index, propose that index as a separate additive migration with query-plan and
regression evidence.

## 14. Analytics — Explicitly Deferred

Do not attempt to make the initial Back Office look complete by inventing analytics.

The repository audit found that some values are currently derivable, while others are not reliably recorded.

In particular, do not claim reliable historical values for:

- product sessions;
- Replay opens;
- Round Review views;
- Learning Report views/exports;
- Academy completions;
- Coach Dashboard usage;
- Learning Focus activity;
- historical active-user counts;
- historical conversion funnels;
- reliable 18-hole match completions where completion evidence is absent.

`play_activities` authorized starts are not equivalent to completed activities if `completed_at` is not being updated.

Do not label a start as a completion.

Future analytics must use honest states such as:

```text
Not recorded before <date>
Recorded since <date>
Building evidence
Not currently available
```

Never fabricate historical backfills.

## 15. Separate Future Deliverable — Back Office Analytics

After Licensing Operations is working, plan a separate analytics implementation covering:

1. account classification;
2. telemetry/event storage;
3. authenticated product sessions;
4. forward-looking event instrumentation;
5. metric definitions;
6. denominators and time windows;
7. completion tracking;
8. historical-data limitations;
9. analytics APIs;
10. analytics screens.

Do not let this larger project block the operational Back Office.

## 16. Required Tests

At minimum, add tests proving:

### Authorization

- PLAYER cannot retrieve `/api/admin/*` data;
- COACH without ADMIN cannot retrieve `/api/admin/*` data;
- ADMIN can access authorized endpoints;
- direct API calls cannot bypass `_require_admin()`;
- browser-side role manipulation cannot authorize an API request;
- `/admin` redirects to `/admin/`;
- `/admin/` and its static assets contain no embedded administrative data;
- `/api/admin/*` uses the centralized ADMIN dispatcher;
- unauthenticated admin API requests return `401`;
- authenticated PLAYER or non-ADMIN COACH requests return `403`;
- inspected-player responses never expose PIN hashes, salts, session tokens,
  access tokens, refresh tokens, or other authentication secrets;
- email and Supabase UUID are never added to non-admin responses.

### Access Codes

- ADMIN can generate Individual codes;
- ADMIN can generate Coach codes;
- non-ADMIN cannot generate codes;
- plaintext behavior remains unchanged;
- hashes remain authoritative;
- atomic redemption remains unchanged;
- revocation remains unchanged;
- rate limiting remains unchanged;
- mutations remain audited.

### Player Account

- redemption remains available;
- administrative generation/list/revoke controls are removed;
- copy says `Have a Jetta Access Code?`;
- helper text says `Enter the code provided by Jetta.`;
- existing activation behavior remains functional.

### Coach

- Coach Dashboard functionality remains intact;
- COACH does not gain ADMIN privileges;
- Coach sponsorship behavior is not changed by Back Office implementation.

### Entitlement Diagnostic

- diagnostic result agrees with authoritative entitlement resolver;
- multiple valid grants are displayed correctly;
- historical-only state is displayed correctly;
- active Coach relationship without sponsorship is represented correctly;
- PAST_DUE/grace behavior agrees with existing licensing rules;
- every result contains `Entitlement Decision`, `Enforcement Mode`, and
  `Current Runtime Result` as distinct values;
- shadow mode reports entitlement denial separately from runtime allowance;
- enforced mode reports entitlement denial and runtime denial separately;
- inspected-player identity uses Account/Identity language and never claims
  that account existence proves current authentication;
- Supabase-linked and local-development identities are distinguished;
- the diagnostic calls the authoritative public licensing diagnostic rather
  than duplicating `_valid_grants()` logic.

### Bounded Operations and Rendering

- user search rejects an empty or unhelpfully short query;
- server-side limits have conservative defaults and hard maximums;
- pagination is stable when multiple rows share a timestamp;
- malformed limits, cursors, identifiers, and filters return controlled `400`
  responses rather than server errors;
- audit results are newest-first and bounded;
- structured audit details are escaped before browser rendering;
- plaintext Access Codes appear only in the immediate generation result;
- code history exposes only safe metadata and the stored code hint;
- ADMIN bootstrap persistence is documented and covered by a regression test;
- local developer-name bootstrap is not presented as a production security
  mechanism.

### Regression

Run the existing licensing suite unchanged where possible.

Verify entitlement behavior for all five protected start paths remains intact:

```text
regular simulated round
On-Course GPS round
Golf Academy lesson
3-hole match
18-hole match
```

## 17. Implementation Sequence

Use this order:

1. Confirm the exact files/routes/services to reuse.
2. Create the `/admin` data-free shell and navigation.
3. Add `/api/admin/session`.
4. Ensure every `/api/admin/*` endpoint passes through the centralized
   `_require_admin()` gate before route-specific handling.
5. Move Access Code administration out of Player Account.
6. Update Player Account redemption wording.
7. Add ADMIN user search.
8. Add entitlement diagnostic.
9. Add Coach/subscription inspection.
10. Add audit-event search/view.
11. Add filters/pagination only where needed.
12. Run full licensing and regression tests.

Do not add analytics telemetry in this phase unless a tiny change is strictly necessary to support an operational licensing feature.

## 18. Non-Goals for This Pass

Do not implement:

- full Back Office Analytics;
- historical metric reconstruction;
- a second entitlement system;
- a second identity system;
- a second authentication system;
- payment/Stripe integration;
- Coach/student billing;
- full ADMIN-management UI;
- browser-side authorization;
- arbitrary database editing;
- impersonation;
- production enforcement-mode toggle;
- unrelated redesign of Player or Coach experiences.

## 19. Exact Implementation Plan

This section is the approved plan for the next coding pass. Do not broaden the
file, route, schema, or product scope without reporting the reason first.

### 19.1 Files to Create

```text
admin/index.html
admin/admin.css
admin/admin.js
packages/accounts/admin_operations.py
tests/test_admin_operations.py
tests/test_admin_http.py
tests/admin_back_office.test.mjs
docs/JETTA_BACK_OFFICE_OPERATIONS_GUIDE.md
```

Responsibilities:

- `admin/index.html` is the data-free Back Office shell with navigation for
  Users, Access & Licensing, Coaches, and Audit.
- `admin/admin.css` contains Back Office-specific layout and responsive styles;
  it must not depend on the gameplay page's modal layout.
- `admin/admin.js` reuses the existing Supabase browser-auth module, attaches
  the bearer token to admin API requests, supports the existing local
  HttpOnly-cookie development session, renders all untrusted values through
  safe DOM text operations, and contains no authoritative licensing logic.
- `packages/accounts/admin_operations.py` contains bounded, read-only
  operational queries and response shaping over the existing account and
  licensing tables. It does not create a second entitlement resolver.
- `tests/test_admin_operations.py` tests bounded queries, safe fields,
  pagination, diagnostics, Coach inspection, and audit inspection.
- `tests/test_admin_http.py` tests route redirect behavior, centralized ADMIN
  authorization, response codes, safe response bodies, and mutation actor
  propagation.
- `tests/admin_back_office.test.mjs` tests Back Office request construction,
  view-state formatting, required diagnostic sections, safe rendering policy,
  and the absence of administrative controls from Player Account markup.
- `docs/JETTA_BACK_OFFICE_OPERATIONS_GUIDE.md` documents ADMIN bootstrap,
  Access Code operations, diagnostic interpretation, and safe rollout.

### 19.2 Files to Modify

```text
scripts/serve.py
packages/accounts/licensing.py
packages/accounts/__init__.py
index.html
app.js
styles.css
tests/test_licensing.py
README.md
improvement/JETTA_CODEX_COMMUNICATION_BACK_OFFICE_LICENSING_OPERATIONS_PHASE1.md
```

Changes:

- `scripts/serve.py`: add `/admin` redirect, centralized admin GET/POST
  dispatch, bounded parameter parsing, and the endpoints listed below.
- `packages/accounts/licensing.py`: add a public authoritative entitlement
  diagnostic and safe read helpers only where licensing-domain knowledge is
  required. Keep `_valid_grants()` private.
- `packages/accounts/__init__.py`: export the new administrative operations
  service.
- `index.html`: remove the Access Code administration button/dialog and update
  Player redemption copy.
- `app.js`: remove administrative code-list/generation/revocation rendering and
  event handlers; preserve code redemption, access display, Coach invitations,
  and Coach Dashboard behavior.
- `styles.css`: remove only styles that become unused with the Player Account
  administration dialog; retain shared Player/Coach access styles.
- `tests/test_licensing.py`: extend authoritative diagnostic coverage without
  weakening or replacing existing licensing tests.
- `README.md`: link the Back Office route and operations guide, document the
  production email bootstrap and local-only name bootstrap.
- This specification records the approved corrections and exact plan; no
  application implementation is performed while planning it.

No `.env` setting or payment-provider configuration is added in this phase.

### 19.3 Route and Endpoint Plan

Static routes:

```text
GET /admin
    308 redirect to /admin/

GET /admin/
    data-free admin/index.html

GET /admin/admin.css
GET /admin/admin.js
    static Back Office assets containing no administrative records
```

Central dispatcher behavior:

```text
do_GET()/do_POST()
    if path starts with /api/admin/:
        admin = _require_admin()
        if admin is None: return
        dispatch_admin_get/post(parsed_path, admin)
```

Unknown `/api/admin/*` paths return a controlled `404` only after the
centralized authorization gate. Invalid inputs return `400`; missing identity
returns `401`; an authenticated non-ADMIN returns `403`.

Administrative endpoints:

```text
GET /api/admin/session
```

Returns the authenticated administrator's safe identity (`id`, display name,
email, roles), the current enforcement mode, and Back Office capability names.
It never returns tokens or secrets.

```text
GET /api/admin/access-codes
POST /api/admin/access-codes
POST /api/admin/access-codes/revoke
GET /api/admin/access-codes/{code_id}/redemptions
```

- Preserve the existing list, generation, and revoke contracts where practical.
- Generation passes `admin["id"]` to `create_access_code()`.
- Revocation passes `admin["id"]` to `revoke_access_code()`.
- List and redemption-history responses expose safe metadata and code hints,
  never hashes or recoverable plaintext.
- Keep the existing revoke route during this phase to avoid an unnecessary API
  migration; a later version may adopt a resource-style revoke route.

```text
GET /api/admin/users?query=<term>&limit=<n>&cursor=<opaque>
GET /api/admin/users/{player_id}
GET /api/admin/users/{player_id}/entitlement-diagnostic
```

- Search requires at least two normalized characters unless the query is a
  complete numeric player ID.
- Default result limit is 25; the hard maximum is 100.
- Cursor ordering is stable using the sort value plus player ID.
- User detail returns Account/Identity information, roles, current Coach,
  subscriptions, grants, and recent licensing events, but no authentication
  secrets.
- The diagnostic always returns separate machine fields and display labels for
  `entitlement_decision`, `enforcement_mode`, and `runtime_result`.

```text
GET /api/admin/coaches?query=<term>&limit=<n>&cursor=<opaque>
GET /api/admin/coaches/{coach_id}
```

- Coach list/detail is read-only.
- Detail includes Coach subscription status, grace deadline, sponsored seats,
  active relationships, pending invitations, and each student's sponsorship
  state.
- It does not call the Coach-facing dashboard as though the ADMIN were the
  Coach and does not expose invitation tokens.

```text
GET /api/admin/audit?event_type=<type>&subject_id=<id>&actor_id=<id>
    &entity_type=<type>&entity_id=<id>&before=<opaque>&limit=<n>
```

- Default limit is 50; hard maximum is 100.
- Results are ordered by `created_at DESC, id DESC`.
- Filters use parameters, never interpolated SQL.
- `detail_json` is parsed into structured data server-side; malformed legacy
  detail is represented safely rather than causing a server error.
- Audit is read-only and has no delete/update endpoint.

No analytics, ADMIN-role management, impersonation, raw SQL, database export,
or enforcement-toggle endpoint is added.

### 19.4 Existing Services and Functions to Reuse

Authorization and identity:

```text
AppHandler._current_player()
AppHandler._with_access_role()
AppHandler._require_admin()
SupabaseAuth.get_user()
PlayerStore.player_for_session()
PlayerStore.upsert_supabase_player()
packages/accounts/browser_supabase_auth.mjs:createSupabaseAuth()
```

Licensing:

```text
LicenseService.roles()
LicenseService.access_summary()
LicenseService.create_access_code()
LicenseService.list_access_codes()
LicenseService.revoke_access_code()
LicenseService.reconcile_subscription_lifecycle()
```

The new public `LicenseService.entitlement_diagnostic(player_id)` will call the
same internal resolver used by play authorization. It will report:

```text
valid grants
entitlement_decision
enforcement_mode
runtime_result
current Coach relationship
relevant subscription/seat explanation
```

`AdminOperationsService` will use parameterized, bounded reads for user, code,
Coach, subscription, redemption, and audit inspection. It may call the public
licensing diagnostic but must not query `_valid_grants()` or decide entitlement
independently.

### 19.5 Schema and Query Plan

No schema migration is approved for the initial implementation.

Use only the existing tables listed in §13A. Read methods must:

- select explicit safe columns rather than `SELECT *` in API-facing queries;
- use parameterized SQL;
- apply a default and maximum limit;
- use stable `(sort_value, id)` cursor pagination where a list can grow;
- avoid per-row unbounded query loops;
- never return hashes, PIN material, session tokens, bearer tokens, or raw
  invitation tokens;
- measure before proposing indexes.

### 19.6 Player Account UI to Remove or Retain

Remove from Player Account:

```text
#license-admin-button
#license-admin-dialog
renderAccessCodes()
loadAccessCodes()
openLicenseAdmin()
createAdminAccessCode()
admin list/revoke event handlers
admin-only code generation/list/revoke markup and styles
```

Retain:

```text
#account-access-card
#account-access-code
#account-redeem-code
redeemPlayerAccessCode()
renderPlayerAccess()
pending Coach invitation controls
Coach Dashboard navigation for COACH users
```

Change the Player copy to:

```text
Have a Jetta Access Code?
Enter the code provided by Jetta.
```

Do not add an ADMIN Back Office link inside the Player access card. If a small
ADMIN navigation link is provided elsewhere in Account, label it `Jetta Back
Office`, point it to `/admin/`, and keep it visually separate from player
entitlement. Its visibility is convenience only; server authorization remains
authoritative.

### 19.7 Authorization Behavior

- The static shell and assets contain no private data.
- Every `/api/admin/*` request reaches `_require_admin()` before route-specific
  parsing or data access.
- Browser-supplied roles, player IDs, Coach IDs, and actor IDs are ignored for
  authorization.
- The authenticated ADMIN ID is the actor for every Access Code mutation.
- PLAYER and non-ADMIN COACH accounts receive no administrative records.
- Production bootstrap uses `GOLFGAME_DEVELOPER_EMAILS`; local names remain a
  development convenience only.
- Persisted ADMIN role behavior is documented. This phase does not add grant or
  revoke UI.
- Browser rendering uses `textContent`, element construction, or an equivalent
  escaping boundary for all database-derived content.
- State-changing requests remain same-origin JSON requests and retain the
  existing Supabase bearer/local SameSite-cookie authentication behavior.

### 19.8 Tests to Add and Update

`tests/test_admin_operations.py`:

- bounded user search and stable pagination;
- numeric-ID, name, and email lookup;
- Supabase-linked versus local identity labels;
- safe-column allowlist and secret exclusion;
- code creator and redemption history;
- Coach subscription, grace, seats, relationships, and invitations;
- released-but-still-coached representation;
- audit filters, ordering, pagination, and malformed detail handling.

`tests/test_admin_http.py`:

- `/admin` redirects to `/admin/`;
- static shell contains no player/license/audit records;
- unauthenticated request receives `401`;
- PLAYER and non-ADMIN COACH receive `403`;
- ADMIN receives authorized data;
- an unknown admin endpoint cannot bypass the central gate;
- browser role/ID/actor spoofing has no effect;
- invalid query parameters receive controlled `400` responses;
- code generation/revocation use the authenticated ADMIN as audit actor;
- plaintext is returned once at generation and absent from later reads.

`tests/test_licensing.py`:

- entitlement decision, enforcement mode, and runtime result are always
  separate;
- no-grant behavior in `off`, `shadow`, and `enforced` modes;
- multiple valid grants;
- active Coach relationship without sponsorship;
- PAST_DUE/grace access;
- expired Coach sponsorship;
- diagnostic result agrees with `authorize_new_activity()` policy.

`tests/admin_back_office.test.mjs`:

- required navigation and diagnostic sections;
- safe query-string construction;
- safe rendering of hostile display names and audit details;
- loading, empty, unauthorized, forbidden, and error states;
- Player Account contains redemption copy but no generation/list/revoke UI;
- COACH navigation does not expose ADMIN operations;
- static assets contain no embedded administrative records.

Regression commands:

```bash
.venv/bin/python -m pytest tests/test_licensing.py tests/test_admin_operations.py tests/test_admin_http.py -q
.venv/bin/python -m pytest -q
node --test tests/*.test.mjs
node --check app.js
node --check admin/admin.js
git diff --check
```

Complete one real-browser pass for ADMIN, PLAYER, and non-ADMIN COACH roles,
including direct `/admin/` navigation and direct admin API attempts.

### 19.9 Migration and Rollout Risks

1. **ADMIN persistence:** Removing an email from the bootstrap allowlist does
   not revoke an already-persisted ADMIN role. Document and verify the intended
   administrators before deployment.
2. **Shadow-mode interpretation:** Without the approved three-part diagnostic,
   runtime allowance could be mistaken for valid entitlement. Never collapse
   these fields.
3. **Supabase page navigation:** `/admin/` cannot rely on navigation headers for
   a bearer token. The shell must load the existing stored Supabase session and
   send the token only to protected APIs.
4. **Local versus production authorization:** Name bootstrap is local-only.
   Production must use verified email bootstrap and persisted ADMIN roles.
5. **PII exposure:** Email and Supabase UUID become available through new admin
   endpoints. Confirm every route uses the central gate and ensure responses
   are not cached publicly.
6. **UI removal regression:** Moving the dialog must not remove player code
   redemption or Coach Dashboard navigation.
7. **Audit rendering:** `detail_json` may contain unexpected legacy data. Parse
   defensively and render as text, never raw HTML.
8. **SQLite growth/performance:** Bounded queries avoid table dumps, but audit
   and search performance must be measured before adding indexes.
9. **Route-cache behavior:** `/admin/` and admin data responses must use
   appropriate no-store headers; static JS/CSS may use the repository's normal
   asset revalidation policy.
10. **Branch integrity:** Implement from `feature/license-model-v1`, not the
    older analytics branch. Preserve the existing license commits and keep the
    Back Office work on a new dedicated branch created from this base.
11. **No analytics inference:** Operational counts shown in individual detail
    views must not become unlabeled product analytics or historical totals.

### 19.10 Commit and Rollout Sequence

Use small reviewable commits:

1. Create a dedicated Back Office branch from the current licensing branch.
2. Add the data-free shell, redirect, central API gate, and authorization tests.
3. Move Access Code administration and update Player redemption copy.
4. Add bounded user search and the authoritative entitlement diagnostic.
5. Add Coach/subscription inspection.
6. Add audit inspection.
7. Add documentation and complete regression/browser verification.
8. Deploy first with existing license enforcement unchanged (`shadow` unless
   separately approved).
9. Verify ADMIN access, PLAYER/COACH denial, Access Code operations, and audit
   actors in the deployed environment.

Back Office deployment does not authorize enabling `enforced` mode and does
not include analytics telemetry or Stripe.

## 20. Definition of Done

This phase is complete when:

- `/admin` exists as the Jetta Back Office shell;
- unauthorized users receive no administrative data;
- ADMIN can generate/manage Access Codes from Back Office;
- Access Code administration is no longer mixed into Player Account;
- Player Account clearly presents code redemption only;
- ADMIN can search a user and inspect current entitlement;
- ADMIN can deterministically understand why new play is allowed or denied;
- ADMIN can inspect Coach subscription/sponsorship state;
- ADMIN can review relevant audit events;
- existing licensing behavior and security remain intact;
- Coach workflows remain intact;
- no unsupported analytics claims have been introduced.

---

# Codex Instruction

**Proceed with the implementation-planning step for Back Office Licensing Operations using the decisions above.**

Do not implement the larger analytics project.

First return the exact file/route/service/test plan described in Section 19. After that plan is reviewed, implementation can proceed.
