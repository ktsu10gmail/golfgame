# Jetta Coach-to-Student Email Invitation & New-Account Onboarding --- Codex Specification

**Status:** Phase 0 repository audit required before coding\
**Product:** Jetta\
**Application:** `https://golfgame.jetta.com`

## 1. Problem

The current Coach Dashboard invitation workflow assumes the invited
student already has a Jetta player account. A message such as:

> Invitation created for david.su@jetta.com. It will appear in that
> player's Jetta account.

does not fit the expected coach-first acquisition workflow. In many
cases, the Coach will invite a student who has never used Jetta.

The desired flow is:

**Coach invites student → Jetta emails student → student visits Jetta →
creates/signs into account → accepts invitation → coaching relationship
and sponsored access are established.**

A Coach must not have to tell a prospective student to create a Jetta
account first and then return later to be invited.

## 2. Product Principle

A Coach invitation is both a coaching invitation and a Jetta onboarding
mechanism.

The invited email may belong to: - an existing Jetta player; or - a
prospective player who does not yet have a Jetta `players.id`.

The invitation architecture must support both.

## 3. No Separate Individual Access Code for Sponsored Students

A Coach-sponsored student should **not** need an Individual Access Code.

Coach activation:

``` text
Jetta Admin
→ Generate Coach Access Code
→ Coach receives code
→ Coach signs into own Jetta account
→ Coach redeems code
→ COACH role/access
→ Coach Dashboard
```

Student onboarding:

``` text
Coach Dashboard
→ Invite Student by email
→ Jetta sends invitation email
→ Student creates/signs into Jetta
→ Student accepts invitation
→ ACTIVE coaching relationship
→ Sponsored seat assigned if available
→ COACH_SPONSORED entitlement
```

Do not require:

``` text
Coach Invitation + Individual Access Code
```

Individual Access Codes remain a separate mechanism for Jetta-provided
Individual/promotional access.

## 4. Desired New-Student Flow

### Step 1 --- Coach submits invitation

``` text
Invite Student

Student Email
[david.su@jetta.com]

[ Send Invitation ]
```

Server authorization must confirm the authenticated user is allowed to
invite students.

### Step 2 --- Create pending invitation

The invitation must be able to exist before the invited person has a
Jetta player record.

Conceptually:

``` text
coach_invitation
- id
- coach_id
- invited_email
- player_id              nullable until matched/claimed if needed
- invitation_token_hash
- status
- created_at
- accepted_at
- cancelled_at
```

This is conceptual only. **Audit the existing schema first. Do not
assume a migration is required.**

### Step 3 --- Send invitation email

Jetta sends an email such as:

``` text
Michael has invited you to join Jetta.

Jetta helps you and your Coach review your golf,
learn from your rounds, and work on your game together.

[ Accept Invitation ]
```

The acceptance link returns to the Jetta application at
`golfgame.jetta.com`, not the public marketing site.

### Step 4 --- Sign in or create account

If unauthenticated:

``` text
Invitation Link
→ Jetta
→ Sign In / Create Account
```

A new student uses the normal Jetta/Supabase signup flow. An existing
student signs in normally.

### Step 5 --- Securely claim invitation

After authentication, Jetta securely associates the pending invitation
with the authenticated player.

Do not trust browser-provided player IDs, emails, Coach IDs, or role
claims. Where email matching is used, use the verified server-side
authenticated identity.

The invitation token alone must not impersonate a Jetta player.

### Step 6 --- Accept

``` text
Coach Invitation

Michael Smith has invited you to join
their Jetta coaching roster.

[ Accept Invitation ]
[ Decline ]
```

### Step 7 --- Relationship

Acceptance uses the existing authoritative relationship system:

``` text
INVITED → ACTIVE
```

Do not introduce `INACTIVE`.

### Step 8 --- Sponsorship

If sponsored-seat capacity exists at acceptance:

``` text
Sponsored Seat: ACTIVE
Entitlement: COACH_SPONSORED
```

No separate Access Code is required.

### Step 9 --- Capacity race

Existing rules remain authoritative: - pending invitations consume no
seat; - capacity is checked atomically at acceptance; - never create an
11th sponsored seat; - if capacity disappeared, relationship still
becomes ACTIVE; - no COACH_SPONSORED grant is created without
capacity; - another valid grant continues normally; - otherwise player
has historical-only access; - Coach may assign sponsorship later.

## 5. Existing Player Flow

Existing Jetta players should also receive email notification:

``` text
Coach invites existing player
→ Pending invitation
→ Invitation email
  +
  Invitation visible in Jetta Account
→ Player accepts/declines
```

## 6. Coach Dashboard Copy

Replace wording that assumes an account already exists.

Preferred general copy:

> **Invitation sent to david.su@jetta.com.**\
> They'll receive an email inviting them to Jetta. If they don't have a
> Jetta account yet, they'll be asked to create one. After signing in,
> they can accept your coaching invitation.

If safe to distinguish an existing account:

> **Invitation sent to David.**\
> We've emailed david.su@jetta.com, and the invitation is also available
> in David's Jetta account.

Do not introduce an account-enumeration vulnerability merely to provide
different copy.

## 7. Pending Invitation Management

Coach Dashboard should make pending invitations understandable,
conceptually:

``` text
Pending Invitations

David Su
david.su@jetta.com
Status: Invitation Sent
Sent: Sep 29, 2026

[ Resend Email ]
[ Cancel Invitation ]
```

Reuse existing lifecycle/status fields wherever possible.

Do not claim `Delivered` unless the email provider provides reliable
delivery evidence.

Resending should reuse the same logical pending invitation rather than
create duplicate relationships. Apply reasonable rate limits.

Cancelling a pending invitation must not create a player, consume a
seat, or create an ACTIVE relationship. Preserve appropriate audit
history.

## 8. Security

Invitation links are security-sensitive.

Requirements: - cryptographically secure invitation tokens; - store a
secure token hash where consistent with existing architecture; - never
expose token hashes through UI/APIs; - invitation token cannot grant
Coach/Admin privileges; - acceptance binds to authenticated Jetta
identity; - do not trust client-supplied identity/role values; - prevent
replay after acceptance/cancellation; - rate-limit invitation
creation/resend as appropriate; - audit state-changing operations; - do
not log plaintext security tokens.

Reuse existing Jetta security primitives.

## 9. Privacy / Account Enumeration

The Coach invitation API must not become a global account lookup
mechanism.

Audit whether current behavior reveals: - whether arbitrary emails have
Jetta accounts; - display names/player IDs prematurely; - different
errors that expose account existence.

Preserve useful Coach workflow without exposing global user-directory
information.

## 10. Existing Domain Rules Remain Authoritative

Do not create a second entitlement or relationship engine.

Preserve: - permanent player identity/history; - coaching relationship
separate from sponsored seat; - sponsored seat separate from
entitlement; - 10 is a sponsorship limit, not a roster limit; - multiple
grants are valid; - accepting sponsorship does not cancel SELF_PAID; -
releasing a seat does not delete account/history or automatically end
coaching; - existing 30-day Coach billing grace remains unchanged.

## 11. Email Infrastructure Audit

Do not invent a new email subsystem before repository/deployment audit.

Determine: 1. whether Jetta already sends transactional email; 2.
current provider/service; 3. how Supabase email is currently used; 4.
whether SMTP/transactional infrastructure exists; 5. environment/secrets
configuration; 6. existing email abstraction/templates; 7. send-failure
logging; 8. safe local-development behavior.

If none exists, propose the smallest secure abstraction rather than
scattering provider-specific calls through Coach code.

## 12. Domain Boundary

Canonical production responsibilities:

``` text
www.jetta.com
Public / marketing website

golfgame.jetta.com
Jetta product application

golfgame.jetta.com/admin/
Restricted Jetta Back Office
```

Invitation acceptance belongs on `golfgame.jetta.com`.

Do not hard-code production hostnames in a way that breaks local/test
environments. Use appropriate base-URL configuration.

## 13. Player Account Experience

Authenticated players should continue to see pending Coach invitations
in Account.

For a student arriving from email:

``` text
Create Account / Sign In
→ Pending invitation recognized
→ Coach invitation shown prominently
→ Accept / Decline
```

Do not make a newly invited student hunt through unrelated profile
settings.

## 14. Core Acceptance Criterion

Scenario:

``` text
Coach has active Coach access
Coach has available sponsored seat
Student has no Jetta account
Coach invites student's email
Student receives email
Student creates Jetta account
Student accepts invitation
```

Expected:

``` text
Relationship: ACTIVE
Sponsored Seat: ACTIVE
Grant: COACH_SPONSORED
New entitled play: available
Individual Access Code: NOT REQUIRED
```

## 15. Audit Events

Reuse existing event conventions where available. Relevant semantics may
include:

``` text
COACH_INVITATION_CREATED
COACH_INVITATION_EMAIL_SENT
COACH_INVITATION_RESENT
COACH_INVITATION_ACCEPTED
COACH_INVITATION_DECLINED
COACH_INVITATION_CANCELLED
COACH_SEAT_ASSIGNED
```

Do not create redundant events if current events already capture these
actions.

`EMAIL_SENT` must mean only what the implementation can prove; it must
not imply inbox delivery without provider evidence.

## 16. Testing Requirements

Cover at minimum:

**Prospective student** - Coach can invite email with no existing
player. - Invitation can persist without existing `player_id`. - Email
send is requested. - Link returns to Jetta product. - New user can
create/sign in. - Correct authenticated identity can claim invitation. -
Acceptance creates ACTIVE relationship. - Available seat creates
COACH_SPONSORED. - Individual Access Code is not required.

**Existing player** - Existing player can be invited. - Invitation
appears in Account. - Email notification is sent. - Acceptance uses
existing identity.

**Security** - arbitrary player/Coach IDs cannot claim or redirect
invitation; - mismatched authenticated identity cannot claim another
person's invitation; - cancelled invite cannot be accepted; - accepted
invite cannot be replayed; - token/hash does not leak through unrelated
APIs/logs; - account enumeration is prevented; - appropriate rate limits
exist.

**Capacity/domain** - pending invitation consumes zero seats; -
acceptance checks capacity atomically; - concurrent acceptance cannot
create seat 11; - no-capacity acceptance still creates ACTIVE
relationship without sponsored grant; - SELF_PAID remains intact; -
sponsorship can later be assigned; - release/end/grace behavior remains
unchanged; - non-Coach cannot invite.

**Email** - send failure does not falsely report delivery; - resend does
not create duplicate relationship; - cancelled invitation is not revived
by old link; - local/test mode does not accidentally send production
email.

## 17. Phase 0 --- Repository Audit Required Before Coding

**Do not implement yet.**

Audit the current authoritative repository/branch and report exactly how
Coach invitations work.

Inspect:

### Schema

-   `coach_invitations`
-   `coach_student_relationships`
-   `coach_seat_assignments`
-   `players`
-   `entitlement_grants`
-   Coach subscriptions/access
-   audit events

For `coach_invitations`, report exact columns, nullability, constraints,
indexes, foreign keys, status values, timestamps, whether `player_id` is
required, whether invited email is stored, and whether a token/token
hash exists.

### Service layer

Identify invitation creation, lookup, acceptance, decline/cancel, seat
assignment, atomic capacity check, entitlement creation, and audit
generation. Identify the authoritative existing service.

### HTTP/API

Identify all invitation endpoints, request/response fields,
authorization, whether existing player is required, email lookup
behavior, account-existence leakage, and whether acceptance trusts
browser IDs.

### UI

Identify Coach Dashboard invitation UI, Player Account pending
invitation UI, current copy, resend/cancel controls, and post-acceptance
navigation.

### Authentication

Confirm Supabase identity resolution, verified-email behavior,
local-development behavior, how a new Supabase user becomes a Jetta
`players` row, and how a post-signup invitation can be matched securely.

### Email

Identify provider, configuration, environment variables, abstraction,
templates, logging, and development behavior. If no transactional email
infrastructure exists, state that explicitly.

### Tests

Identify current tests for invitations, capacity/concurrency, sponsored
grants, signup, email, and invitation security.

## 18. Phase 0 Deliverable

Return an **implementation plan only**. Do not modify application code
during Phase 0.

The plan must include: 1. exact files to create; 2. exact files to
modify; 3. schema migration only if actually required; 4. existing
services to reuse; 5. invitation data contract; 6. email-service
approach; 7. signup/sign-in return flow; 8. secure invitation-claim
flow; 9. UI changes; 10. Coach Dashboard copy changes; 11. Account
changes; 12. API changes; 13. rate-limit/security changes; 14. audit
changes; 15. tests; 16. local manual-test workflow; 17. production
configuration; 18. deployment/rollback risks.

Prefer the existing schema if it safely supports the requirement. If
migration is required, explain exactly why before implementation.

## 19. Implementation Guardrails

When implementation is later approved: - use the current authoritative
licensing implementation as the base; - extend existing
Coach/entitlement services; - do not alter the 10-seat rule; - do not
change 30-day grace; - do not require Individual Access Code for
sponsored student; - do not cancel SELF_PAID; - do not create
`INACTIVE`; - do not expose private emails outside authorized
contexts; - do not trust browser identity/role assertions; - do not
claim email delivery without evidence; - do not hard-code production
URLs; - do not move application invitation acceptance to
`www.jetta.com`; - do not mix unrelated Back Office Analytics into this
work.

## 20. Product Acceptance Scenario

``` text
1. Jetta gives Michael a Coach Access Code.
2. Michael signs into Jetta and redeems it.
3. Michael opens Coach Dashboard.
4. Michael enters david.su@jetta.com.
5. Michael clicks Send Invitation.
6. David has never used Jetta.
7. David receives "Michael has invited you to join Jetta."
8. David clicks Accept Invitation.
9. David goes to golfgame.jetta.com.
10. David creates his Jetta account.
11. Jetta securely recognizes the pending invitation.
12. David accepts Michael's invitation.
13. Relationship becomes ACTIVE.
14. Michael has sponsored capacity.
15. David receives COACH_SPONSORED entitlement.
16. Michael's Sponsored Students changes from 0/10 to 1/10.
17. David can use entitled Jetta features.
18. David never needed an Individual Access Code.
```

## 21. Instruction to Codex

**Phase 0 only. Do not code yet.**

Audit the current repository against this specification and return the
implementation plan in Section 18.

Pay particular attention to: - whether `coach_invitations` currently
requires an existing `players.id`; - how invitations can exist for
prospective users; - how Supabase signup maps to a Jetta player; -
secure post-signup invitation claiming; - whether transactional email
infrastructure already exists.

Do not assume a schema migration or a new email provider is necessary
until the audit proves it.
