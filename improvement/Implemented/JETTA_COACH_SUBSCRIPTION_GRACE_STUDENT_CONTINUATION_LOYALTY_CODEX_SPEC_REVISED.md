# Jetta Coach Subscription Grace, Student Continuation & Loyalty --- Codex Specification

**Status:** Revised implementation specification\
**Product:** Jetta\
**Canonical application:** `https://golfgame.jetta.com`\
**Back Office:** `https://golfgame.jetta.com/admin/`\
**Planned payment provider:** Stripe, in a later payment phase

## 1. Purpose

This specification defines the Coach subscription grace lifecycle,
notifications, student continuity experience, durable Student
Continuation eligibility, and Jetta loyalty policy.

It deliberately separates two releases:

**Phase A --- build from this specification:** existing grace lifecycle
hardening, scheduled reconciliation, notification ledger, daily Coach
emails, limited student notifications, Coach Dashboard and Player
Profile grace UX, durable continuation eligibility, Back Office
diagnostics, and audit.

**Phase B --- separate payment specification:** Stripe Checkout,
recurring billing, signed webhooks, Customer Portal, payment lifecycle,
refunds, disputes, taxes, and credit-card continuation purchase.

Do not block Phase A on Stripe.

## 2. Preserve the Existing Jetta Domain Model

Extend the current licensing foundation rather than replacing it.
Preserve `ACTIVE`, `PAST_DUE`, and `EXPIRED`; the configurable Coach
grace period; continued `COACH_SELF` and existing `COACH_SPONSORED`
access during grace; blocking new sponsorship while `PAST_DUE`; release
of seats/grants after grace; preservation of ACTIVE coaching
relationships; multiple simultaneous grants; authorization snapshots for
in-progress activities; permanent player identity/history; and
separation among identity, entitlement, coaching relationship, and
sponsored seat.

Ten remains a sponsorship limit, not a total coaching-roster limit. Do
not introduce an `INACTIVE` coaching relationship state.

## 3. Jetta Loyalty Principle

> **Loyal customers are one of Jetta's most valuable assets. Customers
> who have already experienced Jetta and found enough value to continue
> should be rewarded for that demonstrated relationship rather than
> treated as brand-new customers.**

The Student Continuation Offer is a loyalty/continuity benefit for a
real Coach-sponsored Jetta user, not a generic public discount.

## 4. Coach Responsibility for Sponsored Access

Coach-facing messaging must clearly state:

> **Your students' sponsored Jetta access depends on your Coach
> subscription.**

A student's Coach-sponsored access remains eligible while the Coach
subscription is eligible under Jetta's subscription/grace rules and the
student occupies a valid sponsored seat.

If the Coach subscription enters `PAST_DUE`, Jetta provides the settled
30-day grace period. Existing Coach access and existing
sponsored-student access continue, but no new sponsorship invitations or
sponsored-seat assignments are allowed.

If grace ends without restoration, **Coach-provided access ends**.
Student accounts, history, and coaching relationships are not deleted.

## 5. Authoritative Grace Clock

`grace_ends_at` is the single authoritative deadline.

Rules:

1.  Store/compare the authoritative deadline as an exact UTC timestamp.
2.  Access remains grace-eligible until `grace_ends_at`.
3.  At or after that timestamp, reconciliation may transition `PAST_DUE`
    to `EXPIRED`, subject to a final protected state recheck.
4.  UI/email must derive the displayed deadline from the same timestamp.
5.  "Days remaining" must be calculated consistently and never imply
    access beyond the exact deadline.
6.  Always show the actual deadline date prominently.

Codex should audit existing timezone/display conventions and use one
consistent customer-facing rule.

For Phase A, UTC remains authoritative. Browser UI may render the exact
deadline in the player's local timezone, but must include the timezone when
showing a time. Transactional email, which has no reliable account timezone,
must show the UTC deadline date and time explicitly. A date-only label must
never imply that access lasts through the end of that local calendar day.

## 6. Grace Start and Day Numbering

When the subscription first transitions to `PAST_DUE`, establish the
grace cycle and `grace_ends_at`. Existing access continues.

The initial Coach notification should be eligible for immediate dispatch
after that authoritative transition commits. Subsequent notifications
are scheduler-driven.

"Days 1--30" is business/customer language. Expiration is controlled by
`grace_ends_at`, not a separate calendar counter.

Notification windows are consecutive 24-hour intervals anchored to the
durable `grace_started_at` for that grace cycle. The immediate notification
occupies window 1. Window 2 does not become eligible until 24 hours after
`grace_started_at`; a calendar-date boundary must not cause two messages to
be sent minutes apart.

A 30-day grace cycle has a maximum of exactly 30 intended Coach notification
windows. Day 1 is the immediate notification; it is not an additional message
before the numbered windows. Day 30 is the final window. Do not create a Day 0
or Day 31 Coach grace notification.

## 7. Scheduled Lifecycle Worker

Request-driven reconciliation is insufficient for guaranteed email
delivery and timely expiration.

Phase A needs a recurring server-side worker:

``` text
Scheduled worker
→ find subscriptions requiring reconciliation
→ re-read authoritative state
→ reconcile restoration/expiration
→ find due notifications
→ reserve notification idempotently
→ send through application email abstraction
→ record success/failure
→ safely retry failures
```

It must not depend on anyone opening Jetta. Use the current
application/deployment environment; do not introduce a separate payment
server merely for this worker.

## 8. Notification Ledger

Add a durable notification ledger or equivalent idempotency mechanism.
Logical uniqueness must distinguish at least:

``` text
subscription_id
grace_cycle_id
notification_day_or_window
notification_type
recipient
```

Exact schema is repository-dependent.

Required behavior: one logical notification per recipient/window, safe
retries after unconfirmed failure, no intentional resend after a notification
is confirmed `SENT`, restoration stops future notices, new grace cycles remain
distinct, and delivery failure never controls entitlement state.

External email acceptance and the local `SENT` update cannot be made one
atomic transaction unless the provider supports an idempotency key. Record
the provider message/request identifiers when returned. A timeout after
provider acceptance may create a rare duplicate on retry; do not claim an
absolute provider-level exactly-once guarantee unless SMTP2GO supplies and
Jetta uses a verified idempotency mechanism.

Do not send a backlog burst after worker downtime. Only the current
notification window may be sent or retried. Earlier unsent windows become
`MISSED`; expiration still reconciles immediately when `grace_ends_at` has
passed.

If a recipient has no deliverable email address, record `NO_ADDRESS`, expose
it to Back Office diagnostics, and continue the entitlement lifecycle. A
missing address must never block grace, restoration, or expiration.

Each logical notification permits a maximum of three total provider delivery
attempts, including the initial attempt. An initial failure may therefore have
at most two retries, and every attempt must occur inside that notification's
valid delivery window.

## 9. Daily Coach Notifications

This is intentional Jetta policy:

> **Send one Coach grace email per grace day for the full grace period
> while the subscription remains `PAST_DUE`.**

Do not reduce V1 to milestone-only emails.

Each email must include the problem, current continuation of existing
access, exact grace deadline, days remaining, the consequence for
Coach-provided student access, and provider-appropriate restoration
instructions.

For a paid-provider subscription, the future UI may offer **Manage
Subscription**. For `ACCESS_CODE`, pilot, promotional, or other
non-payment-provider access, do not show an unusable payment-management
button.

Example:

``` text
Your Jetta Coach subscription needs attention

18 days remaining

Your Jetta access and your existing sponsored students'
access remain active during the grace period.

Grace period ends:
October 29, 2026

If your subscription is not restored by that date,
the Jetta access you provide to your sponsored students
will end.

[ Manage Subscription ]
```

## 10. Student Notifications

Students do not receive daily Coach billing emails.

**Grace begins:** send one informational email to each currently
sponsored student explaining that access remains active, the exact
deadline if the Coach does not restore, account/history preservation,
and the continuation option where applicable.

**During grace:** persistent status lives in **Player Profile → Jetta
Access**.

**Coach restores:** no student email required in V1; Player Profile
returns to normal.

**Grace expires:** send one email explaining that Coach-provided access
ended and present Student Continuation when appropriate.

**Migration exception:** when Phase A reconstructs a grace cycle for a Coach
who was already `PAST_DUE` before deployment, do not send students a
retroactive `STUDENT_GRACE_STARTED` email. Player Profile shows the current
grace status and deadline. If the reconstructed cycle later expires, currently
affected students still receive the normal sponsorship-ended email.

## 11. Expiration Race Protection

Internal final state is `EXPIRED`. Customer copy may say the
subscription "ended." Do not introduce a separate `TERMINATED` state
just for messaging.

Expiration must protect against a simultaneous restoration/payment:

``` text
worker identifies expired grace
→ begin protected transaction/reconciliation
→ re-read subscription
→ verify same grace cycle
→ verify still PAST_DUE
→ verify grace_ends_at <= now
→ verify no restoration committed
→ only then transition to EXPIRED
```

The exact transaction/locking method must fit SQLite and the existing
service architecture.

## 12. Post-Grace Behavior

``` text
PAST_DUE
→ EXPIRED
→ COACH_SELF ends
→ COACH_SPONSORED grants supplied by that subscription end
→ sponsored seats released/deactivated
→ ACTIVE coaching relationships remain ACTIVE
→ audit events recorded
→ Coach expiration email
→ student sponsored-access-ended email
```

Email failure must never prevent expiration.

## 13. Restoration

**During grace:** `PAST_DUE → ACTIVE`; existing seats/grants remain
because they never ended. Daily Coach notices stop.

**After EXPIRED:** do not automatically re-sponsor former students.
Historical relationships remain, but the Coach explicitly chooses whom
to sponsor again. Capacity remains atomic and capped at 10.

## 14. Exact Student Continuation Eligibility

A student qualifies when Jetta historically granted that player a valid
active `COACH_SPONSORED` entitlement.

``` text
Invitation only → NOT eligible
ACTIVE Coach relationship but never sponsored → NOT eligible
Historically active COACH_SPONSORED grant → ELIGIBLE
```

V1 has no minimum number of rounds, Academy requirement, or minimum
sponsorship duration.

## 15. Durable Eligibility

Eligibility must be server-authoritative and durable. Record sufficient
provenance to identify player, qualification date, source Coach
relationship, source seat/grant where available, source Coach
subscription where available, offer version, status, and administrative
correction history.

Exact schema follows repository audit.

Backfill legitimate historical students where authoritative records
prove active `COACH_SPONSORED` access.

For ongoing operation, establish eligibility transactionally when the first
valid `COACH_SPONSORED` grant becomes active. The scheduled worker may repair
an omitted record, but is not the normal qualification path.

ADMIN may revoke/correct eligibility only for fraud, erroneous
provisioning, or administrative correction, and the action must be
audited.

## 16. Eligibility vs Price

Once legitimately earned, Student Continuation eligibility is preserved.

Current offer:

``` text
$9/month USD
or
$49/year USD
```

Permanent eligibility does **not** promise today's dollar price forever.
Future pricing/grandfathering is a separate business decision.

## 17. Player Profile State Matrix

  -----------------------------------------------------------------------
  Student state                       Player Profile behavior
  ----------------------------------- -----------------------------------
  Sponsored only; Coach in grace      Active warning, exact deadline,
                                      continuation offer

  Sponsored + SELF_PAID; Coach in     Explain sponsorship risk; no urgent
  grace                               purchase warning

  Sponsorship ended; no other grant   Historical Access + continuation
                                      offer

  Sponsorship ended; another valid    Active through valid grant; no
  grant                               false loss warning

  Eligible; never purchased           Continuation offer remains
                                      available

  Already subscribed to continuation  Subscription management, not
                                      another checkout

  Coach restored during grace         Return to normal sponsored state
  -----------------------------------------------------------------------

The student API must expose enough authoritative grace/deadline
information to render this without exposing unrelated Coach billing
data.

## 18. Student Player Profile Copy

During grace:

``` text
YOUR JETTA ACCESS

✓ Access remains active

Coach Sponsorship — Grace Period

Your Jetta access is currently provided by your Coach.

Your Coach's subscription is in a grace period, but
your Jetta access continues during this period.

If your Coach's subscription is not restored,
your Coach-sponsored access will end on:

October 29, 2026

Your Jetta account and saved history remain yours.
```

Continuation:

``` text
KEEP YOUR JETTA ACCESS

Because you've been using Jetta through your Coach,
you're eligible for preferred continuation pricing.

$9/month
or
$49/year
```

Phase A may display eligibility/offer information but must not create a
fake checkout.

Until Phase B is enabled, Phase A must not render an active purchase or
payment-management button. It may show:

``` text
Preferred continuation eligibility

You qualify for Jetta Student Continuation:
$9/month or $49/year.

Online subscription activation is not yet available.
Your eligibility has been saved.
```

## 19. Post-Grace Student State

If sponsorship ends with no other valid grant:

``` text
Coach relationship        ACTIVE
Coach sponsorship         ENDED
Sponsored seat            RELEASED
SELF_PAID                 NONE
Account/history            PRESERVED
Entitlement decision       DENIED without another valid grant
Runtime result             determined by current enforcement mode
Continuation eligibility   PRESERVED
```

If another valid grant exists, access continues through that grant.

## 20. Multiple Grants

Never implement `Coach expired → student cannot use Jetta`.

Correct behavior:

``` text
Coach sponsorship ends
→ resolve all other grants
→ valid SELF_PAID/PROMOTIONAL/etc.?
   YES → access continues
   NO  → historical access
```

`SELF_PAID` and `COACH_SPONSORED` may coexist.

## 21. Access Code Clarification

Ordinary paid public onboarding retains the planned Access Code flow:

``` text
Paid Coach/Individual purchase
→ automatic appropriate Access Code
→ setup email
→ Player Profile → Jetta Access → Activate
```

**Student Continuation is the explicit exception:**

> Student Continuation is an authenticated, account-bound purchase.
> Trusted payment confirmation activates `SELF_PAID` directly and does
> not issue an Access Code.

Access Codes remain for ordinary paid Coach/Individual onboarding,
pilot/promotional provisioning, and manual ADMIN support/recovery.

## 22. Audit Concepts

Use existing audit conventions, with concepts equivalent to:

``` text
COACH_GRACE_STARTED
COACH_GRACE_RESTORED
COACH_GRACE_EXPIRED
COACH_GRACE_NOTIFICATION_SENT
COACH_GRACE_NOTIFICATION_FAILED
STUDENT_GRACE_NOTIFICATION_SENT
STUDENT_SPONSORSHIP_ENDED_NOTIFICATION_SENT
CONTINUATION_ELIGIBILITY_GRANTED
CONTINUATION_ELIGIBILITY_REVOKED
```

Never log payment-card data, email credentials, tokens, or secrets.

## 23. Back Office Diagnostics

ADMIN should be able to inspect Coach subscription/provider state,
`grace_ends_at`, grace cycle, notification history, sponsored seats,
active Coach relationships, at-risk sponsored students,
expiration/restoration events, continuation eligibility/provenance, and
audited ADMIN eligibility corrections.

Back Office is diagnostic/operational, not a second entitlement
authority.

## 24. Phase A Acceptance Criteria

1.  `grace_ends_at` is the single expiration authority.
2.  Scheduled reconciliation runs without user traffic.
3.  Notification delivery is idempotent/retryable.
4.  Coach receives one intended email per grace day while `PAST_DUE`.
5.  Provider-appropriate CTAs are used.
6.  Existing Coach/student access continues through grace.
7.  New sponsorship remains blocked during `PAST_DUE`.
8.  Students receive one grace-start notice, not daily billing mail.
9.  Player Profile shows exact sponsored-access deadline.
10. Expiration performs a protected state recheck.
11. Internal final state remains `EXPIRED`.
12. Expiration ends Coach-provided grants/seats but preserves ACTIVE
    coaching relationships.
13. Email failure cannot block entitlement transitions.
14. Restoration during grace preserves sponsorship.
15. Restoration after `EXPIRED` does not auto-responsor.
16. Historically active `COACH_SPONSORED` qualifies.
17. Invitation/relationship without sponsorship does not qualify.
18. Eligibility is durable/server-authoritative.
19. Legitimate historical sponsored students can be backfilled.
20. ADMIN corrections are audited.
21. Student UI resolves multiple grants before warning.
22. Phase A contains no fake credit-card checkout.
23. Phase A leaves a clean Stripe seam.
24. Existing licensing enforcement mode is not changed unless separately
    authorized.
25. Notification windows are 24-hour intervals anchored to the grace-cycle
    start, and the immediate notice occupies window 1.
26. Missed historical windows are not sent as a backlog burst.
27. Confirmed `SENT` notifications are not intentionally resent; provider
    delivery limitations are represented accurately.
28. `NO_ADDRESS` and delivery failure are diagnostic states and never block
    subscription or entitlement transitions.
29. New sponsored grants establish continuation eligibility transactionally.
30. Phase A renders no active purchase or payment-management control.
31. Student status distinguishes entitlement decision, enforcement mode, and
    current runtime result where those facts differ.
32. A 30-day grace cycle creates no more than 30 Coach notification windows;
    the immediate Day-1 notice is window 1, not an extra notice.
33. A notification has at most three total provider delivery attempts,
    including its initial attempt, within its valid window.
34. Reconstructing a pre-existing `PAST_DUE` cycle sends no retroactive student
    grace-start email; normal Player Profile status and expiration email remain.

## 25. Codex Instruction Before Coding

Audit the repository and return an exact Phase A implementation plan
covering:

1.  schema changes;
2.  scheduler/worker deployment mechanism;
3.  notification ledger;
4.  SMTP2GO/application-email reuse;
5.  SQLite transaction/recheck design;
6.  API changes;
7.  Coach Dashboard changes;
8.  Player Profile state matrix;
9.  Back Office diagnostics;
10. historical eligibility backfill;
11. audit mapping;
12. tests;
13. files to create/modify;
14. deviations/questions.

**Do not implement Stripe/payment processing under this specification.**
