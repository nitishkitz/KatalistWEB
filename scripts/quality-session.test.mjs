import './dom-test-setup.mjs';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { createElement as h } from 'react';
import { act } from 'react';
import { render, cleanup } from '@testing-library/react';
let rejectSession=false;
mock.module('@/integrations/supabase/client',{namedExports:{supabase:{auth:{getSession:()=>rejectSession?Promise.reject(new Error('offline')):Promise.resolve({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}}}});
mock.module('@/integrations/supabase/rpcs',{namedExports:{callUngeneratedRpc:()=>Promise.resolve({data:null,error:null})}});
mock.module('@/lib/demo-flag',{namedExports:{demoEnabled:()=>true}});
mock.module('@/lib/fixed-otp',{namedExports:{localFixedOtpEnabled:()=>false}});
const {useSession,DEMO_PERSONAS}=await import('@/hooks/useSession');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let snapshots=[];
function Consumer(){const session=useSession();snapshots.push(session);return h('div',null,session.loading?'Loading':session.session?.user.id||'Signed out');}
test('preview identity is present in the first render before dependent read hooks mount',async()=>{
 localStorage.setItem('katalist_demo_session',JSON.stringify(DEMO_PERSONAS[0])); snapshots=[];
 await act(async()=>{render(h(Consumer));});
 assert.equal(snapshots[0].session.user.id,'demo-priya');cleanup();localStorage.clear();
});
test('rejected initial auth session read leaves loading and remains recoverable',async()=>{
 rejectSession=true;snapshots=[];localStorage.clear();
 await act(async()=>{render(h(Consumer));await new Promise(r=>setTimeout(r,0));});
 assert.equal(snapshots.at(-1).loading,false);assert.equal(snapshots.at(-1).session,null);cleanup();rejectSession=false;
});
