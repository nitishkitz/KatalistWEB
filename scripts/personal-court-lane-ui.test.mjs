import './dom-test-setup.mjs';
import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {createElement as h} from 'react';
import {render,renderHook,cleanup,fireEvent,act} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {advanceIdentityEpoch} from '@/features/realtime/identity-cache-policy';
import {getThingCapabilities} from '@/domain/capabilities';
const actions=[],notices=[];
mock.module('@/features/things/run-thing-action',{namedExports:{runThingAction:async(_qc,request)=>{actions.push(request);return {status:'performed'};}}});
mock.module('sonner',{namedExports:{toast:{success:(...args)=>notices.push(args),error:()=>{},info:()=>{}}}});
mock.module('@/components/katalist/PersonAvatar',{namedExports:{PersonAvatar:()=>null}});
mock.module('@/components/katalist/PersonCell',{namedExports:{PersonCell:()=>null}});
mock.module('@/features/things/personal-snooze',{namedExports:{SNOOZE_OPTIONS:[]}});
const {useCoeyLaneMove}=await import('@/features/court/coey/use-coey-lane-move');
const {ThingStatusControls}=await import('@/features/things/components/ThingStatusControls');
const thing={id:'docs',title:'Get all the docs required',owner:{id:'s',name:'Sudheer'},assignee:{id:'me',name:'Nithesh'},creator:{id:'s',name:'Sudheer'},acknowledgement:'waiting_for_catch',workStatus:'not_started',cancelledAt:null,ownerImportance:'now',personalPace:null,personalCourtLane:null,dueAt:'2026-10-16T12:00:00Z'};
const props={variant:'court',thing,caps:getThingCapabilities(thing,'me'),busy:false,activePace:'now',onSetRequestedPace:()=>{},currentBuckets:[],buckets:[],onToggleBucket:()=>{}};
test('received uncaught Thing has separate read-only sender pace and editable personal placement',()=>{
 const changed=[];const ui=render(h(ThingStatusControls,{...props,onSetPace:lane=>changed.push(lane)}));
 try {
  assert.ok(ui.getByText('Sender’s pace'));
  assert.ok(ui.getByRole('group',{name:'Your pace'}));
  fireEvent.click(ui.getByRole('button',{name:'later'}));
  assert.deepEqual(changed,['later']);
  assert.equal(thing.acknowledgement,'waiting_for_catch');
  assert.equal(ui.queryByLabelText('I will have it done by'),null);
 } finally {cleanup();}
});
test('move and reset dispatch only the private lane action, without a date dialog',async()=>{
 const qc=new QueryClient();advanceIdentityEpoch(qc,{kind:'live',profileId:'me'});
 const wrapper=({children})=>h(QueryClientProvider,{client:qc},children);
 const {result}=renderHook(()=>useCoeyLaneMove({myActorId:'me',onMoved:()=>{}}),{wrapper});
 try {
  await act(async()=>{await result.current.move(thing,'later');});
  assert.deepEqual(actions.at(-1),{kind:'set_court_lane',thingId:'docs',lane:'later'});
  assert.equal(result.current.dialog,null);
  assert.equal(notices.at(-1)[1].description,'Sender’s pace and due date are unchanged.');
  await act(async()=>{await result.current.move(thing,null);});
  assert.equal(actions.at(-1).lane,null);
 } finally {cleanup();qc.clear();}
});
test('a read-only view cannot edit personal placement',()=>{
 const ui=render(h(ThingStatusControls,{...props,thing:{...thing,personalCourtLane:'later'},viewOnly:true,onResetCourtLane:()=>{throw Error('must not reset');},onSetPace:()=>{throw Error('must not edit');}}));
 try {assert.equal(ui.queryByRole('group',{name:'Your pace'}),null);assert.equal(ui.queryByText('Follow assigned pace'),null);} finally {cleanup();}
});


test('Coey sender urgency is displayed separately from a holder’s personal Later choice',()=>{
 const item={...thing,personalCourtLane:'later',coey:{viewerProfileId:'me-profile',schedule:{pace:'urgent',holderProfileId:'me-profile',senderProfileId:'s-profile',state:'open',privateWait:false}}};
 const reset=[];const ui=render(h(ThingStatusControls,{...props,thing:item,caps:getThingCapabilities(item,'me'),activePace:'later',onSetPace:()=>{},onResetCourtLane:()=>reset.push(true)}));
 try {
  assert.ok(ui.getByText('Urgent'));
  assert.equal(ui.getByRole('button',{name:'later'}).getAttribute('aria-pressed'),'true');
  fireEvent.click(ui.getByText('Follow Coey placement'));
  assert.deepEqual(reset,[true]);
 } finally {cleanup();}
});
