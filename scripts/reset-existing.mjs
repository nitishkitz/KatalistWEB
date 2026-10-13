#!/usr/bin/env node
// Defaults to count-only dry-run. Credentials stay in memory; no user contents are logged.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

export function cleanupSql(scope, rollback = false) {
  if (!scope.userTables.length || scope.userTables.some(t => !/^(public|katalist_priv)\.[a-z][a-z0-9_]*$/.test(t))) throw Error("Invalid reset scope");
  if (scope.userTables.some(t => scope.preserveTables.includes(t))) throw Error("Reset scope includes system configuration");
  return `BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s';\nTRUNCATE ${scope.userTables.map(t => t.split('.').map(s => '"'+s+'"').join('.')).join(', ')} RESTRICT;\nUPDATE public.code_activity_settings SET value = 'false'::jsonb;\n${rollback ? 'ROLLBACK' : 'COMMIT'};`;
}

export function validateScope(scope, inventory) {
  const expected = new Set([...scope.userTables, ...scope.preserveTables]);
  const actual = inventory.counts.filter(t => ['public', 'katalist_priv'].includes(t.schema)).map(t => t.schema+'.'+t.table);
  if (actual.length !== expected.size || actual.some(t => !expected.has(t))) throw Error("Database tables differ from reviewed scope; stop and inventory again");
}

async function main() {
  const args = process.argv.slice(2);
  const scope = JSON.parse(await readFile(new URL('./reset/scope.json', import.meta.url), 'utf8'));
  const ref = args[args.indexOf('--project-ref') + 1];
  if (!args.includes('--project-ref') || ref !== scope.projectRef) throw Error("Pass the exact reviewed --project-ref");
  const url = process.env.SUPABASE_URL;
  if (url !== `https://${ref}.supabase.co`) throw Error("SUPABASE_URL does not match the reviewed project");
  const token = process.env.SUPABASE_ACCESS_TOKEN || (await readFile(`${homedir()}/.supabase/access-token`, 'utf8')).trim();
  async function management(path, method = 'GET', body) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw Error(`Management operation failed (${response.status}); no response payload logged`);
    return response.json();
  }
  const query = async sql => management('database/query', 'POST', { query: sql });
  const inventorySql = await readFile(new URL('./reset/inventory.sql', import.meta.url), 'utf8');
  const inventory = (await query(inventorySql))[0].inventory;
  validateScope(scope, inventory);
  const report = { projectRef: ref, mode: args.includes('--execute') ? 'execute' : 'dry-run', before: inventory.counts, checkpoints: [] };
  await mkdir('output/fresh-reset', { recursive: true });
  const save = () => writeFile('output/fresh-reset/reset-operation.json', JSON.stringify(report, null, 2)+'\n');
  await save();
  console.log(JSON.stringify({ projectRef: ref, mode: report.mode, userTables: scope.userTables.length, counts: inventory.counts }));
  if (!args.includes('--execute')) return;

  if (!process.env.VERCEL_TOKEN) throw Error("VERCEL_TOKEN required to verify deployed scheduler/traffic fencing");
  const deploymentCheck = await fetch(`https://api.vercel.com/v9/projects/${scope.vercelProjectId}?teamId=${scope.vercelTeamId}`, {
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
  });
  if (!deploymentCheck.ok) throw Error("Cannot verify Vercel maintenance");
  const deployed = await deploymentCheck.json();
  if (!deployed.paused || !deployed.crons?.disabledAt) throw Error("Production traffic and cron triggers must both be paused");

  // Require independent provider and database fences, not a caller's assertion.
  const auth = await management('config/auth');
  if (!auth.disable_signup) throw Error("Signup must be closed before executing");
  const fence = (await query(`SELECT
    EXISTS(SELECT 1 FROM public.app_config WHERE key='reset_maintenance' AND value='true'::jsonb) AS maintenance,
    NOT EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN pg_roles r WHERE n.nspname IN ('public','katalist_priv') AND r.rolname IN ('anon','authenticated','service_role') AND has_schema_privilege(r.oid,n.oid,'usage')) AS roles_fenced,
    (SELECT count(*) FROM pg_trigger WHERE tgname IN ('katalist_reset_signup_fence','katalist_reset_storage_fence') AND tgenabled='O')=2 AS provider_fences,
    (SELECT count(*) FROM vault.secrets)=0 AS no_vault_secrets,
    NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename IN ('anon','authenticated','service_role','authenticator') AND state='active') AS idle`))[0];
  if (Object.values(fence).some(v => v !== true)) throw Error("Provider/database fence or idle check failed");
  // Dependency rehearsal is one rolled-back transaction on the fenced target. No CASCADE.
  await query(cleanupSql(scope, true));
  report.checkpoints.push('dependency-rehearsal-rolled-back'); await save();

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error("Server-only service credential required for supported Storage/Auth deletion");
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const buckets = await query('SELECT id FROM storage.buckets ORDER BY id');
  if (buckets.some(b => !scope.buckets.includes(b.id)) || buckets.length !== scope.buckets.length) throw Error("Bucket inventory differs from reviewed scope");
  for (const bucket of buckets) {
    const objects = await query(`SELECT name FROM storage.objects WHERE bucket_id='${bucket.id}' ORDER BY name`);
    for (let offset = 0; offset < objects.length; offset += 100) {
      const { error } = await admin.storage.from(bucket.id).remove(objects.slice(offset, offset+100).map(o => o.name));
      if (error) throw Error("Storage cleanup failed; kept ownership metadata for retry");
    }
  }
  if ((await query('SELECT count(*)::int AS n FROM storage.objects'))[0].n !== 0) throw Error("Storage is not empty; refusing application cleanup");
  report.checkpoints.push('storage-objects-removed-through-provider-api'); await save();
  await query(cleanupSql(scope));
  report.checkpoints.push('application-user-tables-cleared'); await save();
  // Always delete page 1: deletion shifts subsequent pages.
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 });
    if (error) throw Error("Auth enumeration failed");
    if (!data.users.length) break;
    for (const user of data.users) {
      const { error } = await admin.auth.admin.deleteUser(user.id, false);
      if (error) throw Error("Auth deletion failed; maintenance remains enforced");
    }
  }
  report.checkpoints.push('auth-users-hard-deleted-through-provider-api');
  const after = (await query(inventorySql))[0].inventory;
  validateScope(scope, after);
  const mustBeEmpty = new Set(scope.userTables.concat(['auth.users','auth.identities','auth.sessions','auth.refresh_tokens','storage.objects']));
  report.after = after.counts;
  report.zeroVerified = after.counts.filter(t => mustBeEmpty.has(t.schema+'.'+t.table)).every(t => t.rows === 0);
  await save();
  if (!report.zeroVerified) throw Error("Nonzero user data remains; maintenance remains enforced");
  console.log(JSON.stringify({ projectRef: ref, zeroVerified: true, checkpoints: report.checkpoints }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error('[reset]', error.message); process.exitCode=1;
});
