import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { domainErrorMessage } from "@/lib/domain-error";
import { getDraft, setDraft, clearDraft } from "@/features/drafts/session-drafts";
import type { useBucketNotes } from "./use-bucket-notes";

/**
 * G-06: the Apple-Notes-style editor dialog's own session/draft
 * ownership, extracted out of the Bucket-detail route so it's directly
 * testable without a router context.
 *
 * Fixes three real defects the previous inline version had:
 *  - Save had no pending guard at all -- a fast double-click/double-Enter
 *    fired two create/update mutations for the same note.
 *  - Cancel/Escape/backdrop discarded unsaved text with no confirmation.
 *  - Cancel doesn't wait for a pending save. If the user cancelled a
 *    pending save and opened a DIFFERENT note before it resolved, the old
 *    save's own success callback would close/clear whatever note the
 *    user had since opened -- guarded here with a generation counter,
 *    bumped on every open/confirmed-close, checked before an async
 *    save/delete's continuation is allowed to touch shared state.
 */
export function useBucketNoteEditor(bucketId: string, notesApi: ReturnType<typeof useBucketNotes>) {
  const qc = useQueryClient();
  const [noteOpen, setNoteOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteOriginal, setNoteOriginal] = useState<{ title: string; body: string }>({ title: "", body: "" });
  const noteSessionRef = useRef(0);

  const noteDraftKey = (id: string | null) => id ?? `new:${bucketId}`;

  const openNoteEditor = (note?: { id: string; title: string; body: string }) => {
    noteSessionRef.current += 1;
    const key = noteDraftKey(note?.id ?? null);
    const draft = getDraft<{ title: string }>(qc, "bucket-note", key);
    const original = { title: note?.title ?? "", body: note?.body ?? "" };
    setEditingNoteId(note?.id ?? null);
    setNoteOriginal(original);
    setNoteTitle(draft?.value?.title ?? original.title);
    setNoteBody((draft?.attachments?.[0] as string | undefined) ?? original.body);
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

  /** Routes every non-Save close (Cancel, Escape, backdrop) through one
   *  place so a genuinely dirty edit is never silently discarded. */
  const requestCloseNoteEditor = () => {
    if (noteIsDirty && (noteTitle.trim() || noteBody.trim())) {
      if (!window.confirm("Discard this note? Your unsaved changes will be lost.")) return;
    }
    noteSessionRef.current += 1;
    clearDraft(qc, "bucket-note", noteDraftKey(editingNoteId));
    setNoteOpen(false);
  };

  const saveNote = () => {
    // A synchronous pending guard -- without it, a fast double click/
    // double-Enter fires two create/update mutations for the same note.
    if (notesApi.create.isPending || notesApi.update.isPending) return;
    const title = noteTitle.trim();
    const body = noteBody.trim();
    if (!title && !body) {
      requestCloseNoteEditor();
      return;
    }
    const savedKey = noteDraftKey(editingNoteId);
    const savedGeneration = noteSessionRef.current;
    const done = () => {
      // Only close/clear if nothing has superseded this edit session
      // since (Cancel doesn't wait for a pending save, so the user may
      // already be editing a DIFFERENT note by the time this resolves).
      if (noteSessionRef.current !== savedGeneration) return;
      clearDraft(qc, "bucket-note", savedKey);
      setNoteOpen(false);
    };
    const fail = (err: unknown) => toast.error(domainErrorMessage(err));
    if (editingNoteId) {
      void notesApi.update.mutateAsync({ id: editingNoteId, title, body }).then(done, fail);
    } else {
      void notesApi.create.mutateAsync({ title, body }).then(done, fail);
    }
  };

  const deleteNote = () => {
    if (!editingNoteId || notesApi.remove.isPending) return;
    const id = editingNoteId;
    const savedGeneration = noteSessionRef.current;
    void notesApi.remove.mutateAsync(id).then(
      () => {
        toast.success("Note deleted.");
        clearDraft(qc, "bucket-note", noteDraftKey(id));
        if (noteSessionRef.current === savedGeneration) setNoteOpen(false);
      },
      (err) => toast.error(domainErrorMessage(err)),
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
