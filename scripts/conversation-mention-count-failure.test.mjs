import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * T05: useConversationMentionCount() collapsed a genuinely failed (retries
 * exhausted) exact-count lookup to the same "0" as a confirmed empty
 * result -- exactly the fabricated zero the plan calls out ("Do not show
 * zero mentions simply because the lookup failed"). It must now report a
 * distinguishable "unknown" instead.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              gt: () => ({
                neq: () => ({
                  contains: () => Promise.resolve({ count: null, error: new Error("boom") }),
                }),
              }),
            }),
          }),
        }),
      }),
    },
  },
});

const { useConversationMentionCount } = await import("@/features/hub/chat-read-state");

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
}

test('useConversationMentionCount() reports "unknown" (not 0) once the exact-count lookup has genuinely failed', async () => {
  window.localStorage.clear();

  const conversation = {
    id: "list-1",
    kind: "dm",
    title: "Someone",
    avatarUrl: null,
    ownerId: "profile-other",
    others: [],
    memberCount: 2,
    lastMessage: "hi",
    lastAt: new Date().toISOString(),
    lastAuthor: "Someone",
    lastAuthorId: "profile-other",
  };

  let latest;
  function Probe() {
    latest = useConversationMentionCount(conversation, "profile-1");
    return null;
  }

  const qc = newClient();
  render(h(QueryClientProvider, { client: qc }, h(Probe)));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

  assert.equal(latest, "unknown", "a failed mention-count lookup must be distinguishable from a real 0, not silently shown as 0");

  cleanup();
  qc.clear();
});
