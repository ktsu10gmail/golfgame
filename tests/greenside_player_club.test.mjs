import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function setup(){
 const state={ball:[0,0],selectedClub:0,profile:{clubs:[{name:'Sand Wedge',carry:75},{name:'Lob Wedge',carry:60},{name:'9 Iron',carry:120}]},shotDraft:{},structuredShot:{},swingPower:.5};
 const ctx={state,GREENSIDE_STRATEGY_VERSION:'test',greensideStrategyEligible:()=>true,pin:()=>({center_point:[0,20]}),greenEdgeDistanceOnCupLine:()=>10,greensideRollRatio:name=>name==='9 Iron'?1.5:name==='Lob Wedge'?.15:.4,bounded:(v,a,b)=>Math.max(a,Math.min(b,v)),distance:(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]),projectPointToward:(a,b,d)=>[a[0],a[1]+d],canonicalPoint:p=>p,coursePointFromCanonical:p=>p,centerOfPolygon:()=>[0,18],hole:()=>({geometries:{green_complex:{polygon:[]}}}),pointInPolygon:()=>true,solveShortGamePower:({desiredCarryYards,clubCarryYards})=>({power:desiredCarryYards/clubCarryYards,power_percent:100*desiredCarryYards/clubCarryYards,expected_carry_yards:desiredCarryYards}),liePenalty:()=>1,expectedShortGameRoll:({carryYards,rollRatio})=>carryYards*rollRatio,greenRollSlopeFactor:()=>1,structuredClone,escapeHtml:s=>s,shotPowerLabel:()=>'',AimType:{LANDING_TARGET:'landing'},ShotType:{CHIP_AND_RUN:'chip'},isGreensideChip:()=>true,rememberStructuredTarget(){},landingTargetActive:()=>true,syncLandingTargetPower(){ctx.recalculated=true;},updateAll(){},finePaceControl:()=>true,syncManualTargetPreview(){},renderMobileClubSelect(){},renderMobileQuickClubCarousel(){},renderMap(){},updateShotDesk(){},clearStrategyPlan(){state.strategySelectedId=null;}};
 for(const[name,end]of[['buildGreensideStrategyChoices','const strategyAnalysisCache'],['strategyChoiceMarkup','function renderStrategyChoices'],['selectStrategyChoice','function toggleDesktopCaddieChoices'],['setSelectedClub','function renderMobileClubSelect']]){runInNewContext(source.slice(source.indexOf('function '+name+'('),source.indexOf(end,source.indexOf('function '+name+'('))),ctx);}
 ctx.currentStrategyChoices=()=>ctx.buildGreensideStrategyChoices();return ctx;
}
test('three greenside targets stay fixed across player-selected wedges and iron',()=>{const c=setup();const before=c.buildGreensideStrategyChoices();for(const index of[1,2]){c.state.selectedClub=index;const after=c.buildGreensideStrategyChoices();assert.equal(after.length,3);assert.deepEqual(after.map(x=>x.target),before.map(x=>x.target));assert.ok(after.every(x=>x.clubIndex===index));assert.notEqual(after[0].rollYards,before[0].rollYards);}});
test('greenside cards describe targets without recommending a club',()=>{const c=setup();for(const choice of c.buildGreensideStrategyChoices()){const html=c.strategyChoiceMarkup(choice);assert.ok(html.includes(choice.objective));assert.ok(html.includes(`<strong>${choice.title}</strong>`));assert.doesNotMatch(html,/Sand Wedge|Lob Wedge|9 Iron/);}});
test('choosing a plan retains club and switching club retains chosen target',()=>{const c=setup();c.state.selectedClub=1;c.selectStrategyChoice('greenside-soft-pitch');assert.equal(c.state.selectedClub,1);const target=c.state.target;const id=c.state.strategySelectedId;c.setSelectedClub(0);assert.equal(c.state.selectedClub,0);assert.equal(c.state.strategySelectedId,id);assert.equal(c.state.target,target);assert.ok(c.recalculated);});

test('all greenside help dialogs explain targets without suggesting clubs or requesting club advice',async()=>{
 const c=setup();const elements=new Map();c.$=id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',dataset:{},showModal(){this.open=true;}});return elements.get(id);};c.strategyAnalysisCache=new Map();c.strategyAnalysisKey=()=> 'test';c.loadStrategyAnalysis=()=>Promise.resolve({});c.renderStrategyProbabilityAnalysis=()=>{};let aiRequests=0;c.requestAiStrategyCritique=()=>{aiRequests++;};c.strategyOutlookLabel=()=> 'Option';c.console=console;
 for(const[name,end]of[['renderStrategyExplanationReasons','function strategyOutcome'],['showStrategyExplanation','function aiStrategyPayload']])runInNewContext(source.slice(source.indexOf('function '+name+'('),source.indexOf(end,source.indexOf('function '+name+'('))),c);
 for(const choice of c.buildGreensideStrategyChoices()){
  c.showStrategyExplanation(choice.id);
  assert.equal(c.$('#strategy-explanation-club').textContent,'Choose your own club');
  assert.match(c.$('#strategy-explanation-reasons').innerHTML,/pick your own club/);
  assert.doesNotMatch(c.$('#strategy-explanation-club').textContent,/Wedge|Iron/);
  assert.match(c.$('#strategy-ai-advice').textContent,/no club is recommended/);
  await Promise.resolve();
 }
 assert.equal(aiRequests,0);
});
