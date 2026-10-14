import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('function updateMobileTargetDistance()'), source.indexOf('function updateShotDesk()'));
function readout({live, target, ball, liveBall, simulatorTarget = target}) {
  const label = {};
  const ctx = {state: {liveGpsView: live, gpsTargetPicking: live ? {point: target} : null, ball, target: simulatorTarget},
    liveGpsBallPoint: () => liveBall, distance: (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]),
    pin: () => ({center_point: [354,0]}), $: () => label, mapViewMode: () => 'full'};
  runInNewContext(helper + '\nupdateMobileTargetDistance();', ctx);
  return label.textContent;
}
test('GPS target readout uses recorded fairway ball instead of simulator tee', () => {
  assert.equal(readout({live:true,target:[350,0],ball:[0,0],liveBall:[200,0],simulatorTarget:[354,0]}),
    'Target · 150 yd from ball · 4 yd to pin');
});
test('simulator readout continues to use simulator ball', () => {
  assert.equal(readout({live:false,target:[350,0],ball:[0,0],liveBall:[200,0]}),
    'Target · 350 yd from ball · 4 yd to pin');
});
test('missing GPS position clears the old simulator distance', () => {
  assert.ok(readout({live:true,target:[350,0],ball:[0,0],liveBall:null}).startsWith('Tap the map'));
});
