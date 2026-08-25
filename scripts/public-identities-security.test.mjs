import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("public_identities migration forces security_invoker and scoped RPCs", () => {
  const sql = readFileSync(
    join(root, "supabase/migrations/20260825065954_public_identities_security_invoker.sql"),
    "utf8",
  );
  assert.match(sql, /security_invoker\s*=\s*true/);
  assert.match(sql, /resolve_profile_identities/);
  assert.match(sql, /list_visible_profile_identities/);
  assert.match(sql, /display_name/);
  assert.match(sql, /avatar_url/);
  assert.equal(/\bemail\b/.test(sql), false);
  assert.equal(/\bphone\b/.test(sql), false);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.resolve_profile_identities/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.list_visible_profile_identities/);
  assert.match(sql, /FROM PUBLIC, anon/);
});

test("directory and list mapping never read email or phone from profiles", () => {
  const directory = readFileSync(join(root, "src/features/people/directory.ts"), "utf8");
  const mapper = readFileSync(join(root, "src/features/lists/map-list-rows.ts"), "utf8");
  assert.match(directory, /list_visible_profile_identities/);
  assert.equal(directory.includes("public_profiles"), false);
  assert.equal(directory.includes('.from("profiles")'), false);
  assert.match(mapper, /resolve_profile_identities/);
  assert.equal(/\bemail\b/.test(mapper), false);
  assert.equal(/\bphone\b/.test(mapper), false);
});
