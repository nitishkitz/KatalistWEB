import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let countQueries = 0;
mock.module("@/integrations/supabase/client", {
  namedExports: { supabase: {
    from: () => ({ select: () => ({ eq: () => ({ is: () => ({ gt: () => ({
      neq: () => { countQueries++; return Promise.resolve({ count: null, error: new Error("unread count failed") }); },
    }) }) }) }) }),
  } },
});

const { useConversationUnreadCount } = await import("@/features/hub/chat-read-state");

test("a current Hub page aggregate avoids per-conversation count requests", async () => {
  localStorage.clear();
  countQueries = 0;
  const conversation = {
    id: "list-2", kind: "dm", title: "Ada", avatarUrl: null, ownerId: "other",
    others: [], memberCount: 2, lastMessage: "hello", lastAt: new Date().toISOString(),
    lastAuthor: "Ada", lastAuthorId: "other", unreadCount: 3, readWatermark: 0,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let latest;
  function Probe() { latest = useConversationUnreadCount(conversation, "me"); return null; }
  render(h(QueryClientProvider, { client: qc }, h(Probe)));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  assert.equal(latest, 3);
  assert.equal(countQueries, 0);
  cleanup();
  qc.clear();
});

test("a self-authored latest message does not erase older unread messages reported by the aggregate", async () => {
  localStorage.clear();
  countQueries = 0;
  const conversation = {
    id: "list-3", kind: "dm", title: "Ada", avatarUrl: null, ownerId: "me",
    others: [], memberCount: 2, lastMessage: "my reply", lastAt: new Date().toISOString(),
    lastAuthor: "Me", lastAuthorId: "me", unreadCount: 1, readWatermark: 0,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let latest;
  function Probe() { latest = useConversationUnreadCount(conversation, "me"); return null; }
  render(h(QueryClientProvider, { client: qc }, h(Probe)));
  assert.equal(latest, 1);
  assert.equal(countQueries, 0);
  cleanup();
  qc.clear();
});

test("a failed exact unread-count lookup reports unknown instead of zero", async () => {
  localStorage.clear();
  const conversation = {
    id: "list-1", kind: "dm", title: "Ada", avatarUrl: null, ownerId: "other",
    others: [], memberCount: 2, lastMessage: "hello", lastAt: new Date().toISOString(),
    lastAuthor: "Ada", lastAuthorId: "other",
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let latest;
  function Probe() {
    latest = useConversationUnreadCount(conversation, "me");
    return null;
  }
  render(h(QueryClientProvider, { client: qc }, h(Probe)));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  assert.equal(latest, "unknown");
  cleanup();
  qc.clear();
});
