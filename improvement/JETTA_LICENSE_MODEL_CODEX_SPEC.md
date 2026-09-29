# Jetta Coach, Player Seat, Subscription, and Play Entitlement Model

**Status:** V7 — Domain Model Freeze Candidate
**Purpose:** Define Jetta account ownership, Coach subscriptions, student seats, Individual subscriptions, play entitlement, and transitions between them.

## 1. Core Principle

A Jetta player account is permanent.

The player owns their Jetta identity and historical record. A coach does not own a student's account.

A subscription or Coach seat supplies **play entitlement**: permission to create new rounds and other entitled play activity.

Keep these concepts separate:

- **Authentication:** Who is the user?
- **Player account:** Whose permanent Jetta identity and history is this?
- **Role:** Is the user a PLAYER, COACH, ADMIN, or combination?
- **Coach relationship:** Who is currently coaching this player?
- **Seat assignment:** Is this player occupying one of a Coach subscription's student seats?
- **Play entitlement:** Why may this player create new play activity?
- **Data sharing:** What may a coach see?

Do not collapse these concepts into one `account_type`, `coach_id`, or subscription flag.

Creating a Jetta account and signing in are free. Play entitlement is required only to START new play activity — never to authenticate, never to review history, and never to finish an activity already in progress.

## 2. Initial Commercial Products

### Jetta Individual

Initial price: **$29/month**.

An annual plan may be offered at a discounted rate.

The player pays Jetta directly and supplies their own play entitlement.

```text
entitlement_type = SELF_PAID
entitlement_holder = player
play_access = ACTIVE
```

A self-paying player does not require a coach.

### Jetta Coach

Initial price: **$49/month**.

A Coach subscription includes a coaching workspace, the subscription holder's own play entitlement, and up to **10 active sponsored student seats** — 11 in total: the coach's own play plus 10 students.

The coach does not need a separate $29 Individual plan to play. Do not ask a coach for $78/month.

The Coach subscription is infrastructure for the coach's professional practice. The seats are not Jetta products that the coach must resell for $29.

The coach independently decides what to charge for professional coaching services. Jetta does not need coach-to-student billing, revenue sharing, or payouts in V1.

Preferred customer-facing language:

> **Includes Jetta access for up to 10 students.**

A Coach may maintain coaching relationships with additional Jetta Individual players beyond these 10 sponsored students.

Avoid describing the offer primarily as "10 player accounts," "10 concurrent accounts," or as a limit on the Coach's total coaching roster.

### Interim Access Codes and Provider-Neutral Billing

Stripe is not required for the first implementation pass. Until Stripe billing is ready, Jetta may activate controlled pilot access through server-issued **Jetta Access Codes**.

Use "access code," not "payment coupon," in customer-facing language when no checkout or payment transaction occurs.

An access code is not an authorization bypass. Redemption must create an authoritative, auditable subscription/access record on the server and flow through the same entitlement resolver used by future paid subscriptions.

Conceptually:

```text
Access code redemption ─┐
                        ├─> Jetta subscription state ─> entitlement grants
Stripe webhook ─────────┘
```

The internal subscription model must be provider-neutral:

```text
subscription
    id
    holder_player_id
    plan                         INDIVIDUAL | COACH
    billing_provider             ACCESS_CODE | STRIPE
    provider_customer_id         nullable
    provider_subscription_id     nullable
    status                       ACTIVE | PAST_DUE | CANCELLED | EXPIRED
    starts_at
    current_period_end
    grace_ends_at
    created_at
    updated_at
```

Store access-code inventory and redemption history separately from the resulting subscription:

```text
access_code
    id
    code_hash
    plan                         INDIVIDUAL | COACH
    duration_days
    expires_at                   nullable; last time the code may be redeemed
    max_redemptions
    redemption_count
    status                       ACTIVE | REVOKED | EXHAUSTED | EXPIRED
    created_by_player_id
    created_at
    revoked_at                   nullable

access_code_redemption
    id
    access_code_id
    player_id
    subscription_id
    redeemed_at

    UNIQUE(access_code_id, player_id)
```

The code's own `expires_at` controls redemption eligibility. The resulting subscription's `current_period_end` controls how long the redeemed access remains valid. These are intentionally different concepts.

Reserve an idempotent provider-event boundary for future billing integrations:

```text
billing_event
    id
    billing_provider             ACCESS_CODE | STRIPE
    provider_event_id
    event_type
    processing_status
    received_at
    processed_at                 nullable

    UNIQUE(billing_provider, provider_event_id)
```

The Stripe adapter may retain additional encrypted or provider-specific payload data where operationally necessary, but core authorization must depend on normalized subscription and entitlement state rather than raw webhook payloads.

Access-code requirements:

- generate cryptographically random codes;
- store only a secure hash of each code;
- configure the plan, duration, expiration, and maximum redemptions server-side;
- redeem atomically and rate-limit failed redemption attempts;
- prevent the same player from redeeming the same code more than once;
- record who created, redeemed, revoked, or cancelled a code;
- never trust the browser to supply subscription or entitlement status;
- default pilot codes to a configurable duration such as 90 days, one redemption, and no automatic renewal;
- do not collect or require a payment method for access-code activation.

When Stripe is introduced, it must be implemented as a billing adapter rather than a replacement entitlement system. Stripe checkout, customer portal, and verified idempotent webhooks update the same internal subscription states. The browser returning from a successful checkout page must never grant access by itself.

Access-code subscriptions remain valid until their recorded expiration. They must not silently convert into a paid Stripe subscription or automatically charge the player. The player must explicitly choose a paid plan.

## 3. Roles

Do not make COACH and PLAYER mutually exclusive account types.

A coach is often also a golfer.

Conceptually support:

```text
PLAYER
COACH
ADMIN
```

A single authenticated Jetta identity may have multiple roles.

## 4. Permanent Player Account

The permanent player account may contain:

- Player Profile
- bag and club information
- GPS rounds
- simulated rounds
- round history
- On-Course Replay
- PC Replay
- Learning Reports
- Canonical Assessments
- Evidence Book information
- Learning Focus history
- other historical learning evidence

Losing or changing an entitlement must not delete these records.

**Invariant:** Releasing a student seat must never cascade-delete player identity, rounds, GPS evidence, Replay data, reports, or learning history.

## 5. Play Entitlement

Play entitlement answers:

> **Why is this player currently permitted to create new Jetta play activity?**

Initial entitlement types:

### `COACH_SPONSORED`

A valid Coach subscription supplies access through an active student seat.

```text
type = COACH_SPONSORED
player_id = <player>
sponsoring_coach_id = <coach>
status = ACTIVE
```

### `SELF_PAID`

The player has an active Jetta Individual subscription.

```text
type = SELF_PAID
player_id = <player>
status = ACTIVE
```

### `COACH_SELF`

The Coach subscription holder's own play access through their active Coach subscription.

```text
type = COACH_SELF
player_id = <coach's player identity>
coach_subscription_id = <subscription>
status = ACTIVE
```

### `PROMOTIONAL`

A valid Jetta Access Code supplies temporary Individual play access without claiming that a cash payment occurred.

```text
type = PROMOTIONAL
player_id = <player>
subscription_id = <access-code subscription>
status = ACTIVE
expires_at = <configured expiration>
```

`PROMOTIONAL` keeps billing and conversion reporting truthful. Do not label access-code activation as `SELF_PAID`. A Coach-plan access code instead creates an ACCESS_CODE-backed Coach subscription; that subscription supplies the normal `COACH_SELF` and `COACH_SPONSORED` grants because those grant types describe who supplies access, not whether Stripe collected payment.

### `NONE`

No active subscription or sponsored seat currently supplies play access.

`NONE` is primarily a **derived access state**: the player has no currently valid entitlement grant. It does not need to be persisted as a synthetic entitlement row if the repository is cleaner when only actual entitlement grants are stored.

```text
valid_entitlement_grants = []
derived_play_access = NONE
```

The player remains a valid authenticated Jetta user.

| Entitlement | Jetta payer | New play | Historical access |
|---|---|---:|---:|
| `COACH_SELF` | Coach (own play) | Yes | Yes |
| `COACH_SPONSORED` | Coach | Yes | Yes |
| `SELF_PAID` | Player | Yes | Yes |
| `PROMOTIONAL` | Jetta promotion | Yes, until expiration | Yes |
| `NONE` | Nobody | No | Yes |

Authentication must not automatically imply play entitlement.

**Entitled play activity** means starting any new round (simulated or on-course GPS recording), Academy lesson, or match. Reading history, reviews, reports, and the Evidence Book never requires entitlement.

Entitlement is checked when new play starts. An activity already in progress is never interrupted by an entitlement change.

## 6. Coach Relationship and Entitlement Are Different

A coach relationship answers:

> **Who is currently coaching this golfer?**

An entitlement answers:

> **Who currently supplies this golfer's Jetta play access?**

Both of these states are valid:

```text
Current Coach: Michael
Valid grants: COACH_SPONSORED (sponsor: Michael)
```

```text
Current Coach: Michael
Valid grants: SELF_PAID
```

Do not authorize play merely because `player.coach_id` is non-null.

A player may hold more than one entitlement grant at once (for example, SELF_PAID or PROMOTIONAL plus an accepted coach seat). **Authorization succeeds if any valid entitlement grant permits new play.** Do not make authorization depend on a fragile global precedence order.

For display and billing UX, Jetta may present SELF_PAID as the player's primary access source while an accepted coach seat remains available as fallback. If the self-paid subscription later lapses, a still-valid coach-sponsored grant can continue play without a gap. `NONE` is derived only when no valid entitlement grant remains.

## 7. Current Coach

The player account UI should indicate the current coach when an active coaching relationship exists.

Example:

```text
Current Coach
Susan Smith
```

or:

```text
Current Coach
None
```

The current coach should be derived from the active relationship, not treated as permanent ownership metadata on the player record.

Historical coach relationships should remain available for historical fidelity.

## 8. Coach-Student Relationship

Conceptually:

```text
coach_student_relationship
    id
    coach_id
    player_id
    status
    started_at
    ended_at
    created_at
```

Initial statuses:

```text
INVITED
ACTIVE
ENDED
```

Coaching relationship state is independent of sponsorship capacity. Once the player accepts the coaching relationship, the relationship is ACTIVE even if no sponsored seat is currently available. Lack of sponsorship is represented by seat/entitlement state, not by making the coaching relationship inactive.

Do not destroy an ended relationship simply because a player changes coaches.

Historical rounds should remain associated with the relationship context that existed when they were played where that context matters.

## 9. Coach Student Seats

A Coach subscription supports up to 10 simultaneously active **sponsored** students, plus the coach's own play entitlement.

**The 10-seat limit is a sponsorship limit, not a coaching-relationship limit.** A coach may maintain coaching relationships with additional players who supply their own valid Jetta entitlement, such as SELF_PAID or PROMOTIONAL players. Only active COACH_SPONSORED students consume the 10 sponsored student seats.

Every accepted sponsorship invitation consumes one sponsored seat — including invitations to players who already hold SELF_PAID or PROMOTIONAL access. Jetta permits multiple valid grants and does not treat them as a problem to resolve. All Jetta requires for play is that the student holds at least one valid grant.

Conceptually:

```text
coach_seat_assignment
    id
    coach_subscription_id
    coach_id
    player_id
    relationship_id
    status
    assigned_at
    released_at
```

Initial states may be:

```text
INVITED
ACTIVE
RELEASED
CANCELLED
```

Only **ACTIVE sponsored students** count against the 10-seat capacity. A pending invitation does not consume an active student seat.

The Coach Dashboard may therefore show:

```text
Sponsored Students: 7 / 10
Sponsored Seats Available: 3
Pending Sponsorship Invitations: 5
```

The coach may cancel a pending invitation at any time. V1 has no automatic invitation expiry.

Sponsored-seat availability is visible to the coach only; players never see seat counts. When all 10 sponsored seats are occupied, the coach cannot send a new **sponsorship invitation** until a seat frees up. This does not prevent the coach from maintaining coaching relationships with players who supply their own entitlement (for example, after sponsorship is released); those relationships consume no sponsored seat. There is no relationship-only invitation: every invitation is a sponsorship invitation.

Sponsored-seat capacity must still be checked atomically when a sponsorship invitation is accepted as a safety net: concurrent acceptance must never create an 11th active sponsored student.

If an invitation is accepted after all sponsored seats have filled, the coaching relationship becomes ACTIVE but no COACH_SPONSORED grant is created. The player is told that the coaching relationship is active but the coach currently has no sponsored seat available. If the player already has SELF_PAID or PROMOTIONAL entitlement, play continues through that grant; otherwise the player has historical-only access until another valid entitlement becomes available.

When a sponsored seat later becomes available, the coach may assign sponsorship to that ACTIVE student, consuming the seat atomically at assignment time. The coaching relationship itself does not transition because of sponsorship availability.

A released seat becomes available for another student.

Reassignment changes entitlement; it does not transfer player data.

## 10. Invitation Flow

Recommended V1:

```text
Coach
  |
  +-- Invite Student
          |
          +-- Existing Jetta player
          |      +-- Sign in
          |      +-- Review invitation
          |      +-- Accept
          |
          +-- New golfer
                 +-- Create permanent Jetta identity
                 +-- Review invitation
                 +-- Accept
                         |
                         +-- relationship ACTIVE
                         +-- seat ACTIVE
                         +-- COACH_SPONSORED entitlement ACTIVE
```

A Coach invitation must never create a disposable player identity owned by the coach.

Acceptance is subject to §9 sponsored-seat capacity. Every V1 invitation is a sponsorship invitation: acceptance creates an ACTIVE coaching relationship and, when a sponsored seat is available, the COACH_SPONSORED grant. This remains true when the player already holds SELF_PAID; dual grants are permitted.

If capacity disappears before acceptance because of a concurrent action, the relationship still becomes ACTIVE but sponsorship is not granted. Sponsorship may be assigned later when a seat becomes available. Relationship-only invitations remain a possible future enhancement, not a V1 requirement.

## 11. Releasing a Student

Use language such as:

> **Release Student Seat**

Avoid:

> Suspend Account

### Release Student Seat

Ends sponsorship and play entitlement. Does not end the coaching relationship or its visibility.

When a coach releases a sponsored player:

1. Release the seat assignment.
2. Remove that coach-sponsored entitlement.
3. Return the seat to the coach's available capacity.
4. Preserve the permanent player identity.
5. Preserve all historical player data.
6. Preserve historical coach/student relationship records.
7. Recalculate whether the player has another valid entitlement (SELF_PAID, PROMOTIONAL, or another coach seat).

If no other entitlement exists, the player enters historical-only access. The player cannot START any new entitled activity — no new rounds, no new Academy lessons, no new matches. Activity already in progress is never interrupted.

### End Coaching Relationship

A separate, explicit action. Ends the coaching relationship and the coach's visibility into the player's data (subject to the privacy defaults in §17). Ending the relationship also releases any active seat.

Releasing a seat must not imply ending the relationship. These are two distinct actions with distinct UI; do not merge them.

### Released but Still Coached

A player may remain an ACTIVE coaching student after the coach releases sponsorship.

Examples:

```text
David
Coaching Relationship: ACTIVE
Entitlement: COACH_SPONSORED
Consumes Sponsored Seat: Yes
```

```text
Jennifer
Coaching Relationship: ACTIVE
Entitlement: SELF_PAID
Consumes Sponsored Seat: No
```

```text
Michael
Coaching Relationship: ACTIVE
Entitlement: NONE
Play Access: Historical Only
Consumes Sponsored Seat: No
```

The player remains in the coach's coaching roster until either party explicitly ends the coaching relationship. Releasing sponsorship changes who funds play access; it does not by itself terminate coaching.

Therefore a coach may have more than 10 active coaching relationships. The Coach subscription may sponsor at most 10 active students at one time.

## 12. Historical-Only Access

A player with `NONE` entitlement may still sign in.

They may access permitted historical information, including their existing profile, previous rounds, GPS records, Replays, Learning Reports, and learning history.

They cannot create new entitled play activity.

Suggested UI:

```text
Your Jetta history is still here.

Your sponsored playing access has ended.
You can continue reviewing your previous rounds and learning history.

To play new rounds:
[Get Individual Access]
[Accept Coach Invitation]

[View My History]
```

Do not enforce missing entitlement by deleting the account or preventing authentication.

### Brand-New Free Account With No Entitlement

Creating a Jetta identity and signing in are free. A brand-new player who has never had an entitlement may complete basic account/profile setup and access non-play onboarding/help surfaces, but cannot start an entitled activity.

```text
Welcome to Jetta

Your account is ready.

To start playing:
[Get Jetta Individual — $29/month]
[Accept Coach Invitation]

[Complete Player Profile]
[Learn How Jetta Works]
```

Codex must audit every route that can create a new round, GPS recording, Academy lesson, or match so a free account cannot bypass entitlement enforcement through an alternate entry point.

## 13. Released Player Buying Individual Access

Example:

```text
BEFORE

Current Coach: None
Entitlement: NONE
Play Access: Historical Only
```

The player subscribes to Jetta Individual:

```text
AFTER

Current Coach: None
Entitlement: SELF_PAID
Play Access: Active
```

No account migration or historical-data copy is necessary.

## 14. Self-Paid Player Joining a Coach

An existing Individual subscriber may accept a Coach invitation without changing identity or losing history.

A valid state is:

```text
Current Coach: Susan
Entitlement: SELF_PAID
```

There is no entitlement "transition" to build. The player simply holds two valid grants at once:

```text
Current Coach: Susan
Valid grants: SELF_PAID, COACH_SPONSORED (sponsor: Susan)
Derived play access: Active
```

Do not silently cancel an Individual subscription when the player accepts a Coach invitation.

Billing changes must be explicit.

If the player already pays $29/month and accepts a coach invitation, keep the Individual subscription exactly as-is — do not cancel, pause, or refund it automatically. The coach seat becomes a fallback entitlement: if the player's self-paid subscription later lapses, the active coach seat supplies play entitlement automatically, so there is no gap. If the player wants to stop paying $29, they cancel it themselves through normal billing.

The sponsored seat is consumed even though the player also holds SELF_PAID. Jetta does not prohibit or collapse dual grants.

## 15. Changing Coaches

Example:

```text
January-June
Coach: Susan
Entitlement: Susan's Coach seat

July
Susan releases sponsored seat
Entitlement: NONE
Coaching relationship: still ACTIVE (released but still coached)
Historical access remains

August
Player accepts Michael's invitation
Coach: Michael
Entitlement: Michael's Coach seat
```

The player's permanent identity and historical learning record remain continuous.

Do not rewrite old rounds to make them appear associated with the new coach.

V1 rule: a player may have at most one ACTIVE coaching relationship at a time. This rule is independent of sponsorship: the active coach may sponsor the player, or the player may be SELF_PAID or historical-only.

Accepting a coaching relationship with a new coach while one is active requires explicitly ending the current relationship first. The invitation UI must present this choice to the player — the player decides which coach to accept.

## 16. Coach Subscription Cancellation or Billing Failure

Cancellation, expiration, or billing failure must never delete sponsored players.

Business rule: a **30-day grace period**.

This is an intentional customer-experience policy, not merely a payment-retry detail. Jetta favors continuity of coaching and play over aggressive access termination. A temporary billing or administrative problem should not unexpectedly disrupt one coach and as many as 10 students.

On cancellation, expiration, or billing failure, the Coach subscription enters `PAST_DUE` and all sponsored entitlements — including the coach's own play — remain fully valid for 30 days. Do not progressively degrade gameplay features during the grace period. A PAST_DUE coach cannot send new sponsorship invitations until the subscription is restored.

Coach-facing messaging should clearly explain the billing problem, grace deadline, and resolution path. Student-facing messaging should be calm and emphasize that access is continuing and no immediate action is required.

Near the end of the grace period, Jetta may offer affected students the option to continue with Jetta Individual if the Coach subscription is not restored.

After the 30-day grace period without resolution:

- the Coach subscription no longer supplies COACH_SELF or COACH_SPONSORED play access;
- active sponsored seat grants are deactivated/released according to the implementation model;
- **coaching relationships remain ACTIVE** and are not ended merely because sponsorship expired;
- SELF_PAID and unexpired PROMOTIONAL students continue playing through their own valid entitlement;
- students with no other valid entitlement enter historical-only access;
- players can purchase Individual access;
- players may explicitly end the coaching relationship and later accept another Coach invitation;
- historical relationship and sponsorship records remain intact.

If the Coach subscription is restored later, sponsorship is not assumed to rewrite history. The implementation should restore or reassign sponsored seats according to explicit, auditable rules while preserving the continuous coaching relationships.

Keep the 30-day duration configurable in code rather than hard-coded across call sites.

**Continuity principle:** Never punish the golfer for an administrative event. Preserve identity, preserve history, preserve any activity already in progress, and provide a generous transition when entitlement changes.

## 17. Privacy and Coach Visibility

Seat sponsorship is not ownership of player data.

Coach visibility should be based on the active coaching relationship and explicit product privacy rules.

The system should define access to:

- shared rounds
- GPS Replay
- Round Review
- Learning Reports
- relevant Player Profile information
- Learning Focus
- learning patterns
- other coaching evidence

A separate privacy specification should establish whether all rounds created during an active relationship are shared by default or whether players can control sharing per round. Do not hard-code active coaching relationship as permanent unrestricted access to every future round in a way that prevents later per-round privacy controls.

Do not assume sponsorship grants permanent unrestricted access to all player data.

Default for pre-relationship history: a coach sees only rounds played during an active coaching relationship, plus rounds the player explicitly shares. Rounds played before the relationship started are not visible to a new coach.

## 18. Coach-First Learning Loop

The entitlement model should enable this product loop:

```text
Coach invites / sponsors student
        |
        v
Coach assigns Learning Focus
        |
        v
Student sees focus before play
        |
        v
Student plays
        |
        v
On-Course GPS captures evidence
        |
        v
Replay / Round Review
        |
        v
Coach reviews real-round evidence
        |
        v
Coach provides instruction
        |
        v
Learning Focus / Academy practice
        |
        v
Next round
```

Subscription management exists to enable this loop, not to become a separate CRM product.

## 19. Coach Professional Revenue

Jetta does not dictate what a coach charges a student.

The $49 Coach subscription provides infrastructure supporting the coach's professional service.

A coach might incorporate Jetta into:

- recurring coaching programs
- lesson packages
- remote round review
- strategy coaching
- course-management coaching
- monthly student programs

Coach-to-student professional fees are outside Jetta V1.

Explicit V1 non-goals:

- coach-to-student billing
- marketplace payments
- coach payouts
- Jetta revenue sharing
- seat resale pricing
- marketplace commissions

## 20. Informal Seat Sharing

Jetta does not need to aggressively prevent informal groups from using a Coach subscription in V1.

Growing genuine player adoption, repeated use, round evidence, and engagement is more important than preventing theoretical price arbitrage at this stage.

Do not add unnecessary Coach-verification gates or anti-sharing enforcement solely to prevent groups of golfers from occupying seats.

Measure actual behavior rather than labeling or policing users.

Useful analytics include:

- paying Coach subscriptions
- seats activated per subscription
- unique sponsored players
- rounds per sponsored player
- GPS rounds
- Replay usage
- coach review activity
- Learning Focus assignments
- repeat rounds
- student retention
- Coach retention
- sponsored-to-self-paid conversion
- self-paid players joining coaches

## 21. Server-Side Authorization

The browser must not be trusted to declare:

- `player_id`
- `coach_id`
- entitlement owner
- subscription status
- seat status
- relationship status

Resolve the authenticated Supabase identity to the authoritative Jetta user/player record.

Centralize entitlement checks.

Conceptually:

```text
can_start_new_play(player_id)

valid_grants = resolve_valid_entitlement_grants(player_id)

if valid_grants contains SELF_PAID:
    ALLOW

if valid_grants contains PROMOTIONAL
        backed by an active, unexpired access-code subscription:
    ALLOW

if valid_grants contains COACH_SPONSORED
        backed by active seat
        and valid Coach subscription (including 30-day grace):
    ALLOW

if valid_grants contains COACH_SELF
        backed by valid Coach subscription (including 30-day grace):
    ALLOW

if no valid grant remains:
    DENY NEW PLAY
    ALLOW PERMITTED HISTORICAL ACCESS
```

Check entitlement when new play starts. Never revoke or interrupt an activity already in progress.

Do not independently reimplement this rule differently in each game mode.

## 22. Historical Integrity

Changes in subscription, Coach, or entitlement must not reinterpret historical evidence.

Where relevant, preserve the relationship/context that existed when an event occurred.

Historical records may need references or immutable snapshots for:

- Coach relationship
- Learning Focus
- assessment version
- player evidence
- round context

A new Coach must not automatically become the Coach associated with old rounds.

## 23. Critical Invariants

1. A Jetta player identity is permanent unless handled through the separate user-requested account-deletion policy.
2. Releasing a Coach seat never deletes player history.
3. A Coach does not own a student's Jetta identity.
4. Authentication does not imply play entitlement.
5. Coach relationship does not imply Coach-sponsored entitlement.
6. Self-paid entitlement does not require a Coach.
7. A player without entitlement can still authenticate and review permitted historical data.
8. A Coach seat can be released and reassigned.
9. Historical Coach relationships remain available.
10. Historical rounds retain their original relationship/evidence context.
11. Entitlement enforcement occurs server-side.
12. A browser cannot grant itself entitlement.
13. Billing transitions cannot silently destroy or transfer player data.
14. Accepting a Coach invitation cannot silently cancel Individual billing.
15. Coach billing failure cannot cascade-delete students.
16. The $49 Coach subscription includes the holder's own play entitlement: 10 student seats plus the coach's own play (11 total).
17. Entitlement is checked when new play starts; in-progress activity is never interrupted.
18. Coach billing failure grants a 30-day grace period before sponsored entitlements deactivate.
19. Release Student Seat ends sponsorship only; End Coaching Relationship is a separate action.
20. V1 allows one active coach per player.
21. A coach cannot see rounds played before the relationship started, unless the player shares them.
22. Pending invitations do not consume active-seat capacity; seat availability is visible to the coach only, the coach cannot invite when all 10 seats are occupied, and capacity is checked atomically at acceptance.
23. Accepting a coach invitation never auto-cancels a player's $29 Individual subscription; a valid coach-sponsored grant can provide fallback access if self-paid access later lapses.
24. `NONE` is a derived play-access state when no valid entitlement grant exists; it need not be stored as an entitlement record.
25. Any valid entitlement grant is sufficient for authorization; entitlement types are not a global authorization precedence hierarchy.
26. Jetta favors continuity over aggressive termination: administrative or billing events preserve identity, history, and in-progress activity.
27. A PAST_DUE coach cannot send new sponsorship invitations.
28. The 10-seat Coach limit applies to COACH_SPONSORED students, not total coaching relationships.
29. A coach may coach more than 10 players when additional students provide their own entitlement.
30. Releasing sponsorship does not remove the player from the coaching roster; the coaching relationship remains ACTIVE until explicitly ended.
31. Every accepted sponsorship invitation consumes one sponsored seat, even when the student also holds SELF_PAID or PROMOTIONAL access; multiple grants are permitted and normal.
32. If sponsored capacity disappears before invitation acceptance, acceptance creates an ACTIVE coaching relationship but no sponsored grant; sponsorship may be assigned later when capacity becomes available.
33. Coaching relationship state does not become inactive merely because sponsorship is unavailable or expires.
34. Expiration of the Coach billing grace period ends/deactivates sponsored access but does not automatically end ACTIVE coaching relationships.
35. An access code creates server-authoritative subscription state; it is never a client-side authorization bypass.
36. Access-code Individual access is PROMOTIONAL, not falsely labeled SELF_PAID.
37. Access-code access never silently converts into paid Stripe billing or charges a stored payment method.
38. Stripe integration updates the same provider-neutral subscription model and entitlement resolver used by access codes.
39. A checkout return page cannot grant entitlement; only authoritative server processing may activate a paid subscription.

## 24. Recommended Player UI

Coach-sponsored:

```text
Jetta Access
Active — Coach Sponsored

Current Coach
Susan Smith

Your Access
Provided by your Coach
```

Self-paid:

```text
Jetta Access
Active — Individual

Current Coach
None

Your Plan
Jetta Individual — $29/month
```

No active entitlement:

```text
Jetta Access
Historical Access

Current Coach
None

Your Plan
No active play entitlement

[Get Individual Access]
[Accept Coach Invitation]
```

Promotional access:

```text
Jetta Access
Active — Promotional Access

Your Access
Jetta Access Code — available through <date>

[Choose a Plan]
```

## 25. Recommended Coach Dashboard

Keep V1 small:

```text
Jetta Coach

Coaching Students: 12
Sponsored Students: 7 / 10
Sponsored Seats Available: 3

David       Sponsored     New round available        [Review]
Jennifer    Self-Paid     Learning Focus active       [View]
Michael     Historical    Last played Sep 26          [View]

[Invite Student]
```

The coaching roster is not capped at 10. The `Sponsored Students: 7 / 10` count represents only students whose play entitlement is supplied by the Coach subscription. Additional students may remain ACTIVE coaching relationships while using SELF_PAID, PROMOTIONAL, or historical-only access.

Student management should provide an explicit **Release Student Seat** action for sponsored students and a separate **End Coaching Relationship** action.

## 26. Implementation Phases

### Phase 0 — Repository Audit

Before coding, inspect the existing repository and report:

- current player/Supabase identity mapping;
- existing role concepts;
- existing authorization;
- subscription or billing code, if any;
- game-start APIs and client paths;
- current round/player ownership;
- assumptions where authentication currently grants gameplay automatically;
- every route capable of starting a new round, GPS recording, Academy lesson, or match;
- whether the existing schema can represent entitlement grants without persisting synthetic `NONE` records;
- existing coach/student linkage (coach accounts already support up to 10 students) — determine whether the current limit represents total relationships or sponsored seats, then reconcile it with this specification's rule that 10 is a sponsorship limit, not a coaching-roster limit; do not layer a parallel system.

Do not implement this specification blindly over existing concepts.

### Phase 1 — Roles

Normalize support for PLAYER, COACH, and ADMIN while preserving existing identities.

### Phase 2 — Entitlement Layer

Introduce centralized SELF_PAID / PROMOTIONAL / COACH_SPONSORED / COACH_SELF entitlement grants, with `NONE` derived when no valid grant exists.

### Phase 2A — Access-Code Pilot

Implement protected access-code creation, hashed storage, atomic redemption, audit history, expiration, and revocation. Access-code redemption must use the provider-neutral subscription service and centralized entitlement resolver. Keep public paid checkout disabled until Stripe is ready.

Before entitlement enforcement is enabled, inventory every existing player who should retain play access and provision an explicit access-code subscription or other approved entitlement. Run the resolver in shadow mode first, compare its decisions with current access, and resolve mismatches before blocking new play. Do not infer paid or promotional status merely from the existence of an account.

### Phase 3 — Coach Subscription and Seats

Implement Coach subscription state, 10-sponsored-seat capacity, sponsorship invitation, activation, release, and reassignment. Do not impose the 10-seat sponsorship limit on total coaching relationships.

### Phase 4 — Coach/Student Relationships

Persist coaching relationship history independently from seat assignments. Support ACTIVE non-sponsored students, including SELF_PAID and historical-only players. Do not introduce a relationship state whose only purpose is to represent missing sponsored-seat capacity.

### Phase 5 — Play Authorization

Require valid entitlement before starting new entitled activities while retaining historical read access.

### Phase 6 — Player Access UI

Show current Coach, entitlement source, access status, Individual subscription option, and invitation handling.

### Phase 7 — Coach Dashboard

Implement the minimal roster, activity, review, invitation, and seat-release workflow.

### Phase 8 — Learning Loop

Connect the relationship model to Learning Focus, GPS Replay, Round Review, and Academy where appropriate.

### Future Phase — Stripe Billing Adapter

Add Stripe checkout, customer portal, signed idempotent webhook handling, and provider-ID storage without changing Coach relationships, seats, historical ownership, activity authorization, or entitlement-resolution rules.

## 27. Required Tests

At minimum verify:

### Identity and History

- releasing a seat does not delete the player;
- releasing a seat does not delete rounds;
- releasing a seat does not delete GPS evidence;
- releasing a seat does not delete Replay/report history.

### Seats

- Coach can assign an available sponsored seat;
- initial Coach plan cannot exceed 10 active sponsored seats;
- coach may have more than 10 active coaching relationships when additional students are SELF_PAID;
- coach with 10 sponsored students can maintain or establish a coaching relationship with a SELF_PAID student without consuming an 11th sponsored seat;
- released sponsored seat becomes available;
- reassignment does not transfer the previous player's data;
- coach's own play works on the Coach subscription without an Individual plan;
- pending invitation does not consume one of the 10 active student seats;
- coach cannot send new sponsorship invitations when all 10 sponsored seats are occupied;
- invitation to an already SELF_PAID player still consumes a sponsored seat;
- full sponsorship capacity does not terminate or prohibit non-sponsored coaching relationships;
- sponsored-seat availability is never shown to players;
- accepting an invitation checks seat capacity atomically;
- concurrent invitation acceptance cannot create an 11th active sponsored student;
- cancelled invitation is removed from the pending invitation list.

### Entitlement

- SELF_PAID player can start new play;
- valid COACH_SPONSORED player can start new play;
- valid COACH_SELF (coach's own play) can start new play;
- `NONE` player cannot start new entitled play;
- `NONE` player can authenticate;
- `NONE` player can access permitted history;
- entitlement change never interrupts an activity already in progress;
- self-paid player accepting an invitation keeps $29 billing; coach seat acts as fallback when self-paid lapses;
- dual SELF_PAID + COACH_SPONSORED grants are both valid and permitted.

### Relationships

- ending sponsorship preserves historical relationship;
- a new Coach does not overwrite prior Coach history;
- releasing a seat does not end the coaching relationship;
- released-but-still-coached player remains in the coach's roster;
- released SELF_PAID student consumes no sponsored seat;
- released historical-only student consumes no sponsored seat;
- ending the relationship releases any active sponsored seat;
- player cannot hold two ACTIVE coaching relationships;
- invitation accepted after sponsored capacity disappears creates an ACTIVE relationship with no sponsored grant;
- an ACTIVE non-sponsored relationship may later receive sponsorship when a seat frees, consuming the seat atomically;
- lack of sponsored capacity does not change an ACTIVE relationship to another relationship state;
- new coach cannot see rounds played before the relationship started.

### Billing Transitions

- Individual access works without a Coach;
- Coach invitation does not silently cancel Individual billing;
- Coach cancellation does not delete students;
- Coach billing failure does not delete students;
- Coach billing failure keeps students (and coach) playing for 30 days;
- PAST_DUE coach cannot send new sponsorship invitations;
- after the 30-day grace period, sponsored grants stop supplying play access;
- after the 30-day grace period, ACTIVE coaching relationships remain ACTIVE;
- SELF_PAID students continue playing after Coach sponsorship expires;
- students without another valid grant move to historical-only access.

### Access Codes and Provider Migration

- access codes are stored as hashes rather than recoverable plaintext;
- invalid, expired, exhausted, cancelled, or revoked codes cannot activate access;
- redemption is atomic and concurrent redemption cannot exceed the configured limit;
- one player cannot redeem the same code twice;
- Individual access-code redemption creates PROMOTIONAL rather than SELF_PAID entitlement;
- Coach access-code redemption creates an ACCESS_CODE-backed Coach subscription with COACH_SELF access and sponsored-seat capacity;
- code expiration prevents new play but does not interrupt an activity already in progress;
- code expiration preserves authentication and historical access;
- code-based access never creates an automatic Stripe charge;
- adding a Stripe subscription does not copy or replace player identity or history;
- verified Stripe webhook processing and access-code redemption produce equivalent internal subscription-state transitions;
- duplicate Stripe webhook delivery is idempotent;
- an unverified webhook or checkout-return request cannot grant entitlement;
- application authorization does not branch directly on `billing_provider`.

### Authorization

- client cannot spoof `player_id`;
- client cannot spoof `coach_id`;
- client cannot manufacture entitlement;
- Coach cannot manage another Coach's seats.

## 28. V1 Non-Goals

Do not expand this work into:

- full coaching CRM
- lesson scheduling
- coach accounting
- coach/student payment processing
- Coach marketplace
- commissions
- sophisticated Coach verification
- anti-seat-sharing enforcement
- social networking
- facility/organization hierarchy

Prove the Coach/student learning loop first.

## 29. Preferred Product Language

Use:

- **Jetta Individual**
- **Jetta Coach**
- **Active Student**
- **Student Seat**
- **Coach Sponsored**
- **Individual Access**
- **Play Entitlement**
- **Release Student Seat**
- **Historical Access**
- **Current Coach**

Avoid:

- Coach owns player
- Coach owns account
- delete student
- suspend student account
- reseller seat
- wholesale account
- concurrent player account

## 30. Definition of Success

The model should support this lifecycle without moving, copying, or destroying the player's identity:

```text
Golfer creates permanent Jetta account
        |
        v
Coach invites golfer
        |
        v
Golfer accepts
        |
        v
Coach seat supplies play entitlement
        |
        v
Golfer plays and builds history
        |
        v
Coach reviews and coaches
        |
        v
Coach releases seat
        |
        v
Golfer retains identity + history
        |
        +-- Historical access only
        |
        +-- OR buys $29 Individual
        |
        +-- OR accepts another Coach invitation
```

The permanent player account owns the continuous learning history.

The entitlement determines whether new play is allowed.

The Coach relationship determines the coaching relationship and associated permissions.

The seat connects a Coach subscription to a sponsored player's entitlement.

These concepts must remain separate in the data model and authorization model.

---

## 31. V7 Freeze Summary

This V7 document is the **domain-model freeze candidate**.

The intended stable model is:

```text
IDENTITY
Permanent

COACHING RELATIONSHIP
INVITED -> ACTIVE -> ENDED

SPONSORED SEAT
INVITED -> ACTIVE -> RELEASED / CANCELLED

ENTITLEMENT GRANTS
SELF_PAID
PROMOTIONAL
COACH_SPONSORED
COACH_SELF

NO VALID GRANT
Derived play access = NONE
Historical access remains

JETTA COACH
$49/month
Coach's own play included
Up to 10 simultaneously sponsored students
Coaching relationships beyond 10 are permitted

JETTA INDIVIDUAL
$29/month
Self-funded play entitlement

INTERIM ACCESS CODES
Provider-neutral pilot activation
PROMOTIONAL Individual access or ACCESS_CODE-backed Coach subscription
No payment method and no automatic Stripe conversion

FUTURE STRIPE INTEGRATION
Billing adapter updates the same subscription states
Verified idempotent webhooks are authoritative
No entitlement logic rewrite

COACH BILLING FAILURE
30-day grace
Existing play continues during grace
In-progress activity is never interrupted
After grace, sponsorship may end but coaching relationships remain
```

Do not expand the domain model further before the Phase 0 repository audit unless the audit reveals a concrete incompatibility, migration risk, or missing invariant.

---

# Instructions to Codex

**For the next Codex pass, perform Phase 0 only. Do not implement schema migrations, billing integration, authorization changes, or UI changes yet.**

Before implementation:

1. Inspect the current Jetta repository.
2. Identify existing identity, role, authorization, subscription, and player-ownership code.
3. Compare the repository against this specification.
4. Identify conflicts, migration risks, and reusable components.
5. Propose the smallest compatible schema changes.
6. Identify every game-start path that eventually requires entitlement enforcement.
7. Identify historical/read-only paths that must remain accessible without entitlement.
8. Report findings before broad implementation.

Do not create a second authentication system.

Do not replace Supabase Auth.

Do not duplicate Jetta's existing permanent player identity.

Do not couple Coach relationships directly to player ownership.

Do not implement a payment provider until the entitlement/domain model has been reviewed.

Prefer small, testable phases and clean commit boundaries.
