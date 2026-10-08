// The read-only connector ships first: only the four candidate migrations (g03, g07, g11, g12) exist. This proves the
// optional AI and Thing-creation parts are simply UNAVAILABLE, not broken, and that nothing in the connector needs them.
//   node --experimental-strip-types --experimental-test-module-mocks --experimental-loader ./scripts/alias-loader.mjs \
//        --test output/code-activity-execution/g10/readonly-subset.test.mjs
process.env.CODE_ACTIVITY_SUBSET = "readonly";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
const { SUBSET, L, U, createDb, reset, rpcClient } = await import("./harness.mjs");
const { CALLBACK_PATH, ENV_NAMES, loadConfig } = await import("../../../src/features/code-activity/server/config.server.ts");
const { createGitHubClient } = await import("../../../src/features/code-activity/server/github.server.ts");
const svc = await import("../../../src/features/code-activity/server/service.server.ts");
const thing = await import("../../../src/features/code-activity/server/thing.server.ts");
const ai = await import("../../../src/features/code-activity/server/ai.server.ts");

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const cfg = loadConfig({
  [ENV_NAMES.appId]: "1", [ENV_NAMES.appSlug]: "app", [ENV_NAMES.clientId]: "Iv1", [ENV_NAMES.clientSecret]: "s", [ENV_NAMES.privateKey]: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  [ENV_NAMES.stateSecret]: "x".repeat(40), [ENV_NAMES.callbackUrl]: `http://localhost:8080${CALLBACK_PATH}`, [ENV_NAMES.allowedOrigins]: "http://localhost:8080",
}, { production: false });
const db = await createDb();
const user = (uid) => rpcClient(db, "authenticated", uid);
const LIST = L.L1;

test("only the read-only connector's objects exist", async () => {
  assert.equal(SUBSET, "readonly");
  const functions = (await db.query("select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname like '%code\\_activity%'")).rows.map((r) => r.proname);
  for (const present of ["code_activity_connect", "code_activity_feed", "code_activity_begin_refresh", "code_activity_server_record_delivery", "code_activity_server_take_budget", "code_activity_is_enabled"]) assert.ok(functions.includes(present), present);
  for (const absent of ["code_activity_ai_status", "code_activity_ai_begin", "code_activity_set_consent", "confirm_code_activity_draft", "code_activity_assignee_candidates"]) assert.ok(!functions.includes(absent), `${absent} must not exist yet`);
  const tables = (await db.query("select tablename from pg_tables where schemaname = 'public' and tablename like 'code\\_activity\\_%'")).rows.map((r) => r.tablename);
  assert.ok(tables.includes("code_activity_budget") && tables.includes("code_activity_deliveries"));
  assert.ok(!tables.includes("code_activity_consents") && !tables.includes("code_activity_confirmations"));
});

test("capabilities still works without the AI functions: enabled and configured, AI simply unavailable", async () => {
  await reset(db);
  const r = await svc.capabilities({ user: user(U.V), listId: LIST, config: cfg, aiConfigured: true });
  assert.deepEqual(r.body, { enabled: true, configured: true, ai: { available: false, consent: false } });
  const outsider = await svc.capabilities({ user: user(U.X), listId: LIST, config: cfg, aiConfigured: true });
  assert.deepEqual(outsider.body, { enabled: false });
});

test("the optional features answer 'unavailable', never crash, and create nothing", async () => {
  await reset(db);
  const owner = user(U.O);
  assert.equal((await ai.setConsent({ user: owner, listId: LIST, enabled: true })).status, 503);
  assert.equal((await thing.assigneeCandidates({ user: owner, listId: LIST })).status, 503);
  const confirm = await thing.confirmDraft({ user: owner, listId: LIST, changeId: "50000000-0000-0000-0000-000000000001", key: "a0000000-0000-0000-0000-000000000001", title: "t", notes: null, assigneeActorId: "60000000-0000-0000-0000-000000000001", dueAt: null, importance: "next", headSha: "a".repeat(40), acknowledgeSourceChange: false, aiGenerated: false });
  assert.equal(confirm.status, 503);
  const fake = createGitHubClient({ config: cfg.config, fetchImpl: async () => { throw new Error("must not be called"); } });
  const draft = await ai.generateDraft({ config: cfg, github: fake, admin: () => rpcClient(db, "service_role"), ai: { apiKey: "sk_test_sarvam_key_0123456789", model: "sarvam-105b" }, aiFetch: async () => { throw new Error("must not be called"); } }, { user: owner, listId: LIST, changeId: "50000000-0000-0000-0000-000000000001", note: "" });
  assert.equal(draft.status, 503, "the model is never called");
  assert.equal((await db.query("select count(*)::int c from public.things")).rows[0].c, 0);
});
