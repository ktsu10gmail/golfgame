# Website and Payment Plan

## Development estimate

A polished promotional website and initial subscription system should require approximately **3–5 working days**:

| Work | Estimated time |
| --- | ---: |
| Promotional website | 1–2 working days |
| Mobile and desktop refinement and testing | 1 additional day |
| Stripe monthly subscription integration | 1–2 additional days |

## Recommended payment architecture

Adding Stripe does not require redesigning the golf game or promotional website if subscription support is considered from the beginning.

```text
Promotional website
        ↓
Sign up or log in with Supabase
        ↓
Stripe-hosted Checkout
        ↓
Stripe webhook updates subscription
        ↓
Game checks subscription entitlement
        ↓
Allow or restrict premium access
```

Recommended responsibilities:

- **Supabase** manages player identity and login.
- **Stripe Checkout** collects payment information and starts subscriptions.
- **Stripe Customer Portal** lets players update payment methods, view invoices, and cancel subscriptions.
- The **Python game server** receives verified Stripe webhook events.
- The application stores a subscription record linked to the player's Supabase user ID.
- The game checks the stored subscription entitlement before allowing paid features.
- A free, trial, expired, or grace-period account state preserves player history when payment access changes.

Card information should be collected on Stripe's hosted pages. The golf game server should never receive or store complete card numbers.

Stripe documentation:

- <https://docs.stripe.com/subscriptions>
- <https://docs.stripe.com/billing/subscriptions/webhooks>

## Subscription information to store

The server should associate the following with the authenticated Supabase player:

- Supabase user ID
- Stripe customer ID
- Stripe subscription ID
- Stripe product ID
- Subscription status
- Current billing-period end date
- Cancellation-at-period-end status
- Last successfully processed Stripe event ID
- Last subscription update time

The game should trust the server's verified subscription record—not values sent by the browser.

## Webhook behavior

Stripe subscription changes happen asynchronously, so webhook handling is required. The server should verify every webhook signature and safely process duplicate events.

Important events include:

- Checkout completed
- Subscription created
- Subscription updated
- Subscription canceled or deleted
- Invoice paid
- Invoice payment failed

These events should activate access, update renewal information, begin a grace period, or restrict paid access as appropriate.

## Current Stripe cost estimate

For standard US domestic-card pricing, Stripe currently lists:

- **2.9% + $0.30** per successful card transaction
- **0.7% of recurring billing volume** for Stripe Billing pay-as-you-go
- No required monthly Stripe fee on the pay-as-you-go option

Pricing references:

- <https://stripe.com/pricing>
- <https://stripe.com/billing/pricing>

### Example: 100 players paying $10 per month

| Item | Amount |
| --- | ---: |
| Gross monthly revenue | $1,000 |
| Estimated card-processing fees | $59 |
| Estimated Stripe Billing fee | $7 |
| **Approximate amount before tax, refunds, and hosting** | **$934** |

Actual fees can differ for international cards, currency conversion, disputes, refunds, taxes, and optional Stripe services.

## Recommended rollout

1. Build the promotional website with subscription-ready pricing and account states.
2. Create the Stripe product and monthly price in test mode.
3. Add Stripe Checkout and the Customer Portal.
4. Implement and verify the subscription webhook endpoint.
5. Add server-side entitlement checks to protected game functions.
6. Test new purchases, renewals, cancellations, failed payments, and duplicate webhooks.
7. Define the free, trial, grace-period, and expired-user experience.
8. Add terms of service, privacy, refund, cancellation, and pricing information.
9. Switch to Stripe live keys only after the complete test flow succeeds.
10. Configure billing and payment monitoring before inviting paying users.

## Recommendation

Build and test the complete subscription system in **Stripe test mode** first. Keep player identity in Supabase, payment processing in Stripe, and access decisions on the server. This creates a clean path from the initial Ubuntu deployment to AWS without replacing the authentication or billing design.
