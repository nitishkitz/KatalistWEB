import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, useEffect } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * H04: useProfileDirectoryQuery() is mounted once, globally, in
 * __root.tsx's ProfileDirectoryProvider -- regardless of route -- and used
 * to fire unconditionally, with no enabled gate at all. That meant three
 * guaranteed-to-401 requests fired on every anonymous page view (/auth,
 * /welcome, /onboarding), caught by the new H04 Playwright smoke spec
 * (tests/e2e/preview/smoke.spec.ts) asserting no console errors on /auth.
 * Fixed by gating on the same enabled: Boolean(user) && !preview pattern
 * every other session-scoped query in this codebase already uses.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let testUser = null;
let testPreview = false;
let fetchCalls = 0;

mock.module("@/hooks/useSession", {
  namedExports: {
    useSession: () => ({ user: testUser, session: testUser ? { user: testUser } : null }),
    DEMO_PERSONAS: [],
    getStoredDemoSession: () => null,
  },
});
mock.module("@/lib/session-mode", {
  namedExports: { isPreviewSession: () => testPreview },
});
mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      auth: { getSession: async () => ({ data: { session: null } }) },
      from: () => {
        const node = { select: () => node, then: (resolve) => resolve({ data: [], error: null }) };
        return node;
      },
      rpc: async () => ({ data: [], error: null }),
    },
  },
});
mock.module("@/lib/authed-fetch", {
  namedExports: {
    authedFetch: async () => {
      fetchCalls += 1;
      return { ok: false };
    },
  },
});

const { useProfileDirectoryQuery } = await import("@/features/people/directory");

function Probe({ onValue }) {
  const q = useProfileDirectoryQuery();
  useEffect(() => {
    onValue(q);
  });
  return null;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

test("signed out: the directory query never fires (no guaranteed-401 requests on an anonymous page)", async () => {
  testUser = null;
  testPreview = false;
  fetchCalls = 0;
  const qc = newClient();

  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: () => {} })));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(fetchCalls, 0, "signed-out visitors must never trigger the directory fetch");

  cleanup();
  qc.clear();
});

test("preview/demo session: also never fires (a demo identity has no real Supabase session either)", async () => {
  testUser = { id: "demo-1" };
  testPreview = true;
  fetchCalls = 0;
  const qc = newClient();

  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: () => {} })));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(fetchCalls, 0, "a preview/demo session must not trigger the real directory fetch either");

  cleanup();
  qc.clear();
});

test("signed in, not preview: the directory query fires normally", async () => {
  testUser = { id: "profile-1" };
  testPreview = false;
  fetchCalls = 0;
  const qc = newClient();

  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: () => {} })));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(fetchCalls, 1, "a real signed-in session must still fetch the directory as before");

  cleanup();
  qc.clear();
});
