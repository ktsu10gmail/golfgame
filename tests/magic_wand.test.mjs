import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMagicWandRegion, smoothWandOutline } from '../packages/editor/hazard_detection.mjs';
function image() {
  const width = 20, height = 20, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([0, 80, 0, 255], i * 4);
  const fill = (x,y,color=[220,200,140,255]) => data.set(color,(y*width+x)*4);
  return {width,height,data,fill};
}
test('wand selects only connected seed colors and retains a concave boundary', () => {
  const im = image();
  for(let y=2;y<10;y++)for(let x=2;x<5;x++) im.fill(x,y);
  for(let y=7;y<10;y++)for(let x=5;x<10;x++) im.fill(x,y);
  for(let y=12;y<16;y++)for(let x=12;x<16;x++) im.fill(x,y);
  const region=detectMagicWandRegion({...im,seedX:3,seedY:3,tolerance:0});
  assert.equal(region.pixels,39);
  assert.ok(region.points.length>4);
  assert.ok(region.points.every(p=>p.x<=10 && p.y<=10));
});
test('wand tolerance expands nearby color selection and rejects outside clicks', () => {
  const im=image();
  for(let y=3;y<8;y++)for(let x=3;x<8;x++) im.fill(x,y);
  for(let y=3;y<8;y++)im.fill(8,y,[230,210,150,255]);
  assert.equal(detectMagicWandRegion({...im,seedX:4,seedY:4,tolerance:0}).pixels,25);
  assert.equal(detectMagicWandRegion({...im,seedX:4,seedY:4,tolerance:10}).pixels,30);
  assert.throws(()=>detectMagicWandRegion({...im,seedX:-1,seedY:3}),/inside/);
  assert.throws(()=>detectMagicWandRegion({...im,seedX:4,seedY:4,tolerance:100}),/most/);
});

test('smoothing rounds pixel corners while retaining the local contour and bounding box', () => {
  const outline=[{x:0,y:0},{x:30,y:0},{x:30,y:10},{x:10,y:10},{x:10,y:30},{x:0,y:30}];
  assert.deepEqual(smoothWandOutline(outline,0),outline);
  const smooth=smoothWandOutline(outline,2);
  assert.ok(smooth.length<=960);
  assert.ok(smooth.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.y>=0&&p.x<=30&&p.y<=30));
  assert.ok(smooth.some(p=>Math.abs(p.x-10)<.1 && p.y>15),'concave edge retained');
  assert.ok(!smooth.some(p=>p.x===30&&p.y===0),'sharp corner rounded');
  assert.throws(()=>smoothWandOutline(outline,3),/strength/);
});
