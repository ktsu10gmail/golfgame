import test from "node:test";
import assert from "node:assert/strict";

import {
  POST_ROUND_REPORT_VERSION,
  buildPostRoundAnalysisReport,
  buildPostRoundPdf,
  postRoundReportFilename
} from "../packages/presentation/post_round_export.mjs";

function report() {
  return buildPostRoundAnalysisReport({
    exportedAt: "2026-09-24T12:00:00.000Z",
    course: { id: "meadows", name: "The Meadows at Middlesex" },
    player: { id: "90", name: "90+ player" },
    tee: "White",
    summary: {
      verdict: "Protect the short side and keep trusting the center-green plan.",
      stats: [{ label: "Round", value: "+4", detail: "18 holes" }]
    },
    scorecard: [{ hole: 1, par: 4, distance_yards: 380, handicap: 5, score: 5, result: "+1 / Bogey" }],
    meaningfulHoles: [{
      hole_number: 1, par: 4, distance_yards: 380, handicap: 5, score: "+1 / Bogey",
      ai_caddie: { label: "AI Caddie insight", wording: "The center-green target was sound." },
      shots: [{
        shot_number: 1, club_and_power: "Driver / Full", decision: "Sound", execution: "On plan",
        strategy: ["Strategy 84"], path: "Fairway -> Fairway", reasons: ["Good miss"],
        context: [], lesson: "Keep this start line."
      }]
    }],
    sourceRound: { version: "golf-round-save-v1" }
  });
}

test("analysis report retains displayed AI wording and source round", () => {
  const value = report();
  assert.equal(value.version, POST_ROUND_REPORT_VERSION);
  assert.equal(value.report.meaningful_holes[0].ai_caddie.wording, "The center-green target was sound.");
  assert.equal(value.source_round.version, "golf-round-save-v1");
  assert.equal(postRoundReportFilename(value, "json"), "the-meadows-at-middlesex-post-round-report-2026-09-24.json");
});

test("PDF export is a downloadable multi-section PDF containing caddie wording", () => {
  const pdf = buildPostRoundPdf(report());
  const text = new TextDecoder().decode(pdf);
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /AI Caddie insight: The center-green target was sound\./);
  assert.match(text, /SCORECARD/);
  assert.match(text, /%%EOF$/);
});

test("canonical PDF labels weighted score and categorical decision rate separately", () => {
  const canonical = {
    schema_version: "2.0",
    generated_at: "2026-09-24T12:00:00.000Z",
    round: { status: "completed", course_name: "Warrenbrook", tee: "White", holes_completed: 18, relative_to_par: 17 },
    summary: {
      strategy_score: 86, scored_decisions: 80, sound_decisions: 76, graded_decisions: 78,
      ungraded_decisions: 2, decision_quality_percent: 97, on_plan_executions: 52,
      graded_executions: 80, execution_quality_percent: 65, practice_priority_label: "Lie Management"
    },
    narrative: { round_story: { text: "Calculated story." }, learning_moment_explanations: {} },
    learning_summary: { three_things_to_remember: [], learning_moments: [], next_round_focus: [] },
    patterns: [], scorecard: [], meaningful_holes: [], detailed_shots: []
  };
  const text = new TextDecoder().decode(buildPostRoundPdf(canonical));
  assert.match(text, /Course-Management Score: 86\/100/);
  assert.match(text, /weighted across 80 scored shots/);
  assert.match(text, /Sound-Plan Rate: 97%/);
  assert.match(text, /76 of 78 graded; 2 ungraded/);
});
