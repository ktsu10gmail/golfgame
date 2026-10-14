import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { unionSimplePolygons } from '../packages/editor/polygon_union.mjs';
const source=fs.readFileSync(new URL('../editor.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('async function mergeHoleFairways()'),source.indexOf('function rotateSelectedFeature'));
function harness(disconnected=false) {
 const square=(x)=>[{lng:x,lat:0},{lng:x+10,lat:0},{lng:x+10,lat:10},{lng:x,lat:10}];
 const hole={features:[{id:'a',type:'fairway',points:square(0)},{id:'b',type:'fairway',points:square(disconnected?30:5)}]};
 const buttons=new Map(); let undo=0;
 const context={Set,Date,console,unionSimplePolygons,selectedFeatureIds:new Set(),selectedFeatureId:null,
 currentHole:()=>hole,selectedFeatures:()=>hole.features.filter(f=>context.selectedFeatureIds.has(f.id)),
 $:id=>{if(!buttons.has(id))buttons.set(id,{disabled:false});return buttons.get(id)},
 gpsDeltaMeters:(o,p)=>({east:p.lng-o.lng,north:p.lat-o.lat}),offsetGpsPoint:(o,e,n)=>({lng:o.lng+e,lat:o.lat+n}),
 window:{requestAnimationFrame:f=>f()},setStatus:message=>{context.message=message;context.$('#editor-status').textContent=message},
 recordUndo:()=>undo++,featureName:()=> 'Fairway',persistProject:()=>{},renderMappedHole:()=>{},setActiveTool:()=>{},renderSelectedFeature:()=>{}};
 vm.createContext(context);vm.runInContext(functions,context);
 return {context,hole,undo:()=>undo};
}
test('dedicated button merges overlapping current-hole fairways',async()=>{
 const h=harness();await h.context.mergeHoleFairways();assert.equal(h.hole.features.length,1);assert.equal(h.undo(),1);
});
test('disconnected fairways remain intact and merge button remains enabled',async()=>{
 const h=harness(true);await h.context.mergeHoleFairways();assert.equal(h.hole.features.length,2);assert.equal(h.undo(),0);assert.equal(h.context.$('#merge-fairways').disabled,false);assert.match(h.context.message,/touch or overlap/);
});
