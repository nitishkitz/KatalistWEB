import './dom-test-setup.mjs';
import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {createElement as h,act} from 'react';
import {renderHook,cleanup} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
mock.module('@/hooks/useSession',{namedExports:{useSession:()=>({user:{id:'owner'},session:{}})}});
mock.module('@/features/context/use-app-context',{namedExports:{useAppContext:()=>({context:'home'})}});
mock.module('@/lib/session-mode',{namedExports:{isPreviewSession:()=>true}});
mock.module('@/features/things/local-state',{namedExports:{getBuckets:()=>[]}});
mock.module('@/features/things/use-local-version',{namedExports:{useLocalVersion:()=>0}});
mock.module('@/features/buckets/fetch-buckets',{namedExports:{fetchBuckets:async()=>[]}});
mock.module('@/integrations/supabase/client',{namedExports:{supabase:{}}});
let calls=0,finish;
let rejectCreate;
mock.module('@/features/things/rpc',{namedExports:{rpcCreateBucket:()=>{calls++;return new Promise((resolve,reject)=>{finish=resolve;rejectCreate=reject})},rpcDeleteBucket:async()=>{},rpcRenameBucket:async()=>{}}});
const {useBuckets}=await import('@/features/buckets/use-buckets');
test('overlapping create submissions issue one RPC and return the same created bucket',async()=>{
 const qc=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false,gcTime:0}}});
 const {result}=renderHook(()=>useBuckets(),{wrapper:({children})=>h(QueryClientProvider,{client:qc},children)});
 try{
 let a,b;
 await act(async()=>{a=result.current.create.mutateAsync('Weekend');b=result.current.create.mutateAsync('Weekend');await new Promise(r=>setTimeout(r,0))});
 const count=calls;
 await act(async()=>{finish({id:'created-bucket',name:'Weekend'});if(count===1)await Promise.all([a,b]);});
 assert.equal(count,1,'second submit must not INSERT another bucket');
 assert.deepEqual(await a,await b);
 }finally{cleanup();qc.clear()}
});


test('failed creates release the lock so the user can correct and retry',async()=>{
 calls=0;
 const qc=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false,gcTime:0}}});
 const {result}=renderHook(()=>useBuckets(),{wrapper:({children})=>h(QueryClientProvider,{client:qc},children)});
 try{
  let first;
  await act(async()=>{first=result.current.create.mutateAsync('Weekend').catch(e=>e);await new Promise(r=>setTimeout(r,0))});
  await act(async()=>{rejectCreate(new Error('network'));await first});
  let retry;
  await act(async()=>{retry=result.current.create.mutateAsync('Weekend');await new Promise(r=>setTimeout(r,0))});
  assert.equal(calls,2);
  await act(async()=>{finish({id:'created-on-retry'});await retry});
  assert.equal((await retry).id,'created-on-retry');
 }finally{cleanup();qc.clear()}
});
