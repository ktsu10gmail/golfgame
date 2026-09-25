export const POST_ROUND_REPORT_VERSION = "golf-post-round-report-v1";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function filenamePart(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "golf-round";
}

export function buildPostRoundAnalysisReport({
  exportedAt = new Date().toISOString(),
  course,
  player,
  tee,
  summary,
  scorecard = [],
  meaningfulHoles = [],
  sourceRound = null
}) {
  return {
    version: POST_ROUND_REPORT_VERSION,
    exported_at: exportedAt,
    purpose: "AI-assisted post-round golf analysis",
    course: structuredClone(course),
    player: structuredClone(player),
    tee,
    report: {
      summary: structuredClone(summary),
      scorecard: structuredClone(scorecard),
      meaningful_holes: structuredClone(meaningfulHoles)
    },
    ...(sourceRound ? { source_round: structuredClone(sourceRound) } : {})
  };
}

export function postRoundReportFilename(report, extension) {
  const date = String(report?.exported_at || report?.generated_at || "").slice(0, 10) || "saved";
  const course = report?.round?.course_name || report?.course?.name || report?.course?.id || "golf-round";
  return `${filenamePart(course)}-post-round-report-${date}.${extension}`;
}

function reportTextLines(report) {
  if (report?.schema_version === "2.0" && report?.round && report?.summary) {
    const score = value => value === 0 ? "E" : value > 0 ? `+${value}` : String(value ?? "-");
    const lines = [
      "POST-ROUND LEARNING REPORT",
      report.round.status === "completed" ? "ORIGINAL ROUND ANALYSIS" : "ROUND REVIEW - IN PROGRESS",
      cleanText(report.round.course_name),
      `${cleanText(report.round.tee)} tee / ${report.round.holes_completed} holes completed`,
      "",
      "ROUND SNAPSHOT",
      `Round: ${score(report.round.relative_to_par)} / Strategy Score: ${report.summary.strategy_score ?? "-"}`,
      `Decision Quality: ${report.summary.decision_quality_percent ?? "-"}% (${report.summary.sound_decisions} of ${report.summary.graded_decisions})`,
      `Execution Quality: ${report.summary.execution_quality_percent ?? "-"}% (${report.summary.on_plan_executions} of ${report.summary.graded_executions})`,
      `Practice Next: ${cleanText(report.summary.practice_priority_label || "Not enough evidence yet")}`,
      "",
      "ROUND STORY",
      cleanText(report.narrative?.round_story?.text),
      "",
      "THINGS TO REMEMBER"
    ];
    for (const item of report.learning_summary?.three_things_to_remember || []) {
      lines.push(`${cleanText(item.label)}: ${cleanText(item.text)}`);
    }
    lines.push("", "KEY LEARNING MOMENTS");
    for (const moment of report.learning_summary?.learning_moments || []) {
      lines.push(
        `Hole ${moment.hole_number}, Shot ${moment.stroke_number}: ${cleanText(moment.title)}`,
        `  Decision: ${cleanText(moment.decision)} / Execution: ${cleanText(moment.execution)} / Result: ${cleanText(moment.result)}`,
        `  Takeaway: ${cleanText(moment.takeaway)}`
      );
      const explanation = report.narrative?.learning_moment_explanations?.[moment.moment_id]?.text;
      if (explanation) lines.push(`  AI Caddie: ${cleanText(explanation)}`);
    }
    lines.push("", "PATTERNS ACROSS YOUR GAME");
    if (!report.patterns?.length) lines.push("No cross-round pattern has cleared the evidence threshold yet.");
    for (const pattern of report.patterns || []) lines.push(`${cleanText(pattern.label)}: ${cleanText(pattern.summary)}`);
    lines.push("", "NEXT-ROUND FOCUS");
    for (const [index, focus] of (report.learning_summary?.next_round_focus || []).entries()) {
      lines.push(`${index + 1}. ${cleanText(focus.title)} - ${cleanText(focus.action)}`);
    }
    lines.push("", "SCORECARD", "Hole / Par / Score / +/-");
    for (const hole of report.scorecard || []) {
      lines.push(`${hole.hole} / ${hole.par} / ${hole.score ?? "-"} / ${hole.relative_to_par == null ? "-" : score(hole.relative_to_par)}`);
    }
    lines.push("", "DETAILED MEANINGFUL-HOLE REVIEW");
    for (const hole of report.meaningful_holes || []) {
      lines.push("", `HOLE ${hole.hole} / PAR ${hole.par} / ${cleanText(hole.result)}`, `Why this hole matters: ${cleanText(hole.why_it_matters)}`);
      for (const shot of hole.shots || []) {
        lines.push(
          `Shot ${shot.stroke_number}: ${cleanText(shot.club)} / ${cleanText(shot.power_label)} / ${cleanText(shot.shot_type_label)}`,
          `  Decision: ${cleanText(shot.decision?.display)} / Execution: ${cleanText(shot.execution?.display)} / Outcome: ${cleanText(shot.result?.finish_lie || shot.result?.display)}`
        );
        if (shot.lesson) lines.push(`  Lesson: ${cleanText(shot.lesson)}`);
        if (shot.strategy) lines.push(`  Detailed Evidence: Strategy ${shot.strategy.score ?? "-"}; Preferred Miss ${cleanText(shot.strategy.preferred_miss || "Not declared")}; ${shot.strategy.reasons.map(cleanText).join(" / ")}`);
        if (shot.landing_target) lines.push(`  Landing Target: ${cleanText(JSON.stringify(shot.landing_target))}`);
        if (shot.adjustment) lines.push(`  Adjustment: ${cleanText(JSON.stringify(shot.adjustment))}`);
      }
    }
    lines.push("", "DETAILED SHOT EVIDENCE / APPENDIX");
    for (const shot of report.detailed_shots || []) {
      lines.push(
        `H${shot.hole_number} S${shot.stroke_number} / ${cleanText(shot.club)} / ${cleanText(shot.power_label)}`,
        `  ${cleanText(shot.decision?.display)} / ${cleanText(shot.execution?.display)} / ${cleanText(shot.result?.start_lie || "Start")} -> ${cleanText(shot.result?.finish_lie || "Recorded result")}`,
        `  Evidence refs: ${(shot.evidence_refs || []).join(", ")}`
      );
    }
    return lines;
  }
  const lines = [
    "POST-ROUND LEARNING REPORT",
    cleanText(report.course?.name || report.course?.id),
    `${cleanText(report.player?.name || "Player")} / ${cleanText(report.tee || "Tee")} tee`,
    `Exported ${cleanText(report.exported_at)}`,
    "",
    "GAME MASTER VERDICT",
    cleanText(report.report?.summary?.verdict),
    ""
  ];

  for (const stat of report.report?.summary?.stats || []) {
    lines.push(`${cleanText(stat.label)}: ${cleanText(stat.value)}${stat.detail ? ` / ${cleanText(stat.detail)}` : ""}`);
  }

  lines.push("", "SCORECARD");
  for (const hole of report.report?.scorecard || []) {
    lines.push(
      `Hole ${hole.hole}: Par ${hole.par} / ${hole.distance_yards} yd / Hcp ${hole.handicap} / ` +
      `Score ${hole.score ?? "-"}${hole.result ? ` (${cleanText(hole.result)})` : ""}`
    );
  }

  const holes = report.report?.meaningful_holes || [];
  lines.push("", "MEANINGFUL-HOLE REVIEW");
  if (!holes.length) lines.push("No hole met the learning-review threshold.");
  for (const hole of holes) {
    lines.push(
      "",
      `HOLE ${hole.hole_number} / Par ${hole.par} / ${hole.distance_yards} yd / Hcp ${hole.handicap} / ${cleanText(hole.score)}`,
      `${cleanText(hole.ai_caddie?.label || "AI Caddie insight")}: ${cleanText(hole.ai_caddie?.wording)}`
    );
    for (const shot of hole.shots || []) {
      lines.push(`Shot ${shot.shot_number}: ${cleanText(shot.club_and_power)}`);
      if (shot.decision) lines.push(`  Decision: ${cleanText(shot.decision)}`);
      if (shot.execution) lines.push(`  Execution: ${cleanText(shot.execution)}`);
      if (shot.strategy?.length) lines.push(`  Strategy: ${shot.strategy.map(cleanText).join(" / ")}`);
      if (shot.path) lines.push(`  Outcome: ${cleanText(shot.path)}`);
      if (shot.reasons?.length) lines.push(`  Evidence: ${shot.reasons.map(cleanText).join(" / ")}`);
      for (const context of shot.context || []) {
        lines.push(`  ${cleanText(context.label)}: ${cleanText(context.wording)}`);
      }
      if (shot.lesson) lines.push(`  Lesson: ${cleanText(shot.lesson)}`);
    }
  }
  return lines;
}

function pdfText(value) {
  return String(value ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2022/g, "-")
    .replace(/\u2192/g, "->")
    .replace(/\u00b7/g, "/")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLine(value, width = 92) {
  const text = pdfText(value).trim();
  if (!text) return [""];
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (line.length + word.length + 1 <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function buildPostRoundPdf(report) {
  const wrapped = reportTextLines(report).flatMap(line => wrapLine(line));
  const pageSize = 47;
  const pages = [];
  for (let index = 0; index < wrapped.length; index += pageSize) {
    pages.push(wrapped.slice(index, index + pageSize));
  }
  if (!pages.length) pages.push(["POST-ROUND LEARNING REPORT"]);

  const fontObject = 3;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  const pageReferences = [];
  pages.forEach((pageLines, pageIndex) => {
    const pageObject = 4 + pageIndex * 2;
    const contentObject = pageObject + 1;
    pageReferences.push(`${pageObject} 0 R`);
    const displayLines = [...pageLines, "", `Page ${pageIndex + 1} of ${pages.length}`];
    const stream = [
      "BT", "/F1 10 Tf", "50 750 Td", "14 TL",
      ...displayLines.map(line => `(${pdfText(line)}) Tj T*`),
      "ET"
    ].join("\n");
    objects[pageObject - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObject} 0 R >>`;
    objects[contentObject - 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[1] = `<< /Type /Pages /Kids [${pageReferences.join(" ")}] /Count ${pages.length} >>`;

  let pdf = "%PDF-1.4\n% Golf post-round report\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
