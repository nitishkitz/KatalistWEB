import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { replayMigrations, actAs, createUser } from './lib/supabase-replay.mjs';
const A='92000000-0000-4000-8000-000000000001', B='92000000-0000-4000-8000-000000000002';
let db, id;
const doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Train booking',marks:[{type:'bold'}]}]}]};
before(async()=>{
 ({db}=await replayMigrations());
 await createUser(db,{id:A,name:'Description Owner'}); await createUser(db,{id:B,name:'Description Assignee'});
 await actAs(db,A); const req=(await db.query('SELECT (send_contact_request($1)).id',[B])).rows[0].id;
 await actAs(db,B); await db.query('SELECT respond_contact_request($1,true)',[req]);
 await actAs(db,A);
 id=(await db.query('SELECT coey_create_things($1,$2::jsonb) r',['description-test',JSON.stringify([{title:'Description test',text_raw:'Legacy capture',mode:'work',holder_profile_id:B,pace:'normal'}])])).rows[0].r.things[0].thing_id;
});
after(async()=>db?.close());
test('owner save persists rich document and activity; assignee sees it but cannot mutate',async()=>{
 await actAs(db,B); await assert.rejects(db.query('SELECT set_thing_description($1,$2::jsonb,0)',[id,JSON.stringify(doc)]),/owner/);
 await actAs(db,A); const saved=(await db.query('SELECT (set_thing_description($1,$2::jsonb,0)).description_revision revision',[id,JSON.stringify(doc)])).rows[0];
 assert.equal(saved.revision,1);
 await actAs(db,B); const row=(await db.query('SELECT description_document,description_updated_by FROM things WHERE id=$1',[id])).rows[0];
 assert.deepEqual(row.description_document,doc); assert.equal(row.description_updated_by,A);
 assert.equal((await db.query("SELECT count(*)::int n FROM thing_activity WHERE thing_id=$1 AND event='description_updated'",[id])).rows[0].n,1);
 await assert.rejects(db.query('UPDATE things SET description_document=NULL WHERE id=$1',[id]),/permission denied/);
});
test('stale revisions, unsafe documents and ownership transfer reject saves',async()=>{
 await actAs(db,A);
 await assert.rejects(db.query('SELECT set_thing_description($1,$2::jsonb,0)',[id,JSON.stringify(doc)]),/changed/);
 const unsafe={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'x',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]}]}]};
 await assert.rejects(db.query('SELECT set_thing_description($1,$2::jsonb,1)',[id,JSON.stringify(unsafe)]),/Invalid/);
 await db.exec('RESET ROLE'); const actor=(await db.query('SELECT id FROM actors WHERE profile_id=$1',[B])).rows[0].id;
 await assert.rejects(db.query('UPDATE things SET owner_actor_id=$2 WHERE id=$1',[id,actor]), /immutable/);
 // The current product forbids transfers. Exercise the RPC against a future transferred row without changing product rules.
 await db.exec('ALTER TABLE things DISABLE TRIGGER trg_things_immutable');
 await db.query('UPDATE things SET owner_actor_id=$2 WHERE id=$1',[id,actor]);
 await db.exec('ALTER TABLE things ENABLE TRIGGER trg_things_immutable');
 await actAs(db,A); await assert.rejects(db.query('SELECT set_thing_description($1,$2::jsonb,1)',[id,JSON.stringify(doc)]),/owner/);
 await actAs(db,B); await db.query('SELECT set_thing_description($1,NULL,1)',[id]);
 assert.equal((await db.query('SELECT description_document,description_revision FROM things WHERE id=$1',[id])).rows[0].description_revision,2);
});
