import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {replayMigrations,actAs,createUser} from './lib/supabase-replay.mjs';
let db,id,ref;
const user='93000000-0000-4000-8000-000000000001';
before(async()=>{({db}=await replayMigrations());await createUser(db,{id:user,name:'Reference Owner'});await actAs(db,user);id=(await db.query('SELECT coey_create_things($1,$2::jsonb) r',['reference-test',JSON.stringify([{title:'Reference test',text_raw:'Reference test',mode:'work',pace:'normal'}])])).rows[0].r.things[0].thing_id;});
after(async()=>db?.close());
test('reference assigned, preserved by lane changes, unique and immutable',async()=>{
 ref=(await db.query('SELECT reference_number FROM things WHERE id=$1',[id])).rows[0].reference_number;
 assert.ok(Number(ref)>=1001);
 await db.query('SELECT set_my_court_lane($1,$2)',[id,'later']);
 assert.equal((await db.query('SELECT reference_number FROM things WHERE id=$1',[id])).rows[0].reference_number,ref);
 await db.exec('RESET ROLE');
 await assert.rejects(db.query('UPDATE things SET reference_number=reference_number+1 WHERE id=$1',[id]),/immutable/);
 const counts=(await db.query('SELECT count(*) n,count(DISTINCT reference_number) distinct_n FROM things')).rows[0];assert.equal(counts.n,counts.distinct_n);
});
