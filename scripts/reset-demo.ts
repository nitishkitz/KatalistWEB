/**
 * KATALIST DEMO / STAGING RESET  —  DEMO DATA ONLY, NEVER PRODUCTION
 * ==================================================================
 * Usage:  bun scripts/reset-demo.ts
 *
 * Removes the demo universe so the seed can be re-run without creating a
 * second copy of it. Deletions run with the service role in foreign-key order.
 * No trigger is disabled and no invariant is bypassed: Katalist's immutability
 * and append-only protections stay exactly as the frozen architecture defines
 * them — this script only removes rows, it never rewrites history in place.
 */
import { admin, findAuthUserByPhone, PEOPLE, EXTERNALS } from './demo/lib';

export async function resetDemo(
  opts: { verbose?: boolean; deleteUsers?: boolean } = {},
) {
  const { verbose = true, deleteUsers = false } = opts;
  const log = (m: string) => verbose && console.log(m);

  const order = [
    'bucket_items',
    'buckets',
    'list_messages',
    'thing_comments',
    'notifications',
    'doorman_state',
    'profile_object_state',
    'private_activity',
    'contacts',
    'bridge_sessions',
    'bridge_grants',
    'nudges',
    'thing_activity',
    'list_members',
    'lists',
  ] as const;

  for (const table of order) {
    const { error, count } = await admin
      .from(table)
      .delete({ count: 'exact' })
      .not('id', 'is', null);
    log(`  ${table.padEnd(22)} ${error ? `skipped (${error.message})` : `${count ?? 0} removed`}`);
  }

  // External demo actors and their identities are recreated by every seed run.
  await admin.from('actors').delete().eq('kind', 'external');
  for (const e of EXTERNALS) {
    await admin.from('external_identities').delete().eq('phone_e164', e.phone);
  }

  // The five demo people keep their identity by default: reusing the same
  // Profile → Actor across runs is what makes the seed rerunnable without
  // producing a second demo universe.
  if (!deleteUsers) {
    log('\nDemo auth users kept (identities are reused by the seed).');
    return;
  }

  log('\nDemo auth users:');
  for (const p of PEOPLE) {
    const id = await findAuthUserByPhone(p.phone);
    if (!id) {
      log(`  ${p.name.padEnd(16)} absent`);
      continue;
    }
    await admin.from('actors').delete().eq('profile_id', id);
    const { error } = await admin.auth.admin.deleteUser(id);
    log(`  ${p.name.padEnd(16)} ${error ? `kept (${error.message})` : 'deleted'}`);
  }
}

if (import.meta.main) {
  console.log('KATALIST DEMO RESET — staging only\n');
  await resetDemo({ deleteUsers: process.argv.includes('--delete-users') });
  console.log('\nReset complete.');
}

