import assert from "node:assert/strict";
import test from "node:test";

import { ReplayHoleLoader } from "../packages/replay/browser_replay_loader.mjs";

function payloadFor(path) {
  const hole = Number(path.match(/\/holes\/(\d+)$/)?.[1] || 1);
  if (path.includes("/api/courses/")) return { simulation_surfaces: [], hole };
  if (!path.includes("/holes/")) {
    return { round_id: "round-123", holes: Array.from({ length: 18 }, (_, index) => ({ hole: index + 1 })) };
  }
  return {
    round_id: "round-123", course_id: "course", course_version_id: "v1",
    hole: { hole_number: hole, score: 4, events: [] }
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test("random jumps fetch the target directly and prefetch only its neighbors", async () => {
  const paths = [];
  const loader = new ReplayHoleLoader({
    fetchJson: async path => { paths.push(path); return payloadFor(path); }
  });
  await loader.navigateToHole("round-123", 3);
  await flush();
  paths.length = 0;
  await loader.navigateToHole("round-123", 15);
  await flush();

  const replayHoles = paths
    .filter(path => path.startsWith("/api/player/") && path.includes("/holes/"))
    .map(path => Number(path.match(/\/holes\/(\d+)$/)[1]));
  assert.deepEqual(new Set(replayHoles), new Set([14, 15, 16]));
  assert.equal(replayHoles.some(hole => hole >= 4 && hole <= 13), false);
});

test("late navigation responses are marked stale", async () => {
  const resolvers = new Map();
  const loader = new ReplayHoleLoader({
    fetchJson: path => {
      if (path.includes("/api/courses/")) return Promise.resolve(payloadFor(path));
      return new Promise(resolve => resolvers.set(path, () => resolve(payloadFor(path))));
    }
  });
  const first = loader.navigateToHole("round-123", 10);
  const second = loader.navigateToHole("round-123", 15);
  resolvers.get("/api/player/rounds/round-123/holes/15")();
  await flush();
  resolvers.get("/api/player/rounds/round-123/holes/10")();
  const [late, current] = await Promise.all([first, second]);
  assert.equal(late.stale, true);
  assert.equal(current.stale, false);
  assert.equal(current.replay.hole.hole_number, 15);
});

test("the replay and geometry caches stay bounded", async () => {
  const loader = new ReplayHoleLoader({
    maxHoles: 5,
    fetchJson: async path => payloadFor(path)
  });
  for (let hole = 1; hole <= 10; hole += 1) {
    await loader.navigateToHole("round-123", hole);
    await flush();
  }
  const diagnostics = loader.diagnostics();
  assert.ok(diagnostics.replayHoles <= 5);
  assert.ok(diagnostics.geometryHoles <= 5);
});
