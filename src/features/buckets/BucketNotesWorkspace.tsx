import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useQueryClient } from "@tanstack/react-query";
import { Check, File, FileText, ImagePlus, Link2, LoaderCircle, Paperclip, Plus, Search, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useAccessibleLists, useAccessibleThings } from "./use-bucket-items";
import { useBucketNoteFiles, type NoteFile } from "./use-bucket-note-files";
import { useBucketNoteSummaries } from "./use-bucket-note-summaries";
import { BucketNoteCard, BucketNoteCover, BucketNoteMeta } from "./BucketNoteCard";
import type { BucketNote, useBucketNotes } from "./use-bucket-notes";
import type { Thing } from "@/domain/thing";
import { rpcCreateThing } from "@/features/things/rpc";
import { cn } from "@/lib/utils";
import "./bucket-notes-workspace.css";

type NotesApi = ReturnType<typeof useBucketNotes>;
type NoteLink = { id: string; target_kind: string; target_id: string; relation: string };
const missingLinksMessage = "Links aren’t ready yet. The private Notes data needs to be set up.";
function isMissingLinksTable(error: { code?: string; message?: string }) {
  return error.code === "PGRST205" || /bucket_note_links.*schema cache|could not find the table.*bucket_note_links/i.test(error.message ?? "");
}

function noteDocument(note: BucketNote): JSONContent {
  if (note.contentJson && typeof note.contentJson === "object" && "type" in note.contentJson) return note.contentJson as JSONContent;
  return { type: "doc", content: [{ type: "paragraph", content: note.body ? [{ type: "text", text: note.body }] : [] }] };
}

function formatSize(size: number) {
  return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function NoteMedia({ file, onRemove }: { file: NoteFile; onRemove: () => void }) {
  const image = file.mime.startsWith("image/");
  const video = file.mime.startsWith("video/");
  return (
    <div className="group relative overflow-hidden rounded-xl border border-[#e6e4f0] bg-white">
      {file.state === "ready" && file.url && image ? <img src={file.url} alt={file.name} className="max-h-60 w-full object-contain bg-[#faf9ff]" /> : null}
      {file.state === "ready" && file.url && video ? <video src={file.url} controls preload="metadata" className="max-h-60 w-full bg-[#171329]" /> : null}
      <div className="flex min-w-0 items-center gap-2 px-3 py-2 text-xs">
        {image ? <ImagePlus className="h-4 w-4 text-[#8f64d6]" /> : <File className="h-4 w-4 text-[#8f64d6]" />}
        <span className="min-w-0 flex-1 truncate font-medium text-[#202044]">{file.name}</span>
        <span className="text-[#8990a7]">{file.state === "uploading" ? `${file.progress}%` : formatSize(file.size)}</span>
        {file.url ? <a href={file.url} target="_blank" rel="noreferrer" className="font-semibold text-[#7c33fd] hover:underline">Open</a> : null}
        <button type="button" onClick={onRemove} aria-label={`Remove ${file.name}`} className="rounded-md p-1 text-[#8990a7] hover:bg-[#f4efff] hover:text-[#7c33fd]"><X className="h-3.5 w-3.5" /></button>
      </div>
      {file.state === "uploading" ? <div className="h-0.5 bg-[#eee7fb]"><div className="h-full bg-[#975ee2] transition-[width] duration-150" style={{ width: `${file.progress}%` }} /></div> : null}
      {file.state === "error" ? <p role="alert" className="px-3 pb-2 text-xs text-red-600">{file.error || "Upload failed"}</p> : null}
    </div>
  );
}

function NoteEditor({ note, notesApi, addThingToBucket, context, myActorId, onOpenThing }: {
  note: BucketNote;
  notesApi: NotesApi;
  addThingToBucket: (thingId: string) => Promise<unknown>;
  context: "work" | "home";
  myActorId: string;
  onOpenThing: (thing: Thing) => void;
}) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const things = useAccessibleThings();
  const lists = useAccessibleLists();
  const media = useBucketNoteFiles(note.id, user?.id);
  const [title, setTitle] = useState(note.title);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const [editVersion, setEditVersion] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [links, setLinks] = useState<NoteLink[]>([]);
  const [linkStatus, setLinkStatus] = useState<"checking" | "ready" | "unavailable">("checking");
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [tossing, setTossing] = useState(false);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const revision = useRef(note.revision);
  const pending = useRef(false);
  const changed = useRef(false);
  const currentTitle = useRef(note.title);
  const currentDoc = useRef<JSONContent>(noteDocument(note));
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), Placeholder.configure({ placeholder: "Start writing…" })],
    content: noteDocument(note),
    immediatelyRender: false,
    editorProps: { attributes: { class: "bucket-note-prose focus:outline-none" } },
    onUpdate: ({ editor: next }) => {
      currentDoc.current = next.getJSON();
      changed.current = true;
      setSaveState("dirty");
      setEditVersion((version) => version + 1);
    },
    onSelectionUpdate: ({ editor: next }) => setSelectedText(next.state.doc.textBetween(next.state.selection.from, next.state.selection.to, " ").trim()),
  });

  const save = useCallback(async () => {
    if (!editor || pending.current || !changed.current) return;
    pending.current = true;
    changed.current = false;
    setSaveState("saving");
    const snapshot = currentDoc.current;
    const snapshotTitle = currentTitle.current;
    const snapshotText = editor.getText();
    let succeeded = false;
    try {
      revision.current = await notesApi.saveRich({ id: note.id, title: snapshotTitle, plainText: snapshotText, contentJson: snapshot as import("@/integrations/supabase/types").Json, revision: revision.current });
      succeeded = true;
      setSaveState(changed.current ? "dirty" : "saved");
    } catch (error) {
      changed.current = true;
      setSaveState("error");
      if (error instanceof Error && /another device/.test(error.message)) toast.error(error.message);
    } finally {
      pending.current = false;
      if (changed.current && succeeded) setSaveState("dirty");
    }
  }, [editor, note.id, notesApi]);
  saveRef.current = save;
  useEffect(() => {
    if (saveState !== "dirty") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void saveRef.current(); }, 800);
    return () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  }, [saveState, title, editVersion]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (changed.current && !pending.current) void saveRef.current();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void supabase.from("bucket_note_links").select("id,target_kind,target_id,relation").eq("note_id", note.id).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setLinkStatus("unavailable"); return; }
      setLinkStatus("ready");
      setLinks((data ?? []) as NoteLink[]);
    });
    return () => { cancelled = true; };
  }, [note.id]);

  const attach = async (files: FileList | File[]) => {
    setAttachmentOpen(false);
    for (const file of Array.from(files)) {
      try { await media.upload(file); }
      catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed";
        if (message.includes("Note uploads aren’t ready")) break;
        toast.error(message);
      }
    }
  };

  const addLink = async (kind: "thing" | "list", id: string): Promise<boolean> => {
    const { data, error } = await supabase.from("bucket_note_links").upsert({
      note_id: note.id, target_kind: kind, target_id: id, thing_id: kind === "thing" ? id : null,
      list_id: kind === "list" ? id : null, relation: "reference",
    }, { onConflict: "note_id,target_kind,target_id,relation" }).select("id,target_kind,target_id,relation").single();
    if (error) {
      if (isMissingLinksTable(error)) setLinkStatus("unavailable");
      setLinkNotice(isMissingLinksTable(error) ? missingLinksMessage : "Couldn’t link this item. Try again.");
      setLinkOpen(false);
      return false;
    }
    setLinkNotice(null);
    setLinks((old) => old.some((link) => link.id === data.id) ? old : [...old, data]);
    void queryClient.invalidateQueries({ queryKey: ["bucket-note-summaries", user?.id] });
    setLinkOpen(false);
    setLinkSearch("");
    return true;
  };

  const removeLink = async (link: NoteLink) => {
    const { data, error } = await supabase.from("bucket_note_links")
      .delete().eq("id", link.id).eq("note_id", note.id).select("id").single();
    if (error || !data) {
      toast.error("Couldn’t remove this link. Try again.");
      return;
    }
    setLinks((old) => old.filter((item) => item.id !== link.id));
    void queryClient.invalidateQueries({ queryKey: ["bucket-note-summaries", user?.id] });
  };

  const tossSelected = async () => {
    if (!selectedText || tossing) return;
    setTossing(true);
    try {
      const created = await rpcCreateThing({ title: selectedText.slice(0, 240), context, assigneeActorId: myActorId, ownerImportance: "next" });
      if (!created?.id) throw new Error("Thing was not created.");
      await addThingToBucket(created.id);
      const linked = await addLink("thing", created.id);
      if (linked) toast.success("Thing created and linked to this note.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Couldn’t create Thing."); }
    finally { setTossing(false); }
  };

  const options = [
    ...things.filter((thing) => thing.title.toLowerCase().includes(linkSearch.toLowerCase())).slice(0, 5).map((thing) => ({ id: thing.id, label: thing.title, kind: "thing" as const })),
    ...lists.filter((list) => list.name.toLowerCase().includes(linkSearch.toLowerCase())).slice(0, 5).map((list) => ({ id: list.id, label: list.name, kind: "list" as const })),
  ];

  return (
    <article className="bucket-note-editor" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); void attach(event.dataTransfer.files); } }}>
      <div className="flex items-center justify-between gap-3 text-[11px] text-[#8990a7]">
        <span>Private to you</span>
        <span role="status" className="inline-flex items-center gap-1">{saveState === "saving" ? <LoaderCircle className="h-3 w-3 animate-spin" /> : saveState === "saved" ? <Check className="h-3 w-3" /> : null}{saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn’t save — retry" : "Unsaved changes"}</span>
      </div>
      <input value={title} onChange={(event) => { currentTitle.current = event.target.value; setTitle(event.target.value); changed.current = true; setSaveState("dirty"); }} placeholder="Untitled note" aria-label="Note title" className="mt-4 w-full bg-transparent text-[25px] font-semibold tracking-tight text-[#121537] outline-none placeholder:text-[#a8aac1]" />
      <div onPasteCapture={(event) => {
        const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
        if (images.length) { event.preventDefault(); void attach(images); }
      }} className="mt-4 min-h-[260px]"><EditorContent editor={editor} /></div>
      {selectedText ? <div className="mb-4 flex items-center gap-2"><button type="button" onClick={() => void tossSelected()} disabled={tossing || linkStatus !== "ready"} className="inline-flex items-center gap-1 rounded-lg border border-[#dac8ff] bg-[#f8f4ff] px-2.5 py-1.5 text-xs font-semibold text-[#703ac4] hover:bg-[#f0e8ff]"><Send className="h-3.5 w-3.5" />{tossing ? "Creating…" : "Toss selection as Thing"}</button><span className="max-w-[240px] truncate text-[11px] text-[#8990a7]">{selectedText}</span></div> : null}
      <div className="relative flex flex-wrap items-center gap-2 border-t border-[#f0eef7] pt-3">
        <button type="button" onClick={() => setAttachmentOpen(!attachmentOpen)} className="bucket-note-tool"><Paperclip className="h-4 w-4" /> Attach</button>
        <button type="button" onClick={() => { if (linkStatus !== "ready") { setLinkNotice(missingLinksMessage); return; } setLinkNotice(null); setLinkOpen(!linkOpen); }} className="bucket-note-tool"><Link2 className="h-4 w-4" /> Link work</button>
        {saveState === "error" ? <button type="button" onClick={() => void save()} className="bucket-note-tool text-red-600">Retry save</button> : null}
        <input ref={fileInput} type="file" multiple className="sr-only" onChange={(event) => { if (event.target.files) void attach(event.target.files); event.target.value = ""; }} />
        {attachmentOpen ? <div className="bucket-note-popover"><button type="button" onClick={() => fileInput.current?.click()} className="w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[#f7f3ff]">Choose files</button><p className="px-3 pb-2 text-[11px] text-[#8990a7]">Or paste and drop directly into this note</p></div> : null}
        {linkOpen ? <div className="bucket-note-popover bucket-note-link-popover"><input autoFocus value={linkSearch} onChange={(event) => setLinkSearch(event.target.value)} placeholder="Find a Thing or List" className="mb-1 w-full rounded-lg border border-[#ebe7f7] px-2.5 py-2 text-xs outline-none focus:border-[#975ee2]" /><div className="bucket-note-option-list">{options.map((option) => <button key={`${option.kind}:${option.id}`} type="button" onClick={() => void addLink(option.kind, option.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-[#f7f3ff]"><span className="rounded bg-[#eee9fb] px-1.5 py-0.5 text-[10px] text-[#7448bc]">{option.kind === "thing" ? "Thing" : "List"}</span><span className="truncate">{option.label}</span></button>)}</div></div> : null}
      </div>
      {linkNotice ? <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{linkNotice}</p> : null}
      {links.length ? <div className="mt-5 space-y-1"><p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#8a8ca7]">Linked work</p>{links.map((link) => {
        const thing = link.target_kind === "thing" ? things.find((item) => item.id === link.target_id) : null;
        const list = link.target_kind === "list" ? lists.find((item) => item.id === link.target_id) : null;
        return <div key={link.id} className="bucket-note-linked-row"><button type="button" onClick={() => { if (thing) onOpenThing(thing); else if (list) window.location.assign(`/lists/${list.id}`); }} className="bucket-note-linked-open"><FileText className="h-4 w-4 shrink-0 text-[#975ee2]" /><span className="min-w-0 flex-1 truncate font-medium">{thing?.title || list?.name || "Unavailable reference"}</span><span className="text-[#9ba0b5]">{link.target_kind}</span></button><button type="button" onClick={() => void removeLink(link)} aria-label={`Remove ${link.target_kind} link: ${thing?.title || list?.name || "Unavailable reference"}`} title="Remove link from note" className="bucket-note-linked-remove"><X className="h-4 w-4" /></button></div>;
      })}</div> : null}
      {media.files.length ? <div className="mt-5"><p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#8a8ca7]">Files · {media.files.length}</p><div className="grid gap-2 sm:grid-cols-2">{media.files.map((file) => <NoteMedia key={file.id} file={file} onRemove={() => void media.remove(file).catch((error) => toast.error(error instanceof Error ? error.message : "Couldn’t remove file"))} />)}</div></div> : null}
      {media.storageError ? <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{media.storageError}</p> : null}
      {media.loading ? <p className="mt-3 text-xs text-[#8990a7]">Loading files…</p> : null}
    </article>
  );
}

export function BucketNotesWorkspace({ context, myActorId, notesApi, onOpenThing, addThingToBucket }: {
  addThingToBucket: (thingId: string) => Promise<unknown>;
  context: "work" | "home";
  myActorId: string;
  notesApi: NotesApi;
  onOpenThing: (thing: Thing) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectNote = (id: string | null) => {
    const apply = () => setSelectedId(id);
    if (typeof document !== "undefined" && "startViewTransition" in document && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.startViewTransition(apply);
    } else apply();
  };
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const notes = useMemo(() => [...notesApi.notes].sort((a, b) => {
    if (Boolean(a.pinnedAt) !== Boolean(b.pinnedAt)) return a.pinnedAt ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  }), [notesApi.notes]);
  const { user } = useSession();
  const summaries = useBucketNoteSummaries(notes.map((note) => note.id), user?.id);
  const matches = notes.filter((note) => `${note.title} ${note.plainText || note.body}`.toLowerCase().includes(query.toLowerCase()));
  const selected = notes.find((note) => note.id === selectedId) ?? null;

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try { const id = await notesApi.create.mutateAsync({ title: "", body: "" }); await notesApi.refetch(); selectNote(id); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Couldn’t create note"); }
    finally { setCreating(false); }
  };

  return (
    <section className="bucket-notes-workspace" aria-label="Bucket notes">
      <div className="bucket-notes-header"><div><h2 className="text-[18px] font-semibold text-[#16183d]">Notes</h2><p className="text-xs text-[#8188a4]">Ideas, files and decisions for this Bucket</p></div><button type="button" onClick={() => void create()} disabled={creating} className="bucket-note-create"><Plus className="h-4 w-4" /> New note</button></div>
      {notesApi.error ? <div role="alert" className="mt-4 rounded-xl border border-red-200 p-4 text-sm text-red-700">Couldn’t load notes. <button type="button" onClick={() => void notesApi.refetch()} className="font-semibold underline">Retry</button></div> : null}
      {!selected ? <div className="bucket-notes-board">
        <button type="button" onClick={() => void create()} className="bucket-note-capture"><Plus className="h-4 w-4 text-[#975ee2]" />Write a note about this Bucket…</button>
        <div className="bucket-note-search"><Search className="h-4 w-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" aria-label="Search notes" /></div>
        {notesApi.isLoading ? <p className="py-10 text-center text-sm text-[#8a90a8]">Loading notes…</p> : matches.length === 0 ? <p className="py-10 text-center text-sm text-[#8a90a8]">{query ? "No matching notes." : "Capture your first note."}</p> : <div className="bucket-note-card-grid">{matches.map((note) => <BucketNoteCard key={note.id} note={note} summary={summaries.data?.[note.id]} onOpen={() => selectNote(note.id)} onPin={() => void notesApi.pin.mutateAsync({ id: note.id, pinned: !note.pinnedAt }).catch((error) => toast.error(String(error)))} />)}</div>}
      </div> : <div className="bucket-note-split"><aside className="bucket-note-sidebar"><div className="flex items-center justify-between px-3 py-3"><button type="button" onClick={() => selectNote(null)} className="text-xs font-semibold text-[#7440c9]">← All notes</button><button type="button" onClick={() => void create()} aria-label="New note" className="rounded-lg p-1.5 text-[#7440c9] hover:bg-[#f5efff]"><Plus className="h-4 w-4" /></button></div><div className="bucket-note-search mx-3 mb-2"><Search className="h-3.5 w-3.5" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" aria-label="Search notes" /></div><div className="max-h-[60vh] overflow-y-auto">{matches.map((note) => <button key={note.id} type="button" onClick={() => selectNote(note.id)} className={cn("bucket-note-sidebar-row", selectedId === note.id && "is-selected")}><span className="bucket-note-sidebar-row-top">{summaries.data?.[note.id]?.cover ? <BucketNoteCover cover={summaries.data[note.id].cover!} compact /> : null}<span className="bucket-note-sidebar-row-copy"><strong>{note.title || "Untitled note"}</strong><span>{note.plainText || note.body || "Start writing…"}</span></span></span><BucketNoteMeta summary={summaries.data?.[note.id]} compact /></button>)}</div></aside><div className="bucket-note-editor-shell" style={{ viewTransitionName: `bucket-note-${selected.id}` }}><NoteEditor key={selected.id} note={selected} notesApi={notesApi} addThingToBucket={addThingToBucket} context={context} myActorId={myActorId} onOpenThing={onOpenThing} /><button type="button" onClick={() => { if (window.confirm("Delete this note?")) void notesApi.remove.mutateAsync(selected.id).then(() => setSelectedId(null), (error) => toast.error(String(error))); }} className="absolute bottom-4 right-5 flex items-center gap-1 text-[11px] text-[#a1a5ba] hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /> Delete note</button></div></div>}
    </section>
  );
}
