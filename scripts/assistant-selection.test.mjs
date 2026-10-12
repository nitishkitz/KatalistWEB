import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, act } from "react";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const person = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ids = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];
let sentIds = [];
let requests = [];
let failSecond = false;
let nextQueryFails = false;
mock.module("@/hooks/useSession", {
  namedExports: { useSession: () => ({ user: { id: "viewer" } }) },
});
mock.module("@/features/lists/use-lists", {
  namedExports: {
    useLists: () => ({
      lists: [{ id: "list-1", name: "Website Launch", coverUrl: "/list-cover.jpg" }],
    }),
  },
});
mock.module("@/features/people/directory", {
  namedExports: {
    useAvatarUrl: (_name, _email, src) => src || null,
    matchAvatarByName: () => null,
  },
});
mock.module("@/integrations/supabase/proxy", { namedExports: { toProxiedUrl: (url) => url } });
mock.module("sonner", { namedExports: { toast: { success() {}, warning() {}, error() {} } } });
mock.module("@/lib/authed-fetch", {
  namedExports: {
    authedFetch: async (url, init) => {
      const request = JSON.parse(init.body);
      requests.push({ url, ...request });
      if (url.endsWith("/nudge")) {
        const successful = request.thingIds.filter((id) => !failSecond || id !== ids[1]);
        sentIds.push(...successful);
        return Response.json({
          sent: successful.map((thingId) => ({ thingId })),
          failed: request.thingIds
            .filter((id) => !successful.includes(id))
            .map((thingId) => ({ thingId })),
        });
      }
      if (nextQueryFails) return Response.json({ message: "Refresh failed" }, { status: 502 });
      const remaining = ids.filter((id) => !sentIds.includes(id));
      const payload = {
        answer: {
          intent: "nudge_recommendation",
          answer_markdown: remaining.length
            ? "**Ajju** needs a nudge"
            : "No eligible nudges remain.",
          citations: [],
          freshness: { timezone: "Asia/Kolkata", is_partial: false },
        },
        facts: {
          things: ids.map((id, index) => ({
            id,
            title: index ? "Review website" : "Visit bank",
            list_id: index ? "list-1" : null,
            is_overdue: !index,
            assignee_name: "Ajju",
          })),
          nudge_recommendations: [
            {
              actor_id: person,
              display_name: "Ajju",
              avatar_url: "/avatars/ajju.jpg",
              eligible_thing_ids: remaining,
              eligible_thing_count: remaining.length,
              can_nudge: remaining.length > 0,
            },
          ],
        },
      };
      if (!url.endsWith("/stream")) return Response.json(payload);
      // The Ask panel reads typed turn events from the stream route.
      const frame = (seq, event) =>
        `event: ${event.type}\ndata: ${JSON.stringify({ turnId: `t${requests.length}`, seq, ...event })}\n\n`;
      return new Response(
        frame(1, { type: "accepted" }) +
          frame(2, { type: "answer", answer: payload.answer, facts: payload.facts }) +
          frame(3, { type: "completed" }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    },
  },
});
const { MagicBoxAssistant } = await import("@/features/court/MagicBoxAssistant");
function setup() {
  sentIds = [];
  requests = [];
  failSecond = false;
  nextQueryFails = false;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const props = {
    question: "who needs a nudge",
    requestKey: 1,
    context: "work",
    onOpenThing() {},
    onClose() {},
  };
  const ui = render(h(QueryClientProvider, { client: qc }, h(MagicBoxAssistant, props)));
  return { ui, qc, props };
}
test("expansion starts unselected and sends only explicitly checked Things, then refreshes", async () => {
  const { ui, qc } = setup();
  try {
    fireEvent.click(await ui.findByRole("button", { name: /Ajju/ }));
    assert.equal(ui.getAllByRole("checkbox").filter((input) => input.checked).length, 0);
    assert.equal(ui.getByRole("button", { name: /Review.*nudges/ }).disabled, true);
    fireEvent.click(ui.getByRole("checkbox", { name: /Visit bank/ }));
    fireEvent.click(ui.getByRole("button", { name: /Review 1 nudge/ }));
    assert.equal(
      requests.some((request) => request.url.endsWith("/nudge")),
      false,
    );
    fireEvent.click(ui.getByRole("button", { name: /Confirm 1 nudge/ }));
    await waitFor(() => assert.deepEqual(sentIds, [ids[0]]));
    assert.deepEqual(requests.find((request) => request.url.endsWith("/nudge")).thingIds, [ids[0]]);
    assert.equal(requests.find((request) => request.url.endsWith("/nudge")).actorId, person);
    await waitFor(() => assert.equal(ui.queryByRole("checkbox", { name: /Visit bank/ }), null));
    assert.ok(ui.getByRole("checkbox", { name: /Review website/ }));
  } finally {
    cleanup();
    qc.clear();
  }
});
test("partial success removes sent Things and retains failed Things for review", async () => {
  const { ui, qc } = setup();
  failSecond = true;
  try {
    fireEvent.click(await ui.findByRole("button", { name: /Ajju/ }));
    fireEvent.click(ui.getByRole("button", { name: "Select all" }));
    fireEvent.click(ui.getByRole("button", { name: /Review 2 nudges/ }));
    fireEvent.click(ui.getByRole("button", { name: /Confirm 2 nudges/ }));
    await ui.findByText(/1 could not be sent/);
    await waitFor(() => assert.equal(ui.queryByRole("checkbox", { name: /Visit bank/ }), null));
    assert.equal(ui.getByRole("checkbox", { name: /Review website/ }).checked, true);
  } finally {
    cleanup();
    qc.clear();
  }
});
test("a Court change keeps the answer, clears a prepared confirmation and offers an explicit refresh", async () => {
  const { ui, qc } = setup();
  try {
    fireEvent.click(await ui.findByRole("button", { name: /Ajju/ }));
    fireEvent.click(ui.getByRole("checkbox", { name: /Visit bank/ }));
    fireEvent.click(ui.getByRole("button", { name: /Review 1 nudge/ }));
    const before = requests.length;
    await act(async () => {
      qc.setQueryData(["court", "viewer", "work"], { changed: true });
    });
    await waitFor(() => assert.ok(!ui.queryByRole("button", { name: /Confirm/ })));
    assert.ok(ui.getByText(/Court changed/), "refresh offered");
    assert.ok(ui.getByRole("checkbox", { name: /Visit bank/ }), "the answer is not rewritten");
    assert.equal(requests.length, before, "no silent refetch");
    sentIds = [ids[0]];
    fireEvent.click(ui.getByRole("button", { name: "Update answer" }));
    await waitFor(() => assert.equal(ui.queryByRole("checkbox", { name: /Visit bank/ }), null));
  } finally {
    cleanup();
    qc.clear();
  }
});
test("a query failure hides outdated recommendations and offers refresh", async () => {
  const { ui, qc } = setup();
  try {
    await ui.findByRole("button", { name: /Ajju/ });
    nextQueryFails = true;
    fireEvent.click(ui.getByRole("button", { name: "Refresh answer" }));
    await ui.findByRole("alert");
    assert.equal(ui.queryByRole("button", { name: /Ajju/ }), null);
  } finally {
    cleanup();
    qc.clear();
  }
});

test("Ask shows the person's photo and the Thing's List identity with safe image fallbacks", async () => {
  const { ui, qc } = setup();
  try {
    const person = await ui.findByRole("button", { name: /Ajju/ });
    const avatar = ui.getByRole("img", { name: "Ajju" });
    assert.equal(avatar.getAttribute("src"), "/avatars/ajju.jpg");
    fireEvent.click(person);
    assert.ok(ui.getByText("Website Launch"));
    const cover = ui.container.querySelector('img[alt="Website Launch cover"]');
    assert.equal(cover?.getAttribute("src"), "/list-cover.jpg");
    assert.equal(
      ui.container.querySelectorAll('img[alt$=" cover"]').length,
      1,
      "standalone Things have no invented List cover",
    );
    fireEvent.error(avatar);
    fireEvent.error(cover);
    assert.equal(ui.queryByRole("img", { name: "Ajju" }), null);
    assert.equal(ui.container.querySelector('img[alt="Website Launch cover"]'), null);
    assert.ok(ui.getByText("Website Launch"));
    fireEvent.click(ui.getByRole("checkbox", { name: /Review website/ }));
    assert.equal(ui.getByRole("checkbox", { name: /Review website/ }).checked, true);
  } finally {
    cleanup();
    qc.clear();
  }
});
