import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { advanceIdentityEpoch } from "../src/features/realtime/identity-cache-policy.ts";
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let user=null,preview=false,reads=0,onCode=null,latest=null;
const href=p=>pathToFileURL(path.resolve(import.meta.dirname,"..",p)).href;
mock.module("@/hooks/useSession",{namedExports:{useSession:()=>({user,session:user?{user,access_token:`synthetic-token-${user.id}`}:null})}});
mock.module("@/lib/session-mode",{namedExports:{isPreviewSession:()=>preview}});
mock.module("@/lib/authed-fetch",{namedExports:{authedFetch:async()=>{
 reads++; return new Response(JSON.stringify({configured:true,people:[{id:`contact-${user.id}`,name:"Synthetic",initials:"S",avatarUrl:null,role:null}],syncedAt:null,contactCount:1,matchedCount:1}));
}}});
mock.module(href("src/features/contacts/google-contacts.ts"),{namedExports:{
 googleContactsClientId:()=>"synthetic-client",loadGoogleContactsSdk:async()=>({}),requestGoogleContactsCode:(_id,callback)=>onCode=callback,
}});
const {useGoogleContacts}=await import("../src/features/contacts/use-google-contacts.ts");
function Probe(){latest=useGoogleContacts(true);return null;}
const pause=async()=>act(async()=>{await new Promise(r=>setTimeout(r,30));});
test("contacts are gated before auth and in preview, and old account callbacks cannot sync into the new account",async()=>{
 const qc=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
 const view=()=>h(QueryClientProvider,{client:qc},h(Probe));
 let rendered;
 await act(async()=>{rendered=render(view());});await pause();assert.equal(reads,0);
 user={id:"preview"};preview=true;await act(async()=>rendered.rerender(view()));await pause();assert.equal(reads,0);
 preview=false;user={id:"a"};advanceIdentityEpoch(qc,{kind:"live",profileId:"a"});
 await act(async()=>rendered.rerender(view()));await pause();assert.equal(latest.people[0].id,"contact-a");
 await act(async()=>latest.sync());assert.equal(latest.syncing,true);const oldCallback=onCode;
 user={id:"b"};advanceIdentityEpoch(qc,{kind:"live",profileId:"b"});
 await act(async()=>rendered.rerender(view()));await pause();assert.equal(latest.people[0].id,"contact-b");
 const originalFetch=globalThis.fetch;let writes=[];
 globalThis.fetch=async(url,options)=>{writes.push({url,options});return new Response(JSON.stringify({ok:true}));};
 try{
  await act(async()=>oldCallback("late-code"));await pause();assert.equal(writes.length,0);
  await act(async()=>latest.sync());await act(async()=>onCode("synthetic-code"));await pause();
  assert.equal(writes.length,1);assert.equal(writes[0].options.headers.Authorization,"Bearer synthetic-token-b");
  assert.equal(writes[0].options.headers["X-Requested-With"],"KatalistGoogleContacts");
 }finally{globalThis.fetch=originalFetch;cleanup();qc.clear();}
});
