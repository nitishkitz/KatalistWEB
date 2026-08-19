/**
 * KATALIST DEMO / STAGING SEED — SHARED LIBRARY
 * =============================================
 * DEMO / STAGING ONLY. Never imported by application code.
 *
 * This module creates demo identities and drives the *existing* Katalist
 * backend through its real RPCs. No schema, RLS, RPC, enum or lifecycle
 * change is made anywhere in this directory, and no trigger is disabled.
 *
 * Identity: every demo person keeps their canonical Katalist phone identity
 * (profiles.phone_e164), created confirmed through the admin API. Because the
 * hosted project currently has the Phone provider disabled, the seed *signs
 * in* through a staging-only confirmed email + a password generated at random
 * for the current run and held only in memory. Nothing is hardcoded, nothing
 * is persisted, and the product login flow is untouched: once Phone Auth and
 * the fixed staging OTP are enabled, phone + OTP works for the same users.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env['SUPABASE_URL'];
const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const anonKey =
  process.env['SUPABASE_PUBLISHABLE_KEY'] ?? process.env['VITE_SUPABASE_PUBLISHABLE_KEY'];

if (!url || !serviceKey || !anonKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_PUBLISHABLE_KEY');
  process.exit(1);
}

export const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

/**
 * Per-run, in-memory only seed credential. Never printed, never committed,
 * never reused across runs, never read by frontend code.
 */
const RUN_PASSWORD = `${crypto.randomUUID()}Aa1!`;

/** Fixed staging OTP to register alongside the demo numbers in Supabase Auth. */
export const DEMO_FIXED_OTP = '000000';

export type PersonKey = 'priya' | 'arjun' | 'sarah' | 'mike' | 'neha';

export type Person = {
  key: PersonKey;
  name: string;
  role: string;
  phone: string;
  email: string;
};

/** Phone is the canonical Katalist identity. These numbers are staging-only. */
export const PEOPLE: Person[] = [
  {
    key: 'priya',
    name: 'Priya Sharma',
    role: 'Operations Manager',
    phone: '+919000000001',
    email: 'priya.sharma@katalist-demo.test',
  },
  {
    key: 'arjun',
    name: 'Arjun Mehta',
    role: 'Product Designer',
    phone: '+919000000002',
    email: 'arjun.mehta@katalist-demo.test',
  },
  {
    key: 'sarah',
    name: 'Sarah Kapoor',
    role: 'Marketing Lead',
    phone: '+919000000003',
    email: 'sarah.kapoor@katalist-demo.test',
  },
  {
    key: 'mike',
    name: 'Mike Fernandes',
    role: 'Engineering Lead',
    phone: '+919000000004',
    email: 'mike.fernandes@katalist-demo.test',
  },
  {
    key: 'neha',
    name: 'Neha Rao',
    role: 'Office Operations',
    phone: '+919000000005',
    email: 'neha.rao@katalist-demo.test',
  },
];

/** External collaborators — external identities only, never authenticated users. */
export const EXTERNALS = [
  { key: 'rohan', name: 'Rohan Shah', phone: '+919000000901', email: null as string | null },
  { key: 'david', name: 'David Lee', phone: '+919000000902', email: null as string | null },
];

export type Session = {
  person: Person;
  profileId: string;
  actorId: string;
  db: SupabaseClient;
};

/** Create (or reuse) a confirmed demo identity for a person. */
async function ensureAuthUser(person: Person): Promise<string> {
  const existing = await findAuthUserByPhone(person.phone);
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing, {
      password: RUN_PASSWORD,
      email: person.email,
      email_confirm: true,
    });
    if (error) throw new Error(`updateUser ${person.name}: ${error.message}`);
    return existing;
  }
  let lastError = 'unknown';
  for (let attempt = 0; attempt < 12; attempt++) {
    const { data, error } = await admin.auth.admin.createUser({
      phone: person.phone,
      phone_confirm: true,
      email: person.email,
      email_confirm: true,
      password: RUN_PASSWORD,
      user_metadata: { display_name: person.name, role_label: person.role, demo: true },
    });
    if (!error) return data.user!.id;
    lastError = error.message; // a just-deleted identity can take a moment to clear
    await sleep(3000);
    const reappeared = await findAuthUserByPhone(person.phone);
    if (reappeared) {
      await admin.auth.admin.updateUserById(reappeared, {
        password: RUN_PASSWORD,
        email: person.email,
        email_confirm: true,
      });
      return reappeared;
    }
  }
  throw new Error(`createUser ${person.name}: ${lastError}`);

}


export async function findAuthUserByPhone(phone: string): Promise<string | null> {
  const digits = phone.replace(/[^0-9]/g, '');
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => (u.phone ?? '').replace(/[^0-9]/g, '') === digits);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Sign in as a demo person (seed-side only) and resolve their Profile → Actor. */
export async function signInAs(person: Person): Promise<Session> {
  const profileId = await ensureAuthUser(person);

  const db = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { error } = await db.auth.signInWithPassword({
    email: person.email,
    password: RUN_PASSWORD,
  });
  if (error) throw new Error(`signIn ${person.name}: ${error.message}`);

  const actorId = await actorForProfile(profileId);
  return { person, profileId, actorId, db };
}

export async function actorForProfile(profileId: string): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const { data } = await admin
      .from('actors')
      .select('id')
      .eq('profile_id', profileId)
      .maybeSingle();
    if (data?.id) return data.id as string;
    await sleep(300); // handle_new_user trigger may still be settling
  }
  throw new Error(`no actor for profile ${profileId}`);
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Thin RPC wrapper that fails loudly with the backend's own message. */
export async function rpc<T = unknown>(
  db: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

export const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
export const hoursAhead = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
export const daysAhead = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

/** A specific hour of today (used for "due today" rows). */
export function todayAt(hour: number) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
