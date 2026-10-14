import assert from 'node:assert/strict';
import { test } from 'node:test';
import { laneOf, coeyLane, theirStateFor } from '@/domain/thing';
import { courtLaneDropAction, coeyLaneMove } from '@/features/court/court-lane-drop';
import { defaultCalendar } from '@/domain/coey/calendar';
const base = () => ({ id:'t', title:'Get all the docs required', owner:{id:'sender'}, assignee:{id:'me'}, acknowledgement:'waiting_for_catch', workStatus:'not_started', cancelledAt:null, dueAt:'2026-10-16T12:00:00Z', personalPace:null, ownerImportance:'now', coey:{viewerProfileId:'me-profile',holderCal:defaultCalendar('Asia/Kolkata'),schedule:{thingId:'t',senderProfileId:'sender-profile',holderProfileId:'me-profile',kind:'task',mode:'work',state:'open',pace:'urgent',privateWait:false,inboxReason:null,actionTime:null,eventTime:null,promiseAt:null,snoozeUntil:null,blockedOn:null,lastActivityAt:Date.now(),lastNudgeAt:null,nudgeCountCycle:0,breakthroughUsed:false,createdAt:Date.now()}} });
test('received Thing moves to chosen personal lane without a Catch, promise or sender pace write',()=>{
 const t=base(), before=structuredClone(t);
 for(const lane of ['now','next','later']) {
  assert.deepEqual(courtLaneDropAction(t,'me',lane),{kind:'set_court_lane',thingId:'t',lane});
  assert.deepEqual(coeyLaneMove(t,lane),{kind:'personal_lane',lane});
  assert.equal(laneOf({...t,personalCourtLane:lane}),lane);
 }
 assert.deepEqual(t,before);
});
test('explicit Court placement wins over urgency and default Catch pace, without changing sender concern',()=>{
 const t=base(); const concern=theirStateFor(t);
 const moved={...t,personalCourtLane:'later',personalPace:'next'};
 assert.equal(coeyLane(moved).lane,'later');
 assert.equal(coeyLane(moved).rule,'PERSONAL');
 assert.equal(theirStateFor(moved),concern);
 assert.equal(laneOf({...moved,personalCourtLane:null}),'now');
 assert.equal(moved.dueAt,t.dueAt);
});
test('shared sender projection and inactive schedules do not acquire holder overrides',()=>{
 const t=base();
 assert.equal(coeyLane({...t,personalCourtLane:'later',coey:{...t.coey,viewerProfileId:'sender-profile'}}).lane,'now');
 for(const state of ['blocked','with_sender','sorted']) {
  const item={...t,personalCourtLane:'later',coey:{...t.coey,schedule:{...t.coey.schedule,state}}};
  assert.equal(coeyLaneMove(item,'next'),null);
  assert.notEqual(coeyLane(item).rule,'PERSONAL');
 }
 assert.equal(courtLaneDropAction({...t,assignee:{id:'other'}},'me','later'),null);
 assert.equal(courtLaneDropAction({...t,workStatus:'sorted'},'me','later'),null);
});
test('non-Coey Things also use personal organization without changing the assigned pace',()=>{
 const t={...base(),coey:undefined,personalCourtLane:'later'};
 assert.equal(laneOf(t),'later');
 assert.equal(laneOf({...t,personalCourtLane:null}),'now');
});
