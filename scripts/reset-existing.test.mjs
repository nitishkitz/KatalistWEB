import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { cleanupSql, validateScope } from "./reset-existing.mjs";

const scope = { userTables: ['public.profiles','public.things'], preserveTables: ['public.app_config','public.code_activity_settings'] };
test('schema drift and configuration overlap stop cleanup', () => {
  const inventory = { counts: [...scope.userTables,...scope.preserveTables].map(t => ({ schema:t.split('.')[0],table:t.split('.')[1] })) };
  validateScope(scope, inventory);
  assert.throws(() => validateScope(scope, { counts: [...inventory.counts,{schema:'public',table:'unknown'}] }));
  assert.throws(() => cleanupSql({ ...scope,userTables:[...scope.userTables,'public.app_config'] }));
  assert.throws(() => cleanupSql({ ...scope,userTables:['public.things;drop table auth.users'] }));
});
test('rehearsal rolls back; execution clears user data and preserves disabled system settings', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE profiles(id int primary key); CREATE TABLE things(id int primary key,owner_id int REFERENCES profiles(id));
      CREATE TABLE app_config(key text primary key,value jsonb); CREATE TABLE code_activity_settings(key text primary key,value jsonb);
      INSERT INTO profiles VALUES(1); INSERT INTO things VALUES(1,1); INSERT INTO app_config VALUES('system','123'); INSERT INTO code_activity_settings VALUES('master','true');`);
    await db.exec(cleanupSql(scope,true));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM profiles')).rows[0].n,1);
    assert.equal((await db.query('SELECT value FROM code_activity_settings')).rows[0].value,true);
    await db.exec(cleanupSql(scope));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM profiles')).rows[0].n,0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM things')).rows[0].n,0);
    assert.equal((await db.query('SELECT value FROM app_config')).rows[0].value,123);
    assert.equal((await db.query('SELECT value FROM code_activity_settings')).rows[0].value,false);
  } finally { await db.close(); }
});
test('an unreviewed foreign-key dependent prevents deletion instead of cascading', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE profiles(id int primary key); CREATE TABLE things(id int primary key,owner_id int REFERENCES profiles(id)); CREATE TABLE outsider(id int REFERENCES profiles(id)); INSERT INTO profiles VALUES(1); INSERT INTO outsider VALUES(1);');
    await assert.rejects(db.exec(cleanupSql(scope)), /foreign key constraint/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM profiles')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM outsider')).rows[0].n,1);
  } finally { await db.close(); }
});
