# Jetta Coach Grace and Student Continuation — Phase A Implementation Plan

**Status:** Phase A implemented and deployed on September 30, 2026
**Source specification:** `JETTA_COACH_SUBSCRIPTION_GRACE_STUDENT_CONTINUATION_LOYALTY_CODEX_SPEC_REVISED.md`
**Payment scope:** None. Do not add Stripe packages, routes, secrets, checkout, portal, webhooks, or payment activation.
**Canonical application:** `https://golfgame.jetta.com`
**Back Office:** `https://golfgame.jetta.com/admin/`

## 1. Repository Findings and Reuse Decisions

Phase A will extend, not replace, these authoritative components:

- `packages/accounts/licensing.py`: subscription state, grants, seats,
  relationships, entitlement resolution, access-code provisioning, audit, and
  activity authorization snapshots.
- `packages/accounts/smtp2go.py`: server-side SMTP2GO API transport. Generalize
  its transport while preserving the existing Coach-invitation API.
- `packages/accounts/admin_operations.py`: bounded Back Office reads.
- `scripts/serve.py`: authenticated Player/Coach routes and centralized
  `/api/admin/*` dispatch through `_require_admin()`.
- `packages/accounts/browser_access_guidance.mjs`: pure Player Profile access
  presentation policy.
- `admin/`: data-free Back Office shell whose records load only after ADMIN
  authorization.
- Existing `golfgame.service`: application server. It remains unchanged as the
  web process; lifecycle work runs through a separate one-shot command and
  timer, not a second server.

Current request-driven reconciliation remains as a safety net, but the timer
becomes the operational mechanism for expiration and notification dispatch.

## 2. Exact Database Migration

Add licensing schema migration version `2` inside `LicenseService._initialize()`.
Run it transactionally and record version 2 in `license_schema_migrations` only
after all DDL and the eligibility backfill succeed.

Do not modify or delete existing subscription, relationship, seat, grant,
activity, billing-event, or audit rows.

### 2.1 `subscription_grace_cycles`

```sql
CREATE TABLE subscription_grace_cycles (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL
        REFERENCES subscriptions(id) ON DELETE RESTRICT,
    started_at TEXT NOT NULL,
    deadline_snapshot_at TEXT NOT NULL,
    status TEXT NOT NULL
        CHECK(status IN ('ACTIVE', 'RESTORED', 'EXPIRED')),
    closed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX one_active_grace_cycle_per_subscription
    ON subscription_grace_cycles(subscription_id)
    WHERE status = 'ACTIVE';

CREATE INDEX grace_cycles_subscription_history
    ON subscription_grace_cycles(subscription_id, started_at DESC);
```

`subscriptions.grace_ends_at` remains the single current expiration authority.
`deadline_snapshot_at` is immutable historical evidence for that cycle and is
not consulted to authorize play.

### 2.2 `license_notifications`

```sql
CREATE TABLE license_notifications (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL
        REFERENCES subscriptions(id) ON DELETE RESTRICT,
    grace_cycle_id TEXT NOT NULL
        REFERENCES subscription_grace_cycles(id) ON DELETE RESTRICT,
    recipient_player_id INTEGER NOT NULL
        REFERENCES players(id) ON DELETE RESTRICT,
    recipient_email TEXT,
    notification_type TEXT NOT NULL CHECK(notification_type IN (
        'COACH_GRACE_DAILY',
        'STUDENT_GRACE_STARTED',
        'COACH_GRACE_EXPIRED',
        'STUDENT_SPONSORSHIP_ENDED'
    )),
    window_key TEXT NOT NULL,
    window_number INTEGER,
    due_at TEXT NOT NULL,
    window_ends_at TEXT,
    status TEXT NOT NULL CHECK(status IN (
        'PENDING', 'CLAIMED', 'FAILED', 'SENT',
        'MISSED', 'CANCELLED', 'NO_ADDRESS'
    )),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
    next_attempt_at TEXT,
    claimed_at TEXT,
    claim_token TEXT,
    last_attempt_at TEXT,
    sent_at TEXT,
    provider TEXT,
    provider_message_id TEXT,
    provider_request_id TEXT,
    last_error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(grace_cycle_id, notification_type, recipient_player_id, window_key)
);

CREATE INDEX license_notifications_due
    ON license_notifications(status, due_at, next_attempt_at);

CREATE INDEX license_notifications_cycle
    ON license_notifications(grace_cycle_id, created_at);
```

Rules:

- Coach windows use `window_key = 'day-01'` through `'day-30'` and
  `window_number = 1..30`.
- Exactly 30 Coach windows are created for a 30-day grace cycle. `day-01` is
  due immediately at `grace_started_at`; it is not preceded by a separate
  unnumbered notification. `day-30` is the final Coach grace window.
- Event notices use `grace-start` or `grace-expired` and a null
  `window_number`.
- `recipient_email` is a delivery snapshot; it is not identity authority.
- Store only a bounded error code such as `TIMEOUT`, `PROVIDER_REJECTED`,
  `NOT_CONFIGURED`, or `NO_ADDRESS`; never store credentials, message bodies,
  tokens, or raw provider responses.

### 2.3 `continuation_eligibilities`

```sql
CREATE TABLE continuation_eligibilities (
    id TEXT PRIMARY KEY,
    player_id INTEGER NOT NULL
        REFERENCES players(id) ON DELETE RESTRICT,
    offer_code TEXT NOT NULL
        CHECK(offer_code = 'STUDENT_CONTINUATION'),
    offer_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('ELIGIBLE', 'REVOKED')),
    qualified_at TEXT NOT NULL,
    source_relationship_id TEXT
        REFERENCES coach_student_relationships(id) ON DELETE RESTRICT,
    source_seat_assignment_id TEXT
        REFERENCES coach_seat_assignments(id) ON DELETE RESTRICT,
    source_grant_id TEXT
        REFERENCES entitlement_grants(id) ON DELETE RESTRICT,
    source_coach_subscription_id TEXT
        REFERENCES subscriptions(id) ON DELETE RESTRICT,
    revoked_at TEXT,
    revoked_by_player_id INTEGER
        REFERENCES players(id) ON DELETE RESTRICT,
    correction_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(player_id, offer_code)
);

CREATE INDEX continuation_eligibility_status
    ON continuation_eligibilities(status, qualified_at);
```

Use offer version `STUDENT_CONTINUATION_USD_2026_01` for the Phase A display
record. The version identifies the offer presentation; it does not promise a
permanent price.

### 2.4 Migration reconstruction and backfill

Within migration version 2:

1. For each existing `PAST_DUE` Coach subscription with a non-null future
   `grace_ends_at`, insert one `ACTIVE` grace cycle. Derive `started_at` as
   `grace_ends_at - configured coach_grace_days`; preserve
   `deadline_snapshot_at = grace_ends_at`. Do not queue historical Coach daily
   windows before migration time.
2. Create only the current Coach daily window for a reconstructed active cycle;
   mark earlier elapsed windows `MISSED`, and create future windows `PENDING`.
3. Do not create `STUDENT_GRACE_STARTED` notifications for reconstructed grace
   cycles. Those students learn the current status and deadline from Player
   Profile. If the reconstructed cycle later expires, create the normal
   `STUDENT_SPONSORSHIP_ENDED` notifications at expiration.
4. Backfill one `ELIGIBLE` continuation row per player having any authoritative
   `entitlement_grants.grant_type = 'COACH_SPONSORED'` row, regardless of the
   grant's current `ACTIVE`/`ENDED` status. Select the earliest qualifying grant
   for provenance and `qualified_at = grant.starts_at`.
5. Insert `CONTINUATION_ELIGIBILITY_GRANTED` with detail
   `{source: 'SCHEMA_V2_BACKFILL', source_grant_id, offer_version}` for every
   newly backfilled eligibility.
6. Do not infer eligibility from invitations, relationships, roles, or seats
   without a `COACH_SPONSORED` grant.
7. Re-running initialization must be a no-op because migration version 2 and
   table uniqueness constraints are authoritative.

Before production migration, copy the SQLite database to a timestamped backup,
run `PRAGMA integrity_check`, record row counts for subscriptions, grants,
seats, relationships, and players, run the migration, then repeat the integrity
check and row counts. The migration must be tested against a copy before the
service restart.

## 3. Domain and Service Design

### 3.1 `LicenseService` responsibilities

Modify `packages/accounts/licensing.py` so that all lifecycle mutations remain
inside SQLite `BEGIN IMMEDIATE` transactions.

Add private helpers:

```text
_start_grace_cycle(database, subscription, started_at, grace_ends_at)
_close_grace_cycle(database, subscription_id, status, closed_at)
_queue_grace_notifications(database, subscription, cycle)
_grant_continuation_eligibility(database, player_id, grant, qualified_at)
_expire_coach_grace(database, subscription, cycle, now)
```

Add public read/worker methods:

```text
reconcile_subscription_lifecycle(at=None) -> LifecycleResult
claim_due_notifications(at=None, limit=50, worker_id=None) -> list[dict]
complete_notification(notification_id, claim_token, delivery, at=None) -> None
fail_notification(notification_id, claim_token, error_code, retry_at, at=None) -> None
continuation_eligibility(player_id) -> dict | None
correct_continuation_eligibility(admin_id, player_id, status, reason) -> dict
notification_history(subscription_id, limit=100) -> list[dict]
```

`LifecycleResult` must report counts/IDs for started, restored, expired, and
notification work; it must not expose secrets.

Change `_assign_seat()` to capture the inserted grant ID and establish
continuation eligibility in the same transaction. Existing eligibility is left
unchanged. This covers both invitation acceptance and explicit sponsorship
assignment.

Change transitions as follows:

- First `ACTIVE → PAST_DUE`: set `grace_ends_at`, create the grace cycle, create
  exactly 30 Coach windows for a 30-day cycle (`day-01` is the immediate
  notification) and student start notifications, then audit once.
- Repeated `PAST_DUE` input: preserve the existing cycle and deadline; never
  restart or extend grace accidentally.
- `PAST_DUE → ACTIVE`: close the cycle as `RESTORED`, cancel unsent cycle
  notifications, preserve seats/grants, and audit restoration.
- `PAST_DUE → EXPIRED`: re-read the same active cycle and subscription under
  `BEGIN IMMEDIATE`; require status `PAST_DUE` and
  `subscriptions.grace_ends_at <= now`; close the cycle, release active seats,
  end only grants supplied by this subscription, preserve relationships,
  create expiration notifications, and audit atomically.
- A later new Coach subscription does not reactivate old seat/grant rows.

Do not hold a SQLite transaction open while making an SMTP2GO network call.

### 3.2 Notification application service

Create `packages/accounts/license_notifications.py` containing
`LicenseNotificationService`. It receives `LicenseService`, `PlayerStore` only
if needed for safe identity reads, and a mailer abstraction.

One `run_once(at=None, batch_size=50, worker_id=None)` call:

1. invokes lifecycle reconciliation;
2. marks elapsed unsent Coach windows `MISSED`;
3. atomically claims due rows with a random claim token;
4. commits the claim;
5. renders and sends each message outside the database transaction;
6. records `SENT`, `FAILED`, `NO_ADDRESS`, or `CANCELLED` using the claim token;
7. returns bounded operational counts and exits nonzero only for worker-level
   failure, not for an individual email failure.

Claims older than 15 minutes are stale and may be reclaimed. Each notification
allows no more than three total provider attempts: attempt 1 at `due_at`,
attempt 2 no earlier than 15 minutes after the first failed/unconfirmed
attempt, and attempt 3 no earlier than 1 hour after the second
failed/unconfirmed attempt. There is no fourth attempt. All three must fit
inside the same valid delivery window. When the window ends, mark an unsent row
`MISSED` and do not send it later. Event notifications use a 24-hour delivery
window after their `due_at`; after that they become `MISSED` rather than
creating a backlog.

### 3.3 Shared runtime construction

Create `packages/accounts/runtime.py` to centralize:

- `.env` loading without overwriting real environment variables;
- player database path;
- license enforcement, seat capacity, and grace-day configuration;
- SMTP2GO configuration and email-delivery switch;
- construction of `PlayerStore`, `LicenseService`, `AdminOperationsService`,
  and the notification service.

Modify `scripts/serve.py` to use this factory without changing route behavior.
The worker imports the same factory, preventing web/worker configuration drift.

## 4. Scheduler and Deployment

### 4.1 Worker entry point

Create `scripts/run_license_lifecycle.py`:

```text
load shared runtime
run LicenseNotificationService.run_once()
emit one structured, secret-free summary line
exit 0 when reconciliation completed, even if individual deliveries failed
exit nonzero for database/schema/configuration/worker failure
```

Support `--dry-run` only for reporting due counts; it must not claim, send,
transition, or write audit rows. Support `--at` only under an explicit
test/development guard; production runs always use server UTC time.

### 4.2 Repository deployment units

Create:

- `deploy/systemd/golfgame-license-lifecycle.service`
- `deploy/systemd/golfgame-license-lifecycle.timer`

Service definition:

```ini
[Unit]
Description=Jetta licensing lifecycle and notification worker
After=network-online.target golfgame.service

[Service]
Type=oneshot
WorkingDirectory=/home/ksu/golfgame
ExecStart=/usr/bin/python3 /home/ksu/golfgame/scripts/run_license_lifecycle.py
```

Timer definition:

```ini
[Unit]
Description=Run Jetta licensing lifecycle worker every 15 minutes

[Timer]
OnBootSec=2min
OnCalendar=*:0/15
Persistent=true
AccuracySec=1min
RandomizedDelaySec=30s
Unit=golfgame-license-lifecycle.service

[Install]
WantedBy=timers.target
```

The current Python processes already load `/home/ksu/golfgame/.env`; no secret
is embedded in either unit. Install the two files under
`~/.config/systemd/user/`, then run:

```text
systemctl --user daemon-reload
systemctl --user enable --now golfgame-license-lifecycle.timer
```

Production deployment must also ensure the user manager survives logout using
the server's established user-service policy, confirm NTP/time synchronization,
and verify the timer with `systemctl --user list-timers` and the worker journal.

Do not run the worker from both cron and systemd. SQLite and notification claims
make overlap safe, but the deployment must have one scheduler authority.

## 5. Email Design

### 5.1 Files and abstraction

Create `packages/accounts/email_templates.py` with pure renderers returning
`subject`, `text_body`, and `html_body` for:

- Coach grace daily;
- student grace started;
- Coach grace expired;
- student sponsorship ended.

Modify `packages/accounts/smtp2go.py`:

- add a generic `send_message(recipient, subject, text_body, html_body)`;
- retain `send_coach_invitation()` as a compatibility wrapper using the generic
  transport;
- return `provider`, `message_id`, and `request_id`;
- never return or log the API key or raw provider response.

### 5.2 Content rules

- Email displays the exact UTC deadline date/time and calculated days remaining
  from the authoritative `subscriptions.grace_ends_at`.
- `ACCESS_CODE` subscriptions receive “Enter a new eligible Jetta Access Code
  or contact Jetta support” rather than a Manage Subscription link.
- Phase A contains no payment or Stripe link.
- Student email is grant-aware: it describes the Coach-sponsored grant ending,
  not the entire account, and does not claim loss of play when another valid
  grant exists.
- If the student is continuation-eligible, the email may state that eligibility
  is saved, but must say online subscription activation is not yet available.
- HTML escapes all names and URLs; text and HTML convey the same facts.

The existing application-level SMTP2GO credentials remain separate from
WordPress and Supabase Auth SMTP credentials.

## 6. API Contract

No Stripe or payment API is added.

### 6.1 Existing Player endpoint — extended

`GET /api/player/access` remains authenticated by `_require_player()` and adds:

```json
{
  "access": {
    "play_access": "ACTIVE",
    "can_start_new_play": true,
    "enforcement": "shadow",
    "grants": [],
    "coach_sponsorship": {
      "status": "GRACE",
      "coach_name": "Coach Name",
      "grace_ends_at": "2026-10-29T15:00:00+00:00"
    },
    "continuation": {
      "eligible": true,
      "status": "ELIGIBLE",
      "offer_code": "STUDENT_CONTINUATION",
      "offer_version": "STUDENT_CONTINUATION_USD_2026_01",
      "display_monthly_usd": 9,
      "display_annual_usd": 49,
      "activation_available": false
    }
  }
}
```

Return only the Coach name, sponsorship status, and grace deadline needed by
the student. Do not return Coach provider IDs, notification history, or other
billing data. `can_start_new_play` continues to represent the runtime result;
`play_access` represents current entitlement.

### 6.2 Existing Coach endpoint — extended

`GET /api/coach/dashboard` remains authenticated by `_require_coach()` and adds:

```json
{
  "dashboard": {
    "grace": {
      "status": "ACTIVE",
      "cycle_id": "grace_...",
      "started_at": "...",
      "ends_at": "...",
      "days_remaining": 18
    },
    "restoration": {
      "kind": "ACCESS_CODE",
      "label": "Enter a new eligible Access Code or contact Jetta support",
      "url": null
    }
  }
}
```

The response continues to disable new invitation/seat actions unless the
subscription is `ACTIVE`.

### 6.3 Back Office reads

All routes remain behind the existing centralized `_require_admin()` dispatch:

- `GET /api/admin/coaches/{coach_id}`: extend with grace-cycle summary,
  at-risk students, and bounded latest notification rows.
- `GET /api/admin/users/{player_id}`: extend with continuation eligibility and
  provenance.
- `GET /api/admin/licensing/grace-summary`: return bounded aggregate counts for
  active grace cycles, at-risk sponsored students, due/failed/missed/no-address
  notifications, and eligible/revoked continuation records. It returns counts
  only, no account rows.
- `GET /api/admin/licensing/notifications?subscription_id=&status=&limit=`:
  bounded list, maximum 100; no body, credentials, tokens, or raw errors.
- `GET /api/admin/licensing/continuation-eligibilities?query=&status=&limit=`:
  bounded lookup by player name/email/ID and eligibility status.

### 6.4 Back Office correction mutation

Add:

```text
POST /api/admin/licensing/continuation-eligibilities/correct
```

Body:

```json
{
  "player_id": 123,
  "status": "ELIGIBLE | REVOKED",
  "reason": "Required human-readable reason, 10–500 characters"
}
```

The handler ignores any submitted actor ID and passes the administrator
identity returned by `_require_admin()` to
`correct_continuation_eligibility()`. It returns the safe eligibility record.
It cannot create grants, subscriptions, seats, relationships, or payment state.

Use existing JSON size limits and controlled `400`, `401`, `403`, `404`, and
`409` responses. No worker-control or “send email now” route is exposed.

## 7. Player Profile and Coach Dashboard UI

### 7.1 Files

Modify:

- `index.html`: add a hidden, semantic sponsorship/grace panel and continuation
  eligibility panel inside Jetta Access; add a Coach grace notice container.
- `packages/accounts/browser_access_guidance.mjs`: extend the pure presentation
  matrix for sponsored grace, ended sponsorship, other-valid-grant, eligibility,
  and enforcement/runtime distinctions.
- `app.js`: populate the new panels using text-safe rendering and the extended
  API payload; do not add checkout handlers.
- `styles.css`: responsive warning/information styles consistent with the
  existing account and Coach Dashboard cards.

### 7.2 Exact behavior

- Sponsored only + grace: show active access, exact local deadline with timezone,
  account/history preservation, and saved continuation eligibility.
- Sponsored + another valid grant: explain sponsorship risk without claiming
  overall access will end; no urgent purchase language.
- Sponsorship ended + no grant: show `Historical Access`, entitlement denied,
  and the enforcement-aware runtime explanation already used by Jetta.
- Sponsorship ended + another grant: lead with the valid grant and show Coach
  sponsorship as historical secondary context.
- Eligible in Phase A: show `$9/month or $49/year`, “activation not yet
  available,” and no enabled payment/management control.
- Not eligible: do not expose the offer.
- Coach grace: prominent deadline, existing students continue, new invitations
  and sponsorship assignment disabled, and provider-appropriate restoration
  wording.

All date formatting uses one shared browser helper. Exact time displays include
the browser timezone abbreviation; do not render date-only “through” wording.

## 8. Back Office UI

Modify `admin/index.html`, `admin/admin.js`, and `admin/admin.css` without adding
data to the static HTML shell.

Add a **Grace & Continuation** view under Access & Licensing containing:

- status totals loaded only after ADMIN verification;
- Coach lookup with subscription state, provider, current grace cycle, exact
  deadline, sponsored/at-risk counts, and restoration/expiration events;
- notification table with type, recipient identity/email, window, status,
  attempts, due/attempt/sent timestamps, bounded error code, and provider
  message ID;
- student continuation lookup with status, qualified date, offer version, and
  source relationship/seat/grant/subscription IDs;
- an eligibility correction form requiring explicit status and reason;
- links/filter actions into the existing audit view.

Never render raw email bodies, credentials, invitation tokens, Access Code
plaintext, SMTP2GO raw responses, or Stripe placeholders. Continue using DOM
node construction and `textContent`; do not introduce `innerHTML` into Back
Office rendering.

## 9. Audit Mapping

Use `actor_player_id = NULL` for scheduled/system transitions and the verified
ADMIN ID for corrections. Use the affected Coach/student as
`subject_player_id`.

| Event | Entity | Required bounded detail |
|---|---|---|
| `COACH_GRACE_STARTED` | grace cycle | subscription ID, start, deadline, provider |
| `COACH_GRACE_RESTORED` | grace cycle | subscription ID, restored timestamp |
| `COACH_GRACE_EXPIRED` | grace cycle | subscription ID, deadline, expired timestamp |
| `COACH_GRACE_NOTIFICATION_SENT` | notification | cycle ID, window, provider message ID |
| `COACH_GRACE_NOTIFICATION_FAILED` | notification | cycle ID, window, error code, attempt |
| `STUDENT_GRACE_NOTIFICATION_SENT` | notification | cycle ID, notification type |
| `STUDENT_SPONSORSHIP_ENDED_NOTIFICATION_SENT` | notification | cycle ID |
| `CONTINUATION_ELIGIBILITY_GRANTED` | continuation eligibility | offer/version, source IDs, source reason |
| `CONTINUATION_ELIGIBILITY_REVOKED` | continuation eligibility | reason |
| `CONTINUATION_ELIGIBILITY_RESTORED` | continuation eligibility | reason |

Existing seat-release audit events remain. Do not duplicate one event on every
worker pass; state change plus uniqueness is the audit boundary.

## 10. Exact File Plan

### Create

- `packages/accounts/runtime.py` — shared environment/configuration and service
  construction.
- `packages/accounts/license_notifications.py` — worker orchestration, claims,
  retry/window policy, and delivery status updates.
- `packages/accounts/email_templates.py` — pure text/HTML transactional email
  renderers.
- `scripts/run_license_lifecycle.py` — one-shot worker CLI.
- `deploy/systemd/golfgame-license-lifecycle.service` — worker unit.
- `deploy/systemd/golfgame-license-lifecycle.timer` — 15-minute persistent timer.
- `tests/test_license_notifications.py` — ledger/worker/retry/missed-window tests.
- `tests/test_license_lifecycle_worker.py` — CLI and dry-run tests.
- `tests/license_access_guidance.test.mjs` — expanded Player Profile state matrix
  tests.

### Modify

- `packages/accounts/licensing.py` — migration v2, grace cycles, eligibility,
  protected transitions, notification claims/completion, richer access and
  Coach dashboard payloads.
- `packages/accounts/smtp2go.py` — generic message transport with invitation
  compatibility.
- `packages/accounts/admin_operations.py` — bounded grace, notification, and
  eligibility diagnostics and audited correction call-through.
- `packages/accounts/__init__.py` — exports for new runtime/notification types.
- `scripts/serve.py` — shared runtime construction and exact new/extended API
  dispatch; no payment routes.
- `index.html`, `app.js`, `styles.css` — Player Profile and Coach Dashboard UI.
- `admin/index.html`, `admin/admin.js`, `admin/admin.css` — diagnostic and
  correction UI loaded after ADMIN authorization.
- `.env.example` — add `GOLFGAME_LICENSE_WORKER_BATCH_SIZE=50` and
  `GOLFGAME_LICENSE_NOTIFICATION_CLAIM_MINUTES=15`; no new payment secret.
- `README.md` — timer installation and health verification summary.
- `docs/JETTA_LICENSE_MODEL_GUIDE.md` — operational grace, notification,
  eligibility, and troubleshooting documentation.
- `tests/test_licensing.py` — lifecycle, eligibility, migration, race, and
  multiple-grant domain tests.
- `tests/test_smtp2go.py` — generic transport/template escaping/result tests.
- `tests/test_admin_operations.py` — bounded diagnostics and corrections.
- `tests/test_admin_http.py` — ADMIN authorization and mutation actor tests.
- `tests/test_coach_invitation_http.py` — regression coverage after runtime and
  mailer refactor.
- `tests/access_onboarding.test.mjs`, `tests/admin_back_office.test.mjs`, and
  `tests/coach_dashboard_layout.test.mjs` — UI state, safety, and responsive
  behavior.

No Stripe dependency, `packages/billing/`, payment route, webhook, checkout,
Customer Portal, price ID, or payment secret is created in Phase A.

## 11. Test Plan

### 11.1 Migration and schema

- Fresh database creates version 2 exactly once.
- Existing version-1 database migrates without changing existing row counts.
- Re-running initialization is idempotent.
- One active grace cycle per subscription is enforced.
- Notification logical uniqueness is enforced.
- One continuation record per player/offer is enforced.
- Foreign keys and `PRAGMA integrity_check` pass.
- Historical qualifying grants backfill; invitation-only and relationship-only
  records do not.

### 11.2 Grace lifecycle

- Coach expiration/payment-failure transition starts one cycle and preserves
  current access.
- Repeated `PAST_DUE` does not extend the deadline or duplicate a cycle.
- A 30-day cycle creates exactly 30 Coach windows: Day 1 is immediate, Day 2 is
  not due before 24 hours, Day 30 is final, and no Day 0/31 row exists.
- `PAST_DUE` blocks new invitations and seat assignments.
- Restoration before deadline closes cycle, cancels pending notices, and
  preserves seats/grants.
- At the deadline, protected recheck expires Coach, ends only supplied grants,
  releases seats, and preserves relationships/history.
- Concurrent restoration wins safely when committed before expiration recheck.
- Expiration wins safely when committed first; later restoration does not
  resurrect seats.
- Other valid grants continue to authorize the student.
- In-progress activity snapshots remain valid.

### 11.3 Eligibility

- First sponsored grant creates eligibility in the same transaction.
- Invitation or relationship without grant does not qualify.
- Releasing sponsorship does not remove eligibility.
- Re-sponsoring does not create a duplicate.
- Backfill selects the earliest authoritative grant.
- ADMIN revoke/restore requires reason and records verified actor.
- Non-ADMIN correction is rejected.

### 11.4 Worker and notifications

- Two concurrent worker invocations cannot claim the same live record.
- A confirmed `SENT` record is never intentionally resent.
- Provider IDs are stored; bodies/secrets/raw responses are not.
- Timeout becomes retryable `FAILED` with bounded error code.
- Maximum delivery attempts are three total, including the initial attempt:
  initial, retry after 15 minutes, and final retry after 1 hour, all inside the
  window. A fourth attempt is never made.
- Stale claims can be reclaimed after 15 minutes.
- Restoration between claim and send causes a final state check and cancellation.
- Worker downtime marks past windows `MISSED` and sends only the current window.
- Migrating a pre-existing `PAST_DUE` cycle creates no student grace-start
  notification, while later expiration still queues the sponsorship-ended
  notification.
- Missing email records `NO_ADDRESS` and does not block expiration.
- SMTP2GO disabled records a controlled failure/not-configured outcome without
  changing entitlement.
- An individual delivery failure does not make the one-shot worker fail.
- Database/configuration failure makes the command exit nonzero.
- Event emails expire after their 24-hour delivery window.

### 11.5 API and authorization

- Player endpoint exposes only that player's sponsorship/grace/eligibility.
- It does not expose Coach billing/provider or notification data.
- Coach endpoint exposes only the authenticated Coach's dashboard.
- All new `/api/admin/*` reads and writes pass through `_require_admin()`.
- Player/Coach/non-authenticated calls receive `403`/`401` as appropriate.
- Submitted actor IDs are ignored; authenticated ADMIN is audited.
- Query limits, filters, IDs, statuses, and correction reasons are validated.
- No Phase A payment endpoint exists.

### 11.6 UI

- Every Player Profile matrix row renders the correct primary access state.
- Shadow mode can show entitlement denied and runtime allowed without
  contradiction.
- Exact deadline includes timezone; no misleading date-only “through” wording.
- Eligible Phase A student sees saved eligibility and no clickable payment CTA.
- Student with another grant receives no false overall-loss warning.
- Coach in grace sees disabled invitation/assignment controls.
- Back Office static shell remains data-free.
- Back Office renderers continue to avoid raw HTML assignment.
- Coach Dashboard and admin tables remain usable on mobile widths.

### 11.7 Regression and verification commands

Run:

```text
python3 -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.mjs
python3 scripts/run_license_lifecycle.py --dry-run
```

Then test against a copied production database with email delivery disabled.
Use controlled test accounts and SMTP2GO delivery only after database and UI
tests pass.

## 12. Rollout and Operational Verification

1. Back up and dry-run migration against a production database copy.
2. Deploy code with `GOLFGAME_EMAIL_DELIVERY=disabled`.
3. Restart `golfgame.service`; verify migration version, integrity, existing
   login, invitations, access, Coach Dashboard, and Back Office.
4. Install/start the timer; run worker dry-run and then a no-email real
   reconciliation test.
5. Verify Back Office grace cycles, notification statuses, and eligibility
   backfill counts against direct bounded SQL totals.
6. Enable SMTP2GO delivery and use one controlled Coach/student grace cycle.
7. Confirm Day-1 Coach and student email content, provider IDs, audit events,
   UI deadline, and absence of duplicates.
8. Test restoration before deadline and confirm future notices cancel.
9. Test an accelerated expiration only in a non-production database.
10. Monitor the user-unit journal, `FAILED`/`NO_ADDRESS`/`MISSED` counts, SQLite
    lock errors, and email acceptance for at least one full notification window.

Rollback disables the timer first, disables email delivery, restores the prior
application version, and leaves additive Phase A tables intact. Do not roll back
by deleting tables or entitlement history. If the schema itself must be
reverted, restore the pre-migration database backup while the application and
worker are stopped.

## 13. Risks and Mitigations

- **SQLite writer contention:** short `BEGIN IMMEDIATE` transactions, bounded
  batches, no network calls while locked, and 15-minute timer cadence.
- **Email duplicates after ambiguous provider timeout:** logical uniqueness,
  provider IDs, no resend after confirmed `SENT`, bounded retries, and honest
  at-least-once limitations.
- **Backlog flood:** expire old windows as `MISSED`; never catch up daily email.
- **Restoration/expiration race:** same-cycle state recheck inside the mutation
  transaction.
- **False loss warning:** resolve every valid grant before composing UI/email.
- **Eligibility overreach:** qualify only from an authoritative sponsored grant;
  audit backfill and ADMIN corrections.
- **Worker not running:** persistent systemd timer, nonzero process failures,
  journal monitoring, and Back Office visibility of stale due notifications.
- **Timezone confusion:** UTC authority, explicit UTC in email, local timestamp
  plus timezone in browser UI.
- **Premature payment expectations:** no CTA, no payment API, explicit “online
  activation is not yet available.”
- **Future Stripe coupling:** keep continuation offer code/version and Jetta
  eligibility independent of provider objects; Phase B adds the billing adapter
  later without changing entitlement authority.

## 14. Phase Boundary

Phase A is complete only when grace transitions run without user traffic,
notifications and delivery failures are diagnosable, continuation eligibility
is durable, Player/Coach/Admin UI agrees with authoritative state, and the full
test suite passes.

Phase A does not collect money and cannot activate `SELF_PAID` through the
continuation offer. Stripe work begins only under the separately reviewed and
approved payment specification.
