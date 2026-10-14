import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{improvePostRoundReport,coachingReportMarkdown,coachingEditorPacket,applyCoachingEditorialSelection,buildCoachingPostRoundReport,coachingReportHtml}from'../packages/presentation/post_round_coaching.mjs';
const original=JSON.parse(readFileSync(new URL('./fixtures/post_round_20261013_evidence.json',import.meta.url),'utf8'));
const one=(id,decision='PREFERRED_PLAN',execution='ON_PLAN_EXECUTION')=>({shot_id:id,hole_number:Number(id.match(/h(\d+)/)[1]),stroke_number:Number(id.match(/s(\d+)/)[1]),club:'Driver',shot_type:'tee_positioning',shot_type_label:'Tee shot',decision:{label:decision,graded:decision!=='DECISION_NOT_GRADED',sound:['PREFERRED_PLAN','COMPETITIVE_PLAN'].includes(decision),reason_codes:[],display:decision==='HIGHER_RISK_PLAN'?'Decision to Review':'Sound Decision'},execution:{label:execution,graded:execution!=='EXECUTION_NOT_GRADED',on_plan:['ON_PLAN_EXECUTION','ACCEPTABLE_EXECUTION'].includes(execution),reason_codes:[],display:execution==='MISSED_EXECUTION'?'Missed Plan':'On Plan'},result:{finish_lie:'Fairway',remaining_yards:50,penalty_strokes:0},strategy:{score:85,reasons:[]},evidence_refs:[`shot:${id}:assessment`]});
function example(shots){const x=structuredClone(original);x.detailed_shots=shots;x.learning_summary.learning_moments=[];return x;}
test('supplied round keeps original scores and shot evidence, corrects flags and drops unsupported priority',()=>{
 const before=structuredClone(original),r=improvePostRoundReport(original);
 assert.deepEqual(original,before);assert.deepEqual(r.round,original.round);assert.deepEqual(r.scorecard,original.scorecard);assert.deepEqual(r.detailed_shots,original.detailed_shots);
 assert.equal(r.summary.practice_priority,'putting_read_discipline');assert.equal(r.coaching_review.editor.corrected_report_flags.length,6);assert.deepEqual(r.coaching_review.key_holes,[9,17,11]);
 for(const m of r.learning_summary.learning_moments){const s=original.detailed_shots.find(s=>s.hole_number===m.hole_number&&s.stroke_number===m.stroke_number);if(m.importance_reasons.includes('putting_read_failure'))assert.ok(s.decision.reason_codes.includes('PUTTING_LINE_MISSED'));if(m.importance_reasons.includes('putting_pace_failure'))assert.ok(s.decision.reason_codes.includes('PUTTING_PACE_MISSED'));}
 assert.equal(r.coaching_review.audit.score_coverage.gimme_strokes,7);assert.equal(r.coaching_review.audit.score_coverage.score_reconciles,true);
 assert.match(r.narrative.round_story.text,/81 \(\+10\)/);assert.match(r.narrative.round_story.text,/15 recorded shots/);assert.match(r.narrative.round_story.text,/starting line on 11 of 26 putts/);assert.doesNotMatch(r.narrative.round_story.text,/Club Selection|swing fault/);
});
test('accepted short-distance tags do not create execution failures or a practice priority',()=>{
 const shots=Array.from({length:8},(_,i)=>one(`h1:s${i+1}`));shots.forEach(s=>s.execution.reason_codes=['DISTANCE_SHORT_OF_PLAN']);const r=improvePostRoundReport(example(shots));
 assert.equal(r.patterns.filter(p=>p.source==='this_round').length,0);assert.equal(r.coaching_review.findings.find(f=>f.id==='decision_execution').data.missed_executions,0);
 assert.equal(r.coaching_review.editor.flagged_findings.find(f=>f.id==='short_distance_thresholds').accepted_count,8);
});
test('repeated driver short misses include count and opportunities without blaming club selection',()=>{
 const shots=Array.from({length:8},(_,i)=>one(`h1:s${i+1}`,'PREFERRED_PLAN',i<3?'MISSED_EXECUTION':'ON_PLAN_EXECUTION'));shots.slice(0,3).forEach(s=>s.execution.reason_codes=['DISTANCE_SHORT_OF_PLAN']);const r=improvePostRoundReport(example(shots));
 const p=r.patterns.find(p=>p.source==='this_round');assert.equal(p.count,3);assert.equal(p.sample_size,8);assert.match(p.summary,/does not establish that the club choice was wrong/);assert.equal(r.summary.practice_priority,null);
});
test('specific planning priority requires recurring explicit decision evidence',()=>{
 const shots=Array.from({length:8},(_,i)=>one(`h1:s${i+1}`,i<3?'HIGHER_RISK_PLAN':'PREFERRED_PLAN'));shots.slice(0,3).forEach(s=>s.decision.reason_codes=['CARRY_MARGIN_THIN']);const r=improvePostRoundReport(example(shots));assert.equal(r.summary.practice_priority,'club_selection');assert.match(r.learning_summary.next_round_focus[0].action,/carry enough margin/);
});
test('four decision/execution combinations remain separate and uncertain shots are not called poor',()=>{
 const shots=[one('h1:s1'),one('h1:s2','PREFERRED_PLAN','MISSED_EXECUTION'),one('h1:s3','HIGHER_RISK_PLAN'),one('h1:s4','HIGHER_RISK_PLAN','MISSED_EXECUTION'),one('h1:s5','DECISION_NOT_GRADED','EXECUTION_NOT_GRADED')];
 assert.deepEqual(improvePostRoundReport(example(shots)).coaching_review.shot_classifications.map(s=>s.meaning),['good_good','good_poor','poor_good','poor_poor','uncertain']);
});
test('contradictory putting classification is flagged and withheld from findings',()=>{
 const s=one('h1:s1');s.club='Putter';s.shot_type='putt_lag';s.decision.reason_codes=['PUTTING_LINE_RESPECTED','PUTTING_LINE_MISSED'];const r=improvePostRoundReport(example([s]));assert.equal(r.coaching_review.shot_classifications.length,0);assert.ok(r.coaching_review.editor.flagged_findings.some(f=>f.reason==='contradictory_shot_classification'));assert.match(r.narrative.round_story.text,/not enough graded evidence/);
});
test('genuine putting planning misses retain failure reasons; a holed respected putt does not',()=>{
 const a=one('h1:s1','HIGHER_RISK_PLAN','MISSED_EXECUTION');a.club='Putter';a.shot_type='putt_lag';a.decision.reason_codes=['PUTTING_LINE_MISSED','PUTTING_PACE_MISSED'];const b=one('h1:s2');b.club='Putter';b.shot_type='putt_make_attempt';b.decision.reason_codes=['PUTTING_LINE_RESPECTED','PUTTING_PACE_RESPECTED'];b.execution.reason_codes=['PUTT_HOLED'];const r=improvePostRoundReport(example([a,b]));assert.ok(r.learning_summary.learning_moments[0].importance_reasons.includes('putting_read_failure'));assert.ok(!r.learning_summary.learning_moments.some(m=>m.stroke_number===2));
});
test('birdies offset gross over-par scores rather than being incorrectly attributed',()=>{
 const x=example([]);x.scorecard=[{hole:1,score:3,par:4},{hole:2,score:6,par:4}];x.round={...x.round,score:9,par:8,relative_to_par:1,holes_completed:2};const r=improvePostRoundReport(x),f=r.coaching_review.findings.find(f=>f.id==='scoring_distribution');assert.equal(f.data.gross_over_par,2);assert.equal(f.data.under_par,1);assert.match(f.text,/offset part/);
});
test('score contradiction is flagged rather than silently corrected or narrated',()=>{
 const x=structuredClone(original);x.round.score=82;const r=improvePostRoundReport(x);assert.equal(r.round.score,82);assert.ok(r.coaching_review.editor.flagged_findings.some(f=>f.id==='score'));assert.ok(!r.coaching_review.findings.some(f=>f.id==='score'));
});
test('empty/in-progress round permits a short uncertain report with no invented focus',()=>{
 const x=example([]);x.scorecard=[];x.round={...x.round,status:'in_progress',score:0,par:0,relative_to_par:0,holes_completed:0};const r=improvePostRoundReport(x);assert.equal(r.learning_summary.next_round_focus.length,0);assert.match(coachingReportMarkdown(r),/not enough graded evidence/);assert.doesNotMatch(coachingReportMarkdown(r),/You made \./);
});
test('optional editor rejects unsupported prose/IDs and omission of mandatory score',()=>{
 const r=improvePostRoundReport(original);for(const selection of[{used_finding_ids:['invented']},{used_finding_ids:['decision_execution']},{used_finding_ids:['score'],text:'A bad swing caused all ten strokes.'}])assert.ok(applyCoachingEditorialSelection(r,selection).coaching_review.editor.rejected_edit);
 const edited=applyCoachingEditorialSelection(r,{used_finding_ids:['score','decision_execution']});assert.match(edited.narrative.round_story.text,/81 \(\+10\)/);assert.equal(edited.coaching_review.editor.mode,'validated_finding_selection');assert.ok(!('detailed_shots'in coachingEditorPacket(r)));
});
test('readable report uses key-hole facts, short language and a coach next step',()=>{
 const text=coachingReportMarkdown(improvePostRoundReport(original));assert.match(text,/Hole 9: Double bogey/);assert.match(text,/Hole 17: Double bogey/);assert.match(text,/qualified golf coach/);assert.match(text,/7 conceded/);assert.doesNotMatch(text,/Club Selection is the first practice priority|putting_read_failure/);
});


test('fresh rounds can use the reusable builder without changing the canonical scoring engine',()=>{
 const shot={club:'Driver',power:100,lie:'Fairway',canonicalAssessment:{assessment_version:'1.0',decision:{label:'HIGHER_RISK_PLAN',reason_codes:['TARGET_TOO_AGGRESSIVE']},execution:{label:'ON_PLAN_EXECUTION',score:86,reason_codes:[]},result:{label:'GOOD_RESULT'},evidence:{}},strategyPacket:{version:'strategy-v1',decision:{score:70,label:'review',reasons:['target_too_aggressive'],subscores:{target_selection:70,club_selection:85}},execution:{score:86,label:'matched_plan',reasons:[]}}};
 const r=buildCoachingPostRoundReport({roundId:'test-round',course:{id:'test',name:'Test course'},tee:'White',scorecard:[{Hole:1,Par:4,Handicap:1,Yards_White:380}],scores:[5],roundHistory:[[shot]]});
 assert.equal(r.round.score,5);assert.equal(r.detailed_shots[0].decision.label,'HIGHER_RISK_PLAN');assert.equal(r.coaching_review.shot_classifications[0].meaning,'poor_good');
});


test('live report renders escaped coaching text and navigable key-hole evidence',()=>{
 const r=improvePostRoundReport(original);r.round.course_name='<img src=x onerror=alert(1)>';
 const html=coachingReportHtml(r);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(html.includes('data-report-hole="9"'));assert.ok(html.includes('data-report-hole="17"'));
});

test('PDF export uses the approved coaching report without legacy ranking advice',async()=>{
 const {buildPostRoundPdf}=await import('../packages/presentation/post_round_export.mjs');
 const pdf=new TextDecoder().decode(buildPostRoundPdf(improvePostRoundReport(original)));
 assert.ok(pdf.startsWith('%PDF-'));assert.ok(pdf.includes('What to keep doing'));assert.ok(pdf.includes('qualified golf coach'));assert.ok(!pdf.includes('Practice Next: Club Selection'));
});


test('summary counts overlapping execution and planning opportunities once without inventing strokes',()=>{
 const a=one('h1:s1','HIGHER_RISK_PLAN','MISSED_EXECUTION');
 const b=one('h1:s2','PREFERRED_PLAN','MISSED_EXECUTION');
 const c=one('h1:s3');c.decision.reason_codes=['PUTTING_LINE_MISSED'];c.club='Putter';c.shot_type='putt_lag';
 const r=improvePostRoundReport(example([a,b,c])),stats=r.coaching_review.summary_statistics;
 assert.equal(stats.missed_target_windows.count,2);assert.equal(stats.planning_review.count,2);assert.equal(stats.overlap.count,1);assert.equal(stats.unique_review_shots.count,3);
 assert.equal(stats.execution_strokes_saved,null);assert.equal(stats.planning_strokes_saved,null);assert.equal(stats.combined_strokes_saved,null);assert.equal(stats.stroke_estimate_status,'not_estimated');assert.match(coachingReportMarkdown(r),/Summary statistics/);
});

test('upgrading a previously composed report preserves original evidence and corrected flag audit',()=>{
 const first=improvePostRoundReport(original);delete first.coaching_review.summary_statistics;
 const updated=improvePostRoundReport(first);assert.deepEqual(updated.detailed_shots,original.detailed_shots);assert.equal(updated.coaching_review.editor.corrected_report_flags.length,6);assert.ok(updated.coaching_review.summary_statistics);assert.deepEqual(updated.coaching_review.audit.legacy_summary,original.summary);
});


test('rough score opportunity counts each overlapping hole once, never each flagged shot as a stroke',()=>{
 const r=improvePostRoundReport(original),o=r.coaching_review.summary_statistics.score_opportunity;
 assert.equal(o.execution_over_par_strokes,8);assert.equal(o.planning_over_par_strokes,5);assert.equal(o.overlapping_over_par_strokes,4);assert.equal(o.combined_over_par_strokes,9);
 assert.equal(r.coaching_review.summary_statistics.combined_strokes_saved,null);assert.match(coachingReportMarkdown(r),/not predictions of strokes you will save/);
 const a=one('h1:s1','HIGHER_RISK_PLAN','MISSED_EXECUTION'),b=one('h1:s2','HIGHER_RISK_PLAN','MISSED_EXECUTION');
 const sameHole=improvePostRoundReport(example([a,b])).coaching_review.summary_statistics.score_opportunity;
 assert.equal(sameHole.execution_over_par_strokes,1);assert.equal(sameHole.planning_over_par_strokes,1);assert.equal(sameHole.combined_over_par_strokes,1);
});

test('inconsistent scores withhold the rough score opportunity benchmark',()=>{
 const x=structuredClone(original);x.round.score=100;assert.equal(improvePostRoundReport(x).coaching_review.summary_statistics.score_opportunity,null);
});
