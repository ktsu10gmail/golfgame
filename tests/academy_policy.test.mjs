import test from "node:test";
import assert from "node:assert/strict";

import {
  ACADEMY_DECISION_POLICY_VERSION,
  academyChoiceEvidence,
  academyDecisionBand,
  normalizeAcademyEvaluation,
  scoreAcademySession
} from "../packages/academy/academy_policy.mjs";

const analysis = {
  version: "multi-run-v1",
  ranking_version: "course-management-v1",
  analysis_seed: 42,
  sample_count: 400,
  candidates: {
    attack: { probability_score: 81, target_percent: 38, playable_percent: 82, bunker_percent: 24, water_percent: 7, penalty_percent: 11, median_leave_yards: 22 },
    position: { probability_score: 79.4, target_percent: 72, playable_percent: 94, bunker_percent: 5, water_percent: 1, penalty_percent: 3, median_leave_yards: 65 },
    conservative: { probability_score: 74, target_percent: 80, playable_percent: 97, bunker_percent: 2, water_percent: 0, penalty_percent: 1, median_leave_yards: 90 }
  }
};

test("Academy normalizes evaluator percentages for persisted evidence", () => {
  assert.deepEqual(normalizeAcademyEvaluation(analysis.candidates.attack), {
    target_probability: .38,
    playable_lie_probability: .82,
    green_probability: null,
    bunker_probability: .24,
    water_probability: .07,
    penalty_probability: .11,
    typical_leave_yards: 22
  });
});

test("Academy recognizes statistically close plans as competitive", () => {
  assert.equal(academyDecisionBand(analysis, "attack"), "PREFERRED");
  assert.equal(academyDecisionBand(analysis, "position"), "COMPETITIVE");
  assert.equal(academyDecisionBand(analysis, "conservative"), "WEAK");
});

test("Academy choice evidence preserves deterministic provenance", () => {
  const evidence = academyChoiceEvidence({ id: "position" }, analysis);
  assert.equal(evidence.decision_band, "COMPETITIVE");
  assert.equal(evidence.modeled_score_delta, 1.6);
  assert.equal(evidence.evaluation.penalty_probability, .03);
  assert.equal(evidence.evidence.sample_count, 400);
  assert.equal(evidence.evidence.analysis_seed, 42);
  assert.equal(evidence.evidence.academy_policy_version, ACADEMY_DECISION_POLICY_VERSION);
});

test("Academy session score rewards decisions rather than random shot results", () => {
  const report = scoreAcademySession([
    { evidence: { decision_band: "PREFERRED" }, result: { lie: "Water" } },
    { evidence: { decision_band: "COMPETITIVE" }, result: { lie: "Fairway" } }
  ]);
  assert.deepEqual(
    { score: report.score, preferred: report.preferred, competitive: report.competitive, weak: report.weak },
    { score: 93, preferred: 1, competitive: 1, weak: 0 }
  );
  assert.equal(report.rating, "Strong strategic player");
});

test("Academy session report guides a player after weaker choices", () => {
  const report = scoreAcademySession([
    { decision_band: "WEAK" },
    { decision_band: "COMPETITIVE" }
  ]);
  assert.equal(report.score, 70);
  assert.equal(report.rating, "Developing good judgment");
  assert.match(report.comment, /avoidable value/i);
});
