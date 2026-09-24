import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, useEffect } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * R-03/R-06/R-07 (independent review of G-06): the previous
 * use-bucket-note-editor.ts had three defects only visible against a REAL
 * useMutation, not the earlier test file's fake notesApi (which flips
 * `isPending` synchronously inside `mutateAsync`, masking all three):
 *
 *  - R-03: `saveNote()`'s `done()` callback only checked the editor's
 *    session generation, not whether the user had typed further edits to
 *    the SAME note while the save was in flight. A slow save that resolves
 *    after newer edits would close the editor and discard those edits.
 *  - R-06: the "synchronous" pending guard read `create.isPending` /
 *    `update.isPending`, which only updates on React's next render -- two
 *    `saveNote()` calls issued before that render both start a mutation.
 *  - R-07: closing after clearing a saved note's text back to blank
 *    skipped the confirmation, because the old condition required BOTH
 *    dirty AND non-blank fields.
 *
 * This test uses the REAL useBucketNoteEditor + REAL useBucketNotes (a
 * real useMutation/useQuery), mocking only supabase/useSession at their
 * own boundary -- not `mutateAsync` itself.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let confirmResult = true;
globalThis.window.confirm = () => confirmResult;

let updateImpl = async () => ({ data: null, error: null });
let createImpl = async () => ({ data: { id: "server-id-1" }, error: null });

mock.module("@/hooks/useSession", {
  namedExports: { useSession: () => ({ user: { id: "profile-1" } }) },
});
mock.module("@/integrations/supabase/client", {
  namedExports: {
    supabase: {
      from: (table) => {
        assert.equal(table, "bucket_notes");
        const node = {
          _op: null,
          select: () => node,
          eq: () => node,
          is: () => node,
          order: async () => ({ data: [], error: null }),
          single: async () => (node._op === "insert" ? createImpl() : { data: null, error: null }),
          insert: () => {
            node._op = "insert";
            return node;
          },
          update: () => {
            node._op = "update";
            return { ...node, eq: async () => updateImpl() };
          },
        };
        return node;
      },
    },
  },
});

const { useBucketNoteEditor } = await import("@/features/buckets/use-bucket-note-editor");
const { useBucketNotes } = await import("@/features/buckets/use-bucket-notes");

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
}

function Probe({ onValue }) {
  const notesApi = useBucketNotes("bucket-1");
  const editor = useBucketNoteEditor("bucket-1", notesApi);
  useEffect(() => {
    onValue(editor);
  });
  return null;
}

function renderProbe(qc, onValue) {
  return render(h(QueryClientProvider, { client: qc }, h(Probe, { onValue })));
}

test("R-03: a save that resolves after further edits to the same note keeps the editor open with the newer text", async () => {
  let resolveUpdate;
  updateImpl = () => new Promise((r) => (resolveUpdate = () => r({ data: null, error: null })));
  const qc = newClient();
  let latest = null;
  await act(async () => {
    renderProbe(qc, (v) => (latest = v));
  });

  await act(async () => {
    latest.openNoteEditor({ id: "note-1", title: "original title", body: "original body" });
  });
  await act(async () => {
    latest.setNoteTitle("version A");
  });
  await act(async () => {
    latest.saveNote(); // starts the update, gated on resolveUpdate
  });
  assert.equal(latest.noteOpen, true, "still open while the save is pending");

  // Type version B BEFORE the in-flight save resolves.
  await act(async () => {
    latest.setNoteTitle("version B");
  });

  await act(async () => {
    resolveUpdate();
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(latest.noteOpen, true, "a stale save acknowledgment must not close the editor over newer edits");
  assert.equal(latest.noteTitle, "version B", "the newer, unsaved text must survive");

  cleanup();
  qc.clear();
});

test("R-03: a save with no further edits closes the editor and clears the draft normally", async () => {
  let resolveUpdate;
  updateImpl = () => new Promise((r) => (resolveUpdate = () => r({ data: null, error: null })));
  const qc = newClient();
  let latest = null;
  await act(async () => {
    renderProbe(qc, (v) => (latest = v));
  });

  await act(async () => {
    latest.openNoteEditor({ id: "note-1", title: "original title", body: "original body" });
  });
  await act(async () => {
    latest.setNoteTitle("version A");
  });
  await act(async () => {
    latest.saveNote();
  });

  await act(async () => {
    resolveUpdate();
    await new Promise((r) => setTimeout(r, 10));
  });

  assert.equal(latest.noteOpen, false, "no newer edits -- the normal close/clear path still applies");

  cleanup();
  qc.clear();
});

test("R-06: two Save calls issued before a React re-render start only one real mutation", async () => {
  let resolveUpdate;
  let updateCallCount = 0;
  updateImpl = () => {
    updateCallCount += 1;
    return new Promise((r) => (resolveUpdate = () => r({ data: null, error: null })));
  };
  const qc = newClient();
  let latest = null;
  await act(async () => {
    renderProbe(qc, (v) => (latest = v));
  });

  await act(async () => {
    latest.openNoteEditor({ id: "note-1", title: "original title", body: "original body" });
  });
  await act(async () => {
    latest.setNoteTitle("version A");
  });

  await act(async () => {
    latest.saveNote(); // first click
    latest.saveNote(); // second click, synchronously, before any re-render
  });

  assert.equal(updateCallCount, 1, "exactly one real mutation despite two synchronous Save calls");

  await act(async () => {
    resolveUpdate();
    await new Promise((r) => setTimeout(r, 10));
  });

  cleanup();
  qc.clear();
});

test("R-06: after a save resolves, Save works again for a later edit", async () => {
  let resolveUpdate;
  let updateCallCount = 0;
  updateImpl = () => {
    updateCallCount += 1;
    return new Promise((r) => (resolveUpdate = () => r({ data: null, error: null })));
  };
  const qc = newClient();
  let latest = null;
  await act(async () => {
    renderProbe(qc, (v) => (latest = v));
  });

  await act(async () => {
    latest.openNoteEditor({ id: "note-1", title: "original title", body: "original body" });
  });
  await act(async () => {
    latest.setNoteTitle("version A");
  });
  await act(async () => {
    latest.saveNote();
  });
  await act(async () => {
    resolveUpdate();
    await new Promise((r) => setTimeout(r, 10));
  });
  assert.equal(updateCallCount, 1);

  await act(async () => {
    latest.openNoteEditor({ id: "note-1", title: "version A", body: "original body" });
  });
  await act(async () => {
    latest.setNoteTitle("version C");
  });
  await act(async () => {
    latest.saveNote();
  });
  assert.equal(updateCallCount, 2, "the guard must release after settling, allowing a later save");

  await act(async () => {
    resolveUpdate();
    await new Promise((r) => setTimeout(r, 10));
  });

  cleanup();
  qc.clear();
});

test("R-07: clearing a saved note's text back to blank still requires discard confirmation", async () => {
  const qc = newClient();
  let latest = null;
  await act(async () => {
    renderProbe(qc, (v) => (latest = v));
  });

  await act(async () => {
    latest.openNoteEditor({ id: "note-1", title: "had text", body: "had body" });
  });
  await act(async () => {
    latest.setNoteTitle("");
    latest.setNoteBody("");
  });

  confirmResult = false;
  await act(async () => {
    latest.requestCloseNoteEditor();
  });
  assert.equal(latest.noteOpen, true, "declining the confirm must keep the editor open even though fields are blank");

  confirmResult = true;
  await act(async () => {
    latest.requestCloseNoteEditor();
  });
  assert.equal(latest.noteOpen, false, "confirming discards and closes");

  cleanup();
  qc.clear();
});

test("R-07: Save with all fields blank on an existing note shows validation and keeps the editor open", async () => {
  const qc = newClient();
  let latest = null;
  await act(async () => {
    renderProbe(qc, (v) => (latest = v));
  });

  await act(async () => {
    latest.openNoteEditor({ id: "note-1", title: "had text", body: "had body" });
  });
  await act(async () => {
    latest.setNoteTitle("");
    latest.setNoteBody("");
  });
  await act(async () => {
    latest.saveNote();
  });

  assert.equal(latest.noteOpen, true, "a blank save on an existing note must not silently discard it");

  cleanup();
  qc.clear();
});

test("R-07: closing a never-touched new note still needs no confirmation", async () => {
  const qc = newClient();
  let latest = null;
  await act(async () => {
    renderProbe(qc, (v) => (latest = v));
  });

  await act(async () => {
    latest.openNoteEditor();
  });
  confirmResult = false; // if consulted, closing would incorrectly stay open
  await act(async () => {
    latest.requestCloseNoteEditor();
  });
  assert.equal(latest.noteOpen, false);

  cleanup();
  qc.clear();
});
