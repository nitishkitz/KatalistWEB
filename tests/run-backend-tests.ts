// Executable Katalist backend test suite runner.
// Usage: bun tests/run-backend-tests.ts
import { createClient } from '@supabase/supabase-js';

const url = process.env['SUPABASE_URL']!;
const key = process.env['SUPABASE_SERVICE_ROLE_KEY']!;
const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await supabase.rpc('run_backend_tests');
if (error) {
  console.error('runner failed:', error.message);
  process.exit(1);
}
let failed = 0;
for (const row of data as { ok: boolean; test: string; detail: string }[]) {
  if (!row.ok) failed++;
  console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${row.test}${row.detail ? `  — ${row.detail}` : ''}`);
}
console.log(`\n${data.length - failed}/${data.length} passed`);
process.exit(failed ? 1 : 0);
