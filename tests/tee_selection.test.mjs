import test from 'node:test';
import assert from 'node:assert/strict';
import { availableScorecardTees, selectedScorecardTee, originTeeYardage } from '../packages/simulation/tee_selection.mjs';
test('Aguila missing White uses Blue and its Blue map origin', () => {
 const row = {Yards_Blue:433,Yards_White:0,Yards_Red:387};
 const metadata = {default_start_tee:'blue',coordinate_system:{origin:'Blue tee marker (0, 0)'}};
 assert.deepEqual(availableScorecardTees(row), ['Blue','Red']);
 assert.equal(selectedScorecardTee(row,'White',metadata),'Blue');
 assert.equal(originTeeYardage(row,metadata),433);
 assert.equal(selectedScorecardTee(row,'Red',metadata),'Red');
 assert.equal(originTeeYardage(row,metadata)-row.Yards_Red,46);
});
test('legacy White-origin course retains White origin when Blue is selected', () => {
 const row = {Yards_Blue:420,Yards_White:400,Yards_Red:360};
 assert.equal(selectedScorecardTee(row,'Blue'),'Blue');
 assert.equal(originTeeYardage(row),400);
});

test('actual browser round-cache initialization handles Aguila Blue origin', async () => {
 const {readFileSync} = await import('node:fs');
 const {runInNewContext} = await import('node:vm');
 const source = readFileSync(new URL('../app.js', import.meta.url),'utf8');
 const fn = source.slice(source.indexOf('function syncRoundStateCaches()'),source.indexOf('function newRoundSeed()'));
 const state = {roundState:{tee:'Blue'},scorecard:[{Yards_Blue:433,Yards_White:0,Yards_Red:387}],
  holes:[{hole_metadata:{default_start_tee:'blue',coordinate_system:{origin:'Blue tee marker (0, 0)'}},
   centerline_waypoints:[{point:[0,0]},{point:[0,100]}],geometries:{green_complex:{pin_zones:[{center_point:[0,400]}]}}}],holeIndex:0,pinIndex:0};
 let initial;
 runInNewContext(fn+'\nsyncRoundStateCaches();',{state,selectedScorecardTee,originTeeYardage,METERS_TO_YARDS:1.09361,
  rotatingPinIndex:()=>0,distance:()=>433,
  buildRoundBrowserState:(_,values)=>{initial=values;return {scores:[null],round_history:[[]]};},
  syncActiveHoleStateFromRoundState:()=>{},persistLegacyRound:()=>{}});
 assert.equal(initial[0].ball[0],0);
 assert.equal(initial[0].ball[1],0);
 assert.equal(initial[0].remaining_distance_yards,433);
});
