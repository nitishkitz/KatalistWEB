import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, createRef } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";

/**
 * G04: ListChatPanel used to unconditionally jump to the bottom on every
 * new message (`scrollRef.current.scrollTop = scrollRef.current.
 * scrollHeight` on every chat.messages.length change), yanking a user
 * reading older history back down. Now it only auto-scrolls when the
 * user was already near the bottom, and shows a "New messages" control
 * otherwise.
 *
 * jsdom does no real layout, so scrollHeight/clientHeight/scrollTop are
 * all 0 by default -- this test defines them as configurable properties
 * on the rendered scroll container to simulate "scrolled up" vs.
 * "at the bottom", which is what the component's own logic actually
 * reads.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let chatMessages = [];
let chatAccessLost = false;
mock.module("@/features/lists/use-list-messages", {
  namedExports: {
    useListMessages: () => ({
      messages: chatAccessLost ? [] : chatMessages,
      pinnedMessages: [],
      send: { mutateAsync: async () => {}, isPending: false },
      sendSystem: { mutateAsync: async () => {} },
      pin: { mutateAsync: async () => {} },
      uploadAttachment: async () => ({ key: "k", name: "n", mime: null, size: 1 }),
      isLoading: false,
      hasMore: false,
      olderError: false,
      accessLost: chatAccessLost,
      error: chatAccessLost ? { status: 403, message: "permission denied" } : null,
    }),
    useListMessageSearch: () => ({ data: [], isFetching: false, error: null, hasMore: false }),
    useListPinnedMessages: () => ({ messages: [], hasMore: false }),
  },
});
mock.module("@/features/hub/use-conversations", {
  namedExports: {
    useConversation: () => ({ conversation: { others: [] } }),
  },
});
mock.module("@/hooks/useSession", {
  // H04: session-mode.ts (now transitively imported via directory.ts's
  // useProfileDirectoryQuery gating) also needs getStoredDemoSession from
  // this same module to link.
  namedExports: {
    useSession: () => ({ user: { id: "me" } }),
    DEMO_PERSONAS: [],
    getStoredDemoSession: () => null,
  },
});
mock.module("sonner", { namedExports: { toast: { success: () => {}, error: () => {} } } });

const { ListChatPanel } = await import("@/features/lists/ListChatPanel");
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
function panel(listId, ref) {
  return h(QueryClientProvider, { client: qc }, h(InteractionBlockerProvider, null, h(ListChatPanel, { listId, ref })));
}

function setScrollMetrics(container, { scrollTop, scrollHeight, clientHeight }) {
  const el = container.querySelector(".overflow-y-auto");
  Object.defineProperty(el, "scrollTop", { value: scrollTop, writable: true, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  return el;
}

test("near the bottom already: a new message auto-scrolls and shows no New messages control", async () => {
  chatMessages = [{ id: "m1", body: "hi", author: "A", authorId: "a", avatarUrl: null, at: "x", kind: "message", attachment: null, pinnedAt: null, mentionedProfileIds: [] }];
  let container;
  await act(async () => {
    const result = render(panel("list-1"));
    container = result.container;
  });
  const el = setScrollMetrics(container, { scrollTop: 920, scrollHeight: 1000, clientHeight: 100 }); // near bottom

  chatMessages = [...chatMessages, { id: "m2", body: "hey", author: "B", authorId: "b", avatarUrl: null, at: "y", kind: "message", attachment: null, pinnedAt: null, mentionedProfileIds: [] }];
  await act(async () => {
    render(panel("list-1"), { container });
  });

  assert.equal(el.scrollTop, el.scrollHeight, "auto-scrolled to bottom");
  assert.equal(container.textContent.includes("New messages"), false);

  cleanup();
});

test("scrolled up reading history: a new message does NOT auto-scroll, and shows the New messages control", async () => {
  chatMessages = [{ id: "m1", body: "hi", author: "A", authorId: "a", avatarUrl: null, at: "x", kind: "message", attachment: null, pinnedAt: null, mentionedProfileIds: [] }];
  let container;
  await act(async () => {
    const result = render(panel("list-2"));
    container = result.container;
  });
  const el = setScrollMetrics(container, { scrollTop: 0, scrollHeight: 1000, clientHeight: 100 }); // scrolled to the very top

  await act(async () => {
    el.dispatchEvent(new window.Event("scroll", { bubbles: true }));
  });

  chatMessages = [...chatMessages, { id: "m2", body: "hey", author: "B", authorId: "b", avatarUrl: null, at: "y", kind: "message", attachment: null, pinnedAt: null, mentionedProfileIds: [] }];
  await act(async () => {
    render(panel("list-2"), { container });
  });

  assert.equal(el.scrollTop, 0, "scroll position must not jump -- the user is still reading history");
  assert.ok(container.textContent.includes("New messages"), "the New messages control must appear");

  cleanup();
});

test("clicking New messages scrolls to bottom and dismisses the control", async () => {
  chatMessages = [{ id: "m1", body: "hi", author: "A", authorId: "a", avatarUrl: null, at: "x", kind: "message", attachment: null, pinnedAt: null, mentionedProfileIds: [] }];
  let container;
  await act(async () => {
    const result = render(panel("list-3"));
    container = result.container;
  });
  const el = setScrollMetrics(container, { scrollTop: 0, scrollHeight: 1000, clientHeight: 100 });
  await act(async () => {
    el.dispatchEvent(new window.Event("scroll", { bubbles: true }));
  });

  chatMessages = [...chatMessages, { id: "m2", body: "hey", author: "B", authorId: "b", avatarUrl: null, at: "y", kind: "message", attachment: null, pinnedAt: null, mentionedProfileIds: [] }];
  await act(async () => {
    render(panel("list-3"), { container });
  });
  assert.ok(container.textContent.includes("New messages"));

  const button = [...container.querySelectorAll("button")].find((b) => b.textContent.includes("New messages"));
  assert.ok(button, "expected a clickable New messages button");
  await act(async () => {
    button.click();
  });

  assert.equal(el.scrollTop, el.scrollHeight, "clicking it scrolls to bottom");
  assert.equal(container.textContent.includes("New messages"), false, "and dismisses itself");

  cleanup();
});

test("confirmed access loss hides a previously focused full-history result", async () => {
  chatAccessLost = false;
  chatMessages = [];
  const ref = createRef();
  const view = render(panel("list-access", ref));
  await act(async () => ref.current.showMessageResult({
    id: "old", body: "private search result", author: "A", authorId: "a", avatarUrl: null,
    at: "2026-09-24T12:00:00Z", kind: "message", attachment: null, pinnedAt: null,
    mentionedProfileIds: [],
  }));
  assert.ok(view.container.textContent.includes("private search result"));
  chatAccessLost = true;
  await act(async () => view.rerender(panel("list-access", ref)));
  assert.equal(view.container.textContent.includes("private search result"), false);
  assert.ok(view.container.textContent.includes("Couldn't load messages"));
  cleanup();
  chatAccessLost = false;
});
