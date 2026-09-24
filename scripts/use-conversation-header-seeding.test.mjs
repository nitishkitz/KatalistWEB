import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * T05: useConversation() (the Hub workspace header's data source) had no
 * seeding from the sidebar's already-fetched lightweight record and no
 * real `isLoading` signal -- ConversationWorkspace.tsx fell back to a
 * fabricated generic "Conversation" title and "0 members" while its own
 * detail query was still in flight, even though the sidebar already knew
 * the real title/member count the instant the conversation was clicked.
 * Now it seeds from that cache via `placeholderData`, and `isLoading` is
 * true only when there is genuinely nothing (not even a seeded record) to
 * show yet.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@/hooks/useSession", {
  namedExports: { useSession: () => ({ session: { user: { id: "profile-1" } }, user: { id: "profile-1" } }) },
});
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => false } });

let detailResolvers = [];
mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            abortSignal: () => ({
              maybeSingle: () =>
                new Promise((resolve) => {
                  detailResolvers.push(resolve);
                }),
            }),
          }),
          in: () => ({ abortSignal: () => Promise.resolve({ data: [], error: null }) }),
        }),
      }),
    },
  },
});
mock.module("@/features/people/directory", {
  namedExports: { getProfileIdentities: async () => [], matchAvatarByName: () => null },
});
mock.module("@/features/realtime/identity-cache-policy", {
  namedExports: { getIdentityEpoch: () => ({ epoch: 1 }), isEpochCurrent: () => true },
});

const { useConversation } = await import("@/features/hub/use-conversations");

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
}

function seedSidebarCache(qc, record) {
  qc.setQueryData(["hub-conversations", "profile-1"], [record]);
}

test("useConversation() immediately returns the sidebar-seeded record (not loading) while its own detail fetch is still pending", async () => {
  detailResolvers = [];
  const qc = newClient();
  const seeded = {
    id: "list-1",
    kind: "group",
    title: "Real Group Name",
    avatarUrl: null,
    ownerId: "profile-other",
    others: [],
    memberCount: 4,
    lastMessage: "hi",
    lastAt: new Date().toISOString(),
    lastAuthor: "Someone",
    lastAuthorId: "profile-other",
  };
  seedSidebarCache(qc, seeded);

  let latest;
  function Probe() {
    latest = useConversation("list-1");
    return null;
  }

  render(h(QueryClientProvider, { client: qc }, h(Probe)));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(latest.isLoading, false, "a seeded record from the sidebar means there is already something real to show");
  assert.equal(latest.conversation?.title, "Real Group Name", "the header must show the real seeded title, not a fabricated fallback");
  assert.equal(latest.conversation?.memberCount, 4, "the header must show the real seeded member count, not a fabricated 0");

  cleanup();
  qc.clear();
});

test("useConversation() reports isLoading while genuinely nothing (no sidebar cache, no resolved fetch) is available yet", async () => {
  detailResolvers = [];
  const qc = newClient();
  // No sidebar cache seeded this time.

  let latest;
  function Probe() {
    latest = useConversation("list-2");
    return null;
  }

  render(h(QueryClientProvider, { client: qc }, h(Probe)));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(latest.isLoading, true, "with no seed and no resolved fetch, there is genuinely nothing to show yet");
  assert.equal(latest.conversation, null, "must not fabricate a conversation record while genuinely loading");

  cleanup();
  qc.clear();
});
