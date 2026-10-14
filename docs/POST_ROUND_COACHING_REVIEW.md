# Evidence-first post-round coaching

The owner approved the regenerated example and authorized live .47 Dev integration on 2026-10-14. The post-round screen and JSON/PDF exports now use the reusable composer. Existing completed reports are converted without regrading recorded shots; fresh reports use the same interpretation rules. .15 remains unchanged.

## Reusable entry points

- `buildCoachingPostRoundReport(options)` builds fresh rounds through existing canonical scoring, then composes evidence-backed coaching.
- `improvePostRoundReport(report)` reinterprets any version 2 canonical JSON report without changing its round, scorecard, source events or shot grades.
- `coachingReportMarkdown(report)` produces the readable report.
- `coachingEditorPacket(report)` supplies compact approved findings to an optional editor.
- `applyCoachingEditorialSelection(report, selection)` accepts only approved finding IDs, preserves mandatory score/uncertainty, and rejects free prose or unsupported findings. A future free-form AI editor needs additional validation; it is not enabled here.

Regenerate a saved report using the private Node runtime:

```
/home/ksu/mapper47/tools/node/bin/node scripts/regenerate_post_round.mjs INPUT.json OUTPUT_PREFIX
```

Writes JSON, Markdown and standalone HTML, refuses to overwrite files, records the source SHA256, and checks that all original round/scorecard/shot/source-round evidence remains unchanged. Review artifacts can be printed to PDF with a browser.

## Findings and language rules

Score facts and model assessments remain separate. No exact strokes-lost attribution, swing diagnosis, or club recommendation is inferred from a bad result. The four decision/execution combinations plus uncertain classification use approved language. Explicit component concerns can warrant review even when the overall decision is graded sound; that grade is retained.

A specific within-round review requires at least three occurrences, five comparable opportunities, and a 25% occurrence rate. These are transparent initial review thresholds, not statistically validated long-term skill diagnoses. The count and denominator are retained. A lowest category average alone never establishes a practice priority. Distance-short tags only count as execution misses when the execution classification also says missed; accepted short shots are recorded in the threshold audit instead.

Putting read/pace failures require the corresponding MISSED code, never merely the presence of LINE or PACE. Conflicting respected/missed flags and incompatible classifications are withheld and audited. Empty, partial and ungraded rounds may produce shorter reports. Birdies offset gross over-par totals correctly. Conceded finishing putts are distinguished from graded shot decisions when source events are available.

Audit contains original summary/narrative, corrected flags, dropped candidate findings, contradictory evidence, decision-label/score distributions, sound grades with component concerns, and score reconciliation. Historical player patterns remain separate from within-round observations. Existing grading formulas are not changed.

## Supplied round evidence

The round stays 81 on par 71; all 74 recorded shots remain unchanged. Seven extra score strokes reconcile to conceded finishing putts. Six false read/pace flags across three old learning moments are corrected. Genuine missed-line flags remain: 11 of 26 putts carry a starting-line concern, supporting a review of those putting plans. All overall decisions still retain the original sound grade. Driver short misses are 3 of 15, below the initial 25% policy; they are retained in audit rather than presented as the first practice priority. No cross-round skill conclusion is invented.

## Validation

Tests cover the supplied round, all four combinations, unknown/empty evidence, repeated explicit planning concerns, accepted short shots, repeated distance misses with opportunities, genuine/false/conflicting putting codes, inconsistent scores, birdie offsets, unsafe editorial selections, and fresh canonical round building. No AI request or account modification is required.

## Live Dev integration — 2026-10-14

The screen presents the approved coaching text first, with Review Hole buttons opening recorded shot details/replay and a separate complete evidence appendix. JSON includes the coaching findings/audit and current round data; PDF uses the same readable coaching text. Legacy free-form AI review is bypassed for this report type. Public-file policy permits only the new presentation module; data and script restrictions remain. Refresh Dev Golfgame to load the new asset versions.

## Summary statistics and rough opportunity — 2026-10-14

Counts distinguish missed execution windows, plans with explicit concerns, shot-level overlap, and unique shots to review. Neither flag is treated as a stroke. A separate rough opportunity-toward-par benchmark sums recorded positive over-par scores on completed holes with these flags. Combined opportunity counts each hole once, even when different shots on that hole have different concerns. This is an observed score-based review benchmark; it does not attribute strokes causally or predict recoverable strokes. Counterfactual strokes-saved fields remain null until a validated comparison exists. Inconsistent scores withhold the benchmark.

The supplied example has 15/74 missed execution windows, 11/74 planning reviews, zero shot-level overlap and 26 different shots to review. Flagged execution holes have eight over-par strokes, planning holes five, and overlapping holes four: the combined benchmark is nine strokes toward par. The report explicitly calls these rough review opportunities rather than predicted savings.
