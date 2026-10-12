import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const archive = readFileSync(new URL("../server/api/qa/credentials/archive.post.ts", import.meta.url), "utf8");
const abort = readFileSync(new URL("../server/api/qa/evidence/abort.post.ts", import.meta.url), "utf8");

test("QA archive does not report success when service-role cleanup fails", () => {
  assert.match(archive, /const \{ error: deleteError \} = await admin\.from\("qa_account_secrets"\)/);
  assert.match(archive, /if \(deleteError\) \{/);
  assert.match(archive, /throw qaError\(502, "credential_cleanup_failed"/);
  assert.match(archive, /const \{ error: flagError \} = await admin\.from\("qa_accounts"\)/);
  assert.match(archive, /if \(flagError\) \{/);
  assert.match(archive, /outcome: "error"/);
  assert.ok(archive.indexOf("if (deleteError)") < archive.indexOf('outcome: "success"'), "success audit must follow both cleanup checks");
});

test("QA evidence abort does not report success when storage removal fails", () => {
  assert.match(abort, /const \{ error: removeError \} = await getSupabaseAdmin\(\)\.storage\.from\("qa-evidence"\)\.remove\(\[data\]\)/);
  assert.match(abort, /if \(removeError\) throw qaError\(502, "storage_unavailable"/);
  assert.ok(abort.indexOf("removeError") < abort.indexOf("return { ok: true }"), "success response must follow the storage check");
});
