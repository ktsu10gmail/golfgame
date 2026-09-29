# Jetta Back Office Operations Guide

## Site boundaries

Jetta uses three distinct web surfaces:

```text
www.jetta.com
→ Public marketing website

golfgame.jetta.com
→ Jetta product application

golfgame.jetta.com/admin/
→ Restricted Jetta Back Office
```

The marketing site introduces Jetta. The product application owns player
identity, gameplay, GPS evidence, Replay, reports, and learning history. The
Back Office is for authorized Jetta operators investigating accounts and
managing controlled access.

The Back Office is not part of the WordPress marketing site and does not expose
the player database to WordPress.

## Accessing the Back Office

Open:

```text
https://golfgame.jetta.com/admin/
```

The HTML shell contains no administrative records. It loads operational data
only after `/api/admin/session` verifies the signed-in identity has the
persisted `ADMIN` role. Each `/api/admin/*` endpoint independently passes
through the same centralized server authorization gate.

Production ADMIN bootstrap uses verified emails in:

```bash
GOLFGAME_DEVELOPER_EMAILS=admin@jetta.com
```

`GOLFGAME_DEVELOPER_NAMES` is for local name/PIN testing only. It must not be
used as production authorization. Removing an email from the environment does
not revoke an ADMIN role already persisted in Jetta; explicit role revocation
is a separate future operation.

## Access & Licensing

An ADMIN can generate Individual or Coach Jetta Access Codes. Jetta generates
the complete `JETTA-...` value. The administrator never invents the characters.

The complete plaintext code appears once after generation. Copy it immediately.
Later views contain only safe metadata and the final code characters because
the database stores a secure hash rather than recoverable plaintext.

Revoking a code prevents future redemption. It does not remove access already
activated through an earlier redemption.

## User investigation

Search by Jetta player ID, display name, email, or Supabase identity. The detail
view uses these terms:

```text
Account: Exists
Identity: Supabase linked
```

or:

```text
Account: Exists
Identity: Local development account
```

Account existence does not prove that the player currently has an authenticated
session.

Every entitlement diagnostic separates:

```text
Entitlement Decision
Enforcement Mode
Current Runtime Result
```

For example, an unlicensed player in shadow mode is shown as:

```text
Entitlement Decision: DENIED
Enforcement Mode: SHADOW
Current Runtime Result: ALLOWED — shadow-mode policy
```

This is not a contradiction. Shadow mode records what enforced licensing would
do while continuing to permit existing product use.

## Coach inspection

Coach operations are read-only in Back Office. ADMIN can inspect subscription
status, grace deadline, sponsored seats, active coaching relationships, and
pending invitations.

A coaching relationship and sponsored access are different. A student may
remain actively coached after their sponsored seat is released.

Normal Coach actions—inviting students, assigning or releasing seats, ending a
relationship, and reviewing rounds—remain in Coach Dashboard.

## Audit

The Audit view presents append-oriented licensing evidence newest first. It can
be filtered by event, actor, subject, or entity through bounded server queries.
Back Office does not provide edit or delete operations for audit history.

## What Back Office does not do

This phase does not add:

- analytics telemetry or historical metric reconstruction;
- Stripe or payment processing;
- account impersonation;
- arbitrary database editing;
- player deletion;
- ADMIN-role management UI; or
- a production license-enforcement toggle.

Deploying Back Office does not change `GOLFGAME_LICENSE_ENFORCEMENT`. Keep the
existing mode, normally `shadow`, until entitlement provisioning and the
separate enforcement rollout are approved.
