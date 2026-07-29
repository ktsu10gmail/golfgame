import assert from "node:assert/strict";
import test from "node:test";

import { analyzeRoundStrategy } from "../packages/simulation/browser_round_analysis.mjs";

function strategyPacket(shotId, shotType, score, subscores, reasons, executionScore) {
  return {
    shot_id: shotId,
    shot_type: shotType,
    decision: { score, subscores, reasons, advice_keys: [] },
    execution: { score: executionScore }
  };
}

const full = (values) => Object.fromEntries([
  "target_selection",
  "club_selection",
  "lie_management",
  "hazard_management",
  "recovery_discipline",
  "miss_planning"
].map((key, index) => [key, values[index]]));

function fixture() {
  return [
    [
      { strategyPacket: strategyPacket("h1:s1", "tee_positioning", 90, full([95, 90, 85, 90, 80, 85]), [], 80) },
      { strategyPacket: strategyPacket("h1:s2", "approach_forced_carry", 60, full([60, 55, 65, 50, 60, 55]), ["carry_margin_thin", "hazard_underweighted"], 50) },
      {
        puttPacket: { read: { feet: 6 } },
        strategyPacket: strategyPacket("h1:s3", "putt_make_attempt", 80, {
          line_plan: 80,
          pace_plan: 80,
          three_putt_avoidance: 80
        }, ["putting_line_respected", "putting_pace_respected"], 95)
      }
    ],
    [
      { strategyPacket: strategyPacket("h2:s1", "approach_forced_carry", 65, full([65, 60, 70, 55, 65, 60]), ["hazard_underweighted"], 60) }
    ]
  ];
}

test("browser round analysis matches the Python golden aggregation", () => {
  const analysis = analyzeRoundStrategy(fixture());

  assert.equal(analysis.version, "round-strategy-v1");
  assert.equal(analysis.strategy_score, 71);
  assert.equal(analysis.execution_score, 66);
  assert.equal(analysis.scored_shots, 4);
  assert.equal(analysis.subscores.putting_read_discipline, 80);
  assert.equal(analysis.top_strength, "putting_read_discipline");
  assert.equal(analysis.top_priority, "hazard_management");
  assert.deepEqual(analysis.holes.map(hole => hole.strategy_score), [74, 65]);
  assert.deepEqual(analysis.patterns.map(pattern => pattern.key), ["hazard_underweighting"]);
  assert.equal(analysis.patterns[0].high_cost_count, 2);
  assert.equal(analysis.top_costly_decisions[0].shot_id, "h1:s2");
});

test("browser round analysis ignores legacy shots without strategy packets", () => {
  assert.equal(analyzeRoundStrategy([[{ club: "Driver" }]]), null);
  assert.equal(analyzeRoundStrategy([]), null);
});
