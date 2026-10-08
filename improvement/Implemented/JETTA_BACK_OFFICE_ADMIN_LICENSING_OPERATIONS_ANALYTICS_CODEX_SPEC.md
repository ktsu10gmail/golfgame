# Jetta Back Office Admin Portal — Licensing, Operations, and Analytics

**Status:** Product / architecture specification  
**Purpose:** Consolidate Jetta administrative functions into one protected Back Office instead of placing administrative controls inside normal Player or Coach account experiences.

## 1. Product Principle

Jetta should have a dedicated **Back Office** for Jetta operators. It is separate from the Player experience, Coach Dashboard, public marketing site, and ordinary account/profile settings.

The Back Office should become the operational home for:

- Users
- Licensing and Access Codes
- Subscriptions and entitlements
- Coaches
- Usage analytics
- Traffic and engagement
- Support investigation
- Audit and operations

Extend the existing licensing and Back Office systems. Do not create parallel identity, entitlement, licensing, or analytics systems.

## 2. Why This Change Is Needed

The current implementation correctly separates permanent accounts from play entitlement, but code redemption and code administration are different jobs.

```text
PLAYER
Receive JETTA-... code
→ Enter code
→ Activate access

JETTA ADMIN
Choose Individual or Coach
→ Choose duration/redemption limit
→ Generate secure JETTA-... code
→ Give code to intended user
```

A normal user should never wonder how many characters they are supposed to invent.

## 3. ADMIN Is a Role, Not a "License Admin" Account Type

`License Admin` may be a useful local test username, but it should not become a permanent account type.

```text
Jetta Identity
├── PLAYER
├── COACH
└── ADMIN
```

One authenticated identity may hold multiple roles. An authorized ADMIN may access the Back Office.

Do not create `account_type = LICENSE_ADMIN`. Do not create a second authentication system. Continue using existing Jetta/Supabase identity and server-side authorization.

## 4. Back Office Route and Security

Preferred administrative surface:

```text
/admin
```

Protect it server-side. Hiding navigation is not authorization.

A user must not gain administrative access by manually entering `/admin`, changing browser state, modifying JavaScript roles, spoofing IDs, or directly calling admin APIs.

Reuse the repository's existing developer/admin authorization where appropriate. Long term, ADMIN should be a proper server-authorized role/capability.

## 5. Information Architecture

Recommended V1:

```text
Jetta Back Office
├── Dashboard
├── Users
├── Access & Licensing
├── Coaches
├── Subscriptions
├── Analytics
└── Audit / Operations
```

Do not build every possible administrative feature immediately.

## 6. Dashboard

The landing page should answer: **What is happening in Jetta?**

Candidate summaries:

```text
Total Users
Active Users
New Users
Active Entitlements

Rounds
GPS Rounds
Academy Sessions
Matches

Active Coaches
Sponsored Students
Coach Seats Used

Promotional Access
Individual Access
Coach Access
Historical-Only Users
```

Where telemetry is incomplete, say so honestly: `Not recorded before <date>`, `Building evidence`, or equivalent. Never fabricate historical analytics.

Reuse the existing Jetta analytics/telemetry architecture.

## 7. Users

Provide administrative user lookup. Useful fields:

```text
Jetta Player ID
Display Name
Email (admin-only)
Supabase User ID
Roles
Account Created
Last Active
Current Entitlement
Current Coach
Play Access
```

Useful read-oriented actions include account details, entitlement history, Coach relationship, license events, recent activity, and access troubleshooting.

Do not add destructive account operations unless covered by a separate policy. Inspection must never silently modify player history.

## 8. Access & Licensing

Administrative Access Code creation belongs at:

```text
/admin → Access & Licensing
```

### Generate Jetta Access Code

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

Jetta generates the code. The administrator does not invent characters after `JETTA-`.

After generation:

```text
Individual Access Code Created

JETTA-AbCdEf123456...

Access Duration: 90 days
Maximum Redemptions: 1

Copy this code now.
The complete plaintext code will not be shown again.
```

Preserve the implemented security design: cryptographically random codes, server-side plan metadata, secure hash storage, plaintext shown only at generation, atomic redemption, rate limiting, revocation, and audit logging.

## 9. Access Code Administration

Allow ADMIN to inspect:

```text
Status
Plan Type
Created At
Created By
Access Duration
Redemption Deadline
Maximum Redemptions
Redemptions Used
Last Characters
Revoked / Active
```

Useful filters: All, Individual, Coach, Unused, Redeemed, Expired, Revoked.

V1 actions:

```text
Generate
View metadata
Revoke unused code
Inspect redemption history
```

Never recover the original plaintext code from storage. Administrative access changes must be explicit and auditable.

## 10. Player Account Experience

The ordinary Account page contains redemption, not administrative generation.

Recommended:

```text
Jetta Access

Current Access
Historical Access

Have a Jetta Access Code?

Enter the code provided by Jetta:
[ JETTA-________________ ]

[ Activate ]
```

When active:

```text
Active — Promotional Access
Available through <date>
```

Avoid wording such as `Create JETTA activation code`, `Choose your activation code`, or `Enter or create code`.

Prefer:

> **Have a Jetta Access Code? Enter the code you received.**

## 11. Coach Dashboard Is Not Back Office

Keep Coach Dashboard focused on coaching:

```text
Students
Sponsored Students
Seats Available
Invitations
Rounds to Review
Learning Focus
Round Review
Replay
```

A Coach does not automatically gain Jetta administrative privileges. Jetta-wide license generation, global user lookup, analytics, and audit belong in `/admin`.

## 12. Coaches Administration

Back Office may show:

```text
Coach
Subscription Status
Grace Status
Sponsored Students / 10
Total Coaching Relationships
Pending Invitations
Last Active
Rounds Reviewed
Learning Focus Activity
```

A Coach detail view may include subscription/promotional status, seat usage, relationships, invitation history, grace deadline, recent activity, and entitlement events.

This is ADMIN functionality; never expose one Coach's administrative information to another Coach.

## 13. Subscriptions and Entitlements

Provide an operational view over the authoritative domain model:

```text
PROMOTIONAL
SELF_PAID
COACH_SELF
COACH_SPONSORED
No valid grant / Historical Access
```

Display implemented subscription states such as ACTIVE, PAST_DUE, EXPIRED, or CANCELLED only where they actually exist in the domain model.

The Back Office must not introduce a second entitlement engine.

## 14. License Support Investigation

A key use case is answering: **Why can't this player start a round?**

Example:

```text
Player: David Chen
Authentication: Valid
Play Access: DENIED

Valid entitlement grants:
None

Coach Relationship:
Susan Smith — ACTIVE

Sponsored Seat:
Released Sep 28

Individual Subscription:
None

Result:
Historical Access
```

Or:

```text
Player: Jennifer Lee
Play Access: ALLOWED

Valid grants:
SELF_PAID
COACH_SPONSORED

Authorization reason:
At least one valid grant permits new play.
```

Use deterministic server evidence. Never ask an LLM to determine authorization.

## 15. Analytics

Build on Jetta's existing analytics work.

Useful categories:

**User growth:** total accounts, new accounts, activated users, active users, returning users.

**Play:** rounds started/completed, GPS rounds, simulated rounds, 3-hole matches, 18-hole matches, Academy sessions.

**Learning:** Replay usage, Round Reviews, Learning Reports, Learning Focus assignments, Academy usage, repeat rounds.

**Coach:** active Coaches, Coaches with students, sponsored students, average sponsored students, seat utilization, invitations/acceptance, rounds reviewed, Learning Focus activity, retention.

**Entitlement:** PROMOTIONAL, SELF_PAID, COACH_SPONSORED, COACH_SELF, historical-only, expiring access, PAST_DUE Coaches.

**Conversion:** Promotional→Individual, Promotional→Coach, Sponsored→Self-Paid, Self-Paid→Coach relationship, Coach invitation→activation.

Only report conversions supported by recorded events.

## 16. Traffic and Engagement

Where reliable telemetry exists, consider:

```text
Sessions
Daily / Weekly / Monthly Active Users
Feature usage
Rounds per active player
Replay adoption
Academy adoption
Coach Dashboard usage
```

Do not equate page views with meaningful engagement. Prefer authenticated product events. Define metric denominators and time windows.

## 17. Audit / Operations

Surface existing licensing audit events in Back Office.

Potential categories include Access Code creation/redemption/revocation, entitlement changes/denials, Coach invitations, seat assignment/release, and ADMIN actions.

Use actual implemented event names after repository inspection; do not create duplicates.

Useful filters:

```text
Date range
Player
Coach
Administrator
Event type
Access code
Entitlement type
```

Audit history should be append-oriented and resistant to accidental modification.

## 18. Enforcement Monitoring

The license system currently supports:

```text
off
shadow
enforced
```

Eventually surface health information such as:

```text
License Enforcement
SHADOW

Last 24 Hours
Entitlement checks: 184
Would allow: 171
Would deny: 13
Unexpected denials: Review
```

Do not make production enforcement a casual dashboard toggle in V1. Keep it an explicit operational configuration until a safe administrative workflow is designed.

## 19. Security Requirements

1. Protect `/admin` server-side.
2. Never trust a browser-provided ADMIN role.
3. Resolve authenticated Supabase identity server-side.
4. Reuse authoritative Jetta user/player mapping.
5. Never expose Supabase service-role credentials to browser JavaScript.
6. Never expose password/PIN secrets.
7. Keep email and Supabase UUID admin-only where displayed.
8. Audit ADMIN actions that change licensing/access.
9. Authorize each admin API server-side.
10. Preserve Access Code hashing and rate limiting.
11. Use protections appropriate to the existing authentication architecture.
12. Never expose raw production database access through Back Office.

## 20. Initial Admin Authorization

For V1, reuse existing developer/admin authorization where safe.

Codex must inspect:

```text
GOLFGAME_DEVELOPER_EMAILS
GOLFGAME_DEVELOPER_NAMES
_require_developer()
existing ADMIN role support
existing /admin routes
existing Back Office analytics
```

Do not blindly create a parallel `_require_license_admin()` system if the existing admin architecture can be extended.

Future granular capabilities might include:

```text
analytics:view
users:view
licensing:view
licensing:manage
audit:view
```

They are not required for V1 unless already naturally supported.

## 21. Reuse Existing Back Office Analytics

Integrate licensing into the same Jetta Back Office. Avoid unrelated products/routes such as `/admin-analytics`, `/license-admin`, and `/operations-admin` unless repository constraints require them.

Preferred conceptual routes:

```text
/admin
/admin/dashboard
/admin/users
/admin/licensing
/admin/coaches
/admin/subscriptions
/admin/analytics
/admin/audit
```

Exact routing should follow existing repository patterns.

## 22. Implementation Strategy

### Phase 0 — Repository Audit

Before changing code, Codex reports:

1. Current `/admin` / Back Office implementation.
2. Existing analytics dashboard routes and authorization.
3. Existing developer/admin authorization.
4. Current Access Code administration UI.
5. Current Access Code APIs/services.
6. Current Player Account redemption UI.
7. Current licensing audit-event storage.
8. Current analytics/telemetry.
9. Current Coach Dashboard.
10. Reusable UI/layout/navigation components.
11. Conflicts between this specification and implemented license behavior.

**Do not begin by rewriting the license model.**

### Phase 1 — Admin Shell Integration

Extend existing Back Office shell/navigation and add **Access & Licensing**. Do not duplicate authentication or authorization.

### Phase 2 — Move Administrative License UI

Move/expose existing Access Code generation and management through Back Office while preserving existing APIs, hashing, atomic redemption, revocation, and auditing.

Remove administrative generation controls from ordinary Player Account surfaces if present.

### Phase 3 — Player Redemption UX

Make Account clearly say:

```text
Have a Jetta Access Code?
Enter the code you received.
```

### Phase 4 — License Operations

Add code metadata, redemption status, revocation, audit lookup, and player entitlement investigation. Prefer read-only diagnostics before mutation tools.

### Phase 5 — Coach / Subscription Operations

Integrate Coach seat/subscription visibility using the authoritative model.

### Phase 6 — Analytics Integration

Add licensing and Coach metrics to existing Back Office analytics. Only expose metrics supported by reliable telemetry.

### Phase 7 — Operational Polish

Add filters, search, pagination, audit drill-down, and support views after core workflows are proven.

## 23. Required Tests

### Authorization

- ordinary Player cannot access Back Office;
- Coach without ADMIN cannot access Back Office;
- manual `/admin` navigation cannot bypass authorization;
- browser role manipulation cannot grant ADMIN;
- admin APIs independently enforce authorization.

### Access Codes

- ADMIN can generate Individual and Coach codes;
- non-ADMIN cannot generate codes;
- plaintext shown only at creation;
- stored code remains hashed;
- redemption remains atomic;
- revocation and rate limiting remain intact;
- administrative changes are audited.

### Player UX

- Player sees redemption UI;
- Player does not see generation controls;
- field clearly says to enter an existing code;
- successful activation updates displayed access state.

### Coach

- Coach Dashboard remains separate;
- Coach cannot use ADMIN APIs;
- sponsorship controls remain scoped to the Coach's own students.

### Analytics

- no fabricated historical values;
- unavailable metrics show honest states;
- date boundaries and denominators are defined.

### Regression

Run existing licensing tests unchanged where possible.

Verify centralized entitlement still governs:

```text
regular round
On-Course GPS
Academy
3-hole match
18-hole match
```

## 24. V1 Non-Goals

Do not expand into:

- second authentication system;
- second entitlement engine;
- second analytics platform;
- full customer-support CRM;
- arbitrary database editing;
- impersonation;
- account deletion;
- payment-provider implementation;
- Coach/student payment processing;
- automated fraud detection;
- complex ADMIN permissions unless already supported;
- casual production enforcement toggles.

## 25. Success Criteria

**Player:** sees `Have a Jetta Access Code? Enter the code you received.` and never wonders how to invent a code.

**Coach:** sees coaching, sponsorship, Replay, and learning workflows—not Jetta-wide administration.

**Jetta Administrator:** opens `/admin` and can understand product activity, find users, investigate access, generate Access Codes, review redemption status, inspect Coach sponsorship, review audit events, and understand usage/traffic.

**Architecture:** reuses Supabase Auth, permanent Jetta player identity, entitlement resolver, Coach relationship model, Access Code service, license audit events, and analytics/telemetry. No parallel system is introduced.

# Instructions to Codex

For the next pass, perform **Phase 0 — Repository Audit only**.

Do not rewrite the working license implementation.

Report:

1. existing Back Office/admin functionality;
2. where Access Code generation currently lives;
3. reusable APIs/services;
4. current admin authorization;
5. existing analytics dashboard structure;
6. UI that should move versus remain;
7. security/migration risks;
8. the smallest compatible implementation plan.

Wait for review before broad implementation.
