import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createGpsRound, gpsRoundComplete, gpsRoundScore} from '../packages/gps/browser_gps_mode.mjs';
const source = fs.readFileSync(new URL('../app.js', import.meta.url),'utf8');
function fn(start,end) {return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
function environment(round) {
 const saved = new Map(); const screen={hidden:false};
 const ctx=vm.createContext({gpsRound:round,gpsPracticeActive:false,gpsCompletingRound:false,
  gpsFinishedUploadPromise:null,state:{player:{id:1},liveGpsView:true},navigator:{onLine:true},
  playerStorageKey:k=>k,localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},
  gpsRoundComplete,gpsRoundScore,JSON,Promise,AbortController,window:{setTimeout:()=>1,clearTimeout:()=>{}},
  setGpsSyncDisplay:()=>{}, $:()=>screen, document:{body:{classList:{remove:()=>{}}}},
  gpsSyncTimer:null,liveGpsPollTimer:null,gpsRoundStorageKey:()=> 'active',syncGameModeSelector:()=>{},resetHole:()=>{},showMobileShotToast:()=>{}});
 vm.runInContext(fn('function finishedGpsQueueKey()', 'function finishGpsGame()'),ctx);
 return {ctx,saved,screen};
}
test('active local game does not upload when callers schedule sync or call sync directly',async()=>{
 const {ctx}=environment(createGpsRound('test'));let calls=0;ctx.playerApi=()=>{calls++;};
 vm.runInContext(fn('async function syncGpsRound()', 'function gpsHoleState()'),ctx);
 vm.runInContext('scheduleGpsRoundSync()',ctx);await vm.runInContext('syncGpsRound()',ctx);assert.equal(calls,0);
});
test('finish exits immediately and stores the completed round before an unavailable upload',async()=>{
 const round=createGpsRound('test');round.ended_early=true;
 const {ctx,saved,screen}=environment(round);ctx.uploadFinishedGpsGames=()=>new Promise(()=>{});
 vm.runInContext(fn('async function finalizeGpsRound(', 'function gpsChangeHole('),ctx);
 await vm.runInContext('finalizeGpsRound({exitGame:true})',ctx);
 assert.equal(screen.hidden,true);assert.equal(ctx.state.liveGpsView,false);assert.equal(ctx.gpsRound,null);
 const queued=JSON.parse(saved.get('finished-gps-upload-queue'));assert.equal(queued[0].round_id,round.round_id);assert.deepEqual(queued[0].holes,round.holes);
});
for(const outcome of ['failure','conflict','success']) {
 test(`finished upload ${outcome} preserves data until explicit server confirmation`,async()=>{
  const round=createGpsRound('test');round.ended_early=true;
  const {ctx,saved}=environment(null);saved.set('finished-gps-upload-queue',JSON.stringify([round]));
  ctx.playerApi=async()=>{if(outcome==='failure')throw Error('poor reception');return outcome==='conflict'?{conflict:true}:{saved:true,complete:true};};
  await vm.runInContext('uploadFinishedGpsGames()',ctx);
  assert.equal(JSON.parse(saved.get('finished-gps-upload-queue')).length,outcome==='success'?0:1);
 });
}

test('local Live mode refresh reads the phone round without a server request',async()=>{
 const round=createGpsRound('test');round.local_only=true;
 const {ctx}=environment(round);let requests=0,rendered=0;
 ctx.fetchLatestGpsRoundForCourse=()=>{requests++;throw Error('network');};ctx.updateAll=()=>{rendered++;};
 vm.runInContext(fn('async function refreshLiveGpsRound(', 'function setCourseMapMode('),ctx);
 await vm.runInContext('refreshLiveGpsRound({followHole:false})',ctx);
 assert.equal(requests,0);assert.equal(rendered,1);assert.equal(ctx.state.liveGpsRound,round);
});
