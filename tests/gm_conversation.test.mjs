import test from "node:test";
import assert from "node:assert/strict";

import { replaceDraftMessage } from "../packages/presentation/gm_conversation.mjs";

test("repeated target selections retain only the last draft for the current shot", () => {
  const briefing = { text: "Opening briefing", role: "gm" };
  const first = replaceDraftMessage([briefing], {
    text: "Direction target set at 180 yards.", role: "gm", draftKey: "target:0:1"
  });
  const second = replaceDraftMessage(first, {
    text: "Direction target set at 192 yards.", role: "gm", draftKey: "target:0:1"
  });

  assert.deepEqual(second, [
    briefing,
    { text: "Direction target set at 192 yards.", role: "gm", draftKey: "target:0:1" }
  ]);
});

test("a target from a completed shot remains when the next shot gets a target", () => {
  const completedShotTarget = {
    text: "Direction target set at 192 yards.", role: "gm", draftKey: "target:0:1"
  };
  const messages = replaceDraftMessage([completedShotTarget], {
    text: "Landing target set at 84 yards.", role: "gm", draftKey: "target:0:2"
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].draftKey, "target:0:1");
  assert.equal(messages[1].draftKey, "target:0:2");
});
