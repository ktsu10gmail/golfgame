import test from 'node:test';
import assert from 'node:assert/strict';
import { runBatchInstall } from '../packages/editor/batch_install.mjs';
test('continues after a rejected course and preserves individual results', async () => {
 let active=0; const seen=[];
 const result=await runBatchInstall([{id:'a'},{id:'b'},{id:'c'}],{install:async item=>{assert.equal(active++,0); seen.push(item.id); await Promise.resolve();active--;if(item.id==='b')throw Error('Dev first');return ['verified'];}});
 assert.deepEqual(seen,['a','b','c']);assert.deepEqual(result.results.map(r=>r.status),['Installed','Failed','Installed']);assert.equal(result.results[1].message,'Dev first');assert.equal(result.stopped,false);
});
test('stop completes current course and does not start remaining courses',async()=>{
 let stop=false;const result=await runBatchInstall([{id:'a'},{id:'b'}],{install:async()=>{stop=true;return [];},shouldStop:()=>stop});assert.equal(result.results.length,1);assert.equal(result.stopped,true);
});
