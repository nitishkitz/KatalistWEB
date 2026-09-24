import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h, useEffect } from "react";
import { act } from "react";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBucketNoteEditor } from "@/features/buckets/use-bucket-note-editor";

/**
 * G-06 (audit): the Bucket note editor's Save had no pending guard (a
 * fast double-click fired two create/update mutations for the same
 * note), Cancel/Escape/backdrop discarded unsaved text with no
 * confirmation, and a save that Cancel had already moved past (Cancel
 * doesn't wait for a pending save) could close/clear whatever note the
 * user had since opened. Renders the real hook (extracted from the
 * Bucket-detail route specifically so it's testable without a router
 * context) against a controllable fake notesApi.
 */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let confirmResult = true;
globalThis.window.confirm = () => confirmResult;

function makeNotesApi() {
  const state = { createGate: null, updateGate: null };
  const calls = { create: [], update: [], remove: [] };
  const api = {
    notes: [],
    isLoading: false,
    error: null,
    refetch: () => {},
    create: {
      isPending: false,
      mutateAsync: async (vars) => {
        calls.create.push(vars);
        api.create.isPending = true;
        if (state.createGate) await state.createGate;
        api.create.isPending = false;
        return "new-note-id";
      },
    },
    update: {
      isPending: false,
      mutateAsync: async (vars) => {
        calls.update.push(vars);
        api.update.isPending = true;
        if (state.updateGate) await state.updateGate;
        api.update.isPending = false;
      },
    },
    remove: {
      isPending: false,
      mutateAsync: async (id) => {
        calls.remove.push(id);
      },
    },
  };
  return { api, state, calls };
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function Probe({ notesApi, onValue }) {
  const editor = useBucketNoteEditor("bucket-1", notesApi);
  useEffect(() => {
    onValue(editor);
  });
  return null;
}

function renderProbe(qc, notesApi, onValue) {
  return render(h(QueryClientProvider, { client: qc }, h(Probe, { notesApi, onValue })));
}

test("G-06: a double-click on Save while the first create is still pending fires only one create", async () => {
  const { api, state, calls } = makeNotesApi();
  let gateResolve;
  state.createGate = new Promise((r) => (gateResolve = r));
  const qc = newClient();
  let latest = null;
  await act(async () => {
    renderProbe(qc, api, (v) => (latest = v));
  });

  await act(async () => {
    latest.openNoteEditor();
  });
  await act(async () => {
    latest.setNoteTitle("Hello");
  });

  await act(async () => {
    latest.saveNote(); // first click -- starts the pending create
  });
  await act(async () => {
    latest.saveNote(); // second click while still pending -- must be a no-op
  });

  assert.equal(calls.create.length, 1, "exactly one create call despite two Save clicks");

  await act(async () => {
    gateResolve();
  });

  cleanup();
  qc.clear();
});

test("G-06: closing with unsaved text requires confirmation, and does not close if declined", async () => {
  const { api } = makeNotesApi();
  const qc = newClient();
  let latest = null;
  await act(async () => {
    renderProbe(qc, api, (v) => (latest = v));
  });

  await act(async () => {
    latest.openNoteEditor();
  });
  await act(async () => {
    latest.setNoteTitle("unsaved work");
  });
  assert.equal(latest.noteOpen, true);

  confirmResult = false;
  await act(async () => {
    latest.requestCloseNoteEditor();
  });
  assert.equal(latest.noteOpen, true, "declining the confirm must keep the editor open");

  confirmResult = true;
  await act(async () => {
    latest.requestCloseNoteEditor();
  });
  assert.equal(latest.noteOpen, false, "confirming discards and closes");

  cleanup();
  qc.clear();
});

test("G-06: closing with no unsaved text (nothing typed) needs no confirmation", async () => {
  const { api } = makeNotesApi();
  const qc = newClient();
  let latest = null;
  await act(async () => {
    renderProbe(qc, api, (v) => (latest = v));
  });

  await act(async () => {
    latest.openNoteEditor();
  });
  confirmResult = false; // if this were consulted, closing would incorrectly stay open
  await act(async () => {
    latest.requestCloseNoteEditor();
  });
  assert.equal(latest.noteOpen, false);

  cleanup();
  qc.clear();
});

test("G-06: an unsaved draft survives the component unmounting and remounting (e.g. navigating away and back) without an explicit discard", async () => {
  // Distinct from Cancel/Escape/backdrop -- those go through
  // requestCloseNoteEditor(), which is an explicit, user-confirmed
  // discard and correctly clears the draft. This models the component
  // itself unmounting (a real remount, e.g. navigating away and back)
  // while the dialog was open with unsaved text -- session-drafts.ts's
  // whole purpose is surviving exactly that, in-memory, for the same
  // identity/session.
  const { api } = makeNotesApi();
  const qc = newClient();
  let latest = null;
  await act(async () => {
    renderProbe(qc, api, (v) => (latest = v));
  });

  await act(async () => {
    latest.openNoteEditor();
  });
  await act(async () => {
    latest.setNoteTitle("draft title");
    latest.setNoteBody("draft body");
  });

  cleanup(); // unmount without ever calling requestCloseNoteEditor

  let latest2 = null;
  await act(async () => {
    renderProbe(qc, api, (v) => (latest2 = v));
  });
  await act(async () => {
    latest2.openNoteEditor();
  });
  assert.equal(latest2.noteTitle, "draft title", "the draft survives an unmount/remount, not just a confirmed Cancel");
  assert.equal(latest2.noteBody, "draft body");

  cleanup();
  qc.clear();
});

test("G-06: Cancel does not wait for a pending save -- an old save resolving afterward must not close a newer, different note's editor", async () => {
  const { api, state, calls } = makeNotesApi();
  let gateResolve;
  state.createGate = new Promise((r) => (gateResolve = r));
  const qc = newClient();
  let latest = null;
  await act(async () => {
    renderProbe(qc, api, (v) => (latest = v));
  });

  // Open the "new note" slot, type, and Save (create pending, gated).
  await act(async () => {
    latest.openNoteEditor();
  });
  await act(async () => {
    latest.setNoteTitle("first note");
  });
  await act(async () => {
    latest.saveNote();
  });
  assert.equal(calls.create.length, 1);

  // Cancel WITHOUT waiting for that save (Cancel/Escape/backdrop never
  // waits for a pending mutation).
  confirmResult = true;
  await act(async () => {
    latest.requestCloseNoteEditor();
  });
  assert.equal(latest.noteOpen, false);

  // Open a genuinely different, already-existing note.
  await act(async () => {
    latest.openNoteEditor({ id: "note-2", title: "second note", body: "already saved" });
  });
  assert.equal(latest.noteOpen, true);
  assert.equal(latest.editingNoteId, "note-2");

  // Now the FIRST (stale) create resolves.
  await act(async () => {
    gateResolve();
  });

  assert.equal(latest.noteOpen, true, "the stale save's success must not close the second note's editor");
  assert.equal(latest.editingNoteId, "note-2", "still editing the second note, untouched by the stale save");
  assert.equal(latest.noteTitle, "second note", "second note's own fields, not clobbered");

  cleanup();
  qc.clear();
});
