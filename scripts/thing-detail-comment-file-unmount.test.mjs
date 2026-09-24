import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h } from "react";
import { act } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";
import { useInteractionBlocker } from "@/components/katalist/use-interaction-blocker";

/**
 * R-02 (source-confirmed by the independent review): handleCommentFileChange()
 * captures the target Thing id before processing, but its post-processing
 * branch compared it only against `thingIdRef.current` -- a ref only ever
 * updated by a render. After the component UNMOUNTS entirely (not just
 * switches to a different Thing), thingIdRef keeps pointing at whatever
 * Thing was last displayed, indistinguishable from "still mounted, same
 * Thing" by that ref alone -- so it took the `setCommentAttachments()`
 * branch on an unmounted component (a no-op) instead of persisting the
 * processed file into session-drafts.ts, and the attachment disappeared.
 *
 * The fix adds an explicit isMountedRef and only takes the live-state
 * branch when both mounted and still on the same Thing; otherwise it
 * writes directly into the captured Thing's own draft, same as the
 * existing "switched to a different Thing" branch already did.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let processFileImpl = async (file) => ({ id: file.name, name: file.name, type: "other" });

mock.module("@/hooks/useSession", {
  namedExports: {
    useSession: () => ({ session: { user: { id: "profile-1", user_metadata: {} } }, user: { id: "profile-1" } }),
  },
});
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => false, isPreviewMode: () => false } });
mock.module("@/features/demo/identities", {
  namedExports: { currentDemoPerson: () => ({ name: "Demo" }), currentDemoActorId: () => "demo-actor" },
});
mock.module("@/features/people/resolve-actors", { namedExports: { resolveActorPeople: async () => new Map() } });
mock.module("@/features/things/local-state", {
  namedExports: {
    addCommentLocal: () => {},
    getActivity: () => [],
    getComments: () => [],
    getBucketRefs: () => [],
  },
});
mock.module("@/features/things/use-local-version", { namedExports: { useLocalVersion: () => 0 } });
mock.module("@/features/things/rpc", {
  namedExports: {
    rpcComment: async () => {},
    isUuid: () => true,
    rpcAddThingFile: async () => {},
    rpcAddToBucket: async () => {},
    rpcAssignOutsideKatalist: async () => ({ path: "/bridge/x" }),
    rpcCancelThing: async () => {},
    rpcCatchThing: async () => {},
    rpcCatchAndStart: async () => {},
    rpcNudgeThing: async () => {},
    rpcReopenThing: async () => {},
    rpcRemoveFromBucket: async () => {},
    rpcReassignThing: async () => {},
    rpcSetDue: async () => {},
    rpcSetPersonalPace: async () => {},
    rpcSetWorkStatus: async () => {},
    rpcShred: async () => {},
    rpcSortThing: async () => {},
  },
});
mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: () => {
        const node = {
          select: () => node,
          eq: () => node,
          is: () => node,
          order: () => node,
          limit: () => node,
          or: () => node,
          abortSignal: async () => ({ data: [], error: null }),
        };
        return node;
      },
    },
  },
});
mock.module("@/features/court/use-court", { namedExports: { useCourt: () => ({ myActorId: "actor-me" }) } });
mock.module("@/features/things/use-thing", { namedExports: { useThing: () => ({ thing: null, isLoading: false }) } });
mock.module("@/features/people/use-assignable", { namedExports: { useAssignablePeople: () => [] } });
mock.module("@/features/people/directory", {
  namedExports: { useAvatarUrl: () => null, matchAvatarByName: () => null },
});
mock.module("@/features/buckets/use-buckets", {
  namedExports: { useBuckets: () => ({ buckets: [], preview: false }) },
});
mock.module("@/features/things/read-state", { namedExports: { markThingAsRead: () => {} } });
mock.module("@/lib/file-utils", {
  namedExports: {
    processFileForUpload: async (f) => processFileImpl(f),
    MAX_THING_ATTACHMENT_BYTES: 50 * 1024 * 1024,
  },
});
mock.module("@/features/things/attachments", {
  namedExports: { uploadThingAttachment: async () => ({ id: "x", name: "x", type: "other" }) },
});
mock.module("@/features/things/query-updates", {
  namedExports: { withOptimisticPatch: (_qc, _id, _patch, fn) => fn },
});
mock.module("@/features/things/personal-shred", { namedExports: { invalidatePersonalSurfaces: async () => {} } });

const { ThingDetailContent } = await import("@/features/things/ThingDetailContent");
const { getDraft } = await import("@/features/drafts/session-drafts");
const { advanceIdentityEpoch } = await import("@/features/realtime/identity-cache-policy");

function makeThing(id, title) {
  const me = { id: "actor-me", name: "Me", initials: "ME" };
  return {
    id,
    title,
    creator: me,
    owner: me,
    assignee: me,
    acknowledgement: "caught",
    workStatus: "under_progress",
    ownerImportance: "next",
    personalPace: "next",
    dueAt: null,
    dueHasTime: false,
    context: "work",
    listId: null,
    listName: null,
    cancelledAt: null,
    sortedAt: null,
    caughtAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function newClient() {
  // gcTime: 0 must be set for BOTH queries and mutations -- mutations
  // default to a 5-minute gcTime, which schedules a real setTimeout that
  // keeps the process (and `node --test`) alive well past every assertion
  // completing. See thing-detail-comment-draft-failure.test.mjs for the
  // minimal no-React reproduction that root-caused this originally.
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
}

function Harness({ qc, thingId }) {
  // variant="court" is the branch that actually renders the file <input>
  // (ThingDetailContent's "default" variant reuses the same ref for its
  // own Attach button but never mounts an input of its own) -- this is
  // the Court detail view's own comment composer, which is what R-02's
  // handleCommentFileChange()/draft-write-effect describes.
  return h(
    QueryClientProvider,
    { client: qc },
    h(
      InteractionBlockerProvider,
      null,
      h(ThingDetailContent, { initialThing: makeThing(thingId, `Thing ${thingId}`), variant: "court" }),
    ),
  );
}

function makeFile(name) {
  return new File(["content"], name, { type: "text/plain" });
}

// The "court" variant renders TWO <input type="file"> elements sharing the
// same accept list: thingFileInputRef (Files section, handleThingFileUpload)
// comes first in source/DOM order, then commentFileInputRef (the reply
// composer's own attach input, handleCommentFileChange -- what R-02
// describes) second.
function getCommentFileInput(container) {
  return container.querySelectorAll('input[type="file"]')[1];
}

test("R-02: a file that finishes processing AFTER the detail unmounts is still persisted into that Thing's draft", async () => {
  let resolveProcess;
  processFileImpl = () => new Promise((r) => (resolveProcess = () => r({ id: "file-1", name: "photo.png", type: "other" })));
  const qc = newClient();
  const { container, unmount } = render(h(Harness, { qc, thingId: "thing-a" }));

  const input = getCommentFileInput(container);
  await act(async () => {
    fireEvent.change(input, { target: { files: [makeFile("photo.png")] } });
  });

  // Unmount the WHOLE detail before processing finishes.
  unmount();

  await act(async () => {
    resolveProcess();
    await new Promise((r) => setTimeout(r, 10));
  });

  const draft = getDraft(qc, "thing-comment", "thing-a");
  assert.ok(draft, "the processed file must have been persisted into thing-a's own draft");
  assert.equal(draft.attachments?.length, 1, "exactly one attachment persisted");
  assert.equal(draft.attachments?.[0].name, "photo.png");

  cleanup();
  qc.clear();
});

test("R-02: a file that finishes processing while still mounted on the SAME Thing still updates live state normally", async () => {
  processFileImpl = async () => ({ id: "file-1", name: "photo.png", type: "other" });
  const qc = newClient();
  const { container } = render(h(Harness, { qc, thingId: "thing-a" }));

  const input = getCommentFileInput(container);
  await act(async () => {
    fireEvent.change(input, { target: { files: [makeFile("photo.png")] } });
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.ok(container.textContent.includes("photo.png"), "the attachment renders in the live UI");

  cleanup();
  qc.clear();
});

test("R-02: a file that finishes processing AFTER switching to a different Thing lands in the original Thing's draft, not the new one", async () => {
  let resolveProcess;
  processFileImpl = () => new Promise((r) => (resolveProcess = () => r({ id: "file-1", name: "photo.png", type: "other" })));
  const qc = newClient();
  const { container, rerender } = render(h(Harness, { qc, thingId: "thing-a" }));

  const input = getCommentFileInput(container);
  await act(async () => {
    fireEvent.change(input, { target: { files: [makeFile("photo.png")] } });
  });

  await act(async () => {
    rerender(h(Harness, { qc, thingId: "thing-b" }));
  });

  await act(async () => {
    resolveProcess();
    await new Promise((r) => setTimeout(r, 10));
  });

  const draftA = getDraft(qc, "thing-comment", "thing-a");
  const draftB = getDraft(qc, "thing-comment", "thing-b");
  assert.equal(draftA?.attachments?.length, 1, "the file belongs to thing-a, the Thing it was picked for");
  assert.ok(!draftB?.attachments?.length, "thing-b (the Thing now displayed) must not receive thing-a's file");

  cleanup();
  qc.clear();
});

test("R-02: pending file processing registers the interaction blocker", async () => {
  let resolveProcess;
  processFileImpl = () => new Promise((r) => (resolveProcess = () => r({ id: "file-1", name: "photo.png", type: "other" })));
  const qc = newClient();
  let blockerValue = null;
  function Probe() {
    const { isBlocked } = useInteractionBlocker();
    blockerValue = isBlocked;
    return null;
  }
  const { container } = render(
    h(
      QueryClientProvider,
      { client: qc },
      h(InteractionBlockerProvider, null, h(Probe), h(ThingDetailContent, { initialThing: makeThing("thing-a", "Thing A"), variant: "court" })),
    ),
  );
  assert.equal(blockerValue, false, "not blocked before any file is selected");

  const input = getCommentFileInput(container);
  await act(async () => {
    fireEvent.change(input, { target: { files: [makeFile("photo.png")] } });
  });
  assert.equal(blockerValue, true, "a file still processing must block Morning Brief's auto-open");

  await act(async () => {
    resolveProcess();
    await new Promise((r) => setTimeout(r, 10));
  });
  assert.equal(blockerValue, true, "the attachment itself is now unsent, so the blocker stays engaged");

  cleanup();
  qc.clear();
});

// Follow-up review of R-02: the direct-draft-write branch (unmounted, or
// switched to a different Thing) wrote via setDraft() WITHOUT passing the
// epoch captured before processing began -- setDraft() defaults to
// stamping a write with whatever epoch is CURRENT at write time, not
// "unreadable after a switch" as an earlier version of the surrounding
// comment incorrectly claimed. An account switch during processing could
// make an old identity's file readable under the NEW identity's draft for
// a Thing id that happens to collide across identities.
test("follow-up review of R-02: a file whose processing finishes AFTER an account switch is dropped, not written into the new identity's draft", async () => {
  let resolveProcess;
  processFileImpl = () => new Promise((r) => (resolveProcess = () => r({ id: "file-1", name: "photo.png", type: "other" })));
  const qc = newClient();
  const { container, unmount } = render(h(Harness, { qc, thingId: "thing-a" }));

  const input = getCommentFileInput(container);
  await act(async () => {
    fireEvent.change(input, { target: { files: [makeFile("photo.png")] } });
  });

  // Unmount (so the write takes the direct-draft-write branch, same as
  // the unmount test above) AND advance the identity epoch mid-processing
  // -- simulating an account switch while this file was still uploading.
  unmount();
  advanceIdentityEpoch(qc, { kind: "live", profileId: "a-different-profile" });

  await act(async () => {
    resolveProcess();
    await new Promise((r) => setTimeout(r, 10));
  });

  const draft = getDraft(qc, "thing-comment", "thing-a");
  assert.ok(
    !draft?.attachments?.length,
    "a file that finishes processing after the identity has switched must not be persisted under the new identity",
  );

  cleanup();
  qc.clear();
});

// T02: null -> Thing A -> Thing B -> null transitions. The due-date edit
// input (and, by the same fix, the selected-file-in-viewer id) had no
// per-Thing reset at all -- switching Thing on this same component
// instance (e.g. via CourtDetailModal) left Thing A's typed, UNSAVED
// due-date value visible in Thing B's own "Edit Due Date" input. The
// "More actions"/Edit Due Date section lives in the DEFAULT variant (not
// "court", which is where the file-input tests above render), so this
// uses its own default-variant harness.
function DefaultHarness({ qc, thingId }) {
  return h(
    QueryClientProvider,
    { client: qc },
    h(InteractionBlockerProvider, null, h(ThingDetailContent, { initialThing: makeThing(thingId, `Thing ${thingId}`) })),
  );
}

test("T02: an unsaved due-date edit for Thing A does not leak into Thing B's own Edit Due Date input", async () => {
  const qc = newClient();
  const { container, rerender } = render(h(DefaultHarness, { qc, thingId: "thing-a" }));

  const moreButton = container.querySelector('[aria-label="Show more Thing actions"]');
  assert.ok(moreButton, "the More actions button must be present for an owner on a non-terminal Thing");
  await act(async () => {
    fireEvent.click(moreButton);
  });

  const dueInput = container.querySelector('input[type="datetime-local"]');
  assert.ok(dueInput, "the Edit Due Date input must be visible once More actions is open");
  await act(async () => {
    fireEvent.change(dueInput, { target: { value: "2026-12-31T10:00" } });
  });
  assert.equal(dueInput.value, "2026-12-31T10:00");

  await act(async () => {
    rerender(h(DefaultHarness, { qc, thingId: "thing-b" }));
  });

  const moreButtonB = container.querySelector('[aria-label="Show more Thing actions"]');
  await act(async () => {
    fireEvent.click(moreButtonB);
  });
  const dueInputB = container.querySelector('input[type="datetime-local"]');
  assert.equal(dueInputB.value, "", "Thing A's unsaved due-date edit must not appear in Thing B's own input");

  cleanup();
  qc.clear();
});
