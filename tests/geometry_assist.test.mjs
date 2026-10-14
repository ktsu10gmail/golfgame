import test from 'node:test';
import assert from 'node:assert/strict';
import {assistFeatures,assistHolePoints} from '../packages/editor/geometry_assist.mjs';
test('evidence overlay preserves project and geographic coordinates',()=>{
 const project={holes:{1:{markers:{blue_tee:{lat:35.29,lng:-78.97},pin:{lat:35.295,lng:-78.97}},route_points:[],features:[{type:'bunker',points:[{lat:35.291,lng:-78.97},{lat:35.292,lng:-78.97},{lat:35.291,lng:-78.969}]}]}}};
 const before=JSON.stringify(project);const evidence=assistFeatures(project);
 assert.equal(evidence.filter(f=>f.type==='bunker').length,1);
 assert.equal(evidence.find(f=>f.type==='route').points[1].lat,35.295);
 assert.equal(JSON.stringify(project),before);
});
test('invalid coordinates and absent geometry do not become features',()=>{
 assert.equal(assistFeatures({holes:{1:{features:[{type:'green',points:[{}, {}, {}]}],markers:{},route_points:[]}}}).length,0);
});

test('hole fitting excludes neighboring holes and preserves saved geometry',()=>{
 const project={holes:{'2':{features:[],markers:{blue_tee:{lat:35,lng:-78},pin:{lat:35.001,lng:-78}}},'9':{features:[],markers:{blue_tee:{lat:36,lng:-79},pin:{lat:36.001,lng:-79}}}}};
 const before=JSON.stringify(project);
 const points=assistHolePoints([project],2);
 assert.ok(points.length>0 && points.every(p=>p[0]<35.01));
 assert.deepEqual(assistHolePoints([project],1),[]);
 assert.equal(JSON.stringify(project),before);
});

import {traceProject} from '../packages/editor/geometry_assist.mjs';
const traceEvidence={course:{id:'test',revision:3},project:{course_id:'existing',holes:{'2':{features:[{id:'old',type:'green',points:[]}],markers:{pin:{lat:35,lng:-79}},gps_control_points:{preserved:true}}}},naip:{status:'available',image_bounds:[[34,-80],[36,-78]],service:'USGS',year:2022,raster_ids:[123],acquisition_dates:[],resolutions:[]}};
const trace={hole:'2',type:'bunker',points:[{lat:35,lng:-79},{lat:35.001,lng:-79},{lat:35,lng:-78.999}]};
test('explicit trace proposal adds geography and provenance without changing saved evidence',()=>{
 const before=JSON.stringify(traceEvidence);
 const result=traceProject(traceEvidence,trace,'trace-id','2026-10-12');
 assert.equal(JSON.stringify(traceEvidence),before);
 assert.equal(result.course_id,'existing');
 assert.deepEqual(result.holes['2'].features[0],traceEvidence.project.holes['2'].features[0]);
 assert.deepEqual(result.holes['2'].gps_control_points,{preserved:true});
 const added=result.holes['2'].features[1];
 assert.deepEqual(added.points,trace.points);assert.equal(added.provenance.classification,'INFERENCE_PROPOSAL');
 assert.equal(added.provenance.base_revision,3);assert.deepEqual(added.provenance.raster_ids,[123]);
});
test('invalid trace proposals reject missing holes, unsupported types, unavailable imagery and bad boundaries',()=>{
 for(const invalid of [{...trace,hole:'9'},{...trace,type:'tee'},{...trace,points:trace.points.slice(0,2)},{...trace,points:[...trace.points,{lat:0,lng:0}]},{...trace,points:[trace.points[0],trace.points[0],trace.points[2]]},{...trace,points:[{lat:35,lng:-79},{lat:35.001,lng:-78.999},{lat:35,lng:-78.999},{lat:35.001,lng:-79}]}]) assert.throws(()=>traceProject(traceEvidence,invalid,'id','now'));
 assert.throws(()=>traceProject({...traceEvidence,naip:{status:'unknown'}},trace,'id','now'));
});

 test('tee box traces preserve explicit roles and existing tee markers',()=>{
 for(const type of ['tee_blue','tee_white','tee_forward']) {
 const result=traceProject(traceEvidence,{...trace,type},'tee-trace','now');
 assert.equal(result.holes['2'].features.at(-1).type,type);
 assert.deepEqual(result.holes['2'].markers,traceEvidence.project.holes['2'].markers);
 }
});

import {editAssistProject} from '../packages/editor/geometry_assist.mjs';
test('shape reassignment preserves geometry, identity, markers and source provenance',()=>{
 const project=traceProject(traceEvidence,trace,'trace-id','now');
 project.holes['3']={features:[],markers:{blue_tee:{lat:35,lng:-79}}};
 const before=structuredClone(project);
 const changed=editAssistProject(project,{hole:'2',index:1},'reassign',{hole:'3',type:'green'},'later');
 assert.deepEqual(project,before);
 assert.equal(changed.holes['2'].features.length,1);
 const moved=changed.holes['3'].features[0];
 assert.equal(moved.id,'trace-id');assert.equal(moved.type,'green');
 assert.deepEqual(moved.points,before.holes['2'].features[1].points);
 assert.deepEqual(moved.provenance,before.holes['2'].features[1].provenance);
 assert.deepEqual(changed.holes['2'].markers,before.holes['2'].markers);
 assert.deepEqual(changed.holes['3'].markers,before.holes['3'].markers);
 assert.equal(moved.assist_edit_history[0].from_type,'bunker');
 const deleted=editAssistProject(changed,{hole:'3',index:0},'delete',null,'later');
 assert.equal(deleted.holes['3'].features.length,0);
 assert.equal(changed.holes['3'].features.length,1);
});
test('shape edits reject invalid selection and destination instead of changing another feature',()=>{
 for(const selection of [{hole:'9',index:0},{hole:'2',index:-1},{hole:'2',index:99},{hole:'2',index:'0'}]) assert.throws(()=>editAssistProject(traceEvidence.project,selection,'delete',null,'now'));
 for(const target of [{hole:'99',type:'green'},{hole:'2',type:'tee'}]) assert.throws(()=>editAssistProject(traceEvidence.project,{hole:'2',index:0},'reassign',target,'now'));
});
