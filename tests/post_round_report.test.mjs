import test from "node:test";
import assert from "node:assert/strict";

import {
  POST_ROUND_REPORT_BUILDER_VERSION,
  attachPostRoundNarrative,
  buildPostRoundReportModel,
  buildReportNarrativePacket
} from "../packages/presentation/post_round_report.mjs";
import { buildPostRoundPdf } from "../packages/presentation/post_round_export.mjs";

const SCORECARD = Array.from({ length: 18 }, (_, index) => ({
  Hole: index + 1, Par: index % 3 === 0 ? 5 : 4, Handicap: index + 1, Yards_White: 380 + index
}));

function canonicalShot({
  hole = 1,
  stroke = 1,
  decision = "PREFERRED_PLAN",
  execution = "ON_PLAN_EXECUTION",
  result = "GOOD_RESULT",
  penalty = 0,
  score = 88,
  shotType = "tee_positioning",
  finish = "Fairway"
} = {}) {
  return {
    club: "Driver", power: 100, lie: finish, intendedLie: "Fairway", penalty, remaining: 170,
    lesson: "Keep the widest landing area in play.",
    canonicalAssessment: {
      assessment_version: "1.0",
      result: { label: result, reason_codes: [] },
      decision: { label: decision, reason_codes: decision === "HIGHER_RISK_PLAN" ? ["TARGET_TOO_AGGRESSIVE"] : [] },
      execution: { label: execution, score: execution === "MISSED_EXECUTION" ? 55 : 86, reason_codes: [] },
      evidence: { simulation_version: "test-engine", evaluator_version: "test-evaluator" }
    },
    strategyPacket: {
      version: "strategy-v1", shot_id: `h${hole}:s${stroke}`, shot_type: shotType,
      preferred_miss: "widest_landing_zone",
      decision: { score, label: score >= 80 ? "sound" : "review", reasons: decision === "HIGHER_RISK_PLAN" ? ["target_too_aggressive"] : [], subscores: { target_selection: score, club_selection: score, lie_management: score, hazard_management: score, recovery_discipline: score, miss_planning: score } },
      execution: { score: execution === "MISSED_EXECUTION" ? 55 : 86, label: execution === "MISSED_EXECUTION" ? "missed" : "matched_plan", reasons: [] }
    }
  };
}

function build(overrides = {}) {
  const history = Array.from({ length: 18 }, () => []);
  history[0] = [
    canonicalShot({ execution: "MISSED_EXECUTION" }),
    canonicalShot({ stroke: 2, decision: "DECISION_NOT_GRADED", execution: "EXECUTION_NOT_GRADED", score: 0 })
  ];
  history[1] = [canonicalShot({ hole: 2, decision: "HIGHER_RISK_PLAN", result: "COSTLY_RESULT", penalty: 1, score: 52 })];
  return buildPostRoundReportModel({
    roundId: "meadows:123", course: { id: "meadows", name: "The Meadow" }, courseVersion: "course-v1",
    tee: "White", scorecard: SCORECARD, scores: [6, 7, ...Array(16).fill(null)], roundHistory: history,
    verifiedPatterns: [{ kind: "recurring_decision_mistake", key: "target_too_aggressive", confidence: "verified", sample_size: 9, round_count: 3 }],
    playerProfile: { id: "90", clubs: [] }, generatedAt: "2026-09-24T12:00:00Z", ...overrides
  });
}

test("canonical report uses explicit graded denominators and numeric score values", () => {
  const report = build();
  assert.equal(report.report_builder_version, POST_ROUND_REPORT_BUILDER_VERSION);
  assert.equal(report.round.status, "in_progress");
  assert.equal(typeof report.round.relative_to_par, "number");
  assert.equal(report.summary.graded_decisions, 2);
  assert.equal(report.summary.sound_decisions, 1);
  assert.equal(report.summary.decision_quality_percent, 50);
  assert.equal(report.summary.graded_executions, 2);
  assert.equal(report.summary.on_plan_executions, 1);
  assert.equal(report.summary.execution_quality_percent, 50);
});

test("learning moments are deterministic, stable, ranked, and evidence-backed", () => {
  const first = build();
  const second = build();
  assert.deepEqual(first.learning_summary.learning_moments, second.learning_summary.learning_moments);
  assert.match(first.learning_summary.learning_moments[0].moment_id, /^h2:s1:/);
  assert.ok(first.learning_summary.learning_moments[0].evidence_refs.length);
  assert.ok(first.learning_summary.learning_moments.length <= 5);
  assert.equal(first.patterns[0].source, "player_history");
});

test("narrative packet contains the complete selected learning layer without raw geometry", () => {
  const packet = buildReportNarrativePacket(build());
  assert.equal(packet.learning_moments.length, 2);
  assert.equal(packet.meaningful_holes.length, 2);
  assert.ok(packet.input_hash.startsWith("fnv1a-"));
  assert.equal(JSON.stringify(packet).includes("geometry"), false);
});

test("validated narrative attaches only to existing deterministic moments with evidence refs", () => {
  const report = build();
  const updated = attachPostRoundNarrative(report, {
    provider: "test", model: "caddie-test", verdict: "The decision record was stronger than the outcomes on the most important holes.",
    hole_reviews: [{ hole_number: 2, insight: "The penalty followed a higher-risk plan.", credit: "The result was recorded clearly.", correction: "Choose more margin.", next_time: "Favor the wider target." }]
  }, { generatedAt: "2026-09-24T13:00:00Z" });
  assert.equal(updated.narrative.status, "available");
  assert.equal(updated.narrative.model, "caddie-test");
  const explanation = Object.values(updated.narrative.learning_moment_explanations)[0];
  assert.ok(explanation.evidence_refs.every(ref => ref.startsWith("shot:h2:s1")));
});

test("completed report is labeled as original analysis and retains fallback without AI", () => {
  const scores = SCORECARD.map(row => row.Par);
  const report = build({ scores });
  assert.equal(report.round.status, "completed");
  assert.equal(report.narrative.status, "deterministic_fallback");
  assert.match(report.narrative.round_story.text, /Across the completed round/);
});

test("unified PDF renderer consumes the canonical model and preserves the learning hierarchy", () => {
  const text = new TextDecoder().decode(buildPostRoundPdf(build()));
  assert.match(text, /ROUND SNAPSHOT/);
  assert.match(text, /ROUND STORY/);
  assert.match(text, /KEY LEARNING MOMENTS/);
  assert.match(text, /DETAILED SHOT EVIDENCE \/ APPENDIX/);
});
