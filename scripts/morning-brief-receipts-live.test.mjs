import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * F02: the live RPC adapter. The real claim_morning_brief/
 * dismiss_morning_brief RPCs aren't deployed to any database (the
 * migration is prepared, not applied), so this mocks
 * @/integrations/supabase/rpcs entirely -- this proves the adapter's own
 * argument-shaping and error-propagation contract, not the RPC's SQL,
 * which has no local Postgres fixture to run against in this environment.
 */

let capturedName = null;
let capturedArgs = null;
let nextResult = { data: null, error: null };

mock.module("@/integrations/supabase/rpcs", {
  namedExports: {
    callUngeneratedRpc: async (name, args) => {
      capturedName = name;
      capturedArgs = args;
      return nextResult;
    },
  },
});

const { claimMorningBriefLive, dismissMorningBriefLive } = await import(
  "@/features/catchup/morning-brief-receipts"
);

test("claimMorningBriefLive: sends context + client timezone, and maps the RPC row shape", async () => {
  nextResult = {
    data: [{ claimed: true, local_date: "2026-06-15", timezone: "America/New_York", presented_at: "2026-06-15T11:00:00Z" }],
    error: null,
  };

  const result = await claimMorningBriefLive("work", "America/New_York");

  assert.equal(capturedName, "claim_morning_brief");
  assert.deepEqual(capturedArgs, { p_context: "work", p_client_timezone: "America/New_York" });
  assert.deepEqual(result, {
    claimed: true,
    localDate: "2026-06-15",
    timezone: "America/New_York",
    presentedAt: "2026-06-15T11:00:00Z",
  });
});

test("claimMorningBriefLive: an RPC error (e.g. the migration not deployed yet) rejects -- it must not silently report claimed:false", async () => {
  nextResult = { data: null, error: { message: "function public.claim_morning_brief does not exist" } };
  await assert.rejects(claimMorningBriefLive("work", "America/New_York"));
});

test("claimMorningBriefLive: a row with no data (unexpected empty result) rejects rather than returning undefined fields", async () => {
  nextResult = { data: [], error: null };
  await assert.rejects(claimMorningBriefLive("work", "America/New_York"));
});

test("dismissMorningBriefLive: sends context + client timezone, and resolves on success", async () => {
  nextResult = { data: null, error: null };
  await dismissMorningBriefLive("home", "Asia/Tokyo");
  assert.equal(capturedName, "dismiss_morning_brief");
  assert.deepEqual(capturedArgs, { p_context: "home", p_client_timezone: "Asia/Tokyo" });
});

test("dismissMorningBriefLive: an RPC error rejects", async () => {
  nextResult = { data: null, error: { message: "boom" } };
  await assert.rejects(dismissMorningBriefLive("work", "America/New_York"));
});
