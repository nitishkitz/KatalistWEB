import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/20260924210000_trophy_activity_stats.sql", import.meta.url), "utf8");
const owner = "11111111-1111-1111-1111-111111111111";
const outsider = "22222222-2222-2222-2222-222222222222";
const actor = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const thing = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

test("T06 Trophy aggregate returns exact scoped counts and calendar streak without event transfer", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
        AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE TYPE public.activity_event AS ENUM ('sorted','caught','created');
      CREATE TABLE public.actors (id uuid PRIMARY KEY, profile_id uuid NOT NULL);
      CREATE TABLE public.thing_activity (
        id bigserial PRIMARY KEY, thing_id uuid NOT NULL, actor_id uuid NOT NULL,
        event public.activity_event NOT NULL, created_at timestamptz NOT NULL
      );
      GRANT USAGE ON SCHEMA public, auth TO authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
      ALTER TABLE public.actors ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.thing_activity ENABLE ROW LEVEL SECURITY;
      CREATE POLICY own_actor ON public.actors TO authenticated USING (profile_id=auth.uid());
      CREATE POLICY own_activity ON public.thing_activity TO authenticated USING (
        EXISTS (SELECT 1 FROM public.actors a WHERE a.id=actor_id AND a.profile_id=auth.uid())
      );
    `);
    await db.exec(migration);
    await db.exec(`
      INSERT INTO public.actors VALUES ('${actor}','${owner}');
      INSERT INTO public.thing_activity (thing_id,actor_id,event,created_at) VALUES
        ('${thing}','${actor}','sorted', now()),
        ('${thing}','${actor}','sorted', now()-interval '1 day'),
        ('${thing}','${actor}','sorted', now()-interval '1 day'),
        ('${thing}','${actor}','sorted', now()-interval '3 days'),
        ('${thing}','${actor}','caught', now());
      SET ROLE authenticated;
      SET request.jwt.claim.sub = '${owner}';
    `);
    const own = await db.query("SELECT * FROM public.get_trophy_activity_stats('UTC')");
    assert.deepEqual(own.rows, [{ sorted_count: 4, caught_count: 1, weekly_count: 5, streak_days: 2 }]);
    await db.exec(`RESET ROLE;
      DELETE FROM public.thing_activity;
      INSERT INTO public.thing_activity (thing_id,actor_id,event,created_at) VALUES
        ('${thing}','${actor}','sorted', date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '1 day' + interval '12 hours'),
        ('${thing}','${actor}','sorted', date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '2 days' + interval '12 hours');
      SET ROLE authenticated;`);
    const yesterdayAnchor = await db.query("SELECT streak_days FROM public.get_trophy_activity_stats('UTC')");
    assert.deepEqual(yesterdayAnchor.rows, [{ streak_days: 2 }]);
    await db.exec(`SET request.jwt.claim.sub = '${outsider}'`);
    const other = await db.query("SELECT * FROM public.get_trophy_activity_stats('UTC')");
    assert.deepEqual(other.rows, [{ sorted_count: 0, caught_count: 0, weekly_count: 0, streak_days: 0 }]);
    await assert.rejects(db.query("SELECT * FROM public.get_trophy_activity_stats('Not/A_Zone')"), /invalid Trophy timezone/);
    const rights = await db.query(`SELECT
      has_function_privilege('anon','public.get_trophy_activity_stats(text)','EXECUTE') AS anon,
      has_function_privilege('authenticated','public.get_trophy_activity_stats(text)','EXECUTE') AS authenticated`);
    assert.deepEqual(rights.rows[0], { anon: false, authenticated: true });
  } finally {
    await db.close();
  }
});
