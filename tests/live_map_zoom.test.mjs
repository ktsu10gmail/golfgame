import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function constrainLiveMapView('), source.indexOf('function onLiveMapMeasurePointerDown('));
function setup() {
  let view = [0,0,1000,1000];
  const reset = {hidden:true};
  const svg = {getAttribute: () => view.join(' '), setAttribute: (_,value) => {view=value.split(' ').map(Number);},
    getScreenCTM: () => ({inverse: () => ({x:view[0],y:view[1],scale:view[2]/1000})})};
  class Point {
    constructor(x,y) {this.x=x;this.y=y;}
    matrixTransform(m) {return {x:m.x+this.x*m.scale,y:m.y+this.y*m.scale};}
  }
  const ctx = {state:{liveGpsView:true,courseId:'test',holeIndex:0},DOMPoint:Point,
    bounded:(x,a,b)=>Math.max(a,Math.min(b,x)),$: selector => selector === '#course-map svg' ? svg : reset,
    hideMapDistancePreview(){},performance:{now:()=>100}};
  runInNewContext('let liveMapCamera=null;const liveMapTouches=new Map();let liveMapGesture=null;let liveMapGestureConsumed=false;let liveMapMeasurePointerId=null;let liveMapMeasureSurface=null;let suppressMapClickUntil=0;\n'+functions,ctx);
  const event = (id,x,y) => ({pointerId:id,pointerType:'touch',clientX:x,clientY:y,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}});
  return {ctx,event,view:()=>view,reset,suppressed:()=>runInNewContext('suppressMapClickUntil',ctx)};
}
test('pinch zoom anchors fingers and suppresses target taps after gesture',()=>{
  const {ctx,event,view,reset,suppressed}=setup();
  ctx.onLiveMapTouchDown(event(1,300,500));
  ctx.onLiveMapTouchDown(event(2,700,500));
  const move=event(2,900,500);ctx.onLiveMapTouchMove(move);
  assert.ok(Math.abs(view()[2]-1000/1.5)<.001);
  assert.ok(Math.abs(view()[0]+300*view()[2]/1000-300)<.001);
  assert.equal(move.stopped,true);assert.equal(reset.hidden,false);
  const end=event(2,900,500);ctx.onLiveMapTouchEnd(end);
  assert.equal(end.stopped,true);assert.ok(suppressed()>100);
  ctx.onLiveMapTouchEnd(event(1,300,500));
});
test('enlarged map pans, remains bounded, resets, and starts fresh on another hole',()=>{
  const {ctx,event,view,reset}=setup();
  ctx.onLiveMapTouchDown(event(1,300,500));ctx.onLiveMapTouchDown(event(2,700,500));
  ctx.onLiveMapTouchMove(event(2,1100,500));
  ctx.onLiveMapTouchEnd(event(2,1100,500));ctx.onLiveMapTouchEnd(event(1,300,500));
  const start=view()[0];
  ctx.onLiveMapTouchDown(event(3,500,500));ctx.onLiveMapTouchMove(event(3,450,500));
  assert.ok(view()[0]>start);
  ctx.onLiveMapTouchMove(event(3,-10000,500));
  assert.ok(view()[0]+view()[2]<=1000);
  ctx.onLiveMapTouchEnd(event(3,-10000,500));ctx.resetLiveMapCamera();
  assert.deepEqual(view(),[0,0,1000,1000]);assert.equal(reset.hidden,true);
  ctx.state.holeIndex=1;ctx.applyLiveMapCamera();assert.deepEqual(view(),[0,0,1000,1000]);
});
test('ordinary tap and full-scale measuring drag remain available; simulator ignores gestures',()=>{
  const {ctx,event,view,suppressed}=setup();
  ctx.onLiveMapTouchDown(event(1,500,500));
  const move=event(1,550,500);ctx.onLiveMapTouchMove(move);
  assert.equal(move.stopped,undefined);
  const end=event(1,550,500);ctx.onLiveMapTouchEnd(end);
  assert.equal(end.stopped,undefined);assert.equal(suppressed(),0);assert.deepEqual(view(),[0,0,1000,1000]);
  ctx.state.liveGpsView=false;ctx.onLiveMapTouchDown(event(2,300,500));ctx.onLiveMapTouchMove(event(2,500,500));
  assert.deepEqual(view(),[0,0,1000,1000]);
});
test('zoom limits preserve map aspect ratio',()=>{
  const {ctx}=setup();
  const result=ctx.constrainLiveMapView([-60,-80,1120,1160],[-500,-500,10,10]);
  assert.equal(result[0],-60);assert.equal(result[1],-80);
  assert.ok(Math.abs(result[2]-1120/6)<.000001);assert.ok(Math.abs(result[3]-1160/6)<.000001);
});
