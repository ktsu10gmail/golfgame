import assert from "node:assert/strict";
import test from "node:test";

import {
  personalizeCustomProfile,
  playerProfileName
} from "../packages/accounts/browser_profile_naming.mjs";

test("custom profile defaults to the signed-in player name", () => {
  assert.equal(playerProfileName("  ktsu10  "), "ktsu10 profile");
});

test("legacy starter labels migrate without replacing a chosen custom name", () => {
  const migrated = personalizeCustomProfile({
    id: "custom-1",
    name: "90+ - Custom profile",
    description: "Based on 90+ player"
  }, "ktsu10");
  assert.equal(migrated.name, "ktsu10 profile");
  assert.equal(migrated.description, "Personal club distances and putting statistics");

  const chosen = personalizeCustomProfile({
    id: "custom-2",
    name: "Windy-day bag",
    description: "Low-flight setup"
  }, "ktsu10");
  assert.equal(chosen.name, "Windy-day bag");
  assert.equal(chosen.description, "Low-flight setup");
});
