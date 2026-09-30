import assert from "node:assert/strict";
import test from "node:test";

import { buildAccessGuidance } from "../packages/accounts/browser_access_guidance.mjs";

const exact = () => "October 29, 2026 at 3:00 PM EDT";

test("Coach grace shows exact sponsorship deadline and saved continuation eligibility", () => {
  const view = buildAccessGuidance({
    play_access: "ACTIVE", can_start_new_play: true, enforcement: "shadow",
    roles: ["PLAYER"], current_coach: { coach_name: "Coach David" },
    grants: [{ type: "COACH_SPONSORED" }],
    coach_sponsorship: { status: "GRACE", grace_ends_at: "2026-10-29T19:00:00Z" },
    continuation: { eligible: true, display_monthly_usd: 9, display_annual_usd: 49 }
  }, exact);
  assert.equal(view.showSponsorshipNotice, true);
  assert.match(view.sponsorshipDetail, /October 29, 2026 at 3:00 PM EDT/);
  assert.equal(view.showContinuation, true);
  assert.match(view.continuationDetail, /activation is not yet available/i);
});

test("historical entitlement and shadow runtime remain distinct", () => {
  const view = buildAccessGuidance({
    play_access: "HISTORICAL_ONLY", can_start_new_play: true,
    enforcement: "shadow", roles: ["PLAYER"], grants: [],
    coach_sponsorship: { status: "ENDED" },
    continuation: { eligible: true, display_monthly_usd: 9, display_annual_usd: 49 }
  });
  assert.equal(view.title, "Historical Access");
  assert.match(view.guidance, /No valid entitlement/);
  assert.match(view.guidance, /SHADOW enforcement/);
  assert.match(view.sponsorshipDetail, /Coach-provided entitlement has ended/);
});
