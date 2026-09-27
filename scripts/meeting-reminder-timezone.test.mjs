import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, useEffect } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * H07: `useUpcomingMeetingReminder`'s urgent-window/countdown logic is
 * pure epoch-millisecond arithmetic end to end (`new Date(iso).getTime()`
 * subtraction) -- both here and in `ScheduleMeetingDialog.tsx`'s own
 * `start.getTime() + durationMin * 60_000` and `.toISOString()` submission.
 * There is no manual UTC-offset math anywhere in this feature for a DST
 * transition to break. This fixture proves that property directly: a
 * meeting straddling a real DST transition (America/New_York, 2026-03-08,
 * spring-forward at 07:00 UTC / 2am->3am local) is scheduled/surfaced
 * identically to one that doesn't, since the underlying computation never
 * looks at a local calendar date at all.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@/hooks/useSession", {
  namedExports: { useSession: () => ({ session: { user: { id: "profile-1" } }, user: { id: "profile-1" } }) },
});
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => false } });

let meetingRows = [];
mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      rpc: (name, args) => {
        assert.equal(name, "get_my_upcoming_meetings");
        assert.equal(args.p_within_hours, 24);
        return { abortSignal: () => Promise.resolve({ data: meetingRows, error: null }) };
      },
    },
  },
});

const { useUpcomingMeetingReminder } = await import("@/features/lists/use-upcoming-meetings-reminder");

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function Probe({ onValue }) {
  const value = useUpcomingMeetingReminder();
  useEffect(() => {
    onValue(value);
  });
  return null;
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

test("a meeting starting just after a real DST spring-forward transition surfaces on schedule, identical to a non-DST meeting", async (t) => {
  // 2026-03-08T06:58:00Z is 2 minutes before the meeting; DST begins at
  // 07:00 UTC (2am EST becomes 3am EDT) -- this straddles the transition
  // by design.
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-03-08T06:58:00Z").getTime() });
  t.after(() => mock.timers.reset());

  meetingRows = [
    {
      id: "m-dst",
      list_id: "list-1",
      list_kind: "list",
      list_name: "Product",
      title: "Sprint planning",
      starts_at: "2026-03-08T07:01:00Z",
      ends_at: "2026-03-08T07:31:00Z",
    },
  ];
  const qc = newClient();
  let latest = null;
  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });
  await settle();

  assert.ok(latest.reminder, "a meeting 3 minutes out (within the 5-minute urgent window) must surface");
  assert.equal(latest.reminder.id, "m-dst");
  assert.equal(latest.inProgress, false);
  cleanup();
});

test("a meeting more than 5 minutes out does not yet surface as the urgent reminder", async (t) => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-03-08T06:50:00Z").getTime() });
  t.after(() => mock.timers.reset());

  meetingRows = [
    {
      id: "m-far",
      list_id: "list-1",
      list_kind: "list",
      list_name: "Product",
      title: "Sprint planning",
      starts_at: "2026-03-08T07:01:00Z",
      ends_at: "2026-03-08T07:31:00Z",
    },
  ];
  const qc = newClient();
  let latest = null;
  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });
  await settle();

  assert.equal(latest.reminder, null, "11 minutes out is outside the 5-minute urgent window");
  cleanup();
});

test("a meeting already in progress (past its start) still surfaces, marked inProgress, until it ends", async (t) => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-03-08T07:15:00Z").getTime() });
  t.after(() => mock.timers.reset());

  meetingRows = [
    {
      id: "m-live",
      list_id: "list-1",
      list_kind: "list",
      list_name: "Product",
      title: "Sprint planning",
      starts_at: "2026-03-08T07:01:00Z",
      ends_at: "2026-03-08T07:31:00Z",
    },
  ];
  const qc = newClient();
  let latest = null;
  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });
  await settle();

  assert.ok(latest.reminder);
  assert.equal(latest.inProgress, true);
  cleanup();
});

test("dismissing a meeting is idempotent -- calling it twice does not resurrect or double-fire anything", async (t) => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-03-08T06:58:00Z").getTime() });
  t.after(() => mock.timers.reset());

  meetingRows = [
    {
      id: "m-dismiss",
      list_id: "list-1",
      list_kind: "list",
      list_name: "Product",
      title: "Sprint planning",
      starts_at: "2026-03-08T07:01:00Z",
      ends_at: "2026-03-08T07:31:00Z",
    },
  ];
  const qc = newClient();
  let latest = null;
  await act(async () => {
    render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue: (v) => (latest = v) })));
  });
  await settle();
  assert.ok(latest.reminder);

  await act(async () => {
    latest.dismiss("m-dismiss");
  });
  assert.equal(latest.reminder, null, "a dismissed meeting no longer surfaces");

  await act(async () => {
    latest.dismiss("m-dismiss");
  });
  assert.equal(latest.reminder, null, "dismissing an already-dismissed meeting a second time changes nothing");
  cleanup();
});
