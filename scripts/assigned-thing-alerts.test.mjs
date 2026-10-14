import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act, render, cleanup } from "@testing-library/react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let currentUser = { id: "user-1" };
let currentNotifications = {
  isLoading: false,
  items: [],
  markOne: {
    mutate: (ids) => {
      markedIds.push(...ids);
    },
  },
};
let markedIds = [];
let toastsEmitted = [];
let thingsById = {
  "thing-1": { id: "thing-1", title: "Review auth flow" },
  "thing-2": { id: "thing-2", title: "Deploy database migration" },
};

mock.module("@/hooks/useSession", {
  namedExports: {
    useSession: () => ({ user: currentUser, session: { user: currentUser }, loading: false }),
    getStoredDemoSession: () => null,
  },
});

mock.module("@/features/notifications/use-notifications", {
  namedExports: {
    useNotifications: () => currentNotifications,
  },
});

mock.module("@/features/things/use-thing", {
  namedExports: {
    useThing: (id) => ({
      isLoading: false,
      thing: id ? (thingsById[id] ?? null) : null,
      refetch: async () => {},
    }),
  },
});

mock.module("sonner", {
  namedExports: {
    toast: {
      info: (message, options) => {
        toastsEmitted.push({ type: "info", message, options });
      },
      error: (message, options) => {
        toastsEmitted.push({ type: "error", message, options });
      },
    },
    useSonner: () => ({ toasts: [] }),
  },
});

mock.module("@/features/court/CourtDetailModal", {
  namedExports: {
    CourtDetailModal: ({ thing, isOpen, onClose }) => {
      if (!isOpen || !thing) return null;
      return h("div", { "data-testid": "court-detail-modal", "data-thing-id": thing.id }, thing.title);
    },
  },
});

mock.module("@/components/ui/dialog", {
  namedExports: {
    Dialog: ({ open, children }) => (open ? h("div", { "data-testid": "dialog-open" }, children) : null),
    DialogContent: ({ children }) => h("div", { "data-testid": "dialog-content" }, children),
    DialogTitle: ({ children }) => h("h2", null, children),
    DialogDescription: ({ children }) => h("p", null, children),
  },
});

const { AssignedThingAlerts, OPEN_ASSIGNED_THING_EVENT } = await import(
  "@/features/notifications/AssignedThingAlerts"
);

test("historical assignments present on mount do not produce toasts", async () => {
  cleanup();
  currentUser = { id: "user-1" };
  toastsEmitted = [];
  markedIds = [];
  currentNotifications.items = [
    {
      id: "notif-hist-1",
      kind: "thing_assigned",
      thingId: "thing-1",
      body: "Assigned by Jane",
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    },
  ];

  const { container } = render(h(AssignedThingAlerts));

  assert.equal(toastsEmitted.length, 0, "No toast emitted for historical assignment on initial mount");
  assert.equal(container.querySelector("[data-testid='court-detail-modal']"), null);
});

test("a fresh assignment produces one alert, and refetch does not duplicate it", async () => {
  cleanup();
  currentUser = { id: "user-1" };
  toastsEmitted = [];
  markedIds = [];
  currentNotifications.items = [];

  const { rerender } = render(h(AssignedThingAlerts));
  assert.equal(toastsEmitted.length, 0);

  // Fresh assignment arrives
  await act(async () => {
    currentNotifications = {
      ...currentNotifications,
      items: [
        {
          id: "notif-fresh-1",
          kind: "thing_assigned",
          thingId: "thing-2",
          body: "Deploy database migration assigned to you",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    rerender(h(AssignedThingAlerts));
  });

  assert.equal(toastsEmitted.length, 1, "One alert emitted for fresh assignment");
  assert.equal(toastsEmitted[0].message, "New Thing assigned to you");
  assert.equal(toastsEmitted[0].options.description, "Deploy database migration assigned to you");
  assert.equal(toastsEmitted[0].options.action.label, "Open Thing");

  // Refetch happens with identical items
  await act(async () => {
    rerender(h(AssignedThingAlerts));
  });

  assert.equal(toastsEmitted.length, 1, "Alert is not duplicated on refetch");
});

test("toast Open action triggers OPEN_ASSIGNED_THING_EVENT, marks notification read, and opens authorized Thing modal", async () => {
  cleanup();
  currentUser = { id: "user-1" };
  toastsEmitted = [];
  markedIds = [];
  currentNotifications.items = [];

  const { container, rerender } = render(h(AssignedThingAlerts));

  await act(async () => {
    currentNotifications = {
      ...currentNotifications,
      items: [
        {
          id: "notif-fresh-2",
          kind: "thing_assigned",
          thingId: "thing-1",
          body: "Review auth flow assigned",
          createdAt: new Date().toISOString(),
        },
      ],
    };
    rerender(h(AssignedThingAlerts));
  });

  assert.equal(toastsEmitted.length, 1);
  const openAction = toastsEmitted[0].options.action;

  // Trigger Open action
  await act(async () => {
    openAction.onClick();
  });

  assert.deepEqual(markedIds, ["notif-fresh-2"], "Notification was marked as read");
  const modal = container.querySelector("[data-testid='court-detail-modal']");
  assert.ok(modal, "CourtDetailModal is opened");
  assert.equal(modal.getAttribute("data-thing-id"), "thing-1");
});

test("account changes clear seen and detail state, preventing cross-account access", async () => {
  cleanup();
  currentUser = { id: "user-1" };
  toastsEmitted = [];
  markedIds = [];
  currentNotifications.items = [
    {
      id: "notif-u1",
      kind: "thing_assigned",
      thingId: "thing-1",
      body: "User 1 task",
      createdAt: new Date().toISOString(),
    },
  ];

  const { container, rerender } = render(h(AssignedThingAlerts));

  // Open the detail modal for user-1
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent(OPEN_ASSIGNED_THING_EVENT, {
        detail: { thingId: "thing-1", notificationId: "notif-u1" },
      }),
    );
  });
  assert.ok(container.querySelector("[data-testid='court-detail-modal']"), "Modal open for user 1");

  // Switch account to user-2
  await act(async () => {
    currentUser = { id: "user-2" };
    currentNotifications = {
      ...currentNotifications,
      items: [],
    };
    rerender(h(AssignedThingAlerts));
  });

  assert.equal(
    container.querySelector("[data-testid='court-detail-modal']"),
    null,
    "Modal immediately closed when user switches",
  );

  // An assignment event targeting user-1's old task when logged out does not open if user is not authorized or logged out
  await act(async () => {
    currentUser = null;
    rerender(h(AssignedThingAlerts));
    window.dispatchEvent(
      new CustomEvent(OPEN_ASSIGNED_THING_EVENT, {
        detail: { thingId: "thing-1" },
      }),
    );
  });

  assert.equal(
    container.querySelector("[data-testid='court-detail-modal']"),
    null,
    "Logged out user cannot open assigned thing",
  );
});
