import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminUrl, diagnosticLabels } from "../admin/admin.js";

test("admin query construction encodes values without changing the route", () => {
  const value = adminUrl("/api/admin/users", { query: "A&B Player", limit: 25, cursor: "" });
  assert.equal(value, "/api/admin/users?query=A%26B+Player&limit=25");
});

test("diagnostic always separates entitlement enforcement and runtime", () => {
  const labels = diagnosticLabels({
    entitlement_decision: "DENIED",
    entitlement_reason: "No valid grant.",
    enforcement_mode: "SHADOW",
    runtime_result: "ALLOWED",
    runtime_reason: "Allowed by shadow-mode policy."
  });
  assert.deepEqual(labels.map(item => item[0]), [
    "Entitlement Decision", "Enforcement Mode", "Current Runtime Result"
  ]);
  assert.deepEqual(labels.map(item => item[1]), ["DENIED", "SHADOW", "ALLOWED"]);
});

test("Back Office shell states the three Jetta website boundaries", () => {
  const html = readFileSync(new URL("../admin/index.html", import.meta.url), "utf8");
  assert.match(html, /www\.jetta\.com/);
  assert.match(html, /Public marketing website/);
  assert.match(html, /golfgame\.jetta\.com/);
  assert.match(html, /Jetta product application/);
  assert.match(html, /golfgame\.jetta\.com\/admin\//);
  assert.match(html, /Restricted Jetta Back Office/);
});

test("Player Profile keeps redemption and removes administrative generation", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(html, /Have a Jetta Access Code\?/);
  assert.match(html, /Enter a valid code provided by Jetta\./);
  assert.doesNotMatch(html, /license-admin-dialog/);
  assert.doesNotMatch(html, /license-admin-button/);
  assert.doesNotMatch(app, /createAdminAccessCode/);
  assert.doesNotMatch(app, /renderAccessCodes/);
});

test("Back Office renderer has no raw HTML assignment boundary", () => {
  const source = readFileSync(new URL("../admin/admin.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /textContent/);
});
