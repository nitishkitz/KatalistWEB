import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { domainErrorMessage } from "@/lib/domain-error";
import { getDraft, setDraft, clearDraft } from "@/features/drafts/session-drafts";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { useBlockWhile } from "@/components/katalist/use-interaction-blocker";
import type { useBucketNotes } from "./use-bucket-notes";

/**
 * G-06: the Apple-Notes-style editor dialog's own session/draft
 * ownership, extracted out of the Bucket-detail route so it's directly
 * testable without a router context.
 *
 * Fixes real defects the previous inline version had:
 *  - Save had no pending guard at all -- a fast double-click/double-Enter
 *    fired two create/update mutations for the same note. Guarded with a
 *    ref flipped synchronously before the mutation starts (React's
 *    isPending only updates on the next render, which a second
 *    synchronous call can beat).
 *  - Cancel/Escape/backdrop discarded unsaved text with no confirmation,
 *    based on dirtiness alone -- clearing a saved note's text back to
 *    blank is still a discard of the original content and must confirm.
 *  - A blank Save (all fields cleared) on an existing note is a
 *    validation error, not a silent discard; only a never-touched new
 *    note may close without a prompt.
 *  - Cancel doesn't wait for a pending save. If the user cancelled a
 *    pending save and opened a DIFFERENT note before it resolved, the old
 *    save's own success callback would close/clear whatever note the
 *    user had since opened -- guarded here with a generation counter,
 *    bumped on every open/confirmed-close, checked before an async
 *    save/delete's continuation is allowed to touch shared state.
 *  - A save that resolves AFTER the user has typed further edits to the
 *    SAME note must not close the editor or discard those newer edits --
 *    guarded with a separate edit-revision counter, bumped on every
 *    keystroke and captured alongside the session at Save time.
 */
export function useBucketNoteEditor(bucketId: string, notesApi: ReturnType<typeof useBucketNotes>) {
  const qc = useQueryClient();
  const [noteOpen, setNoteOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteTitle, setNoteTitleState] = useState("");
  const [noteBody, setNoteBodyState] = useState("");
  const [noteOriginal, setNoteOriginal] = useState<{ title: string; body: string }>({ title: "", body: "" });
  const noteSessionRef = useRef(0);
  const noteEditRevisionRef = useRef(0);
  const noteIsSavingRef = useRef(false);

  const setNoteTitle = (value: string) => {
    noteEditRevisionRef.current += 1;
    setNoteTitleState(value);
  };
  const setNoteBody = (value: string) => {
    noteEditRevisionRef.current += 1;
    setNoteBodyState(value);
  };

  const noteDraftKey = (id: string | null) => id ?? `new:${bucketId}`;

  const openNoteEditor = (note?: { id: string; title: string; body: string }) => {
    noteSessionRef.current += 1;
    noteEditRevisionRef.current = 0;
    const key = noteDraftKey(note?.id ?? null);
    const draft = getDraft<{ title: string }>(qc, "bucket-note", key);
    const original = { title: note?.title ?? "", body: note?.body ?? "" };
    setEditingNoteId(note?.id ?? null);
    setNoteOriginal(original);
    setNoteTitleState(draft?.value?.title ?? original.title);
    setNoteBodyState((draft?.attachments?.[0] as string | undefined) ?? original.body);
    setNoteOpen(true);
  };

  // Write-through so a note's unsaved text survives closing and
  // reopening the SAME note (or the "new note" slot) -- explicit Cancel/
  // successful save/delete are the only paths that clear it.
  useEffect(() => {
    if (!noteOpen) return;
    const key = noteDraftKey(editingNoteId);
    if (!noteTitle.trim() && !noteBody.trim()) {
      clearDraft(qc, "bucket-note", key);
      return;
    }
    // Draft<T>'s shape is a generic (value/attachments) container built
    // for composer text+files; a note has two text fields, so `value`
    // carries the title and `attachments[0]` carries the body -- reusing
    // the same store rather than inventing a second one for this one
    // composer kind.
    setDraft(qc, "bucket-note", key, { value: { title: noteTitle }, attachments: [noteBody] });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- noteDraftKey is a pure function of bucketId, already a dep
  }, [qc, noteOpen, editingNoteId, noteTitle, noteBody, bucketId]);

  const noteIsDirty = noteTitle !== noteOriginal.title || noteBody !== noteOriginal.body;

  // T03: a dirty (unsaved) note edit is just as much an in-progress
  // composer action as ThingDetailContent's own comment draft or Magic
  // Box's capture text -- register the same interaction blocker so
  // nothing (Morning Brief's auto-open, etc.) can silently interrupt it.
  useBlockWhile(noteOpen && noteIsDirty, "bucket-note-draft");

  /** Routes every non-Save close (Cancel, Escape, backdrop) through one
   *  place so a genuinely dirty edit -- including clearing a saved
   *  note's text back to blank -- is never silently discarded. */
  const requestCloseNoteEditor = () => {
    if (noteIsDirty) {
      if (!window.confirm("Discard this note? Your unsaved changes will be lost.")) return;
    }
    noteSessionRef.current += 1;
    clearDraft(qc, "bucket-note", noteDraftKey(editingNoteId));
    setNoteOpen(false);
  };

  const saveNote = () => {
    // A ref flipped synchronously before the mutation starts -- isPending
    // only updates on the next render, which a second synchronous call
    // (fast double click/double-Enter) can beat.
    if (noteIsSavingRef.current) return;
    const title = noteTitle.trim();
    const body = noteBody.trim();
    if (!title && !body) {
      if (editingNoteId) {
        // Clearing a saved note's fields is a validation error, not a
        // silent discard -- keep the editor open so the user can either
        // restore text or explicitly Cancel.
        toast.error("Add a title or body before saving, or cancel to discard.");
        return;
      }
      requestCloseNoteEditor();
      return;
    }
    const savedKey = noteDraftKey(editingNoteId);
    const savedGeneration = noteSessionRef.current;
    const savedRevision = noteEditRevisionRef.current;
    // T02: a save/delete's continuation must not touch shared state (or
    // emit a toast) once a SUCCESSOR IDENTITY has taken over -- session/
    // revision alone only guard against a same-identity note switch, not
    // an account switch, which this component instance may not unmount
    // across.
    const savedEpoch = getIdentityEpoch(qc).epoch;
    noteIsSavingRef.current = true;
    const done = (createdId?: string) => {
      if (!isEpochCurrent(qc, savedEpoch)) return;
      // Only close/clear if nothing has superseded this edit session
      // since (Cancel doesn't wait for a pending save, so the user may
      // already be editing a DIFFERENT note by the time this resolves).
      if (noteSessionRef.current !== savedGeneration) return;
      if (noteEditRevisionRef.current !== savedRevision) {
        // The user kept typing while this save was in flight -- the
        // acknowledged value is now the new baseline, but the newer,
        // unsaved draft must survive; do not close or clear it. A
        // first-time create must also adopt the server-assigned id so
        // the next Save updates this note instead of creating another.
        setNoteOriginal({ title, body });
        if (createdId && !editingNoteId) {
          // Follow-up review of R-03: adopting the id alone left the
          // live draft parked under the OLD "new:<bucketId>" slot (savedKey,
          // since editingNoteId is null in this branch) until the
          // write-through effect next ran -- and even then, that effect
          // only ever WRITES the new key, it never clears the old one.
          // Starting a second new note before that happened (or ever,
          // since the old key is otherwise never revisited) would
          // resurrect this note's abandoned draft under the "new note"
          // slot. Migrate the live draft to the new key and clear the
          // old one immediately, synchronously, rather than waiting on
          // the effect to (partially) catch up next render.
          const liveDraft = getDraft<{ title: string }>(qc, "bucket-note", savedKey);
          if (liveDraft) setDraft(qc, "bucket-note", createdId, liveDraft);
          clearDraft(qc, "bucket-note", savedKey);
          setEditingNoteId(createdId);
        }
        toast.success("Saved. Your newer edits are still here.");
        return;
      }
      clearDraft(qc, "bucket-note", savedKey);
      toast.success("Note saved.");
      setNoteOpen(false);
    };
    const fail = (err: unknown) => {
      if (!isEpochCurrent(qc, savedEpoch)) return;
      if (noteSessionRef.current !== savedGeneration) return;
      toast.error(domainErrorMessage(err));
    };
    const settle = () => {
      noteIsSavingRef.current = false;
    };
    if (editingNoteId) {
      void notesApi.update.mutateAsync({ id: editingNoteId, title, body }).then(() => done(), fail).finally(settle);
    } else {
      void notesApi.create.mutateAsync({ title, body }).then(done, fail).finally(settle);
    }
  };

  const deleteNote = () => {
    if (!editingNoteId || notesApi.remove.isPending) return;
    const id = editingNoteId;
    const savedGeneration = noteSessionRef.current;
    const savedEpoch = getIdentityEpoch(qc).epoch;
    void notesApi.remove.mutateAsync(id).then(
      () => {
        // T02: a delete resolving after a successor identity has taken
        // over must not clear that identity's draft/editor state or show
        // this identity's own "deleted" toast on their screen.
        if (!isEpochCurrent(qc, savedEpoch)) return;
        toast.success("Note deleted.");
        clearDraft(qc, "bucket-note", noteDraftKey(id));
        if (noteSessionRef.current === savedGeneration) setNoteOpen(false);
      },
      (err) => {
        if (!isEpochCurrent(qc, savedEpoch)) return;
        toast.error(domainErrorMessage(err));
      },
    );
  };

  return {
    noteOpen,
    editingNoteId,
    noteTitle,
    setNoteTitle,
    noteBody,
    setNoteBody,
    openNoteEditor,
    requestCloseNoteEditor,
    saveNote,
    deleteNote,
    isSaving: notesApi.create.isPending || notesApi.update.isPending,
    isDeleting: notesApi.remove.isPending,
  };
}
