import './dom-test-setup.mjs';
import assert from 'node:assert/strict';
import { test, mock, afterEach } from 'node:test';
import { act } from 'react';
import { renderHook, cleanup } from '@testing-library/react';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let handler;
let calls;
mock.module('@/lib/authed-fetch', { namedExports: { authedFetch: async (_url, init) => {
  const body = JSON.parse(init.body);
  calls.push({body, signal:init.signal});
  return handler(body, init.signal, calls.length);
} } });
const { useCoeyInterpretation } = await import('@/features/court/coey/use-coey-interpretation');
const reply = (body, extra = {}) => new Response(JSON.stringify({ok:true,schema_version:body.schema_version,request_id:body.request_id,draft_revision:body.draft_revision,latency_ms:5,interpretation:{things:[],gibberish:false,forwarded:false},...extra}));
afterEach(cleanup);
function mount() { calls=[]; return renderHook(({text,enabled=true})=>useCoeyInterpretation(text,'home',enabled),{initialProps:{text:'Water the plants'}}); }

test('a transient failure recovers inside the same send, without refreshing', async()=>{
 const {result}=mount();
 handler=(body,_signal,n)=>n===1?Promise.reject(new TypeError('Failed to fetch')):Promise.resolve(reply(body));
 let outcome; await act(async()=>{outcome=await result.current.resolveNow()});
 assert.equal(outcome.status,'ready'); assert.equal(calls.length,2);
});
test('pressing Toss again starts a fresh request after a transient failure exhausted recovery',async()=>{
 const {result}=mount();
 handler=async body=>reply(body,{ok:false,reason:'unavailable'});
 await act(async()=>{await result.current.resolveNow()});
 assert.equal(result.current.state.status,'failed');
 const before=calls.length; handler=async body=>reply(body);
 let outcome; await act(async()=>{outcome=await result.current.resolveNow()});
 assert.equal(outcome.status,'ready'); assert.equal(calls.length,before+1);
});
test('rate limits and authentication failures are not automatically retried',async()=>{
 for(const status of [401,403,409,429]){
  const {result,unmount}=mount(); handler=async()=>new Response('{}',{status});
  await act(async()=>{await result.current.resolveNow()});
  assert.equal(calls.length,1); assert.equal(result.current.state.status,'failed'); unmount();
 }
});
test('editing a failed draft cancels pending recovery and cannot apply the old response',async()=>{
 const {result,rerender}=mount();
 let fail; handler=()=>new Promise((_,reject)=>{fail=reject});
 let sending; await act(async()=>{sending=result.current.resolveNow()});
 await act(async()=>{fail(new TypeError('offline')); await Promise.resolve()});
 await act(async()=>{rerender({text:'Buy groceries'})});
 let old; await act(async()=>{old=await sending});
 assert.equal(calls.length,1,'superseded draft must not retry');
 assert.notEqual(result.current.state.status,'ready');
 assert.equal(calls[0].signal.aborted,true);
});
