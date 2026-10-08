import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Player Profile and Coach Dashboard share the preferred-course workflow", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const app = await readFile(new URL("app.js", root), "utf8");

  assert.match(html, /data-course-preferences="profile"/);
  assert.match(html, /data-course-preferences="coach"/);
  assert.equal((html.match(/data-course-search-form/g) || []).length, 2);
  assert.match(app, /\/api\/player\/course-directory\/search/);
  assert.match(app, /\/api\/player\/preferred-courses/);
  assert.match(app, /renderPreferredCourseLists/);
});

test("course search results are escaped before browser rendering", async () => {
  const app = await readFile(new URL("app.js", root), "utf8");
  assert.match(app, /escapeHtml\(course\.name\)/);
  assert.match(app, /escapeHtml\(preferredCourseLocation\(course\)\)/);
});
