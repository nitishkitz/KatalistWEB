import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {replayMigrations,actAs,createUser} from './lib/supabase-replay.mjs';
const A='91000000-0000-4000-8000-000000000001', B='91000000-0000-4000-8000-000000000002', C='91000000-0000-4000-8000-000000000003';
let db,a,b;
before(async()=>{
 ({db}=await replayMigrations());
 a=await createUser(db,{id:A,name:'Placement Sender'});
 b=await createUser(db,{id:B,name:'Placement Holder'});
 await createUser(db,{id:C,name:'Other Person'});
 await actAs(db,A);
 const request=(await db.query('SELECT (send_contact_request($1)).id',[B])).rows[0].id;
 await actAs(db,B); await db.query('SELECT respond_contact_request($1,true)',[request]);
});
after(async()=>db?.close());
async function capture(key){
 await actAs(db,A);
 return (await db.query('SELECT coey_create_things($1,$2::jsonb) r',[key,JSON.stringify([{title:key,text_raw:key,mode:'work',holder_profile_id:B,pace:'urgent'}])])).rows[0].r.things[0].thing_id;
}
async function shared(id){
 await db.exec('RESET ROLE');
 return (await db.query('SELECT to_jsonb(t) AS thing,to_jsonb(s) AS schedule FROM things t JOIN thing_schedules s ON s.thing_id=t.id WHERE t.id=$1',[id])).rows[0];
}
test('all three private lane choices persist without changing any shared Thing or schedule field',async()=>{
 const id=await capture('private-placement');
 await db.query("SELECT set_due($1,'2026-10-16T12:00:00Z',true)",[id]);
 const original=await shared(id);
 for(const lane of ['now','next','later']) {
  await actAs(db,B); await db.query('SELECT set_my_court_lane($1,$2::pace)',[id,lane]);
  assert.equal((await db.query('SELECT lane FROM thing_court_placement WHERE thing_id=$1',[id])).rows[0].lane,lane);
  assert.deepEqual(await shared(id),original,'due, sender pace, promise, caught status, revisions and follow-up inputs remain unchanged');
 }
 await actAs(db,A); assert.deepEqual((await db.query('SELECT * FROM thing_court_placement WHERE thing_id=$1',[id])).rows,[]);
 await assert.rejects(db.query("SELECT set_my_court_lane($1,'now')",[id]),/current assignee/);
 await actAs(db,C); assert.deepEqual((await db.query('SELECT * FROM thing_court_placement',[id].slice(0,0))).rows,[]);
 await assert.rejects(db.query("SELECT set_my_court_lane($1,'now')",[id]),/not found/);
 await actAs(db,B); await assert.rejects(db.query("UPDATE thing_court_placement SET lane='now' WHERE thing_id=$1",[id]),/permission denied/);
 await db.query('SELECT set_my_court_lane($1,NULL)',[id]);
 assert.deepEqual((await db.query('SELECT * FROM thing_court_placement WHERE thing_id=$1',[id])).rows,[]);
 assert.deepEqual(await shared(id),original);
});
test('reassignment deletes old placement, including when reassigned back to the original holder',async()=>{
 const id=await capture('placement-reassignment');
 await actAs(db,B); await db.query("SELECT set_my_court_lane($1,'later')",[id]);
 await actAs(db,A); await db.query('SELECT reassign_thing($1,$2)',[id,a.actorId]);
 await db.exec('RESET ROLE'); assert.equal((await db.query('SELECT count(*)::int n FROM thing_court_placement WHERE thing_id=$1',[id])).rows[0].n,0);
 await actAs(db,B); await assert.rejects(db.query("SELECT set_my_court_lane($1,'now')",[id]),/current assignee|not found/);
 await actAs(db,A); await db.query('SELECT reassign_thing($1,$2)',[id,b.actorId]);
 await actAs(db,B); assert.deepEqual((await db.query('SELECT * FROM thing_court_placement WHERE thing_id=$1',[id])).rows,[]);
});
test('closed and blocked schedules cannot be resurrected by personal organization',async()=>{
 const id=await capture('placement-terminal');
 await actAs(db,B); await db.query("SELECT set_my_court_lane($1,'later')",[id]);
 await db.query("SELECT catch_thing($1,'next')",[id]); await db.query('SELECT sort_thing($1)',[id]);
 await assert.rejects(db.query("SELECT set_my_court_lane($1,'now')",[id]),/no longer active/);
 assert.deepEqual((await db.query('SELECT * FROM thing_court_placement WHERE thing_id=$1',[id])).rows,[]);
 const blocked=await capture('placement-blocked');
 await actAs(db,B); await db.query("SELECT coey_flag_blocker($1,'third_party','Waiting on files')",[blocked]);
 await assert.rejects(db.query("SELECT set_my_court_lane($1,'later')",[blocked]),/not currently/);
});
