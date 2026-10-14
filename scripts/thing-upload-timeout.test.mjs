import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
let controller;
let storageCalls=0;
mock.method(AbortSignal,'timeout',()=>{controller=new AbortController();return controller.signal;});
mock.module('@/integrations/supabase/client',{namedExports:{supabase:{auth:{getUser:()=>new Promise(()=>{})},storage:{from:()=>{storageCalls++;throw new Error('must not proceed');}}}}});
mock.module('@/lib/authed-fetch',{namedExports:{authedFetch:()=>{throw new Error('must not proceed');}}});
const {uploadThingAttachment}=await import('../src/features/things/attachments.ts');
test('hung authentication exits upload and never starts later stages',async()=>{
 const pending=uploadThingAttachment('thing-1',{name:'image.png',size:10,type:'image/png'});
 controller.abort();
 await assert.rejects(pending,/Upload timed out/);
 assert.equal(storageCalls,0);
});
