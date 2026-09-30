import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildAccessGuidance } from "../packages/accounts/browser_access_guidance.mjs";

const date = () => "December 28, 2026";
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("the profile navigation anchor uses Player Profile consistently", () => {
  assert.match(index, /aria-label="Open Player Profile"/);
  assert.match(index, /<span class="eyebrow">Player Profile<\/span>/);
  assert.doesNotMatch(index, /<span class="eyebrow">Player account<\/span>/);
});

test("Coach access explains own play, ten seats, and Coach Dashboard", () => {
  const guidance = buildAccessGuidance({
    play_access: "ACTIVE",
    roles: ["PLAYER", "COACH"],
    grants: [{ type: "COACH_SELF", expires_at: "2026-12-28T00:00:00Z" }]
  }, date);
  assert.equal(guidance.title, "Active — Coach Access");
  assert.match(guidance.detail, /own Jetta play and up to 10 sponsored student seats/);
  assert.match(guidance.guidance, /Coach Dashboard/);
  assert.equal(guidance.showCoachDashboard, true);
});

test("Coach-sponsored guidance says no Access Code is required", () => {
  const guidance = buildAccessGuidance({
    play_access: "ACTIVE",
    roles: ["PLAYER"],
    current_coach: { coach_name: "Coach David" },
    grants: [{ type: "COACH_SPONSORED", expires_at: "2026-12-28T00:00:00Z" }]
  }, date);
  assert.equal(guidance.title, "Active — Provided by Your Coach");
  assert.match(guidance.detail, /Coach David currently provides/);
  assert.match(guidance.guidance, /do not need a Jetta Access Code/);
});

test("multiple grants preserve independent access in the explanation", () => {
  const guidance = buildAccessGuidance({
    play_access: "ACTIVE",
    roles: ["PLAYER"],
    grants: [
      { type: "PROMOTIONAL", expires_at: "2026-12-28T00:00:00Z" },
      { type: "COACH_SPONSORED", expires_at: "2026-12-28T00:00:00Z" }
    ]
  }, date);
  assert.match(guidance.guidance, /other active Jetta access also remains available/);
});

test("promotional access explains activities, expiry, and code behavior", () => {
  const guidance = buildAccessGuidance({
    play_access: "ACTIVE",
    roles: ["PLAYER"],
    grants: [{ type: "PROMOTIONAL", expires_at: "2026-12-28T00:00:00Z" }]
  }, date);
  assert.equal(guidance.title, "Active — Promotional Access");
  assert.match(guidance.detail, /rounds, GPS sessions, Academy lessons, and matches/);
  assert.match(guidance.detail, /December 28, 2026/);
  assert.equal(guidance.codeLabel, "Have another Jetta Access Code?");
});

test("Historical Access teaches both activation routes", () => {
  const guidance = buildAccessGuidance({
    play_access: "HISTORICAL_ONLY", roles: ["PLAYER"], grants: []
  }, date);
  assert.equal(guidance.title, "Historical Access");
  assert.match(guidance.guidance, /activate valid Jetta access/);
  assert.match(guidance.guidance, /accept a sponsored Coach invitation/);
});
