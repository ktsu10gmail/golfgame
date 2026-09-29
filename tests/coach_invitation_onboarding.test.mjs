import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("coach invitation link is captured from the fragment and claimed after login", () => {
  assert.match(app, /fragment\.get\("coach_invitation"\)/);
  assert.match(app, /localStorage\.setItem\(COACH_INVITATION_STORAGE_KEY/);
  assert.match(app, /history\.replaceState/);
  assert.match(app, /\/api\/player\/coach-invitations\/claim/);
  assert.match(app, /await claimCoachInvitationFromEmail\(\)/);
});

test("account and coach dashboard expose the final invitation actions", () => {
  assert.match(index, /id="account-coach-invitation-arrival"/);
  assert.match(index, />Send invitation<\/button>/);
  assert.match(app, /data-resend-coach-invitation/);
  assert.match(app, /\/api\/coach\/invitations\/resend/);
  assert.doesNotMatch(app, /Invitation ending/);
});

test("accepting or declining clears the arrival notice and stored link", () => {
  const responder = app.match(/async function respondToCoachInvitation[\s\S]*?\n}/)?.[0] || "";
  assert.match(responder, /coachInvitationArrival = null/);
  assert.match(responder, /localStorage\.removeItem\(COACH_INVITATION_STORAGE_KEY\)/);
  assert.match(responder, /await refreshPlayerAccess\(\)/);
});

test("an open Coach Dashboard refreshes accepted invitations and identifies students", () => {
  assert.match(app, /student\.email[^\n]+Coach Sponsored/);
  assert.match(app, /function startCoachDashboardRefresh\(\)/);
  assert.match(app, /setInterval\([\s\S]*?loadCoachDashboard/);
  assert.match(app, /coach-dashboard-dialog[^\n]+addEventListener\("close", stopCoachDashboardRefresh\)/);
});
