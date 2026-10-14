import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('function nextGpsShotPage()'),source.indexOf('async function captureGpsLocation('));
test('Next Shot preserves score and outgoing club without recording a GPS fix',()=>{
 const hole={tee:{lie:'Tee'},shots:[],putts:0,pending_strategy:{club_name:'Driver'}};
 let saved=0;
 const ctx={gpsPagePreviewActive:()=>false,gpsHoleState:()=>hole,gpsCurrentFix:()=>hole.tee,structuredClone,
 persistGpsRound:()=>saved++,renderGpsMode:()=>{},$:()=>({scrollIntoView:()=>{}})};
 runInNewContext(fn+'\nnextGpsShotPage();nextGpsShotPage();',ctx);
 assert.equal(hole.awaiting_ball_location,true);
 assert.equal(hole.outgoing_strategy.club_name,'Driver');
 assert.equal(hole.shots.length,0);assert.equal(hole.putts,0);assert.equal(saved,1);
 assert.equal(hole.pending_strategy,null);
});
