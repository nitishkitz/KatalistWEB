import { useEffect, useId, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { closeHistory } from "@tiptap/pm/history";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bold,
  FileText,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Pencil,
  Redo2,
  Sparkles,
  Undo2,
} from "lucide-react";
import type { Thing } from "@/domain/thing";
import { Button } from "@/components/ui/button";
import { clearDraft, getDraft, setDraft } from "@/features/drafts/session-drafts";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { useBlockWhile } from "@/components/katalist/use-interaction-blocker";
import { toSafeHref } from "@/lib/linkify";
import { LinkCard } from "../components/LinkPreviewCards";
import {
  descriptionLinks,
  descriptionText,
  legacyDescriptionDocument,
  sanitizeDescription,
  type DescriptionDocument,
} from "./document";
import { DescriptionReadView } from "./DescriptionReadView";
import { guardDescriptionDraft } from "./draft-guard";
import { improveDescriptionDraft } from "./improve-description-client";
import "./thing-description.css";

type DescriptionDraft = {
  document: DescriptionDocument;
  base: DescriptionDocument;
  revision: number;
  ownerId: string;
};

/** Keyed by Thing and viewer at the call site; drafts belong to the existing identity epoch. */
export function ThingDescription({ thing, canEdit }: { thing: Thing; canEdit: boolean }) {
  const qc = useQueryClient();
  const label = useId();
  const saved = useMemo(
    () =>
      sanitizeDescription(
        thing.descriptionDocument ??
          legacyDescriptionDocument((thing.descriptionRevision ?? 0) > 0 ? "" : thing.description),
      ),
    [thing.descriptionDocument, thing.description, thing.descriptionRevision],
  );
  const recovered = useRef(getDraft<DescriptionDraft>(qc, "thing-description", thing.id)?.value);
  const [editing, setEditing] = useState(Boolean(recovered.current) && canEdit);
  const [draft, setCurrentDraft] = useState<DescriptionDraft>(
    () =>
      recovered.current ?? {
        document: saved,
        base: saved,
        revision: thing.descriptionRevision ?? 0,
        ownerId: thing.owner.id,
      },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [linkInput, setLinkInput] = useState<string | null>(null);
  const [improving, setImproving] = useState(false);
  const [improveError, setImproveError] = useState("");
  const [suggestion, setSuggestion] = useState<{
    document: DescriptionDocument;
    source: string;
    selected: boolean;
  } | null>(null);
  const improveRequest = useRef<AbortController | null>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const epoch = getIdentityEpoch(qc).epoch;
  const dirty = editing && JSON.stringify(draft.document) !== JSON.stringify(draft.base);
  const conflict =
    editing &&
    ((thing.descriptionRevision ?? 0) !== draft.revision || thing.owner.id !== draft.ownerId);
  const initialContent = useRef(draft.document);
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          protocols: ["http", "https"],
          HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow" },
        },
      }),
      Placeholder.configure({ placeholder: "Add a description…" }),
    ],
    [],
  );
  const editorProps = useMemo(
    () => ({
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": label,
        class: "thing-description-prose thing-description-input",
      },
    }),
    [label],
  );
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions,
    content: initialContent.current,
    editable: canEdit && !saving,
    editorProps,
    onUpdate: ({ editor: current }) => {
      try {
        let document: DescriptionDocument = current.getJSON();
        try {
          document = sanitizeDescription(document);
          setError("");
        } catch (cause) {
          setError((cause as Error).message);
        }
        setCurrentDraft((previous) => {
          const next = { ...previous, document };
          if (isEpochCurrent(qc, epoch)) {
            const changed = JSON.stringify(document) !== JSON.stringify(next.base);
            if (changed) setDraft(qc, "thing-description", thing.id, { value: next });
            else clearDraft(qc, "thing-description", thing.id);
            guardDescriptionDraft(qc, thing.id, changed);
          }
          return next;
        });
      } catch (cause) {
        setError((cause as Error).message);
      }
    },
  });
  useEffect(() => {
    editor?.setEditable(canEdit && !saving, false);
  }, [editor, canEdit, saving]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      improveRequest.current?.abort();
    };
  }, []);
  useBlockWhile(dirty || saving, "thing-description-draft");

  const immediateLinks = useMemo(
    () => descriptionLinks(editing ? draft.document : saved),
    [editing, draft.document, saved],
  );
  const [previewLinks, setPreviewLinks] = useState(immediateLinks);
  useEffect(() => {
    // Remove deleted links immediately; request newly typed links once typing settles.
    setPreviewLinks((previous) => previous.filter((url) => immediateLinks.includes(url)));
    const timeout = setTimeout(() => setPreviewLinks(immediateLinks), editing ? 600 : 0);
    return () => clearTimeout(timeout);
  }, [immediateLinks, editing]);

  function stopImproving() {
    improveRequest.current?.abort();
    improveRequest.current = null;
    setImproving(false);
  }
  function clearSuggestion() {
    stopImproving();
    setSuggestion(null);
    setImproveError("");
  }
  async function improve() {
    if (
      !editor ||
      !canEdit ||
      saving ||
      conflict ||
      improveRequest.current ||
      !isEpochCurrent(qc, epoch)
    )
      return;
    const controller = new AbortController();
    improveRequest.current = controller;
    setImproving(true);
    setImproveError("");
    setSuggestion(null);
    try {
      const document = sanitizeDescription(editor.getJSON());
      const source = JSON.stringify(document);
      const { from, to, empty } = editor.state.selection;
      const next = await improveDescriptionDraft(
        {
          thingId: thing.id,
          document,
          ...(!empty ? { selection: { from, to } } : {}),
        },
        controller.signal,
      );
      if (
        !mounted.current ||
        controller.signal.aborted ||
        improveRequest.current !== controller ||
        !isEpochCurrent(qc, epoch)
      )
        return;
      if (JSON.stringify(sanitizeDescription(editor.getJSON())) !== source) {
        setImproveError(
          "Your description changed while Sarvam was working. Improve again to use your latest draft.",
        );
        return;
      }
      if (JSON.stringify(next) === source) {
        setImproveError("No wording changes were suggested. Your draft is unchanged.");
        return;
      }
      setSuggestion({ document: next, source, selected: !empty });
    } catch (cause) {
      if (
        mounted.current &&
        !controller.signal.aborted &&
        improveRequest.current === controller &&
        isEpochCurrent(qc, epoch)
      )
        setImproveError(
          cause instanceof Error && cause.name !== "TimeoutError"
            ? cause.message
            : "Sarvam took too long. Your draft is unchanged; try again.",
        );
    } finally {
      if (improveRequest.current === controller) {
        improveRequest.current = null;
        if (mounted.current) setImproving(false);
      }
    }
  }
  function applySuggestion() {
    if (!suggestion || !editor || !canEdit || saving || conflict || !isEpochCurrent(qc, epoch))
      return;
    if (JSON.stringify(sanitizeDescription(editor.getJSON())) !== suggestion.source) {
      setSuggestion(null);
      setImproveError("Your description changed. Improve again to use your latest draft.");
      return;
    }
    // Keep accepting a suggestion separate from edits on either side of it.
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        closeHistory(tr);
        return true;
      })
      .setContent(suggestion.document)
      .run();
    editor.view.dispatch(closeHistory(editor.state.tr));
    setSuggestion(null);
    setImproveError("");
  }

  function begin() {
    if (!canEdit) return;
    clearSuggestion();
    const next = {
      document: saved,
      base: saved,
      revision: thing.descriptionRevision ?? 0,
      ownerId: thing.owner.id,
    };
    setCurrentDraft(next);
    editor?.commands.setContent(saved);
    setEditing(true);
    setError("");
    requestAnimationFrame(() => editor?.commands.focus("end"));
  }
  function cancel() {
    if (saving) return;
    clearSuggestion();
    clearDraft(qc, "thing-description", thing.id);
    guardDescriptionDraft(qc, thing.id, false);
    setCurrentDraft({
      document: saved,
      base: saved,
      revision: thing.descriptionRevision ?? 0,
      ownerId: thing.owner.id,
    });
    setEditing(false);
    setLinkInput(null);
    setError("");
    actionRef.current?.focus();
  }
  async function save() {
    if (!canEdit || !dirty || saving || conflict || !editor) return;
    clearSuggestion();
    setSaving(true);
    setError("");
    try {
      const document = sanitizeDescription(editor.getJSON());
      const { saveThingDescription } = await import("./save-description");
      if (!isEpochCurrent(qc, epoch)) return;
      const patch = await saveThingDescription(thing.id, document, draft.revision);
      if (!isEpochCurrent(qc, epoch)) return;
      clearDraft(qc, "thing-description", thing.id);
      guardDescriptionDraft(qc, thing.id, false);
      qc.setQueryData<Thing>(["thing", thing.id], (current) => ({
        ...(current ?? thing),
        ...patch,
      }));
      void qc.invalidateQueries({ queryKey: ["court"] });
      void qc.invalidateQueries({ queryKey: ["thing-activity", thing.id] });
      if (mounted.current) {
        setEditing(false);
        setLinkInput(null);
        actionRef.current?.focus();
      }
    } catch (cause) {
      if (mounted.current && isEpochCurrent(qc, epoch))
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not save the description. Please try again.",
        );
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  const activeFormats = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      bulletList: current?.isActive("bulletList") ?? false,
      orderedList: current?.isActive("orderedList") ?? false,
      link: current?.isActive("link") ?? false,
    }),
  });
  const toolbar = [
    {
      label: "Bold",
      icon: Bold,
      active: activeFormats?.bold,
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      icon: Italic,
      active: activeFormats?.italic,
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      label: "Bullet list",
      icon: List,
      active: activeFormats?.bulletList,
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      icon: ListOrdered,
      active: activeFormats?.orderedList,
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Insert link",
      icon: Link2,
      active: activeFormats?.link,
      run: () => setLinkInput(editor?.getAttributes("link").href ?? ""),
    },
    { label: "Undo", icon: Undo2, run: () => editor?.chain().focus().undo().run() },
    { label: "Redo", icon: Redo2, run: () => editor?.chain().focus().redo().run() },
  ];
  if (!editing && !canEdit && !descriptionText(saved)) return null;

  return (
    <section
      className="thing-description rounded-lg border border-[#eef0f6] bg-white p-3 xl:col-span-2"
      aria-labelledby={label}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id={label} className="flex items-center gap-2 text-[13px] font-medium text-[#000533]">
          <FileText className="h-4 w-4 text-[#3a4675]" />
          Description
        </h3>
        {!editing && canEdit ? (
          <button
            ref={actionRef}
            type="button"
            onClick={begin}
            className="inline-flex min-h-8 items-center gap-1 rounded px-1 text-[12px] text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {descriptionText(saved) ? (
              <>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </>
            ) : (
              "+ Add description"
            )}
          </button>
        ) : null}
      </div>
      {editing ? (
        <div
          className="thing-description-editor"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (!dirty) cancel();
              else setError("Your draft is kept. Use Save or Cancel to finish editing.");
            }
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              void save();
            }
          }}
        >
          <div
            role="toolbar"
            aria-label="Description formatting"
            className="mb-2 flex flex-wrap gap-1"
          >
            {toolbar.map((item) => (
              <button
                key={item.label}
                type="button"
                aria-label={item.label}
                aria-pressed={item.active}
                disabled={!canEdit || saving}
                onMouseDown={(event) => event.preventDefault()}
                onClick={item.run}
                className="thing-description-format flex h-9 w-9 items-center justify-center rounded text-[#3a4675] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <item.icon className="h-4 w-4" />
              </button>
            ))}
            <button
              type="button"
              aria-label="Improve with Sarvam"
              disabled={
                !canEdit || saving || conflict || improving || !descriptionText(draft.document)
              }
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void improve()}
              title="Improve selected text, or the whole description. Review before applying."
              className="thing-description-improve ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-md border border-primary/15 bg-primary/[0.04] px-2.5 text-[12px] font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {improving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {improving ? "Improving…" : "Improve"}
            </button>
            {improving ? (
              <button
                type="button"
                onClick={stopImproving}
                className="min-h-9 rounded px-2 text-[12px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Stop
              </button>
            ) : null}
          </div>
          {linkInput !== null ? (
            <form
              className="mb-2 flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const href = /^https?:\/\//i.test(linkInput) ? toSafeHref(linkInput) : null;
                if (!href) {
                  setError("Enter a complete HTTP or HTTPS URL.");
                  return;
                }
                const chain = editor?.chain().focus();
                if (editor?.state.selection.empty && !editor.isActive("link"))
                  chain
                    ?.insertContent({
                      type: "text",
                      text: href,
                      marks: [{ type: "link", attrs: { href } }],
                    })
                    .run();
                else chain?.extendMarkRange("link").setLink({ href }).run();
                setLinkInput(null);
                setError("");
              }}
            >
              <input
                autoFocus
                aria-label="Link URL"
                type="url"
                disabled={!canEdit || saving}
                value={linkInput}
                onChange={(event) => setLinkInput(event.target.value)}
                className="min-w-0 flex-1 rounded border border-input px-2 text-xs"
                placeholder="https://…"
              />
              <Button size="sm" type="submit" disabled={!canEdit || saving}>
                Apply
              </Button>
              <Button
                size="sm"
                type="button"
                variant="ghost"
                disabled={!canEdit || saving}
                onClick={() => {
                  editor?.chain().focus().unsetLink().run();
                  setLinkInput(null);
                }}
              >
                Remove link
              </Button>
            </form>
          ) : null}
          <EditorContent editor={editor} />
          {improving ? (
            <p role="status" className="mt-2 text-[12px] text-muted-foreground">
              Sarvam is improving the wording. You can keep editing.
            </p>
          ) : null}
          {suggestion ? (
            <section
              role="region"
              aria-label="Sarvam suggestion"
              className="mt-3 rounded-lg border border-primary/20 bg-primary/[0.03] p-3"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-1.5 text-[12px] font-medium text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  Sarvam suggestion
                </h4>
                <span className="text-[12px] text-muted-foreground">
                  {suggestion.selected ? "Selected text improved" : "Description improved"}
                </span>
              </div>
              <div className="max-h-60 overflow-y-auto">
                <DescriptionReadView document={suggestion.document} />
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setSuggestion(null)}>
                  Keep original
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    !canEdit ||
                    saving ||
                    conflict ||
                    suggestion.source !== JSON.stringify(draft.document)
                  }
                  onClick={applySuggestion}
                >
                  Use suggestion
                </Button>
              </div>
              {suggestion.source !== JSON.stringify(draft.document) ? (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  Your draft changed. Improve again for a fresh suggestion.
                </p>
              ) : null}
              <p className="mt-2 text-[12px] text-muted-foreground">
                Review for accuracy. Changes are saved only when you choose Save.
              </p>
            </section>
          ) : null}
          {improveError ? (
            <p role="alert" className="mt-2 text-[12px] text-destructive">
              {improveError}
            </p>
          ) : null}
          {!canEdit || conflict ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {!canEdit
                ? "Ownership changed. Your draft is kept, but you can no longer save it."
                : "The saved description changed in another session. Cancel to load the latest version; your draft has not overwritten it."}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={cancel}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!dirty || !canEdit || conflict || saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : descriptionText(saved) ? (
        <DescriptionReadView document={saved} />
      ) : canEdit ? (
        <button
          type="button"
          onClick={begin}
          className="w-full rounded bg-[#f8f9fc] px-3 py-2 text-left text-[12px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Add a description…
        </button>
      ) : (
        <p className="text-[12px] text-muted-foreground">No description yet.</p>
      )}
      {previewLinks.length ? (
        <div aria-label="Description links" className="mt-3 space-y-2">
          {previewLinks.map((url) => (
            <LinkCard key={url} url={url} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
