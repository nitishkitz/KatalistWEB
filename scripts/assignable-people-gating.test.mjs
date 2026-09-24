import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let user = null;
let preview = false;
let requests = 0;
mock.module("@/hooks/useSession", { namedExports: { useSession: () => ({ user, session: user ? { user } : null }) } });
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => preview } });
mock.module("@/features/things/local-state", { namedExports: { directoryPeople: () => [] } });
mock.module("@/features/demo/identities", { namedExports: { demoDirectory: () => [] } });
mock.module("@/features/people/directory", { namedExports: { matchAvatarByName: () => null } });
mock.module("@/integrations/supabase/client", { namedExports: { supabase: {
  rpc: async () => { requests++; return { data: [], error: null }; },
  from: () => { requests++; const q = { select: () => q, eq: () => q,
    then: (resolve) => resolve({ data: [], error: null }) }; return q; },
} } });
const { useAssignablePeople } = await import("@/features/people/use-assignable");

function Probe() { useAssignablePeople(); return null; }
async function renderProbe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => { render(h(QueryClientProvider, { client: qc }, h(Probe))); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  cleanup(); qc.clear();
}

test("T06 assignment directory does not fetch before auth resolves", async () => {
  user = null; preview = false; requests = 0;
  await renderProbe();
  assert.equal(requests, 0);
});

test("T06 assignment directory does not fetch during preview", async () => {
  user = { id: "demo-priya" }; preview = true; requests = 0;
  await renderProbe();
  assert.equal(requests, 0);
});

test("T06 assignment directory still fetches for a real signed-in user", async () => {
  user = { id: "profile-1" }; preview = false; requests = 0;
  await renderProbe();
  assert.ok(requests > 0);
});
