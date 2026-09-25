import test from "node:test";
import assert from "node:assert/strict";
import { buildInPlayPresentation } from "../packages/presentation/in_play_presentation_policy.mjs";

test("in-play policy is deterministic, concise, and leaves supplied facts untouched", () => {
  const input = { current: { surface: "Rough", distanceYards: 160, conditions: ["Ball above your feet", "Nearly level"], adjustments: ["Expect ~4 yd left", "Favor ~4 yd right"] }, previous: { decisionLabel: "Competitive plan", risk: 20, details: ["Finished 21 yd right"] } };
  const before = structuredClone(input);
  const first = buildInPlayPresentation(input);
  assert.deepEqual(first, buildInPlayPresentation(input));
  assert.deepEqual(input, before);
  assert.equal(first.primary.surface, "ROUGH");
  assert.equal(first.previousShot.summary, "Competitive plan · 20% risk");
});

test("specialized tree UI suppresses generic coaching and penalties escalate", () => {
  const result = buildInPlayPresentation({ current: { surface: "Trees", distanceYards: 336, conditions: ["Too much"], specializedBriefing: ["Direct route has high tree-interference risk."] }, specialized: "tree", previous: { penalty: 1, surface: "Water", details: ["Stored evidence"] } });
  assert.deepEqual(result.primary.conditions, ["Direct route has high tree-interference risk."]);
  assert.deepEqual(result.primary.adjustments, []);
  assert.equal(result.event.label, "Penalty");
});
