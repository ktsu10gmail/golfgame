# Jetta Paid Access Codes, Coach Sponsorship & Onboarding --- Codex Specification

**Status:** Product/domain rule clarification\
**Product:** Jetta\
**Primary application:** `https://golfgame.jetta.com`\
**Back Office:** `https://golfgame.jetta.com/admin/`

## 1. Core Rule

A direct paid Jetta subscription receives an **automatically generated
Access Code** as part of the payment-complete onboarding flow.

A **Coach-sponsored student does not receive or need an Individual
Access Code**.

Manual Access Code generation in Back Office is reserved primarily for
support, recovery, replacement, promotional/pilot, testing, and other
exceptional administrative situations.

Identity, subscription, entitlement, coaching relationship, and
sponsored seat remain separate concepts.

## 2. Three Onboarding Paths

### Paid Coach

``` text
Coach purchases $49/month subscription
→ trusted payment confirmation
→ Jetta automatically generates Coach Access Code
→ setup email includes Coach Access Code
→ Coach creates/signs into Jetta
→ Player Profile → Jetta Access
→ enter code → Activate
→ Coach access active
→ Player Profile → Coach Dashboard
```

The setup email must explain where to go. It should tell the Coach:

1.  Sign in or create a Jetta account.
2.  Open **Player Profile**.
3.  Find **Jetta Access**.
4.  Enter the Coach Access Code and select **Activate**.
5.  Return to **Player Profile** and open **Coach Dashboard**.
6.  Use Coach Dashboard to invite students, manage sponsored seats, and
    review students.

The Coach subscription includes the Coach's own Jetta access plus Jetta
access for up to 10 sponsored students.

### Paid Individual Golfer

``` text
Golfer purchases $29/month subscription
→ trusted payment confirmation
→ Jetta automatically generates Individual Access Code
→ setup email includes Individual Access Code
→ Golfer creates/signs into Jetta
→ Player Profile → Jetta Access
→ enter code → Activate
→ Individual access active
```

The normal paid customer should not depend on a Jetta administrator
manually creating their first code.

### Coach-Sponsored Student

``` text
Coach opens Player Profile → Coach Dashboard
→ invites student by email
→ Jetta sends invitation email
→ student creates/signs into Jetta
→ student opens Player Profile
→ accepts Coach invitation
→ ACTIVE coaching relationship
→ sponsored seat assigned if capacity exists
→ COACH_SPONSORED entitlement
```

**No Individual Access Code is generated or required for the
Coach-sponsored student.**

## 3. Coach Setup Email

The Coach payment-complete/setup email should contain:

-   confirmation of successful Coach subscription;
-   Coach Access Code;
-   sign-in/account-creation instructions;
-   explicit navigation to **Player Profile → Jetta Access**;
-   activation instructions;
-   explicit navigation to **Player Profile → Coach Dashboard**;
-   short explanation of inviting students;
-   reminder of the 10 sponsored-seat capacity.

Example:

``` text
Your Jetta Coach access is ready.

1. Sign in to Jetta or create your Jetta account.
2. Open Player Profile.
3. Find Jetta Access.
4. Enter the Coach Access Code below and select Activate.
5. Return to Player Profile and open Coach Dashboard.

Coach Access Code:
JETTA-XXXXXXXX

From Coach Dashboard, invite students by email,
manage sponsored seats, and review your students.

Your Coach subscription includes your own Jetta access
and Jetta access for up to 10 sponsored students.
```

## 4. Individual Setup Email

The Individual payment-complete/setup email should teach:

``` text
Your Jetta access is ready.

1. Sign in to Jetta or create your Jetta account.
2. Open Player Profile.
3. Find Jetta Access.
4. Enter the Individual Access Code below.
5. Select Activate.

Individual Access Code:
JETTA-XXXXXXXX
```

## 5. Student Invitation Email

The Coach-sponsored student invitation email should teach:

``` text
Your Coach has invited you to Jetta.

1. Select Join Jetta.
2. Sign in, or create your Jetta account if you're new.
3. Open Player Profile.
4. Find Coach Invitation.
5. Select Accept Invitation.

If your Coach is sponsoring your Jetta access,
you do not need a separate Jetta Access Code.
```

A sponsored student must not be asked to purchase Individual access,
obtain an Individual code from the Coach/Jetta, or redeem another code
after accepting valid sponsorship.

## 6. Student Who Pays Independently

A student may have an ACTIVE Coach relationship while paying for their
own \$29 Jetta subscription.

If they directly purchase Individual access, Jetta automatically
generates and emails their Individual Access Code.

If the same student also receives Coach sponsorship, multiple grants are
allowed. Do not automatically cancel, pause, refund, or modify SELF_PAID
when sponsorship is accepted.

## 7. Manual Access Code Generation

Back Office retains manual Access Code generation, but this is **not the
normal paid onboarding workflow**.

Typical manual cases:

-   access/support problem requiring a new or replacement code;
-   recovery from onboarding failure;
-   administrator-authorized replacement;
-   pilot access;
-   promotional/complimentary access;
-   testing;
-   exceptional manual provisioning.

``` text
NORMAL PAID CUSTOMER

Payment
→ automatic code generation
→ setup email
→ Player Profile activation


SUPPORT / EXCEPTION

Jetta Back Office
→ Admin investigates account/access
→ manually generates replacement code when appropriate
→ customer activates from Player Profile
```

## 8. Replacement Codes

For a legitimate access issue:

``` text
golfgame.jetta.com/admin/
→ Access & Licensing
→ investigate user/access
→ Generate Access Code when required
```

Before issuing a replacement, Back Office should allow the administrator
to inspect the player's account, subscription, entitlement, previous
code/redemption state, enforcement/runtime result, and relevant audit
history.

Replacement/revocation remains auditable. Never delete player
identity/history to resolve an access problem.

## 9. Access Code Security

Automatic paid-code issuance must reuse the authoritative existing
Access Code service.

Preserve:

-   cryptographically random `JETTA-...` codes;
-   plan/type stored server-side;
-   secure hash storage;
-   plaintext only when legitimately generated/delivered;
-   atomic redemption;
-   server-side redemption limits;
-   failed-attempt rate limiting;
-   revocation;
-   creation/redemption/revocation audit;
-   visible code editing cannot alter plan/duration.

Do not create a second Access Code implementation for billing.

## 10. Payment Integration Rule

When billing is implemented:

``` text
Payment provider confirms successful subscription
→ Jetta validates trusted server-side payment event
→ Jetta creates/updates subscription
→ Jetta automatically generates correct Access Code
→ Jetta sends payment-complete/setup email
→ customer activates code in Player Profile
```

Do not trust the browser to claim payment succeeded.

The trusted payment-provider server confirmation/webhook is
authoritative.

Automatic issuance must be idempotent so duplicate webhook processing
cannot create unintended duplicate Access Codes.

Exact billing/webhook implementation belongs in the future billing
specification.

## 11. Player Profile Is the Navigation Anchor

Use the exact term **Player Profile** consistently in:

-   Coach setup email;
-   Individual setup email;
-   student invitation email;
-   product onboarding;
-   help text;
-   documentation.

Avoid switching between `Account`, `Player Account`, `Profile`, and
`Player Profile` for the same screen.

Teach these paths:

``` text
Coach:
Player Profile → Jetta Access → Activate
Player Profile → Coach Dashboard → Invite Student

Student:
Player Profile → Coach Invitation → Accept

Individual:
Player Profile → Jetta Access → Activate
```

## 12. Player Profile Access Guidance

User-facing copy should explain what the person can do rather than
requiring knowledge of internal entitlement names.

### Coach

``` text
YOUR JETTA ACCESS

Active

Coach Access
Your Coach access includes your own Jetta play
and up to 10 sponsored student seats.

Manage students, invitations, sponsored seats,
and student rounds from Coach Dashboard.

[ Open Coach Dashboard ]
```

### Coach-sponsored student

``` text
YOUR JETTA ACCESS

Active

Provided by Your Coach
Your Coach currently provides your Jetta access.

You do not need a Jetta Access Code while your
Coach sponsorship remains active.
```

### Historical access

``` text
YOUR JETTA ACCESS

Historical Access

You can still view your saved Jetta history.

To start new entitled activities when licensing
enforcement is enabled, activate valid Jetta access
or accept a sponsored Coach invitation.
```

Avoid redundant displays such as `Active` and `ACTIVE` representing the
same status.

## 13. Coach Dashboard Guidance

Coach Dashboard should briefly teach the workflow:

``` text
Getting your students started

1. Open Player Profile and select Coach Dashboard.
2. Enter your student's email and send the invitation.
3. Jetta emails the student. New students create an account first.
4. The student opens Player Profile and accepts your Coach invitation.
5. After acceptance, the student appears in Coach Dashboard
   and can use a sponsored Jetta seat when sponsorship is assigned.

Invitations do not use a sponsored seat until the student accepts
and sponsorship is assigned.
```

Use user-facing terms: student, invitation, Jetta access, sponsored
seat, Player Profile, Coach Dashboard.

Do not make Coaches learn internal grant terminology.

## 14. Domain Rules That Do Not Change

Preserve the existing licensing model:

-   permanent player identity/history;
-   entitlement separate from identity;
-   Coach relationship separate from entitlement;
-   sponsored seat separate from relationship;
-   10 is sponsorship capacity, not total roster capacity;
-   pending invitations consume no active seat;
-   capacity checked atomically at acceptance;
-   never create seat 11;
-   SELF_PAID and COACH_SPONSORED may coexist;
-   accepting sponsorship never cancels SELF_PAID;
-   releasing sponsorship never deletes identity/history;
-   releasing sponsorship does not automatically end coaching;
-   ending coaching releases sponsorship;
-   30-day Coach billing grace remains unchanged;
-   entitlement changes do not interrupt already-authorized activity;
-   no `INACTIVE` coaching relationship state.

## 15. Automatic vs Manual Summary

  -------------------------------------------------------------------------
  Scenario            Access Code       Generated by      User action
  ------------------- ----------------- ----------------- -----------------
  Coach pays \$49     Coach code        Automatically by  Player Profile →
                                        Jetta after       Jetta Access →
                                        confirmed payment Activate

  Individual pays     Individual code   Automatically by  Player Profile →
  \$29                                  Jetta after       Jetta Access →
                                        confirmed payment Activate

  Coach-sponsored     **None**          None              Player Profile →
  student                                                 Coach Invitation
                                                          → Accept

  Support/recovery    Code when         Jetta Admin       Player Profile →
  replacement         required          manually in Back  Jetta Access →
                                        Office            Activate

  Promotional/pilot   Code when         Admin/approved    Player Profile →
  access              appropriate       provisioning      Jetta Access →
                                                          Activate
  -------------------------------------------------------------------------

## 16. Future Billing Acceptance Criteria

When paid billing is implemented:

1.  trusted successful Coach payment automatically generates the
    intended Coach Access Code;
2.  trusted successful Individual payment automatically generates the
    intended Individual Access Code;
3.  code is included in the appropriate payment-complete/setup email;
4.  email explicitly teaches `Player Profile → Jetta Access`;
5.  Coach email additionally teaches `Player Profile → Coach Dashboard`;
6.  duplicate payment webhook processing cannot create unintended
    duplicate codes;
7.  failed/unconfirmed payment cannot create paid access;
8.  ordinary successful payment does not require manual Back Office code
    generation;
9.  Back Office retains manual generation for support/exception cases;
10. Coach-sponsored student invitation creates no Individual Access
    Code;
11. sponsored student can receive COACH_SPONSORED access by accepting
    the Coach invitation;
12. existing licensing security/audit behavior remains authoritative.

## 17. Current Pilot vs Future Paid Production

### Current pilot

``` text
Jetta Admin manually generates Access Code
→ sends code
→ user activates in Player Profile
```

### Future normal paid production

``` text
Customer completes payment
→ Jetta automatically generates correct Access Code
→ Jetta emails code and setup instructions
→ user activates in Player Profile
```

### Coach-sponsored student

``` text
Coach sends invitation
→ Jetta emails student
→ student creates/signs in
→ Player Profile → accept invitation
→ sponsored access
→ no Individual Access Code
```

## 18. Codex Guidance

Treat this as a product/domain clarification for onboarding, email, and
future billing work.

Do **not** implement payment automation until billing work is explicitly
authorized.

For current onboarding/email work:

-   preserve current pilot Access Code behavior;
-   use **Player Profile** consistently;
-   distinguish Coach setup email from student invitation email;
-   do not require an Individual Access Code for Coach-sponsored
    students;
-   preserve Back Office manual code generation;
-   reuse authoritative licensing services;
-   do not create parallel entitlement or code-generation logic.

When future billing implementation begins, perform a repository audit
first and design automatic Access Code issuance around the existing
licensing and Access Code services.
