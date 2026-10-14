import { buildPostRoundReportModel } from "./post_round_report.mjs";
/** Evidence-first, reusable interpretation of an existing canonical round report.
 * Does not rescore shots, alter recorded events, infer swing faults or attribute strokes. */
export const COACHING_VERSION = 'post-round-coaching-v1';
export const COACHING_POLICY = Object.freeze({ minimum_pattern_count: 3, minimum_opportunities: 5, minimum_rate: .25 });
const SOUND = new Set(['PREFERRED_PLAN','COMPETITIVE_PLAN']);
const GRADED = new Set([...SOUND,'HIGHER_RISK_PLAN']);
const EXECUTION = new Set(['ON_PLAN_EXECUTION','ACCEPTABLE_EXECUTION','MISSED_EXECUTION']);
const phrase = {
  good_good: 'The model rated the plan as sound, and the shot stayed within its execution window.',
  good_poor: 'The plan was rated sound, but the shot did not match it. Review what happened before changing the plan.',
  poor_good: 'The shot stayed within its execution window, but the model flagged the plan for review. A successful shot does not remove the planning concern.',
  poor_poor: 'The model flagged the plan for review, and the shot missed its execution window. Review the choice and the execution separately.',
  uncertain: 'There is not enough consistent evidence to judge both the plan and the execution.',
  coach: 'This report shows where to look. A qualified golf coach can help you understand why it happened and decide what to work on next.'
};
const categoryRules = [
  ['club_selection','Carry margin','Check whether the selected club gives the intended carry enough margin.', ['CARRY_MARGIN_THIN']],
  ['target_selection','Target margin','Choose a target with more room for your normal miss.', ['PIN_ATTACK_NOT_JUSTIFIED','TARGET_TOO_AGGRESSIVE']],
  ['hazard_management','Hazard margin','Review the margin between your intended shot and the hazard.', ['HAZARD_UNDERWEIGHTED','OB_RISK_NOT_JUSTIFIED']],
  ['recovery_discipline','Recovery choice','Decide how to get back into position before trying to gain distance.', ['RECOVERY_NOT_TAKEN','HERO_SHOT_NOT_JUSTIFIED']],
  ['putting_read_discipline','Putting starting line','Compare the flagged putts with the modeled starting line before changing your routine.', ['PUTTING_LINE_MISSED']],
  ['putting_pace','Putting pace','Compare the flagged putts with the modeled pace before changing your routine.', ['PUTTING_PACE_MISSED']]
];
const codes = s => new Set([...(s.decision?.reason_codes || []),...(s.strategy?.reasons || [])].map(x=>String(x).toUpperCase()));
const refs = s => s.evidence_refs?.length ? [...s.evidence_refs] : [`shot:${s.shot_id}:assessment`];
const isPutt = s => String(s.shot_type || '').startsWith('putt_') || s.club === 'Putter';
const relative = n => n===0?'E':n>0?`+${n}`:String(n);
const finishLocation = s => {const lie=s.result?.finish_lie?.toLowerCase();return lie==='green'?'on the green':lie==='fairway'?'on the fairway':lie==='bunker'?'in a bunker':lie?`in ${lie}`:'at the recorded position';};
const scoreName = n => n===0?'Par':n===1?'Bogey':n===2?'Double bogey':n===-1?'Birdie':n===-2?'Eagle':`${relative(n)} to par`;
function classes(s) {
  const d=s.decision?.graded && GRADED.has(s.decision.label) ? (SOUND.has(s.decision.label)?'good':'poor') : 'uncertain';
  const e=s.execution?.graded && EXECUTION.has(s.execution.label) ? (s.execution.label==='MISSED_EXECUTION'?'poor':'good') : 'uncertain';
  return {decision:d, execution:e, meaning:d==='uncertain'||e==='uncertain'?'uncertain':`${d}_${e}`};
}
function contradictingShot(s) {
  const c=codes(s);
  return ['LINE','PACE'].some(k=>c.has(`PUTTING_${k}_RESPECTED`)&&c.has(`PUTTING_${k}_MISSED`)) ||
    (GRADED.has(s.decision?.label) && s.decision?.graded && s.decision.sound!==SOUND.has(s.decision.label)) ||
    (EXECUTION.has(s.execution?.label) && s.execution?.graded && s.execution.on_plan!==(s.execution.label!=='MISSED_EXECUTION'));
}
function eligible(count,denominator) {
  return count>=COACHING_POLICY.minimum_pattern_count && denominator>=COACHING_POLICY.minimum_opportunities && count/denominator>=COACHING_POLICY.minimum_rate;
}

export function improvePostRoundReport(input) {
  if(input?.schema_version!=='2.0'||!input.round||!input.summary||!Array.isArray(input.detailed_shots)||!Array.isArray(input.scorecard)) throw Error('Expected a canonical version 2 round report.');
  const report=structuredClone(input);
  const findings=[], flagged=[], dropped=[], corrected=structuredClone(input.coaching_review?.editor?.corrected_report_flags || []);
  const add=(id,kind,text,data,evidence_refs,mandatory=false)=>findings.push({id,kind,text,data,evidence_refs,confidence:'recorded_model_evidence',mandatory});
  const shots=report.detailed_shots;
  const clean=shots.filter(s=>!contradictingShot(s));
  for(const s of shots.filter(contradictingShot))flagged.push({id:`shot:${s.shot_id}`,reason:'contradictory_shot_classification',evidence_refs:refs(s)});
  const rows=report.scorecard.filter(r=>Number.isInteger(r.score)&&Number.isInteger(r.par));
  const score=rows.reduce((t,r)=>t+r.score,0),par=rows.reduce((t,r)=>t+r.par,0);
  const scoreConsistent=rows.length===report.round.holes_completed && score===report.round.score && par===report.round.par && score-par===report.round.relative_to_par;
  if(scoreConsistent && rows.length) add('score','score',`${report.round.status==='completed'?'You finished with':'Through the completed holes, your score is'} ${score} (${relative(score-par)}).`,{score,par,to_par:score-par,holes:rows.length},['round:score','scorecard'],true);
  else if(!scoreConsistent) flagged.push({id:'score',reason:'round_totals_disagree_with_scorecard',evidence_refs:['round:score','scorecard']});
  const pars=rows.filter(r=>r.score-r.par===0).length,bogeys=rows.filter(r=>r.score-r.par===1).length,doubles=rows.filter(r=>r.score-r.par===2).length;
  if(scoreConsistent && rows.length) {
    const counts=new Map();for(const r of rows){const n=r.score-r.par;counts.set(n,(counts.get(n)||0)+1);}
    const label=n=>n===0?'par':n===1?'bogey':n===2?'double bogey':n===-1?'birdie':n===-2?'eagle':n>2?`hole at ${n} over par`:`hole at ${n} under par`;
    const list=[...counts].sort((a,b)=>a[0]-b[0]).map(([n,count])=>`${count} ${label(n)}${count===1?'':'s'}`);
    const over=rows.filter(r=>r.score>r.par),grossOver=over.reduce((t,r)=>t+r.score-r.par,0),under=rows.filter(r=>r.score<r.par).reduce((t,r)=>t+r.par-r.score,0);
    add('scoring_distribution','score',`You made ${list.join(', ')}. ${over.length?`${over.length} holes finished over par, adding ${grossOver} strokes above par${under?`; ${under} strokes under par elsewhere offset part of that`:''}.`:'No completed hole finished over par.'}`,{pars,bogeys,double_bogeys:doubles,over_par_holes:over.map(r=>r.hole),gross_over_par:grossOver,under_par:under},['scorecard']);
  }
  const decisions=clean.filter(s=>classes(s).decision!=='uncertain'), executions=clean.filter(s=>classes(s).execution!=='uncertain');
  const good=decisions.filter(s=>classes(s).decision==='good').length,misses=executions.filter(s=>classes(s).execution==='poor');
  const counts={good_good:0,good_poor:0,poor_good:0,poor_poor:0,uncertain:0};for(const s of clean)counts[classes(s).meaning]++;
  if(decisions.length) add('decision_execution','interpretation',`${good===decisions.length?'The model rated your overall shot plans as sound.':`The model rated ${good} of ${decisions.length} plans as sound.`}${executions.length?` ${misses.length} recorded shots did not match their plans.`:' There is not enough execution evidence for a comparison.'}`,{sound:good,graded_decisions:decisions.length,missed_executions:misses.length,graded_executions:executions.length,combinations:counts},clean.flatMap(refs));
  else add('limited_evidence','uncertainty','There is not enough graded evidence for a reliable planning summary. Use the scorecard and recorded shots for review.',{graded_decisions:0},['summary:decision_quality'],true);
  const shortTags=clean.filter(s=>s.execution?.reason_codes?.includes('DISTANCE_SHORT_OF_PLAN'));
  const acceptedShort=shortTags.filter(s=>classes(s).execution==='good');
  if(acceptedShort.length)flagged.push({id:'short_distance_thresholds',reason:'short_distance_tag_can_coexist_with_acceptable_execution; do_not_count_all_tags_as_failures',count:shortTags.length,accepted_count:acceptedShort.length,evidence_refs:acceptedShort.flatMap(refs)});
  const opportunities=clean.filter(s=>!isPutt(s)&&classes(s).execution!=='uncertain');
  const byClub=new Map();for(const s of opportunities){if(!byClub.has(s.club))byClub.set(s.club,[]);byClub.get(s.club).push(s);}
  const patterns=[];
  for(const [club,pool]of byClub){const short=pool.filter(s=>classes(s).execution==='poor'&&s.execution.reason_codes.includes('DISTANCE_SHORT_OF_PLAN'));
    if(eligible(short.length,pool.length)){
      const id=`short_execution:${club}`;
      const text=`${short.length} of ${pool.length} graded non-putting shots with ${club} both finished short of plan and missed their execution windows. Review expected distance and execution together; this does not establish that the club choice was wrong.`;
      add(id,'within_round_pattern',text,{club,count:short.length,opportunities:pool.length,scope:'this_round'},short.flatMap(refs));patterns.push({pattern_id:id,kind:'within_round_distance_execution',label:`${club} distance review`,source:'this_round',sample_size:pool.length,count:short.length,scope:'this_round',summary:text,evidence_refs:short.flatMap(refs)});
    }else if(short.length)dropped.push({id:`short_execution:${club}`,reason:'below_initial_pattern_policy',count:short.length,opportunities:pool.length,evidence_refs:short.flatMap(refs)});
  }
  const safeMissPool=decisions.filter(s=>!isPutt(s));
  const safeMisses=safeMissPool.filter(s=>codes(s).has('GOOD_MISS_PLAN'));
  if(eligible(safeMisses.length,safeMissPool.length))add('safe_miss_planning','strength',`The model gave credit for miss planning on ${safeMisses.length} of ${safeMissPool.length} non-putting shots. Keep thinking about where a miss could finish when choosing your target.`,{count:safeMisses.length,opportunities:safeMissPool.length},safeMisses.flatMap(refs));
  const focus=[];
  const concernShots=decisions.filter(s=>categoryRules.some(rule=>rule[3].some(code=>codes(s).has(code))));
  for(const [category,title,action,rule]of categoryRules){const pool=decisions.filter(s=>category.startsWith('putting_')?isPutt(s):!isPutt(s));const matches=pool.filter(s=>rule.some(code=>codes(s).has(code)));
    if(eligible(matches.length,pool.length)){
      focus.push({type:'priority',title,action,evidence_refs:matches.flatMap(refs),count:matches.length,opportunities:pool.length,category});
      add(`planning_pattern:${category}`,'within_round_pattern',category==='putting_read_discipline'?`The model flagged the starting line on ${matches.length} of ${pool.length} putts. Review those putting plans even when their overall decision grades were sound.`:category==='putting_pace'?`The model flagged pace on ${matches.length} of ${pool.length} putts. Review those plans separately from how the putts were executed.`:`The model flagged ${title.toLowerCase()} on ${matches.length} of ${pool.length} comparable plans. ${action}`,{count:matches.length,opportunities:pool.length,category,scope:'this_round'},matches.flatMap(refs));
    }
  }
  const keyHoles=rows.map(row=>{const pool=clean.filter(s=>s.hole_number===row.hole);const issues=pool.filter(s=>['good_poor','poor_good','poor_poor'].includes(classes(s).meaning));return {...row,issues,pool};})
    .filter(h=>h.issues.length || h.score-h.par>=2).sort((a,b)=>(b.score-b.par)-(a.score-a.par)||b.issues.length-a.issues.length||a.hole-b.hole).slice(0,3);
  for(const h of keyHoles){const d=h.pool.filter(s=>classes(s).decision==='poor'),e=h.pool.filter(s=>classes(s).execution==='poor');
    const text=`Hole ${h.hole}: ${scoreName(h.score-h.par)} (${h.score} on par ${h.par}). ${e.length?`Shots ${e.map(s=>s.stroke_number).join(', ')} did not match their plans. `:''}${d.length?`${d.length} ${d.length===1?'plan was':'plans were'} flagged for review. `:''}${!d.length&&e.length?'Those plans were rated sound.':''}`;
    add(`key_hole:${h.hole}`,'example',text,{hole:h.hole,score:h.score,par:h.par,missed_shots:e.map(s=>s.shot_id),decision_reviews:d.map(s=>s.shot_id)},[`scorecard:h${h.hole}`,...h.pool.flatMap(refs)]);
  }
  const oldMoments=input.learning_summary?.learning_moments||[];
  for(const m of oldMoments){const s=shots.find(s=>s.hole_number===m.hole_number&&s.stroke_number===m.stroke_number);if(!s)continue;const c=codes(s);
    for(const [reason,code]of [['putting_read_failure','PUTTING_LINE_RESPECTED'],['putting_pace_failure','PUTTING_PACE_RESPECTED']])if(m.importance_reasons?.includes(reason)&&c.has(code))corrected.push({id:m.moment_id,removed_reason:reason,reason:'failure_flag_contradicted_respected_decision_evidence',evidence_refs:refs(s)});
  }
  const moments=clean.filter(s=>classes(s).meaning!=='uncertain'&&(classes(s).execution==='poor'||classes(s).decision==='poor'||concernShots.includes(s)||s.result?.penalty_strokes>0))
    .map(s=>{const c=classes(s),row=rows.find(r=>r.hole===s.hole_number);const reasons=[c.execution==='poor'?'execution_missed_window':null,c.decision==='poor'?'decision_review':null,s.result?.penalty_strokes>0?'penalty_recorded':null];const rc=codes(s);
      if(isPutt(s)&&rc.has('PUTTING_LINE_MISSED'))reasons.push('putting_read_failure');if(isPutt(s)&&rc.has('PUTTING_PACE_MISSED'))reasons.push('putting_pace_failure');
      return {moment_id:`${s.shot_id}:${c.meaning}`,hole_number:s.hole_number,stroke_number:s.stroke_number,type:concernShots.includes(s)&&c.meaning==='good_good'?'component_concern':c.meaning,title:`${s.club}: ${concernShots.includes(s)?'planning detail to review':c.decision==='good'?'sound plan':'plan to review'}, ${c.execution==='good'?'within the execution window':'missed execution window'}`,importance_score:Math.max(0,(row?.score||0)-(row?.par||0))*20+(s.result?.penalty_strokes||0)*10+(c.decision==='poor'?12:0)+(c.execution==='poor'?10:0),importance_reasons:reasons.filter(Boolean),decision:s.decision.display,execution:s.execution.display,result:s.result?.finish_lie||'Recorded result',shot_type:s.shot_type_label,takeaway:concernShots.includes(s)&&c.decision==='good'?'The overall plan was rated sound, but a specific planning detail was flagged. Review that detail rather than relying on the overall grade alone.':phrase[c.meaning],evidence_refs:refs(s)};})
    .sort((a,b)=>b.importance_score-a.importance_score||a.hole_number-b.hole_number||a.stroke_number-b.stroke_number).slice(0,5);
  if(!focus.length&&patterns.length)for(const p of patterns.slice(0,2))focus.push({type:'review',title:p.label,action:'Compare your expected distance with these recorded misses before changing clubs or your playing distances.',evidence_refs:p.evidence_refs});
  if(!focus.length&&keyHoles.length)focus.push({type:'review',title:'Review the key holes',action:`Review holes ${keyHoles.map(h=>h.hole).join(', ')}. Compare the intended shot with what happened before choosing a practice change.`,evidence_refs:keyHoles.map(h=>`scorecard:h${h.hole}`)});
  if(input.summary.practice_priority)dropped.push({id:'legacy_practice_priority',reason:'lowest_category_score_alone_is_not_evidence_of_a_weakness',value:input.summary.practice_priority,evidence_refs:['summary:practice_priority']});
  report.summary.practice_priority=focus.find(f=>f.type==='priority')?.category||null;
  report.summary.practice_priority_label=focus.find(f=>f.type==='priority')?.title||null;
  const storyIds=['score','scoring_distribution','decision_execution',...(focus.find(f=>f.type==='priority')?[`planning_pattern:${focus.find(f=>f.type==='priority').category}`]:[]),'limited_evidence'];
  const story=findings.filter(f=>storyIds.includes(f.id));
  report.learning_summary={three_things_to_remember:findings.filter(f=>f.kind==='strength'||f.kind==='interpretation'||f.kind==='within_round_pattern'||f.kind==='uncertainty').slice(0,3).map(f=>({type:f.kind,label:f.kind==='strength'?'Keep doing':f.kind==='interpretation'?'Plans and execution':'Evidence to review',text:f.text,evidence_refs:f.evidence_refs})),learning_moments:moments,next_round_focus:focus.slice(0,2)};
  report.patterns=[...(input.patterns||[]).filter(p=>p.source!=='this_round'),...patterns];
  report.meaningful_holes=keyHoles.map(h=>{const f=findings.find(f=>f.id===`key_hole:${h.hole}`);const {pool,issues,...row}=h;return {...row,why_it_matters:f.text,reason_count:h.issues.length,shots:h.pool};});
  const executionIds=new Set(misses.map(s=>s.shot_id));
  const planningIds=new Set(clean.filter(s=>classes(s).decision==='poor'||concernShots.includes(s)).map(s=>s.shot_id));
  const overlapIds=[...executionIds].filter(id=>planningIds.has(id));
  const uniqueIds=[...new Set([...executionIds,...planningIds])];
  const executionHoles=new Set(clean.filter(s=>executionIds.has(s.shot_id)).map(s=>s.hole_number));
  const planningHoles=new Set(clean.filter(s=>planningIds.has(s.shot_id)).map(s=>s.hole_number));
  const combinedHoles=new Set([...executionHoles,...planningHoles]);
  const overlapHoles=new Set([...executionHoles].filter(h=>planningHoles.has(h)));
  const overParFor=holes=>rows.filter(row=>holes.has(row.hole)).reduce((sum,row)=>sum+Math.max(0,row.score-row.par),0);
  const scoreOpportunity=scoreConsistent?{
    status:'observed_score_benchmark',baseline:'par',
    execution_over_par_strokes:overParFor(executionHoles),
    planning_over_par_strokes:overParFor(planningHoles),
    overlapping_over_par_strokes:overParFor(overlapHoles),
    combined_over_par_strokes:overParFor(combinedHoles),
    execution_holes:[...executionHoles],planning_holes:[...planningHoles],combined_holes:[...combinedHoles],
    definition:'Recorded over-par strokes on completed holes containing review flags. Each hole is counted once in the combined benchmark. This is a potential room-toward-par benchmark, not causal stroke attribution or a prediction of recoverable strokes.'
  }:null;
  const summaryStatistics={
    version:'review-opportunities-v1',score_opportunity:scoreOpportunity,
    missed_target_windows:{count:executionIds.size,opportunities:executions.length,shot_ids:[...executionIds],definition:'Graded MISSED_EXECUTION shots; not every deviation from an exact target point is a miss.'},
    planning_review:{count:planningIds.size,opportunities:decisions.length,shot_ids:[...planningIds],definition:'Higher-risk plans or explicit recognized component concerns; these are review candidates, not proven stroke-saving alternatives.'},
    overlap:{count:overlapIds.length,shot_ids:overlapIds},
    unique_review_shots:{count:uniqueIds.length,shot_ids:uniqueIds},
    execution_strokes_saved:null,planning_strokes_saved:null,combined_strokes_saved:null,
    stroke_estimate_status:'not_estimated',
    stroke_estimate_reason:'No validated alternative-shot or whole-round counterfactual is available. Counts must not be converted into strokes or added as independent stroke savings.'
  };
  const classifications=clean.map(s=>({shot_id:s.shot_id,...classes(s),phrase_id:classes(s).meaning,evidence_refs:refs(s)}));
  const sourceHoles=Array.isArray(input.source_round?.round_state?.holes)?input.source_round.round_state.holes:[];
  const gimmeCount=sourceHoles.flatMap(h=>h.events||[]).filter(e=>e.event_type==='shot_committed'&&e.completion_type==='gimme').reduce((t,e)=>t+Math.max(0,(e.stroke_count_delta||0)-1),0);
  const coverage={recorded_shots:shots.length,score:report.round.score,penalty_strokes:shots.reduce((t,s)=>t+(s.result?.penalty_strokes||0),0),gimme_strokes:gimmeCount,source_events_available:Array.isArray(input.source_round?.round_state?.holes)};
  coverage.score_reconciles=coverage.source_events_available?coverage.score===coverage.recorded_shots+coverage.penalty_strokes+gimmeCount:null;
  report.coaching_review={version:COACHING_VERSION,policy:COACHING_POLICY,summary_statistics:summaryStatistics,findings,shot_classifications:classifications,key_holes:keyHoles.map(h=>h.hole),coach_next_step:phrase.coach,editor:{mode:'approved_language',used_finding_ids:story.map(f=>f.id),dropped_findings:dropped,flagged_findings:flagged,corrected_report_flags:corrected},audit:{input_report_builder:input.coaching_review?.audit?.input_report_builder || input.report_builder_version,legacy_summary:input.coaching_review?.audit?.legacy_summary||structuredClone(input.summary),input_narrative_retained_for_audit:input.coaching_review?.audit?.input_narrative_retained_for_audit||structuredClone(input.narrative),assessment_scores_unchanged:true,decision_grading_audit:{all_graded_plans_sound:decisions.length>0&&good===decisions.length,sound_plans_with_explicit_concerns:concernShots.filter(s=>classes(s).decision==='good').map(s=>({shot_id:s.shot_id,reason_codes:[...codes(s)].filter(code=>categoryRules.some(rule=>rule[3].includes(code)))})),decision_labels:Object.fromEntries([...new Set(shots.map(s=>s.decision?.label))].map(label=>[label,shots.filter(s=>s.decision?.label===label).length])),strategy_score_histogram:Object.fromEntries([...new Set(shots.map(s=>s.strategy?.score).filter(Number.isFinite))].sort((a,b)=>a-b).map(score=>[score,shots.filter(s=>s.strategy?.score===score).length]))},score_coverage:coverage}};
  report.report_builder_version=COACHING_VERSION;
  report.narrative={status:'deterministic_fallback',provider:null,model:null,prompt_version:'coaching-editor-v1',schema_version:report.schema_version,report_version:report.report_version,round_story:{text:story.map(f=>f.text).join(' '),evidence_refs:[...new Set(story.flatMap(f=>f.evidence_refs))]},learning_moment_explanations:{},next_round_focus_explanations:{}};
  return report;
}

export function coachingEditorPacket(report) {
  if(!report.coaching_review)throw Error('Build coaching findings first.');
  return {version:COACHING_VERSION,findings:report.coaching_review.findings,flagged_findings:report.coaching_review.editor.flagged_findings,rules:['Use only approved finding IDs.','Preserve mandatory findings.','Do not add diagnoses, numbers, club recommendations or claims about strokes caused.','Keep uncertainty visible.','Unrecognized or contradictory findings must be omitted and flagged.']};
}

/** Optional AI may select approved sentences, never supply unverified factual prose. */
export function applyCoachingEditorialSelection(report,selection) {
  const next=structuredClone(report),review=next.coaching_review;
  if(!review)throw Error('Build coaching findings first.');
  const ids=selection?.used_finding_ids;
  const allowed=new Map(review.findings.map(f=>[f.id,f]));
  const invalid=!Array.isArray(ids)||ids.some(id=>!allowed.has(id))||new Set(ids).size!==ids.length||review.findings.some(f=>f.mandatory&&!ids.includes(f.id))||typeof selection.text==='string';
  if(invalid){review.editor.rejected_edit={reason:'unsupported_prose_or_unknown_or_missing_mandatory_findings'};return next;}
  review.editor.used_finding_ids=ids;review.editor.mode='validated_finding_selection';
  next.narrative.round_story={text:ids.map(id=>allowed.get(id).text).join(' '),evidence_refs:[...new Set(ids.flatMap(id=>allowed.get(id).evidence_refs))]};
  return next;
}

export function coachingReportMarkdown(report) {
  const r=report.coaching_review;if(!r)throw Error('Build coaching findings first.');
  const sections=['# Your round',`**${report.round.course_name} · ${report.round.tee} tee**`,report.narrative.round_story.text];
  const stats=r.summary_statistics;
  if(stats)sections.push('## Summary statistics',
    `- Shots that missed their target window: **${stats.missed_target_windows.count} of ${stats.missed_target_windows.opportunities} graded shots**.`,
    `- Shots with a planning concern to review: **${stats.planning_review.count} of ${stats.planning_review.opportunities} graded plans**.`,
    `- Shots appearing in both groups: **${stats.overlap.count}**.`,
    `- Different shots to review in total: **${stats.unique_review_shots.count}**.`,
    'A small miss from the exact target is not automatically a failed shot. These counts identify shots to review, not strokes lost.');
  if(stats?.score_opportunity){const o=stats.score_opportunity;sections.push('## Rough opportunity toward par',
    `- Over-par strokes on holes with missed shots: **${o.execution_over_par_strokes}**.`,
    `- Over-par strokes on holes with planning flags: **${o.planning_over_par_strokes}**.`,
    `- Potential room toward par across these holes: **${o.combined_over_par_strokes} strokes**, counting each hole once.`,
    'These are rough score-based opportunities to review, not predictions of strokes you will save. The same hole can contain both execution and planning issues, so the two figures cannot simply be added.');
  }else if(stats)sections.push('Potential strokes saved cannot be estimated from the available score evidence.');
  const strengths=r.findings.filter(f=>f.kind==='strength');
  if(strengths.length)sections.push('## What to keep doing',...strengths.map(f=>f.text));
  if(r.key_holes.length) sections.push('## What happened');
  for(const id of r.key_holes){const f=r.findings.find(f=>f.id===`key_hole:${id}`);sections.push(f.text);const shots=report.meaningful_holes.find(h=>h.hole===id)?.shots||[];for(const s of shots.filter(s=>s.execution.label==='MISSED_EXECUTION'||s.decision.label==='HIGHER_RISK_PLAN'))sections.push(`- Shot ${s.stroke_number}, ${s.club}: finished ${finishLocation(s)}${Number.isFinite(s.result?.remaining_yards)?`, ${s.result.remaining_yards} yards from the cup`:''}.`);}
  const patterns=r.findings.filter(f=>f.kind==='within_round_pattern'&&!r.editor.used_finding_ids.includes(f.id));
  if(patterns.length){sections.push('## Patterns worth reviewing',...patterns.map(f=>f.text));}
  sections.push('## Your next step',...(report.learning_summary.next_round_focus.length?report.learning_summary.next_round_focus.map(f=>f.action):['Keep recording comparable shots. There is not enough evidence for a specific practice priority.']),'## Review with a coach',r.coach_next_step,'## About this review','These are assessments from a simulated round. They do not establish a real-world swing fault, club problem or exact strokes lost. The detailed JSON preserves the recorded shot grades and includes evidence references and consistency checks.');
  const c=r.audit.score_coverage;if(c.score_reconciles&&c.gimme_strokes)sections.push(`The score includes ${c.gimme_strokes} conceded finishing putts. Those strokes are not separate graded shot decisions.`);
  return sections.join('\n\n')+'\n';
}

/** Build any new round through existing canonical scoring, then interpret its evidence. */
export function buildCoachingPostRoundReport(options) {
  return improvePostRoundReport(buildPostRoundReportModel(options));
}

export function coachingReportHtml(report) {
  const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const inline=value=>escape(value).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
  return coachingReportMarkdown(report).split('\n\n').filter(Boolean).map(block=>{
    if(block.startsWith('## '))return '<h3>'+inline(block.slice(3))+'</h3>';
    if(block.startsWith('# '))return '<h3>'+inline(block.slice(2))+'</h3>';
    if(block.startsWith('- '))return '<ul>'+block.split('\n').map(line=>'<li>'+inline(line.replace(/^- /,''))+'</li>').join('')+'</ul>';
    const hole=/^Hole (\d+): /.exec(block);
    return '<p>'+inline(block)+'</p>'+(hole?'<button type="button" class="secondary-action" data-report-hole="'+hole[1]+'">Review Hole '+hole[1]+' shots</button>':'');
  }).join('\n');
}
