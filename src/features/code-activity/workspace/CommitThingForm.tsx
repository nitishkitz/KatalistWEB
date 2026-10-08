import { useEffect, useRef, useState } from "react";
import { workspaceApi } from "../live/workspace-api";
import type { RegisteredSource } from "../live/workspace-api";
import { dueDateToInstant } from "../live/adapter";
import { useAssigneeCandidates } from "../live/use-feed";
import { Notice, Spinner } from "../ui-parts";
import type { WorkspaceItem } from "./types";

const FIELD = "w-full rounded-[9px] border border-[var(--ca-line-strong)] bg-white px-3 py-2.5 text-[14px] outline-none focus-visible:border-[var(--ca-accent)] focus-visible:ring-[3px] focus-visible:ring-[var(--ca-accent)]/25";
const LABEL = "mb-1 block text-[13px] font-medium";

type Stage =
  | { kind: "registering" }
  | { kind: "register_failed"; message: string }
  | { kind: "review"; source: RegisteredSource }
  | { kind: "done"; thingId: string | null; replayed: boolean };

const registerMessage = (code: string) =>
  code === "not_configured" ? "Creating Things from commits has not been set up in this environment yet. Nothing was created."
  : code === "not_allowed" || code === "disabled" ? "You cannot create a Thing from this change."
  : code === "rate_limited" ? "GitHub is limiting requests. Try again in a moment."
  : "GitHub could not be reached. Try again.";

const confirmMessage = (code: string) =>
  code === "not_configured" ? "Creating Things from commits has not been set up in this environment yet. Nothing was created. Your text is kept."
  : code === "conflict" ? "This request was already used with different content. Close this and start again."
  : code === "not_allowed" || code === "disabled" ? "You cannot create a Thing here, or the assignee is no longer eligible. Nothing was created."
  : code === "invalid_request" ? "Something in the form is not valid. Check the title, assignee and date."
  : "No reply arrived. Nothing is lost: try again and the same request is used, so it cannot be created twice.";

/**
 * A manual, reviewed Thing from a commit or pull request that is not a saved feed row. Every word is the person's own;
 * nothing here is drafted by a model. A repeat of the same submission is safe because one idempotency key is kept for the form.
 */
export function CommitThingForm({ item, listId, canCreate, onClose, onOpenThings }: { item: WorkspaceItem; listId: string; canCreate: boolean; onClose: () => void; onOpenThings?: () => void }) {
  const kind = item.kind === "pull_request" ? "pull_request" : "commit";
  const key = kind === "commit" ? item.sha : String(item.number ?? "");
  const [stage, setStage] = useState<Stage>({ kind: "registering" });
  const [tick, setTick] = useState(0);
  const idempotency = useRef(crypto.randomUUID());
  const candidates = useAssigneeCandidates(listId, canCreate);
  const [title, setTitle] = useState(item.title.slice(0, 300));
  const [notes, setNotes] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [importance, setImportance] = useState<"now" | "next" | "later">("next");
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceMoved, setSourceMoved] = useState(false);

  useEffect(() => {
    if (!key) return setStage({ kind: "register_failed", message: "This change has no identifier to link to." });
    const controller = new AbortController();
    setStage({ kind: "registering" });
    workspaceApi
      .registerSource(listId, kind, key, controller.signal)
      .then((r) => {
        if (controller.signal.aborted) return;
        setStage(r.ok ? { kind: "review", source: r.data } : { kind: "register_failed", message: registerMessage(r.code) });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted && !(e instanceof DOMException)) setStage({ kind: "register_failed", message: registerMessage("source_unavailable") });
      });
    return () => controller.abort();
  }, [listId, kind, key, tick]);

  if (stage.kind === "registering") return <div role="status" className="flex items-center gap-2 p-6 text-[13px]"><Spinner /> Reading {item.title} from GitHub…</div>;
  if (stage.kind === "register_failed")
    return (
      <div role="alert" className="space-y-3 p-6">
        <Notice tone="warn">{stage.message}</Notice>
        <div className="flex gap-2">
          <button type="button" onClick={() => setTick((n) => n + 1)} className="inline-flex min-h-[36px] cursor-pointer items-center rounded-[10px] border border-[var(--ca-line)] px-3 text-[13px] font-medium">Try again</button>
          <button type="button" onClick={onClose} className="inline-flex min-h-[36px] cursor-pointer items-center rounded-[10px] px-3 text-[13px]">Close</button>
        </div>
      </div>
    );
  if (stage.kind === "done")
    return (
      <div role="status" className="space-y-3 p-6">
        <h2 className="text-[18px] font-semibold">{stage.replayed ? "This Thing was already created" : "Thing created"}</h2>
        <p className="text-[13px] text-[var(--ca-muted)]">It starts as Waiting for Catch for the person you chose.</p>
        <div className="flex gap-2">
          {onOpenThings ? <button type="button" onClick={() => { onClose(); onOpenThings(); }} className="inline-flex min-h-[36px] cursor-pointer items-center rounded-[10px] bg-[var(--ca-accent)] px-3 text-[13px] font-medium text-white">Open Things</button> : null}
          <button type="button" onClick={onClose} className="inline-flex min-h-[36px] cursor-pointer items-center rounded-[10px] border border-[var(--ca-line)] px-3 text-[13px]">Close</button>
        </div>
      </div>
    );

  const source = stage.source;
  const moved = kind === "pull_request" && item.sha !== null && item.sha !== source.revisionSha;
  const titleOk = title.trim().length > 0 && title.length <= 300;
  const canSubmit = titleOk && assignee !== "" && !busy && (!moved && !sourceMoved ? true : acknowledge);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await workspaceApi
      .confirm({ listId, sourceId: source.sourceId, key: idempotency.current, title, notes: notes.trim() === "" ? null : notes, assigneeActorId: assignee, dueAt: dueDateToInstant(due === "" ? null : due), importance, reviewedSha: source.revisionSha, acknowledgeSourceChange: acknowledge })
      .catch(() => ({ ok: false as const, status: 0, code: "source_unavailable" }));
    setBusy(false);
    if (result.ok) return setStage({ kind: "done", thingId: result.data.thingId, replayed: result.data.replayed });
    if (result.code === "source_changed") {
      setSourceMoved(true);
      return setError("This change moved on after you opened it. Tick the box to create the Thing anyway.");
    }
    setError(confirmMessage(result.code));
  };

  return (
    <form className="space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); if (canSubmit) void submit(); }}>
      <div>
        <h2 className="text-[18px] font-semibold">Create a Thing from this {kind === "commit" ? "commit" : "pull request"}</h2>
        <p className="mt-1 text-[13px] text-[var(--ca-muted)]">Reviewed against <span className="ca-code">{source.revisionSha.slice(0, 7)}</span>. You write it; nothing is drafted for you.</p>
      </div>
      <div><label className={LABEL} htmlFor="ct-title">Title</label><input id="ct-title" className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} aria-invalid={!titleOk} /></div>
      <div><label className={LABEL} htmlFor="ct-notes">Notes (optional)</label><textarea id="ct-notes" className={FIELD} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={8000} /></div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className={LABEL} htmlFor="ct-assignee">Assignee</label>
          <select id="ct-assignee" className={FIELD} value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={candidates.loading || candidates.candidates.length === 0}>
            <option value="">{candidates.loading ? "Loading…" : "Choose a person"}</option>
            {candidates.candidates.map((c) => <option key={c.actorId} value={c.actorId}>{c.name}{c.isSelf ? " (you)" : ""} · {c.role}</option>)}
          </select>
          {candidates.error ? <p role="alert" className="mt-1 text-[12px] text-[var(--ca-bad-ink)]">{candidates.error}{candidates.retryable ? <button type="button" onClick={candidates.retry} className="ml-1 underline">Retry</button> : null}</p> : null}
        </div>
        <div><label className={LABEL} htmlFor="ct-due">Due date (optional)</label><input id="ct-due" type="date" className={FIELD} value={due} onChange={(e) => setDue(e.target.value)} /></div>
        <div><label className={LABEL} htmlFor="ct-importance">Importance</label><select id="ct-importance" className={FIELD} value={importance} onChange={(e) => setImportance(e.target.value as typeof importance)}><option value="now">Now</option><option value="next">Next</option><option value="later">Later</option></select></div>
      </div>
      {moved || sourceMoved ? <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} className="mt-0.5 h-4 w-4" />The change moved on since I reviewed it. Create the Thing anyway.</label> : null}
      {error ? <Notice tone="bad" live="alert">{error}</Notice> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={!canSubmit} className="inline-flex min-h-[38px] cursor-pointer items-center gap-2 rounded-[10px] bg-[var(--ca-accent)] px-4 text-[14px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <Spinner /> : null}Create Thing</button>
        <button type="button" onClick={onClose} className="inline-flex min-h-[38px] cursor-pointer items-center rounded-[10px] border border-[var(--ca-line)] px-4 text-[14px]">Cancel</button>
      </div>
    </form>
  );
}
