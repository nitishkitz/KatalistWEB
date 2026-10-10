import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadGoogleContactsSdk, requestGoogleContactsCode, GOOGLE_CONTACTS_SCOPE } from "../src/features/contacts/google-contacts.ts";
test("Google popup asks only for read-only contacts, handles cancellation and forwards only the code",async()=>{
 let options,requested=0,code=null,error=null;
 window.google={accounts:{oauth2:{initCodeClient:o=>{options=o;return {requestCode:()=>requested++};}}}};
 assert.equal(await loadGoogleContactsSdk(),window.google.accounts.oauth2);
 requestGoogleContactsCode("synthetic-client",value=>code=value,value=>error=value);
 assert.equal(requested,1);assert.equal(options.scope,GOOGLE_CONTACTS_SCOPE);assert.equal(options.ux_mode,"popup");assert.equal(options.include_granted_scopes,false);
 options.error_callback({type:"popup_closed"});assert.match(error,/cancelled/);assert.equal(code,null);
 options.callback({error:"access_denied"});assert.match(error,/not granted/);
 options.callback({code:"synthetic-code"});assert.equal(code,"synthetic-code");
 delete window.google;
});
