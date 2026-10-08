# Jetta Payment System Integration --- Stripe-Ready Codex Specification

**Status:** Phase B architecture specification\
**Product:** Jetta\
**Application:** `https://golfgame.jetta.com`\
**Public website:** `https://www.jetta.com`\
**Back Office:** `https://golfgame.jetta.com/admin/`\
**Planned payment provider:** Stripe\
**Currency:** USD

## 1. Purpose

Define a future Stripe payment architecture that can be added with
minimal disruption to Jetta's existing account, subscription, licensing,
Coach, and entitlement systems.

Core rule:

> **Stripe handles money. Jetta handles product access.**

Stripe must not become Jetta's entitlement authority.

## 2. Initial Architecture Decision

Do **not** create a separate payment server for the initial Stripe
integration.

Integrate Stripe server-side into `golfgame.jetta.com` behind a narrow
billing-service/provider boundary:

``` text
www.jetta.com
Marketing / pricing
       ↓
golfgame.jetta.com
Jetta application
├── Supabase authentication
├── Player accounts
├── Licensing / entitlement
├── Coach / student
├── Billing Service
│      └── Stripe Provider
└── Jetta database
       ↑
       │ signed/trusted events
     Stripe
```

A separate billing service may be extracted later if Jetta grows
materially more complex. V1 should avoid another deployment,
authentication boundary, monitoring surface, and failure point.

Design the boundary so extraction later does not require redesigning
entitlements.

## 3. Ownership Boundary

**Stripe owns:** hosted payment collection, payment methods, Stripe
Customer/Subscription records, recurring charge attempts, invoices,
Stripe Customer Portal, and provider events.

**Jetta owns:** player identity, roles, local subscription
projection/state, entitlement grants, Coach/student relationships,
sponsored seats, Coach grace policy, Student Continuation eligibility,
Access Code behavior, authorization, and audit.

Gameplay authorization must not require a live Stripe API call.

## 4. Billing Service Boundary

Do not scatter Stripe SDK calls throughout `serve.py`, licensing, Player
Profile, Coach Dashboard, or unrelated code.

Create/extend a billing abstraction conceptually like:

``` text
packages/billing/
    service.py
    provider.py
    stripe_provider.py
```

Exact paths follow repository conventions.

Conceptual operations:

``` text
create_subscription_checkout(...)
create_customer_portal_session(...)
process_provider_event(...)
reconcile_subscription(...)
lookup_provider_subscription(...)
```

Stripe-specific objects/signatures stay in the adapter. Licensing
consumes Jetta subscription/grant state.

## 5. Planned Products

``` text
Jetta Coach
$49/month USD

Jetta Individual
$29/month USD

Jetta Student Continuation
$9/month USD
$49/year USD
```

Student Continuation is restricted to server-authoritatively eligible
Coach-sponsored students/former students.

Use configured Stripe Price IDs rather than dollar amounts in
authorization logic.

Conceptual configuration:

``` text
JETTA_STRIPE_COACH_MONTHLY_PRICE_ID
JETTA_STRIPE_INDIVIDUAL_MONTHLY_PRICE_ID
JETTA_STRIPE_STUDENT_MONTHLY_PRICE_ID
JETTA_STRIPE_STUDENT_ANNUAL_PRICE_ID
```

Exact names are implementation decisions.

## 6. Stripe-Hosted Checkout

Prefer Stripe-hosted Checkout for V1 rather than building Jetta
card-entry UI.

Jetta should not directly store card number, CVV, or raw payment
credentials.

``` text
Jetta
→ authenticated/validated checkout request
→ server selects allowed product/Price ID
→ create Stripe Checkout Session
→ browser redirects to Stripe-hosted Checkout
→ customer pays
→ browser may return to Jetta
+
→ Stripe sends signed webhook
```

The browser return/success page is **not** authoritative payment proof.

## 7. Trusted Webhook

Use one dedicated endpoint conceptually:

``` text
POST /api/billing/stripe/webhook
```

Flow:

``` text
Stripe event
→ verify signature
→ validate supported event
→ idempotency check using provider event ID
→ record/process billing event
→ translate to Jetta subscription transition
→ reconcile entitlement
→ audit
```

Never trust browser-supplied payment success, player ID as authority,
Coach ID, eligibility, price, subscription status, or entitlement.

## 8. Existing Billing Event Seam

Codex previously identified an existing `billing_events` idempotency
seam. Audit and reuse it where appropriate.

Do not create a parallel event system unless the existing structure
cannot safely support Stripe.

Provider event processing must tolerate duplicate/retried events.

## 9. Provider Mapping

Jetta will need durable mappings to Stripe, conceptually including some
subset of:

``` text
billing_provider
external_customer_id
external_subscription_id
external_price_id
billing_period
current_period_end
cancel_at_period_end
```

Do not blindly add these exact columns. Audit existing
subscription/billing schema first and add only what is required.

Never use email alone as the durable Stripe-to-Jetta key.

## 10. Ordinary Paid Coach Onboarding

Jetta's settled rule retains Access Codes for ordinary paid Coach
onboarding:

``` text
Coach selects $49/month
→ Jetta creates Stripe Checkout Session
→ Stripe-hosted payment
→ signed webhook confirms trusted payment/subscription
→ Jetta creates/updates Coach subscription
→ Jetta automatically generates Coach Access Code
→ Jetta/SMTP2GO sends setup email with code
→ Coach signs in/creates account
→ Player Profile → Jetta Access
→ Activate
→ Coach access / Coach Dashboard
```

Automatic code issuance must be idempotent. Duplicate webhook delivery
must not create unintended extra codes.

Manual Back Office code generation remains for
support/recovery/exceptions.

## 11. Ordinary Paid Individual Onboarding

``` text
Golfer selects $29/month
→ Stripe Checkout
→ signed webhook
→ Jetta creates/updates paid Individual subscription
→ automatically generates Individual Access Code
→ setup email includes code
→ Player Profile → Jetta Access → Activate
```

Again, automatic issuance must occur once per intended onboarding
purchase/subscription activation.

## 12. Coach-Sponsored Student

Coach-sponsored students need no payment and no Individual Access Code
merely to receive sponsorship:

``` text
Coach Dashboard
→ invite student
→ student creates/signs in
→ Player Profile → accept Coach invitation
→ sponsored seat if capacity exists
→ COACH_SPONSORED
```

Stripe is involved only if that student separately buys an eligible
subscription.

## 13. Student Continuation --- Explicit Access Code Exception

Student Continuation is authenticated and account-bound:

``` text
Authenticated eligible student
→ Player Profile → Jetta Access
→ server verifies continuation eligibility
→ choose $9/month or $49/year
→ server maps choice to allowed Stripe Price ID
→ Stripe Checkout
→ signed webhook
→ Jetta activates SELF_PAID
→ NO Access Code
```

The browser must not prove eligibility through a query parameter,
coupon, player ID, or arbitrary Price ID.

## 14. Continuation Eligibility

Payment does not decide eligibility. Jetta's loyalty/domain system does.

Expected rule:

``` text
Historically active COACH_SPONSORED grant → eligible
Invitation only → not eligible
Coach relationship without sponsorship → not eligible
```

Revalidate eligibility server-side immediately before Checkout Session
creation.

Eligibility is durable. Permanent eligibility does not guarantee today's
price forever.

## 15. Stripe Customer Portal

Prefer Stripe's hosted Customer Portal for supported billing-management
functions rather than building custom Jetta screens for payment-method
changes, invoices, cancellation, etc.

``` text
Player Profile → Manage Subscription
→ authenticated Jetta request
→ server resolves correct Stripe Customer
→ create short-lived portal session
→ redirect to Stripe Customer Portal
```

The browser must not choose an arbitrary Stripe Customer ID.

## 16. Jetta Subscription State Is the Product Boundary

Translate Stripe state/events into the existing Jetta subscription
model.

``` text
Stripe
→ Stripe adapter
→ Jetta Billing Service
→ Jetta subscription state
→ Jetta entitlement resolver
```

Licensing should continue to reason about Jetta states such as `ACTIVE`,
`PAST_DUE`, and `EXPIRED`, not Stripe-specific object states spread
across the app.

## 17. Coach Grace Remains Jetta Policy

Stripe retry/dunning behavior must not silently redefine the settled
Coach policy.

Jetta remains responsible for:

-   30-day Coach grace;
-   continued existing Coach/sponsored access during grace;
-   blocking new sponsorship while `PAST_DUE`;
-   daily Coach notifications;
-   `EXPIRED` transition after Jetta grace;
-   preservation of ACTIVE coaching relationships;
-   explicit re-sponsorship after post-grace restoration.

Stripe supplies billing facts; Jetta applies Jetta access policy.

## 18. Individual/Student Failed Renewal --- Must Be Decided

Do **not** automatically apply the Coach 30-day grace to Individual or
Student Continuation subscriptions.

Before production, explicitly approve:

-   failed renewal state;
-   provider retry window;
-   whether Jetta grants an Individual grace period;
-   when `SELF_PAID` ends;
-   customer messaging;
-   restoration behavior.

Codex must surface these questions rather than invent answers.

## 19. Renewal and Cancellation Contract

Before production, explicitly approve:

-   monthly automatic renewal;
-   annual automatic renewal;
-   cancellation timing;
-   `cancel_at_period_end`;
-   whether immediate cancellation is supported;
-   upgrade/downgrade policy if any;
-   renewal failure;
-   restoration;
-   duplicate subscription prevention;
-   replacement subscription behavior.

## 20. Refunds, Disputes, Chargebacks

Define explicit Jetta behavior for full/partial refunds, disputes,
chargebacks, reversed disputes, and accidental duplicate payment.

Never delete account/history merely because financial state changes.

## 21. Taxes

Tax behavior is a Phase B decision. If Stripe Tax or another mechanism
is adopted, keep tax calculation in the billing layer. Entitlement logic
must not depend on tax implementation.

Do not invent tax/compliance rules in gameplay/licensing code.

## 22. Metadata/Internal References

Stripe metadata/client references may aid reconciliation, conceptually:

``` text
jetta_player_id
jetta_subscription_id
offer_type
offer_version
```

Do not store secrets, Access Codes, authentication tokens, unnecessary
PII, or payment data in metadata.

Resolve and verify referenced Jetta records server-side on webhook
receipt.

## 23. Security

Required:

-   Stripe secret key server-side only;
-   webhook signing secret server-side only;
-   no secret in browser JS;
-   HTTPS;
-   signature verification;
-   idempotent webhook processing;
-   server-side product/Price allowlist;
-   server-side eligibility;
-   authenticated account binding;
-   no browser-authoritative entitlement;
-   no card data in Jetta logs/audit;
-   no Access Code plaintext in normal logs;
-   rate-limit sensitive checkout/portal creation as appropriate;
-   ADMIN-only billing diagnostics.

Never commit Stripe/SMTP secrets to GitHub or expose them in generated
documentation/output.

## 24. Email

Jetta transactional product email stays behind Jetta's application email
abstraction.

SMTP2GO is the preferred application mail provider based on current
direction, using app credentials separate from WordPress and separate
from Supabase Auth SMTP credentials.

``` text
Stripe confirms payment
→ Jetta processes trusted webhook
→ Jetta performs idempotent provisioning
→ Jetta email service / SMTP2GO
→ Jetta setup email
```

Stripe may separately send provider receipts/invoices according to
Stripe configuration.

## 25. Back Office Billing Diagnostics

ADMIN should eventually inspect safe billing state:

-   Jetta subscription ID/state;
-   billing provider;
-   Stripe Customer/Subscription IDs;
-   provider Price ID;
-   current billing period;
-   cancellation-at-period-end status;
-   last relevant billing event;
-   Coach grace/deadline;
-   entitlement diagnostic;
-   Access Code issuance/redemption where applicable;
-   continuation eligibility;
-   webhook/event failures.

Never expose card data, Stripe secret keys, webhook secrets, or raw
payment credentials.

## 26. Suggested API Boundary

Exact routes require audit, but conceptually:

``` text
POST /api/billing/checkout
POST /api/billing/portal
POST /api/billing/stripe/webhook
GET  /api/billing/subscription
```

ADMIN diagnostics remain under centralized `/api/admin/*`.

Prefer one Stripe webhook adapter rather than separate
Coach/Individual/Student webhook endpoints.

## 27. Checkout Request Security

Browser should request an allowed Jetta offer, not an arbitrary
amount/Price ID.

Good:

``` text
offer = STUDENT_CONTINUATION_ANNUAL
```

Server:

``` text
authenticate
→ verify eligibility
→ map offer to configured Price ID
→ create Checkout Session
```

Do not accept arbitrary `amount`, arbitrary `price_id`, or arbitrary
`player_id` as purchase authority.

## 28. Webhook Processing

Design for retries and possible out-of-order events:

``` text
receive
→ verify signature
→ identify event
→ reserve idempotency
→ resolve Jetta customer/subscription
→ re-fetch/reconcile provider state if needed
→ transactionally update Jetta state
→ reconcile grants
→ audit
→ mark billing event processed
```

Do not mark success before the Jetta transition commits.

## 29. Automatic Access Code Idempotency

Ordinary paid Coach/Individual onboarding requires automatic Access Code
issuance.

``` text
trusted paid activation
→ onboarding code already issued?
   YES → do not issue another
   NO  → issue once
```

Webhook retry/server restart must not create multiple unintended valid
codes.

Replacement codes remain a separate audited ADMIN action.

## 30. Stripe Test Mode

Before live activation, verify in Stripe test mode:

-   Coach checkout;
-   Individual checkout;
-   eligible continuation monthly/annual;
-   ineligible continuation denied server-side;
-   successful webhook;
-   duplicate/retried webhook;
-   out-of-order reconciliation;
-   failed renewal;
-   restoration;
-   cancellation;
-   portal access isolation;
-   ordinary paid Access Code issued once;
-   no Access Code for continuation;
-   `SELF_PAID` after trusted continuation payment;
-   Coach grace interaction;
-   restoration/expiration race;
-   multiple-grant continuity;
-   no payment secrets logged.

## 31. Production Rollout

Recommended sequence:

``` text
1. Repository/billing audit
2. Approve exact billing contract
3. Create Stripe test products/prices
4. Implement billing boundary
5. Implement hosted Checkout
6. Implement signed webhooks
7. Implement Customer Portal
8. Implement Jetta subscription reconciliation
9. Implement ordinary paid Access Code issuance
10. Implement continuation direct SELF_PAID provisioning
11. Automated tests
12. End-to-end Stripe test-mode validation
13. Back Office diagnostics
14. Production secrets/config
15. Live products/prices/webhook
16. Controlled production rollout
17. Monitor billing/provisioning/entitlement diagnostics
```

Do not enable payment-dependent entitlement enforcement merely because
Checkout succeeds. Verify the complete lifecycle.

## 32. When to Consider a Separate Payment Server

Not required initially.

Reconsider only if Jetta develops materially greater complexity such as
multiple major applications/backends, enterprise billing,
marketplace/payouts, multiple payment providers/currencies, high
billing-event volume, or separate billing engineering/operations
ownership.

The billing abstraction should permit later extraction without changing
the entitlement model.

## 33. Business Decisions Still Required Before Production

Codex must surface, not invent:

1.  exact Stripe Product/Price IDs;
2.  renewal rules;
3.  Individual/Student failed-payment grace policy;
4.  cancellation timing;
5.  refund policy;
6.  dispute/chargeback access policy;
7.  tax strategy;
8.  Customer Portal configuration;
9.  future price-change/grandfathering policy;
10. production webhook event set;
11. production secret/deployment procedure.

## 34. Acceptance Criteria

1.  Stripe is server-side behind a narrow billing boundary.
2.  No separate payment server for initial integration.
3.  Stripe-hosted Checkout for initial card collection.
4.  Jetta stores no raw card details.
5.  Webhook signatures are verified.
6.  Provider events are idempotent.
7.  Browser redirects are not payment proof.
8.  Browser cannot choose arbitrary player/price/eligibility.
9.  Stripe state translates into Jetta subscription state.
10. Jetta entitlement remains authoritative.
11. Paid Coach onboarding issues one automatic Coach Access Code.
12. Paid Individual onboarding issues one automatic Individual Access
    Code.
13. Coach-sponsored students need no Individual Access Code.
14. Student Continuation directly activates account-bound `SELF_PAID`
    with no Access Code.
15. Continuation eligibility is server-side.
16. \$9/month and \$49/year use configured provider prices.
17. Customer Portal handles supported billing management.
18. Coach 30-day grace remains Jetta policy.
19. restoration/expiration races reconcile safely.
20. Back Office diagnoses provider/Jetta state without exposing secrets.
21. Jetta/SMTP2GO product email remains separate from payment
    processing.
22. Account/history/coaching data is never destructively tied to
    cancellation.
23. Billing can later be extracted without redesigning entitlements.

## 35. Codex Instruction Before Coding

Before implementing Stripe, audit the repository and return an exact
plan covering:

1.  existing subscription/billing tables and reusable seams;
2.  billing package/service boundary;
3.  files to create/modify;
4.  schema migration, if any;
5.  Stripe Product/Price configuration;
6.  Checkout contract;
7.  Customer Portal contract;
8.  webhook endpoint/event mapping;
9.  signature/idempotency strategy;
10. Jetta subscription transition mapping;
11. Access Code issuance idempotency;
12. Student Continuation direct provisioning;
13. Coach grace interaction;
14. SMTP2GO integration points;
15. Back Office diagnostics;
16. Stripe test-mode workflow;
17. automated tests;
18. production secret/config plan;
19. unresolved Section 33 decisions.

**Do not code until this audit/plan is reviewed and approved.**
