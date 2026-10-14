import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createGpsRound} from '../packages/gps/browser_gps_mode.mjs';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('function startNewGpsRound()'),source.indexOf('function enterGpsMode()'));
test('new GPS game archives progress and starts a distinct empty nine-hole round',()=>{
 const old=createGpsRound('nine',9);old.holes[3].putts=2;
 const stored=new Map();let entered=false;
 const c={gpsPracticeActive:false,state:{courseId:'nine',holeIndex:3,liveGpsRound:old,gpsReplay:{}},gpsRound:old,
 loadGpsRound:()=>old,playerStorageKey:k=>k,gpsRoundStorageKey:()=> 'active',
 localStorage:{setItem:(k,v)=>stored.set(k,v)},createGpsRound,activeCourseHoleCount:()=>9,
 window:{clearTimeout:()=>{}},gpsSyncTimer:1,liveGpsPollTimer:2,
 rotatingPinIndex:()=>0,hole:()=>({geometries:{green_complex:{pin_zones:[{}]}}}),enterGpsMode:()=>{entered=true;}};
 runInNewContext(fn+'\nstartNewGpsRound();',c);
 assert.equal(JSON.parse(stored.get(`gps-round-archive-${old.round_id}`)).holes[3].putts,2);
 assert.notEqual(c.gpsRound.round_id,old.round_id);
 assert.equal(c.gpsRound.holes.length,9);
 assert.equal(c.gpsRound.holes[3].putts,0);
 assert.equal(c.state.holeIndex,0);assert.equal(entered,true);
});

test('saving previous game queues recorded strokes before clearing active data',()=>{
 const start=source.indexOf('function gpsRoundHasRecordedProgress(');
 const code=source.slice(start,source.indexOf('function openGpsMode()',start));
 const old=createGpsRound('nine',9);old.holes[0].putts=2;old.holes[0].tee={lat:25,lng:121};
 const stored=new Map([['active',JSON.stringify(old)]]);
 const ctx={gpsRound:old,loadGpsRound:()=>old,structuredClone,loadFinishedGpsQueue:()=>[],
 finishedGpsQueueKey:()=> 'queue',gpsRoundStorageKey:()=> 'active',
 localStorage:{setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
 openGpsMode:()=>{},$:()=>({open:false}),uploadFinishedGpsGames:()=>Promise.resolve()};
 runInNewContext(code+'\nsaveAndFinishPreviousGpsGames();',ctx);
 const queued=JSON.parse(stored.get('queue'))[0];
 assert.equal(queued.ended_early,true);assert.equal(queued.holes[0].putts,2);
 assert.equal(queued.holes[1].finished,false);assert.equal(stored.has('active'),false);
 assert.equal(ctx.gpsRound,null);
 assert.equal(ctx.gpsRoundHasRecordedProgress(createGpsRound('empty',9)),false);
});

test('New Game in Practice mode stays simulated and preserves real round storage',()=>{
 const old=createGpsRound('practice',9);old.practice=true;
 const stored=new Map([['real','existing real round']]);
 const c={gpsPracticeActive:true,state:{courseId:'practice'},gpsRound:old,loadGpsRound:()=>old,
  playerStorageKey:k=>k,gpsRoundStorageKey:()=> 'practice-active',localStorage:{setItem:(k,v)=>stored.set(k,v)},
  createGpsRound,activeCourseHoleCount:()=>9,window:{clearTimeout:()=>{}},gpsSyncTimer:null,liveGpsPollTimer:null,
  rotatingPinIndex:()=>0,hole:()=>({geometries:{green_complex:{pin_zones:[{}]}}}),enterGpsMode:()=>{}};
 runInNewContext(fn+'\nstartNewGpsRound();',c);
 assert.equal(c.gpsPracticeActive,true);
 assert.equal(c.gpsRound.practice,true);
 assert.equal(stored.get('real'),'existing real round');
});
