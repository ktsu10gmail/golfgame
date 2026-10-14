import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../editor.js',import.meta.url),'utf8');
test('deleting a selected wand shape cancels the tool and preserves other shapes',()=>{
 const hole={features:[{id:'wand',type:'bunker'},{id:'keep',type:'fairway'}],gps_control_points:{bunker_feature_id:'wand'}};
 const context={Set,activeTool:'magic_wand',selectedFeatureId:'wand',selectedFeatureIds:new Set(['wand']),
 currentHole:()=>hole,selectedFeatures:()=>hole.features.filter(f=>context.selectedFeatureIds.has(f.id)),selectedFeature:()=>hole.features[0],
 setActiveTool:()=>{context.activeTool=null},recordUndo:()=>{context.undo=true},featureName:()=> 'Bunker',persistProject:()=>{},renderMappedHole:()=>{},setStatus:()=>{}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('function deleteSelectedFeatures()'),source.indexOf('function smoothSelectedOutline()')),context);
 assert.equal(context.deleteSelectedFeatures(),true);
 assert.equal(context.activeTool,null);assert.deepEqual(hole.features.map(f=>f.id),['keep']);
 assert.equal(hole.gps_control_points.bunker_feature_id,null);assert.equal(context.undo,true);
});
