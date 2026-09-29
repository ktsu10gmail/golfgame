# Jetta License Model Guide

This guide explains how Jetta access works, how to create and use Jetta Access
Codes, how Coach-sponsored access differs from Individual access, and how to
test and deploy license enforcement safely.

The detailed domain specification is available in
[`improvement/JETTA_LICENSE_MODEL_CODEX_SPEC.md`](../improvement/JETTA_LICENSE_MODEL_CODEX_SPEC.md).

## 1. What the license model controls

A Jetta account and a Jetta play entitlement are deliberately separate.

- **Account:** The permanent player identity, profile, rounds, GPS evidence,
  Replay data, reports, and learning history.
- **Authentication:** Proves which person is signed in.
- **Play entitlement:** Determines whether that player may start new play.
- **Coach relationship:** Determines who currently coaches the player.
- **Sponsored seat:** Determines whether a Coach subscription supplies the
  player's play entitlement.

A player without an active entitlement can still sign in and review permitted
history. Jetta does not delete an account or its history when access expires.

Entitlement is required to start:

- a regular simulated round;
- an On-Course GPS round;
- a Golf Academy lesson;
- a 3-hole match; or
- an 18-hole match.

An activity that was authorized and started while access was valid can be
finished even if the entitlement changes later.

## 2. Access types

Jetta currently recognizes these entitlement grants:

| Grant | Supplied by | New play | Historical access |
|---|---|---:|---:|
| `PROMOTIONAL` | Individual Jetta Access Code | Yes, until expiration | Yes |
| `COACH_SELF` | Coach subscription | Yes | Yes |
| `COACH_SPONSORED` | Active sponsored Coach seat | Yes | Yes |
| `SELF_PAID` | Future paid Individual subscription | Yes | Yes |
| No valid grant | Nobody | No | Yes |

The current pilot uses Access Codes. Stripe checkout is not required and does
not yet collect payment. Future Stripe billing will update the same internal
subscriptions and entitlement grants rather than replacing this model.

## 3. Jetta Access Code format

All generated codes use the visible format:

```text
JETTA-<secure random characters>
```

For example:

```text
JETTA-AbCdEf123456...
```

`INDIVIDUAL` and `COACH` are server-side plan types. They are not different
code prefixes.

- An **INDIVIDUAL** code creates temporary `PROMOTIONAL` access for the player
  who redeems it.
- A **COACH** code activates Jetta Coach, supplies the Coach's own play access,
  and enables up to 10 active sponsored student seats.

Players should copy and enter the complete code beginning with `JETTA-`. Code
entry is case-insensitive and separators are normalized by the server, but the
complete displayed format should be used when sharing a code.

The plan, duration, redemption deadline, and redemption limit are stored on the
server. Editing the visible text cannot turn an Individual code into a Coach
code.

For security:

- generated codes are cryptographically random;
- only a secure hash is stored in the database;
- the plaintext code is displayed only when it is generated;
- redemption is atomic;
- failed attempts are rate-limited;
- a code can be revoked; and
- creation, redemption, and revocation are audited.

## 4. Administrator workflow

An administrator creates controlled pilot access.

1. Sign in with an account listed in `GOLFGAME_DEVELOPER_EMAILS` or, for local
   testing, `GOLFGAME_DEVELOPER_NAMES`.
2. Open **Account**.
3. Select **Access-code administration**.
4. Choose `Individual` or `Coach`.
5. Set the access duration and maximum number of redemptions.
6. Select **Generate code**.
7. Copy the displayed code immediately and deliver it securely to the intended
   player or Coach.

The administration screen later shows only the final characters of the code,
its status, duration, and redemption count. It cannot recover the original
plaintext code.

The default pilot recommendation is:

```text
Duration: 90 days
Maximum redemptions: 1
```

Use a redemption limit greater than one only when the same controlled code is
intentionally being issued to several people.

Revoking an unredeemed code prevents future redemption. It does not silently
convert or charge an account through Stripe.

### Two different expiration dates

Do not confuse these dates:

- **Redemption deadline:** Last date on which the code may be activated.
- **Access expiration:** Last date on which the subscription created by that
  redemption supplies play access.

A code can stop accepting new redemptions while access already activated from
that code remains valid until its recorded access expiration.

## 5. Player workflow

1. Create or sign in to the permanent Jetta account.
2. Open **Account**.
3. Find **Jetta Access Code**.
4. Enter the complete `JETTA-...` code.
5. Select **Activate**.

For an Individual code, the account should show:

```text
Active — Promotional Access
Available through <date>
```

The player can then start new rounds, GPS recordings, Academy lessons, and
matches until access expires.

Without an active entitlement, the account shows **Historical Access**. The
player can still review previous records but cannot start new entitled play
when enforcement is enabled.

## 6. Coach workflow

After redeeming a Coach code, the account receives both `PLAYER` and `COACH`
roles. The Coach does not need a separate Individual entitlement for their own
play.

The **Coach Dashboard** shows:

- active coaching relationships;
- sponsored students out of the 10-seat allowance;
- available sponsored seats;
- pending invitations; and
- student rounds available for review.

### Invite and sponsor a student

1. Open **Coach Dashboard**.
2. Enter the student's Jetta account email.
3. Choose **Send invitation**.
4. Jetta emails the student a secure link and keeps the invitation pending in
   the Coach Dashboard.
5. The student opens the link and signs in with the invited email address. A
   new student can create their Jetta player account from the same login screen.
6. Player Account opens with the invitation ready to accept or decline.

The Coach can resend a pending invitation from the dashboard. Resending keeps
the same logical invitation, rotates its secure link, and does not create a
second coaching relationship. A one-minute cooldown and daily resend limit
reduce accidental and abusive sends. Cancelling makes the link unusable.

An email-only invitation does not pre-create a player account or coaching
relationship. Jetta binds it to the authenticated player only after the player
opens the secure link with the matching account email. The invitation token is
stored only as a hash and is not returned to the Coach's browser.

When capacity is available, acceptance creates:

- an active coaching relationship;
- an active sponsored seat; and
- a `COACH_SPONSORED` entitlement.

The Coach subscription can sponsor up to 10 active students. The Coach may
maintain more than 10 coaching relationships when additional students use
their own Individual or Promotional access.

### Release Student Seat

**Release seat** removes Coach-sponsored play access and returns the seat to
the Coach's available capacity. It does not end the coaching relationship or
delete the student's history.

If the student has another valid grant, play continues through that grant. If
not, the student changes to Historical Access.

### End Coaching Relationship

**End coaching** is a separate action. It ends Coach visibility associated
with the active relationship and also releases an active sponsored seat.

### Round privacy

By default, a Coach can review only rounds completed after the active coaching
relationship began. A new Coach cannot automatically see the player's earlier
rounds.

## 7. Coach billing grace period

If a Coach subscription is cancelled, expires, or has a billing failure, it
enters `PAST_DUE` with a configurable 30-day grace period.

During grace:

- the Coach and sponsored students retain full play access;
- existing activities continue normally;
- the Coach cannot create new sponsorship invitations or assign new seats; and
- the dashboard shows the grace deadline.

After grace expires:

- Coach-supplied play grants end;
- sponsored seats are released;
- active coaching relationships remain intact;
- players with another entitlement continue playing; and
- players without another entitlement receive Historical Access.

Restoring a Coach subscription does not silently rewrite sponsorship history.
Seats must be restored or reassigned through explicit, auditable actions.

## 8. Enforcement modes

The server setting `GOLFGAME_LICENSE_ENFORCEMENT` supports three modes:

| Mode | Behavior |
|---|---|
| `off` | Entitlement records exist, but play is not blocked. |
| `shadow` | Decisions are recorded, but unlicensed play remains allowed. |
| `enforced` | A valid entitlement is required to start new play. |

The default is `shadow`.

Recommended configuration:

```bash
GOLFGAME_LICENSE_ENFORCEMENT=shadow
GOLFGAME_COACH_SEAT_CAPACITY=10
GOLFGAME_COACH_GRACE_DAYS=30
```

Do not change a production server to `enforced` until every existing player
who should continue playing has been given an approved entitlement and the
shadow-mode audit results have been reviewed.

## 9. Safe local test procedure

Use an isolated database so testing cannot alter real accounts or history.

```bash
cd /home/ksu/golfgame
git switch feature/license-model-v1
git pull --ff-only origin feature/license-model-v1

export JETTA_LICENSE_TEST_DB="$(mktemp /tmp/jetta-license-test-XXXXXX.sqlite3)"

SUPABASE_URL= \
SUPABASE_ANON_KEY= \
GOLFGAME_PLAYER_DB="$JETTA_LICENSE_TEST_DB" \
GOLFGAME_LICENSE_ENFORCEMENT=enforced \
GOLFGAME_DEVELOPER_NAMES="License Admin" \
.venv/bin/python scripts/serve.py --port 8092
```

Open `http://localhost:8092`.

### Test denial and activation

1. Create the local account `License Admin`.
2. Generate an Individual code from **Access-code administration**.
3. Sign out and create a different test player.
4. Confirm the player initially has Historical Access.
5. Attempt to start Academy, a match, GPS recording, or the first shot of a new
   round. Enforced mode should deny the start.
6. Redeem the generated code.
7. Confirm the account changes to Active — Promotional Access.
8. Start new play again. It should now succeed.
9. Attempt to redeem the same single-use code again. It should be rejected.

### Test Coach access

1. Generate a Coach code as the administrator.
2. Redeem it with a separate Coach test account.
3. Confirm the Coach can play without an Individual code.
4. Confirm Coach Dashboard shows `0 / 10` sponsored students.

Email invitations should be tested with Supabase test accounts because local
name/PIN accounts do not contain email addresses.

### Inspect audit events

```bash
sqlite3 "$JETTA_LICENSE_TEST_DB" \
  "SELECT event_type, detail_json, created_at FROM license_audit_events ORDER BY created_at DESC LIMIT 20;"
```

## 10. Automated verification

Run the focused licensing tests:

```bash
.venv/bin/python -m pytest tests/test_licensing.py -q
```

Run the complete Python and browser test suites:

```bash
.venv/bin/python -m pytest -q
node --test tests/*.test.mjs
```

The focused tests cover access-code hashing and revocation, rate limiting,
concurrent redemption, concurrent Coach seat acceptance, seat capacity,
relationship preservation, Coach ownership boundaries, round privacy, grace
periods, and the rule that an authorized activity remains playable.

## 11. Production rollout checklist

1. Back up the real player database.
2. Deploy the code with enforcement set to `shadow`.
3. Identify every existing player who should retain new-play access.
4. Issue the appropriate Individual or Coach access records.
5. Exercise all five start paths: regular round, GPS, Academy, 3-hole match,
   and 18-hole match.
6. Inspect denied and shadow-allowed audit events.
7. Resolve unexpected entitlement results.
8. Change enforcement to `enforced` only after the audit is clean.
9. Verify that unlicensed users retain sign-in and historical access.
10. Monitor access-code redemption failures, Coach capacity, and support
    feedback after enforcement begins.

## 12. Current limitations

- Stripe checkout, billing portal, and signed webhook processing are future
  work.
- Access Codes do not collect payment and never automatically become paid
  subscriptions.
- Local name/PIN accounts cannot receive email-based Coach invitations unless
  an email is added through an appropriate test setup; use Supabase test users
  for the complete invitation experience.
- License enforcement is intentionally left in `shadow` mode by default.

## 13. Coach invitation email configuration

Coach invitation delivery uses SMTP2GO through a golf-game application mailer,
not through WordPress. Keep the public website and product application as
separate security boundaries. The SMTP2GO credentials already used by
`www.jetta.com` must not be copied from the WordPress server. Create a separate
API key for `golfgame.jetta.com`, even if both keys belong to the same SMTP2GO
account.

Add the following only to the golf-game server's `.env` file:

```text
SMTP2GO_API_KEY=<separate golfgame application key>
SMTP2GO_SENDER=Jetta Golf <verified-sender@jetta.com>
GOLFGAME_PUBLIC_URL=https://golfgame.jetta.com
GOLFGAME_EMAIL_DELIVERY=enabled
```

`SMTP2GO_SENDER` must be authorized in SMTP2GO. `SMTP2GO_REPLY_TO` is optional.
Restart `golfgame.service` after changing configuration. When configuration is
absent or delivery fails, Jetta preserves the pending invitation and reports
the actual delivery state; it does not claim that an email was sent.

These limitations do not change player identity or historical ownership. The
same provider-neutral subscription and entitlement resolver will remain in use
when Stripe is added.
