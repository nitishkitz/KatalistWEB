import { useEffect, useId, useState, type FormEvent } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { COVER_ACCEPT } from "./covers";
import { describeUrl, describeWriteError, validateDraft, type DesignDraft, type DraftErrors } from "./design-library-model";
import type { DesignOperationError } from "./design-queries";
import type { DesignFolder } from "./records";

export type CoverControls = {
  url: string | null;
  hasCover: boolean;
  busy: boolean;
  /** Last cover failure; the current cover is unchanged when this is set. */
  error: string | null;
  /** Last cover success. */
  notice: string | null;
  onPick: (file: File) => void;
  onRemove: () => void;
};

export type DesignMemberOption = { profileId: string; name: string; initials: string; avatarUrl?: string | null };

const URL_ERROR_CODES = new Set([
  "empty", "too_long", "malformed", "insecure_protocol", "credentials_not_allowed", "port_not_allowed",
  "unsupported_host", "unsupported_route", "invalid_file_key", "invalid_node_id", "invalid_version_id", "invalid_parameter",
]);

const fieldClass =
  "mt-1 w-full rounded-lg border border-[#dfe3f0] bg-white px-3 text-[14px] text-[#000533] outline-none focus:border-[#975ee2] focus-visible:ring-2 focus-visible:ring-[#975ee2]/40 aria-[invalid=true]:border-[#d92d20]";
const labelClass = "text-[12.5px] font-medium text-[#4a5578]";

/**
 * Add/edit dialog. The draft is owned by the parent so a failed save (or a closed
 * dialog after a failure) never loses what the person typed.
 */
export function DesignFormDialog({
  open,
  mode,
  draft,
  onDraftChange,
  folders,
  members,
  submitting,
  serverError,
  restoredDraft,
  onDiscardDraft,
  onSubmit,
  onClose,
  onShowExisting,
  onCloseAutoFocus,
  cover,
}: {
  open: boolean;
  mode: "add" | "edit";
  draft: DesignDraft;
  onDraftChange: (next: DesignDraft) => void;
  folders: readonly DesignFolder[];
  members: readonly DesignMemberOption[];
  submitting: boolean;
  serverError: DesignOperationError | null;
  restoredDraft: boolean;
  onDiscardDraft: () => void;
  onSubmit: (draft: DesignDraft) => void;
  onClose: () => void;
  onShowExisting: (existingId: string | null) => void;
  onCloseAutoFocus: () => void;
  /** Present only when editing a saved design. */
  cover?: CoverControls;
}) {
  const uid = useId();
  const ids = { url: `${uid}-url`, title: `${uid}-title`, notes: `${uid}-notes`, tags: `${uid}-tags`, owner: `${uid}-owner`, folder: `${uid}-folder` };
  const [errors, setErrors] = useState<DraftErrors>({});
  const hasOptional = Boolean(draft.notes || draft.tags || draft.ownerProfileId || draft.folderId);
  const [showMore, setShowMore] = useState(mode === "edit" || hasOptional);

  useEffect(() => {
    if (open) {
      setErrors({});
      setShowMore(mode === "edit" || hasOptional);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  const set = (patch: Partial<DesignDraft>) => {
    onDraftChange({ ...draft, ...patch });
    setErrors((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(patch) as Array<keyof DesignDraft>) delete next[key as keyof DraftErrors];
      return next;
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const found = validateDraft(draft);
    setErrors(found);
    const first = (["url", "title", "notes", "tags"] as const).find((k) => found[k]);
    if (first) {
      if ((first === "notes" || first === "tags") && !showMore) setShowMore(true);
      requestAnimationFrame(() => document.getElementById(ids[first])?.focus());
      return;
    }
    onSubmit(draft);
  };

  const detected = describeUrl(draft.url);
  const urlServerMessage = serverError && URL_ERROR_CODES.has(serverError.code) ? serverError.message : null;
  const urlError = errors.url ?? urlServerMessage ?? undefined;
  const generalError = serverError && !urlServerMessage ? serverError : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="max-h-[90dvh] max-w-lg overflow-y-auto"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseAutoFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "Add design" : "Edit design"}</DialogTitle>
          <DialogDescription>
            Paste a Figma link. Katalist stores the link and your notes; it does not read your Figma file.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="space-y-3">
          {restoredDraft && (
            <div role="status" className="flex items-center justify-between gap-2 rounded-lg bg-[#f4f0ff] px-3 py-2 text-[12.5px] text-[#4a2c8a]">
              <span>Restored your unsaved draft.</span>
              <button type="button" onClick={onDiscardDraft} className="cursor-pointer font-medium underline outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2]">
                Discard draft
              </button>
            </div>
          )}

          {generalError && (
            <div role="alert" className="rounded-lg border border-[#f4c7c3] bg-[#fef3f2] px-3 py-2 text-[12.5px] text-[#912018]">
              <p>{describeWriteError(generalError)}</p>
              {generalError.code === "duplicate_design" && (
                <button
                  type="button"
                  onClick={() => onShowExisting(generalError.existingId)}
                  className="mt-1 cursor-pointer font-medium underline outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2]"
                >
                  Show the saved design
                </button>
              )}
              <p className="mt-1 text-[#6a769c]">Your draft is kept.</p>
            </div>
          )}

          <div>
            <label htmlFor={ids.url} className={labelClass}>
              Figma link <span aria-hidden="true">*</span>
              <span className="sr-only">(required)</span>
            </label>
            <input
              id={ids.url}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={draft.url}
              onChange={(e) => set({ url: e.target.value })}
              aria-invalid={Boolean(urlError)}
              aria-describedby={`${ids.url}-help`}
              placeholder="https://www.figma.com/design/…"
              className={`${fieldClass} h-10`}
            />
            <p id={`${ids.url}-help`} className={`mt-1 text-[12px] ${urlError ? "text-[#b42318]" : "text-[#6a769c]"}`}>
              {urlError ?? (detected?.ok ? detected.text : detected && !detected.ok ? detected.error.message : "Design, FigJam, prototype, Slides or deck links.")}
            </p>
          </div>

          <div>
            <label htmlFor={ids.title} className={labelClass}>
              Title <span aria-hidden="true">*</span>
              <span className="sr-only">(required)</span>
            </label>
            <input
              id={ids.title}
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? `${ids.title}-error` : undefined}
              maxLength={400}
              placeholder="e.g. Checkout flow"
              className={`${fieldClass} h-10`}
            />
            {errors.title && <p id={`${ids.title}-error`} className="mt-1 text-[12px] text-[#b42318]">{errors.title}</p>}
          </div>

          <button
            type="button"
            aria-expanded={showMore}
            aria-controls={`${uid}-more`}
            onClick={() => setShowMore((v) => !v)}
            className="cursor-pointer text-[12.5px] font-medium text-[#975ee2] outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2]"
          >
            {showMore ? "Hide details" : "Add notes, tags, owner or folder (optional)"}
          </button>

          <div id={`${uid}-more`} hidden={!showMore} className="space-y-3">
            <div>
              <label htmlFor={ids.notes} className={labelClass}>Notes</label>
              <textarea
                id={ids.notes}
                value={draft.notes}
                onChange={(e) => set({ notes: e.target.value })}
                rows={3}
                aria-invalid={Boolean(errors.notes)}
                aria-describedby={errors.notes ? `${ids.notes}-error` : undefined}
                className={`${fieldClass} py-2`}
              />
              {errors.notes && <p id={`${ids.notes}-error`} className="mt-1 text-[12px] text-[#b42318]">{errors.notes}</p>}
            </div>
            <div>
              <label htmlFor={ids.tags} className={labelClass}>Tags</label>
              <input
                id={ids.tags}
                value={draft.tags}
                onChange={(e) => set({ tags: e.target.value })}
                aria-invalid={Boolean(errors.tags)}
                aria-describedby={`${ids.tags}-help`}
                placeholder="web, checkout"
                className={`${fieldClass} h-10`}
              />
              <p id={`${ids.tags}-help`} className={`mt-1 text-[12px] ${errors.tags ? "text-[#b42318]" : "text-[#6a769c]"}`}>
                {errors.tags ?? "Separate tags with commas."}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={ids.owner} className={labelClass}>Owner</label>
                <select id={ids.owner} value={draft.ownerProfileId} onChange={(e) => set({ ownerProfileId: e.target.value })} className={`${fieldClass} h-10`}>
                  <option value="">{mode === "add" ? "Me (default)" : "Keep current owner"}</option>
                  {members.map((m) => (
                    <option key={m.profileId} value={m.profileId}>{m.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={ids.folder} className={labelClass}>Folder</label>
                <select id={ids.folder} value={draft.folderId} onChange={(e) => set({ folderId: e.target.value })} className={`${fieldClass} h-10`}>
                  <option value="">No folder</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {cover && (
            <fieldset className="space-y-2 rounded-lg border border-[#eaeffa] p-3" disabled={cover.busy}>
              <legend className="px-1 text-[12.5px] font-medium text-[#4a5578]">Cover image (optional)</legend>
              <div className="flex items-center gap-3">
                {cover.url ? (
                  <img src={cover.url} alt="Current cover" className="h-16 w-24 rounded-md border border-[#eaeffa] object-cover" />
                ) : (
                  <div className="flex h-16 w-24 items-center justify-center rounded-md bg-[#f4f5fb] text-[11.5px] text-[#6a769c]">
                    {cover.hasCover ? "Loading…" : "No cover"}
                  </div>
                )}
                <div className="min-w-0 space-y-1.5">
                  <label
                    htmlFor={`${uid}-cover`}
                    className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-[#eaeffa] bg-white px-3 text-[13px] font-medium text-[#1d1d1d] focus-within:ring-2 focus-within:ring-[#975ee2] hover:bg-[#fafaff]"
                  >
                    {cover.hasCover ? "Replace image" : "Choose image"}
                    <input
                      id={`${uid}-cover`}
                      type="file"
                      accept={COVER_ACCEPT}
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) cover.onPick(file);
                      }}
                    />
                  </label>
                  {cover.hasCover && (
                    <button
                      type="button"
                      onClick={cover.onRemove}
                      className="ml-2 inline-flex h-9 cursor-pointer items-center rounded-lg px-2 text-[13px] font-medium text-[#b42318] outline-none hover:bg-[#fef3f2] focus-visible:ring-2 focus-visible:ring-[#975ee2]"
                    >
                      Remove cover
                    </button>
                  )}
                  <p className="text-[12px] text-[#6a769c]">PNG, JPEG or WebP, up to 5 MB. Katalist never captures covers automatically.</p>
                </div>
              </div>
              <div aria-live="polite">
                {cover.busy && <p className="text-[12.5px] text-[#6a769c]">Updating cover…</p>}
                {cover.error && <p role="alert" className="text-[12.5px] text-[#b42318]">{cover.error}</p>}
                {cover.notice && !cover.error && <p role="status" className="text-[12.5px] text-[#067647]">{cover.notice}</p>}
              </div>
            </fieldset>
          )}

          <DialogFooter className="gap-2 pt-1 sm:gap-0">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 cursor-pointer items-center justify-center rounded-[9px] border border-[#eaeffa] bg-white px-4 text-[14px] font-medium text-[#1d1d1d] outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 cursor-pointer items-center justify-center rounded-[9px] bg-[#975ee2] px-4 text-[14px] font-medium text-white outline-none hover:bg-[#8650d1] focus-visible:ring-2 focus-visible:ring-[#975ee2] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Saving…" : mode === "add" ? "Add design" : "Save changes"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
