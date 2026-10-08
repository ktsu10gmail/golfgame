import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderIllustratedHolePrototype, prototypeTreePlacements, renderIllustratedTreeLayer } from '../packages/editor/illustrated_hole_prototype.mjs';
import { gamePreviewBounds, gamePreviewProjector } from '../packages/editor/game_map_preview.mjs';
const hole = JSON.parse(readFileSync(new URL('../data/warrenbrook-golf-course-new/hole1.json', import.meta.url)));
test('prototype is deterministic and leaves the real course data unchanged', () => {
  const before = JSON.stringify(hole);
  const svg = renderIllustratedHolePrototype(hole);
  assert.equal(renderIllustratedHolePrototype(hole), svg);
  assert.equal(JSON.stringify(hole), before);
  assert.match(svg, /fill:#4fb344;stroke:none/);
  assert.match(svg, /one-hole-prototype/);
  assert.ok(prototypeTreePlacements(hole).length > 30);
  assert.ok(prototypeTreePlacements(hole).length <= 900);
});
test('decorative tree centers never occupy the mapped fairway or green', () => {
  const project = gamePreviewProjector(gamePreviewBounds(hole));
  const polygons = [...hole.geometries.fairway_segments.map(item => item.polygon), hole.geometries.green_complex.polygon].map(polygon => polygon.map(project));
  function inside(point, polygon) {
    let result = false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
      const a=polygon[i],b=polygon[j];
      if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;
    }
    return result;
  }
  for(const tree of prototypeTreePlacements(hole))assert.ok(polygons.every(polygon=>!inside([tree.x,tree.y],polygon)));
});


test('tree density is halved again without moving retained trees', () => {
  const original = prototypeTreePlacements(hole, { density: 1 });
  const reduced = prototypeTreePlacements(hole);
  assert.equal(reduced.length, Math.round(original.length * .3));
  assert.ok(reduced.every(tree => original.some(candidate => candidate.x === tree.x && candidate.y === tree.y)));
});


test('tree canopies and shadows stay outside the tee-to-green approach corridor', () => {
  const project = gamePreviewProjector(gamePreviewBounds(hole));
  const origin = project([0,0]), unit = project([1,0]);
  const clearance = 12 * .9144 * Math.hypot(unit[0]-origin[0], unit[1]-origin[1]);
  const route = hole.centerline_waypoints.map(item => project(item.point));
  for (const tree of prototypeTreePlacements(hole)) {
    for(let index=1; index<route.length; index++) {
      const a=route[index-1],b=route[index],dx=b[0]-a[0],dy=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((tree.x-a[0])*dx+(tree.y-a[1])*dy)/(dx*dx+dy*dy||1)));
      const distance=Math.hypot(tree.x-a[0]-t*dx,tree.y-a[1]-t*dy);
      assert.ok(distance >= tree.radius*1.6+clearance);
    }
  }
});


test('prototype canopies are fifty percent larger than the original size range', () => {
  for (const tree of prototypeTreePlacements(hole)) {
    assert.ok(tree.radius >= 12 && tree.radius <= 24);
  }
});


test('illustrated style renders all eighteen saved Warrenbrook holes without data changes', () => {
  for (let number = 1; number <= 18; number += 1) {
    const courseHole = JSON.parse(readFileSync(new URL(`../data/warrenbrook-golf-course-new/hole${number}.json`, import.meta.url)));
    const original = JSON.stringify(courseHole);
    const svg = renderIllustratedHolePrototype(courseHole);
    assert.match(svg, /illustrated-hole/);
    assert.equal(JSON.stringify(courseHole), original);
  }
});


test('par three without fairway or mapped woods gets trees beside its clear playing corridor', () => {
  const parThree = structuredClone(hole);
  parThree.hole_metadata.par = 3;
  parThree.geometries.fairway_segments = [];
  parThree.geometries.tree_zones = [];
  const before = JSON.stringify(parThree);
  const trees = prototypeTreePlacements(parThree);
  assert.ok(trees.length > 10);
  assert.ok(trees.every(tree => tree.source === 'decorative_estimate'));
  const project = gamePreviewProjector(gamePreviewBounds(parThree));
  const origin = project([0,0]), unit = project([1,0]);
  const clearance = 12 * .9144 * Math.hypot(unit[0]-origin[0], unit[1]-origin[1]);
  const route = parThree.centerline_waypoints.map(item => project(item.point));
  for (const tree of trees) {
    for (let i=1;i<route.length;i++) {
      const a=route[i-1], b=route[i], dx=b[0]-a[0], dy=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((tree.x-a[0])*dx+(tree.y-a[1])*dy)/(dx*dx+dy*dy||1)));
      assert.ok(Math.hypot(tree.x-a[0]-t*dx,tree.y-a[1]-t*dy) >= tree.radius*1.6+clearance);
    }
  }
  assert.match(renderIllustratedHolePrototype(parThree), /decorative-forest/);
  assert.equal(JSON.stringify(parThree), before);
});


test('Alta Vista hole three uses double-size canopies without changing other holes', () => {
  const shortHole = structuredClone(hole);
  shortHole.hole_metadata.course_name = 'Alta Vista Country Club';
  shortHole.hole_metadata.hole_number = 3;
  shortHole.hole_metadata.par = 3;
  shortHole.geometries.fairway_segments = [];
  shortHole.geometries.tree_zones = [];
  const trees = prototypeTreePlacements(shortHole);
  assert.ok(trees.length > 0);
  assert.ok(trees.every(tree => tree.radius >= 24 && tree.radius <= 48));
  shortHole.hole_metadata.hole_number = 4;
  assert.ok(prototypeTreePlacements(shortHole).every(tree => tree.radius >= 12 && tree.radius <= 24));
});


test('game tree layer follows the active camera and never mutates geometry', () => {
  const before = JSON.stringify(hole);
  const first = renderIllustratedTreeLayer(hole, point => [point[0]*2+50, -point[1]*2+100]);
  const zoomed = renderIllustratedTreeLayer(hole, point => [point[0]*4+50, -point[1]*4+100]);
  assert.match(first, /pointer-events="none"/);
  assert.equal((first.match(/<use href=/g)||[]).length, prototypeTreePlacements(hole).length);
  assert.notEqual(first, zoomed);
  assert.equal(renderIllustratedTreeLayer(hole, point => [point[0]*2+50, -point[1]*2+100]), first);
  assert.equal(JSON.stringify(hole), before);
});
