// Katalist Bridge end-to-end tests.
// Exercises the real HTTP surface: /api/public/bridge/{redeem,thing,act,comment}
// with a real HttpOnly session cookie, against real fixture data.
// Usage: bun tests/run-bridge-e2e.ts
import { createClient } from '@supabase/supabase-js';

const BASE = process.env['BRIDGE_TEST_BASE_URL'] ?? 'http://localhost:8080';
const supabase = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  { auth: { persistSession: false } },
);

type Fixture = {
  owner_profile: string;
  other_profile: string;
  ext_actor: string;
  other_actor: string;
  thing_id: string;
  other_thing_id: string;
  list_id: string;
  token: string;
};

const results: { ok: boolean; test: string; detail: string }[] = [];
function check(ok: boolean, test: string, detail = '') {
  results.push({ ok, test, detail });
}

async function fixture(): Promise<Fixture> {
  const { data, error } = await supabase.rpc('test_bridge_fixture');
  if (error) throw new Error(`fixture failed: ${error.message}`);
  return (data as Fixture[])[0]!;
}

async function ownerAction(
  profile: string,
  action: string,
  thingId: string,
  target?: string,
) {
  const { data, error } = await supabase.rpc('test_bridge_owner', {
    p_profile: profile,
    p_action: action,
    p_thing_id: thingId,
    p_target: target ?? null,
  });
  if (error) throw new Error(`owner action ${action} failed: ${error.message}`);
  return data as string;
}

async function state(thingId: string) {
  const { data, error } = await supabase.rpc('test_bridge_state', { p_thing_id: thingId });
  if (error) throw new Error(`state failed: ${error.message}`);
  return data as Record<string, unknown>;
}

/** Redeem a raw magic-link token; returns the response plus the session cookie. */
async function redeem(token: string) {
  const res = await fetch(`${BASE}/api/public/bridge/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = /katalist_bridge=([^;]*)/.exec(setCookie);
  const body = await res.json().catch(() => ({}));
  return { res, setCookie, cookie: match ? `katalist_bridge=${match[1]}` : null, body };
}

async function getThing(cookie: string) {
  const res = await fetch(`${BASE}/api/public/bridge/thing`, { headers: { cookie } });
  return { res, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function act(cookie: string, action: string) {
  const res = await fetch(`${BASE}/api/public/bridge/act`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  return { res, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function comment(cookie: string, body: string) {
  const res = await fetch(`${BASE}/api/public/bridge/comment`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  return { res, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

const LEAKY = /(relation|function|column|constraint|violates|pg_|SQLSTATE|row-level security|public\.)/i;
function assertSafeError(body: Record<string, unknown>, label: string) {
  const message = String(body['error'] ?? '');
  check(
    message.length > 0 && !LEAKY.test(message),
    `${label} returns a safe message`,
    message || '(empty)',
  );
}

try {
  // ---------------- FLOW A: full happy path through the Bridge --------------
  {
    const f = await fixture();
    const r = await redeem(f.token);
    check(r.res.status === 200, 'FLOW A: magic-link token redeems', `status=${r.res.status}`);
    check(
      /HttpOnly/i.test(r.setCookie) && /Secure/i.test(r.setCookie) && /SameSite=Lax/i.test(r.setCookie),
      'FLOW A: session cookie is HttpOnly, Secure, SameSite=Lax',
      r.setCookie.replace(/katalist_bridge=[^;]*/, 'katalist_bridge=***'),
    );
    check(
      !JSON.stringify(r.body).includes(f.token),
      'FLOW A: response body never carries a token',
    );
    const cookie = r.cookie!;

    const read = await getThing(cookie);
    const thing = (read.body['thing'] ?? {}) as Record<string, unknown>;
    check(read.res.status === 200 && thing['id'] === f.thing_id, 'FLOW A: Bridge can read its Thing');

    check((await act(cookie, 'catch')).res.status === 200, 'FLOW A: Bridge can Catch');
    const prog = await act(cookie, 'under_progress');
    check(
      prog.res.status === 200 && prog.body['work_status'] === 'under_progress',
      'FLOW A: Bridge can move to Under Progress',
      String(prog.body['work_status']),
    );
    const c = await comment(cookie, 'guest comment from the Bridge');
    check(c.res.status === 200 && typeof c.body['comment_id'] === 'string', 'FLOW A: Bridge can comment');

    const sorted = await act(cookie, 'sorted');
    check(
      sorted.res.status === 200 && sorted.body['work_status'] === 'sorted',
      'FLOW A: Bridge can Sort',
      String(sorted.body['work_status']),
    );

    const after = await state(f.thing_id);
    check(after['work_status'] === 'sorted', 'FLOW A: Thing is Sorted', String(after['work_status']));
    check(Number(after['comments']) === 1, 'FLOW A: guest comment landed on the Thing');
    check(
      Number(after['live_grants']) === 0 && Number(after['live_sessions']) === 0,
      'FLOW A: Sorting revokes the grant and its sessions',
      `grants=${after['live_grants']} sessions=${after['live_sessions']}`,
    );
    check(after['personal_pace'] === null, 'FLOW A: Bridge never gets a Personal Pace');

    const deadRead = await getThing(cookie);
    check(deadRead.res.status >= 400, 'FLOW A: session cannot read after Sort', `status=${deadRead.res.status}`);
    const deadAct = await act(cookie, 'under_progress');
    check(deadAct.res.status >= 400, 'FLOW A: session cannot act after Sort', `status=${deadAct.res.status}`);
    assertSafeError(deadAct.body, 'FLOW A: dead-session action');
    const reuse = await redeem(f.token);
    check(reuse.res.status >= 400, 'FLOW A: the magic link cannot be redeemed again', `status=${reuse.res.status}`);
    assertSafeError(reuse.body, 'FLOW A: reused link');
  }

  // ---------------- FLOW B: reassignment kills the Bridge -------------------
  {
    const f = await fixture();
    const r = await redeem(f.token);
    const cookie = r.cookie!;
    check((await getThing(cookie)).res.status === 200, 'FLOW B: session is valid before the handover');

    await ownerAction(f.owner_profile, 'reassign', f.thing_id, f.other_actor);

    const read = await getThing(cookie);
    const action = await act(cookie, 'catch');
    const note = await comment(cookie, 'should not land');
    check(read.res.status >= 400, 'FLOW B: old session cannot read after reassignment', `status=${read.res.status}`);
    check(action.res.status >= 400, 'FLOW B: old session cannot act after reassignment', `status=${action.res.status}`);
    check(note.res.status >= 400, 'FLOW B: old session cannot comment after reassignment', `status=${note.res.status}`);
    assertSafeError(read.body, 'FLOW B: revoked read');
    assertSafeError(note.body, 'FLOW B: revoked comment');

    const after = await state(f.thing_id);
    check(
      Number(after['live_grants']) === 0 && Number(after['live_sessions']) === 0,
      'FLOW B: reassignment revokes grants and sessions',
      `grants=${after['live_grants']} sessions=${after['live_sessions']}`,
    );
    check(Number(after['comments']) === 0, 'FLOW B: no comment was written after revocation');
  }

  // ---------------- Cancel revokes the Bridge -------------------------------
  {
    const f = await fixture();
    const cookie = (await redeem(f.token)).cookie!;
    await ownerAction(f.owner_profile, 'cancel', f.thing_id);
    const action = await act(cookie, 'catch');
    check(action.res.status >= 400, 'Cancel revokes the Bridge', `status=${action.res.status}`);
    const after = await state(f.thing_id);
    check(
      Number(after['live_grants']) === 0 && Number(after['live_sessions']) === 0,
      'Cancel revokes grants and sessions',
      `grants=${after['live_grants']} sessions=${after['live_sessions']}`,
    );
  }

  // ---------------- Explicit revocation -------------------------------------
  {
    const f = await fixture();
    const cookie = (await redeem(f.token)).cookie!;
    check((await getThing(cookie)).res.status === 200, 'Revocation: session valid before revoke');
    await ownerAction(f.owner_profile, 'revoke_all', f.thing_id);
    const read = await getThing(cookie);
    check(read.res.status >= 400, 'Owner revocation kills the Bridge session', `status=${read.res.status}`);
    const reuse = await redeem(f.token);
    check(reuse.res.status >= 400, 'Revoked link cannot be redeemed', `status=${reuse.res.status}`);
  }

  // ---------------- Bridge scope limits -------------------------------------
  {
    const f = await fixture();
    const cookie = (await redeem(f.token)).cookie!;
    await act(cookie, 'catch');

    const pace = await act(cookie, 'later');
    check(pace.res.status === 400, 'Bridge cannot set a Personal Pace', `status=${pace.res.status}`);
    assertSafeError(pace.body, 'Bridge pace attempt');
    const paced = await state(f.thing_id);
    check(paced['personal_pace'] === null, 'Bridge Thing still has no Personal Pace');

    const read = await getThing(cookie);
    const thing = (read.body['thing'] ?? {}) as Record<string, unknown>;
    const keys = Object.keys(thing).sort().join(',');
    check(
      !keys.includes('list'),
      'Bridge payload exposes no List information',
      keys,
    );
    check(thing['id'] === f.thing_id, 'Bridge sees only its own Thing', String(thing['id']));

    // The Bridge routes accept no Thing id at all; extra body fields are ignored.
    const injected = await fetch(`${BASE}/api/public/bridge/act`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'under_progress', thing_id: f.other_thing_id }),
    });
    check(injected.status === 200, 'Bridge action ignores a caller-supplied Thing id', `status=${injected.status}`);
    const other = await state(f.other_thing_id);
    check(
      other['work_status'] === 'not_started' && other['acknowledgement'] === 'waiting_for_catch',
      'Another Thing is untouched by the Bridge',
      String(other['work_status']),
    );

    const noCookie = await fetch(`${BASE}/api/public/bridge/thing`);
    check(noCookie.status === 401, 'No session means no Bridge access', `status=${noCookie.status}`);
    assertSafeError(
      (await noCookie.json().catch(() => ({}))) as Record<string, unknown>,
      'Unauthenticated read',
    );

    const garbage = await redeem('x'.repeat(64));
    check(garbage.res.status >= 400, 'An invalid token is rejected', `status=${garbage.res.status}`);
    assertSafeError(garbage.body, 'Invalid token');
  }
} finally {
  const { error } = await supabase.rpc('test_bridge_cleanup');
  if (error) console.error('cleanup failed:', error.message);
}

let failed = 0;
for (const row of results) {
  if (!row.ok) failed++;
  console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.test}${row.detail ? `  — ${row.detail}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
