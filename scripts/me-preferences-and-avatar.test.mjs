import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * G13: three confirmed defects in me.tsx, reproduced against the real
 * mounted component (heavy dependencies mocked at their own module
 * boundary; QueryClient, AppShell wrapper aside, and the identity-epoch
 * helpers are real, unmocked production code).
 *
 * 1. The four settings panels + "Recently Shredded" were a hand-rolled
 *    `fixed inset-0` overlay with no role="dialog" and no Escape handling
 *    -- moved to the same Radix Dialog primitive "Edit profile" already
 *    used.
 * 2. Avatar upload gave a toast only, with no lasting pending/failure
 *    indicator and no retry without re-picking the file.
 * 3. Saving an empty name showed only a toast, no inline field message.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigateSpy = mock.fn();
mock.module("@tanstack/react-router", {
  namedExports: {
    createFileRoute: () => (opts) => opts,
    useNavigate: () => navigateSpy,
  },
});
mock.module("@/components/layout/AppShell", {
  namedExports: { AppShell: (props) => h("div", { "data-testid": "app-shell" }, props.children) },
});
mock.module("@/hooks/useSession", {
  namedExports: {
    useSession: () => ({
      user: { id: "profile-1", email: "person@example.com" },
      signOut: async () => {},
    }),
  },
});
mock.module("@/features/context/use-app-context", {
  namedExports: { useAppContext: () => ({ context: "work" }) },
});
mock.module("@/features/people/directory", {
  namedExports: { useAvatarUrl: () => null, matchAvatarByName: () => null },
});
mock.module("@/features/doorman/use-doorman", {
  namedExports: { isDoormanEnabled: () => false },
});
mock.module("@/features/push/push-registration", {
  namedExports: {
    getPushPermissionState: () => "default",
    registerPushForUser: async () => ({ ok: true }),
  },
});
mock.module("@/features/me/use-trophy", {
  namedExports: {
    useTrophy: () => ({
      stats: { sorted: 3, caught: 5, streak: 2, weekly: 4, achievement: null, shredded: [] },
      restore: async () => {},
      readState: "ready",
      retry: () => {},
    }),
  },
});

let uploadOutcome = "success";
const uploadCalls = [];
const uploadAvatarFake = {
  mutate: (file, opts) => {
    uploadCalls.push(file);
    if (uploadOutcome === "success") opts.onSuccess();
    else opts.onError(new Error("Upload failed: network down"));
  },
};
const updateProfileCalls = [];
const updateProfileFake = {
  mutate: (payload, opts) => {
    updateProfileCalls.push(payload);
    opts.onSuccess();
  },
};
mock.module("@/features/me/use-profile", {
  namedExports: {
    useProfile: () => ({ data: { display_name: "Test User", occupation: "Engineer" }, isLoading: false }),
    useUploadAvatar: () => uploadAvatarFake,
    useUpdateProfile: () => updateProfileFake,
  },
});

const { Route } = await import("@/routes/me");
const MePage = Route.component;

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

async function renderMe() {
  const qc = newClient();
  let utils;
  await act(async () => {
    utils = render(h(QueryClientProvider, { client: qc }, h(MePage)));
  });
  return utils;
}

test("a settings panel is a real accessible dialog, and Escape closes it and returns focus", async () => {
  await renderMe();

  const trigger = screen.getByText("Appearance").closest("button");
  await act(async () => {
    fireEvent.click(trigger);
  });

  const dialog = screen.getByRole("dialog");
  assert.ok(dialog, "the panel must expose role=dialog, not a plain div");
  assert.ok(within(dialog).getByText("Reduced motion"), "panel content is preserved");

  await act(async () => {
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
  });

  assert.equal(screen.queryByRole("dialog"), null, "Escape must close the dialog");
  cleanup();
});

test("a failed avatar upload keeps the file and offers Retry without re-selecting it; Retry resubmits the same file", async () => {
  uploadOutcome = "failure";
  uploadCalls.length = 0;
  await renderMe();

  const fileInput = document.querySelector('input[type="file"][accept*="image"]');
  assert.ok(fileInput, "an avatar file input must exist");
  const file = new File(["a"], "avatar.png", { type: "image/png" });

  await act(async () => {
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    fireEvent.change(fileInput);
  });

  assert.equal(uploadCalls.length, 1);
  const retryButton = screen.getByTitle("Upload failed — click to retry");
  assert.ok(retryButton, "a failed upload must show a persistent retry affordance, not just a toast");

  uploadOutcome = "success";
  await act(async () => {
    fireEvent.click(retryButton);
  });

  assert.equal(uploadCalls.length, 2, "Retry must resubmit a mutation");
  assert.equal(uploadCalls[1], file, "Retry must resend the exact same File, not require re-selection");
  assert.equal(screen.queryByTitle("Upload failed — click to retry"), null, "success must clear the failed indicator");
  cleanup();
});

test("saving an empty name shows an inline field error, keeps the dialog open, and never dispatches the mutation", async () => {
  updateProfileCalls.length = 0;
  await renderMe();

  await act(async () => {
    fireEvent.click(screen.getByText("Edit profile"));
  });
  const nameInput = screen.getByDisplayValue("Test User");
  await act(async () => {
    fireEvent.change(nameInput, { target: { value: "   " } });
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Save"));
  });

  assert.ok(screen.getByText("Name can’t be empty."), "an inline, field-level message must appear");
  assert.equal(updateProfileCalls.length, 0, "an empty name must never reach the mutation");
  assert.ok(screen.getByRole("dialog"), "the dialog must stay open so the user can fix it");
  cleanup();
});
