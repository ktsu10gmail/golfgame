import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSESSMENT_VERSION,
  DecisionLabel,
  ResultLabel,
  assessGameShot,
  assessGpsShot,
  assessShotContext,
  canonicalAssessmentForGameShot,
  canonicalAssessmentForGpsShot,
  legacyPacketAssessment
} from "../packages/assessment/browser_assessment_service.mjs";

function context(overrides = {}) {
  return {
    mode: "PC_SIMULATION",
    shot_type: "approach_standard",
    intended_surface: "Green",
    landing_surface: "Bunker",
    finish_surface: "Bunker",
    penalty_strokes: 0,
    remaining_yards: 25,
    holed_out: false,
    target_kind: "DIRECTION_TARGET",
    target_preserved: true,
    target_delta: { lateral_yards: 15.2, distance_yards: -10.3 },
    strategy_evidence: { hybrid_outlook: "Best", reason_codes: ["good_miss_plan"], recommended_choice_id: "safe" },
    execution_evidence: { score: 40, label: "missed", reason_codes: ["missed_intended_window"] },
    physics_execution: "missed",
    risk_evidence: { penalty_percent: 2, bunker_percent: 8, playable_percent: 91, green_percent: 42 },
    evidence: { simulation_version: "sim-v8", evaluator_version: "multi-run-v1", decision_policy_version: "decision-policy-v1", seed: 182731, sample_count: 400 },
    ...overrides
  };
}

test("golden A keeps a preferred decision separate from a costly bunker result", () => {
  const assessment = assessShotContext(context());
  assert.equal(assessment.assessment_version, ASSESSMENT_VERSION);
  assert.equal(assessment.decision.label, DecisionLabel.PREFERRED);
  assert.equal(assessment.result.label, ResultLabel.COSTLY);
  assert.deepEqual(assessment.result.reason_codes, ["BUNKER_FINISH"]);
  assert.equal(assessment.outcome_vs_target.lateral_direction, "RIGHT");
  assert.equal(assessment.outcome_vs_target.depth_direction, "SHORT");
});

test("golden B keeps a good result separate from a higher-risk decision", () => {
  const assessment = assessShotContext(context({
    finish_surface: "Green",
    landing_surface: "Green",
    strategy_evidence: { hybrid_outlook: "Higher risk", reason_codes: ["higher_penalty_risk"] },
    physics_execution: "on_plan",
    execution_evidence: { score: 90, label: "matched_plan", reason_codes: [] }
  }));
  assert.equal(assessment.decision.label, DecisionLabel.HIGHER_RISK);
  assert.equal(assessment.result.label, ResultLabel.GOOD);
});

test("golden C leaves an older GPS decision and target ungraded", () => {
  const assessment = assessGpsShot({ start: { lie: "Tee" }, end: { lie: "Fairway" }, strategy: null });
  assert.equal(assessment.decision.label, DecisionLabel.NOT_GRADED);
  assert.equal(assessment.outcome_vs_target.available, false);
  assert.deepEqual(assessment.outcome_vs_target.reason_codes, ["TARGET_EVIDENCE_MISSING"]);
});

test("sidehill prose cannot overturn current strategy evidence", () => {
  const assessment = assessGameShot({
    club: "Pitching Wedge",
    intendedLie: "Fairway",
    lie: "Fairway",
    penalty: 0,
    outcomeVsTarget: { lateral_yards: 1.75, distance_yards: 1.76 },
    gmReview: { decision: "Review the sidehill plan." },
    strategyPacket: {
      version: "decision-score-v2",
      shot_type: "layup_positioning",
      decision: { score: 84, label: "sound", reasons: ["smart_layup"] },
      execution: { score: 70, label: "slight_miss", reasons: ["distance_short_of_plan"] }
    },
    resultPacket: { assessment: { execution_assessment: "on_plan" }, audit: { engine_version: "full-shot-v4" } }
  });
  assert.equal(assessment.decision.label, DecisionLabel.COMPETITIVE);
  assert.equal(assessment.result.label, ResultLabel.GOOD);
  assert.equal(assessment.execution.label, "ON_PLAN_EXECUTION");
});

test("manageable lag leaves are acceptable execution", () => {
  const assessment = assessGameShot({
    club: "Putter",
    intendedLie: "Green",
    lie: "Green",
    remaining: 1.14,
    strategyPacket: {
      shot_type: "putt_lag",
      decision: { score: 89, label: "sound", reasons: [] },
      execution: { score: 78, label: "slight_miss", reasons: ["manageable_leave"] }
    },
    puttPacket: { made: false, assessment: { execution_assessment: "missed" } }
  });
  assert.equal(assessment.execution.label, "ACCEPTABLE_EXECUTION");
  assert.equal(assessment.outcome_vs_target.target_kind, "PUTTING_LINE");
});

test("risk values normalize existing paired percentages without rerunning a model", () => {
  const assessment = assessShotContext(context());
  assert.equal(assessment.risk.penalty_probability, 0.02);
  assert.equal(assessment.risk.bunker_probability, 0.08);
  assert.equal(assessment.risk.playable_lie_probability, 0.91);
});

test("stored current-version assessments remain historically stable", () => {
  const stored = assessShotContext(context());
  const shot = {
    canonicalAssessment: stored,
    strategyPacket: { decision: { label: "review" } },
    lie: "Water"
  };
  assert.strictEqual(canonicalAssessmentForGameShot(shot), stored);
});

test("stored GPS assessments remain stable after later evidence changes", () => {
  const stored = assessShotContext(context({ mode: "GPS" }));
  const shot = { canonicalAssessment: stored, end: { lie: "Water" } };
  assert.strictEqual(canonicalAssessmentForGpsShot(shot), stored);
});

test("landing and direction target semantics remain explicit", () => {
  const landing = assessGameShot({
    aimType: "landing_target",
    intendedLie: "Fringe",
    landingLie: "Fringe",
    lie: "Green",
    outcomeVsTarget: { lateral_yards: -2, distance_yards: 3 },
    strategyPacket: {
      decision: { label: "sound", reasons: [] },
      execution: { score: 80, label: "matched_plan", reasons: [] }
    },
    resultPacket: { assessment: { execution_assessment: "on_plan" } }
  });
  const direction = assessGameShot({
    aimType: "direction_target",
    intendedLie: "Fairway",
    landingLie: "Fairway",
    lie: "Fairway",
    outcomeVsTarget: { lateral_yards: 1, distance_yards: -4 },
    strategyPacket: {
      decision: { label: "sound", reasons: [] },
      execution: { score: 80, label: "matched_plan", reasons: [] }
    },
    resultPacket: { assessment: { execution_assessment: "on_plan" } }
  });
  assert.equal(landing.outcome_vs_target.target_kind, "LANDING_TARGET");
  assert.equal(landing.evidence.landing_surface, "Fringe");
  assert.equal(landing.evidence.finish_surface, "Green");
  assert.equal(direction.outcome_vs_target.target_kind, "DIRECTION_TARGET");
});

test("canonical compatibility adapter treats acceptable execution as successful without erasing its label", () => {
  const assessment = assessGameShot({
    club: "Putter",
    intendedLie: "Green",
    lie: "Green",
    remaining: 1,
    strategyPacket: {
      shot_type: "putt_lag",
      decision: { label: "sound", reasons: [] },
      execution: { score: 75, label: "slight_miss", reasons: ["manageable_leave"] }
    },
    puttPacket: { assessment: { execution_assessment: "missed" } }
  });
  assert.equal(assessment.execution.label, "ACCEPTABLE_EXECUTION");
  assert.equal(legacyPacketAssessment(assessment).execution_assessment, "on_plan");
});
