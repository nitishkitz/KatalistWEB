import assert from "node:assert/strict";
import { test, mock, beforeEach } from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";
const href = p => pathToFileURL(path.resolve(import.meta.dirname,"..",p)).href;
const OWNER="11111111-1111-4111-8111-111111111111";
let denied=false, fetched=0, writes=[], configured=true, reads=[], failed=false;
const config={clientId:"test",clientSecret:"synthetic",origin:"https://example.test"};
mock.module("h3",{namedExports:{defineEventHandler:f=>f,readBody:async e=>e.body,getHeader:(e,n)=>e.headers?.[n],setResponseHeader(){},createError:o=>Object.assign(new Error(o.message),o)}});
mock.module(href("server/lib/require-user.ts"),{namedExports:{requireUser:async()=>{if(denied)throw Object.assign(new Error("unauthorized"),{statusCode:401});return {userId:OWNER};}}});
mock.module(href("server/lib/contacts/google.ts"),{namedExports:{
 googleContactsConfig:()=>configured?config:null,
 readGoogleContacts:async()=>{fetched++;if(failed)throw new Error("Google failed");return [{resource:"people/synthetic",emails:["synthetic@example.test"],phones:[],name:"Synthetic"}];}
}});
mock.module(href("server/lib/supabase-admin.ts"),{namedExports:{getSupabaseAdmin:()=>({
 rpc:async(name,args)=>{writes.push({name,args});return {data:1,error:null};},
 from:table=>{const q={select:()=>q,eq:(key,value)=>{reads.push({table,key,value});return q;},maybeSingle:async()=>({data:null,error:null}),then:resolve=>resolve({data:[],error:null})};return q;}
})}});
const {default:sync}=await import("../server/api/contacts/google-sync.post.ts");
const {default:list}=await import("../server/api/contacts/google.get.ts");
const event=(body={code:"synthetic-code"},headers={origin:config.origin,"x-requested-with":"KatalistGoogleContacts"})=>({body,headers});
beforeEach(()=>{denied=false;fetched=0;writes=[];configured=true;reads=[];failed=false;});
test("anonymous users are rejected before Google or database access",async()=>{
 denied=true;await assert.rejects(sync(event()),{statusCode:401});await assert.rejects(list(event()),{statusCode:401});assert.equal(fetched,0);assert.equal(reads.length,0);assert.equal(writes.length,0);
});
test("cross-origin and missing CSRF header are rejected before Google exchange",async()=>{
 await assert.rejects(sync(event(undefined,{origin:"https://attacker.test","x-requested-with":"KatalistGoogleContacts"})),{statusCode:403});
 await assert.rejects(sync(event(undefined,{origin:config.origin})),{statusCode:403});assert.equal(fetched,0);
});
test("client cannot submit a forged contact list or choose a different owner",async()=>{
 await assert.rejects(sync(event({contacts:[{profileId:"arbitrary"}]})),{statusCode:400});
 const result=await sync(event({code:"synthetic-code",owner:"attacker",contacts:[{profileId:"arbitrary"}]}));
 assert.equal(result.matchedCount,1);assert.equal(writes[0].args.p_owner,OWNER);assert.equal(writes[0].args.p_contacts[0].resource,"people/synthetic");
});
test("missing setup and failed Google reads never replace existing matches",async()=>{
 configured=false;await assert.rejects(sync(event()),{statusCode:503});assert.equal(fetched,0);
 configured=true;failed=true;await assert.rejects(sync(event()),{statusCode:502});assert.equal(writes.length,0);
});
test("contact list always filters by verified owner, ignoring client owner input",async()=>{
 const result=await list(event({owner:"another-owner"}));assert.deepEqual(result.people,[]);
 assert.deepEqual(reads.map(r=>[r.table,r.key,r.value]),[["google_contact_matches","owner_profile_id",OWNER],["google_contact_syncs","owner_profile_id",OWNER]]);
});
