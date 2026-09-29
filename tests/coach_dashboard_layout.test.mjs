import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Coach Dashboard owns the wide dialog instead of overflowing a narrow account modal", async () => {
  const css = await readFile(new URL("styles.css", root), "utf8");

  assert.match(css, /#coach-dashboard-dialog\s*\{\s*width:\s*min\(960px,/);
  assert.match(css, /\.license-dashboard-modal \.modal-card\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.license-dashboard-modal \.modal-card\s*\{[^}]*overflow-x:\s*hidden/s);
});

test("Coach Dashboard stacks controls inside a full-width mobile sheet", async () => {
  const css = await readFile(new URL("styles.css", root), "utf8");

  assert.match(css, /\.license-dashboard-modal,\s*#coach-dashboard-dialog\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.license-roster article\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /\.license-roster \.license-row-actions button\s*\{\s*flex:\s*1 1 120px/);
});
