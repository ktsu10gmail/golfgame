import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('marker-only start is Tee but later rough and bunker lies remain authoritative',()=>{
 const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const start=source.indexOf('function currentLieType()');
 const context={state:{ball:[0,0],shots:[],currentLie:'Trees'},teePoint:()=>[0,0],distance:(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]),lieAt:()=>({type:'Rough'})};
 vm.createContext(context);vm.runInContext(source.slice(start,source.indexOf('\nfunction ',start+1)),context);
 assert.equal(context.currentLieType(),'Tee');
 context.state.shots=[{}];context.state.currentLie='Bunker';assert.equal(context.currentLieType(),'Bunker');
 context.state.shots=[];context.state.ball=[10,0];context.state.currentLie=null;assert.equal(context.currentLieType(),'Rough');
});
