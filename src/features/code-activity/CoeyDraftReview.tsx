import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { aiActionState } from "./access";
import { countChecks, shortSha } from "./format";
import { Notice, SourceLink, Spinner } from "./ui-parts";
import { validateDraft } from "./types";
import type { CodeActivityAdapter } from "./adapter";
import type {
  ActivityChange,
  AssigneeCandidate,
  ConfirmFailureReason,
  DraftFailureReason,
  DraftFields,
  DraftPayload,
  ListRole,
} from "./types";

interface CoeyDraftReviewProps {
  change: ActivityChange;
  role: ListRole;
  consent: boolean;
  listName: string;
  adapter: CodeActivityAdapter;
  candidates: readonly AssigneeCandidate[];
  candidatesLoading?: boolean;
  candidatesError?: string | null;
  onRetryCandidates?: () => void;
  /** Leave the draft and return to the change overview. */
  onClose: () => void;
  onOpenConsentSettings: () => void;
  /** Leave Code Activity and use the normal manual flow. */
  onCreateManually?: () => void;
  /** True in the live feature: nothing here is labeled Preview and a confirmed draft creates a real Thing. */
  live?: boolean;
  /** "manual" skips drafting: the person writes the Thing themselves, starting from the change title. */
  startMode?: "ai" | "manual";
  /** After a real Thing was created: open it (the parent decides where). */
  onOpenThing?: (thingId: string) => void;
}

type Stage = "input" | "generating" | "failed" | "review" | "done";
type SubmitState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "failed"; reason: ConfirmFailureReason };

const PREVIEW_TAG = "PREVIEW";

const FAILURE_COPY: Record<DraftFailureReason, { title: string; body: string }> = {
  timeout: {
    title: "Coey could not finish in time",
    body: "Your change, files, and checks are still here. Nothing was created.",
  },
  invalid_output: {
    title: "Coey’s answer could not be used",
    body: "It did not match the format Katalist needs, so it was discarded. Nothing was created.",
  },
  unavailable: {
    title: "Drafting is unavailable right now",
    body: "The feed, files, checks, and normal Thing creation still work. Nothing was created.",
  },
  consent_withdrawn: {
    title: "Drafting was turned off",
    body: "Private-content processing is off for this List, so the draft was not kept.",
  },
  cancelled: { title: "Drafting was cancelled", body: "Nothing was created." },
};

function newKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const FIELD = "w-full rounded-[9px] border border-[#d6dbea] bg-white px-3 py-2.5 text-[14px] text-black outline-none focus-visible:border-[#975ee2] focus-visible:ring-[3px] focus-visible:ring-[#975ee2]/25";

/**
 * The Coey draft flow, shown inside the selected change inspector.
 * Preview only: generation and confirmation come from the preview adapter, and a confirmed
 * draft creates NOTHING real. The result screen says so.
 */
export function CoeyDraftReview({
  change,
  role,
  consent,
  listName,
  adapter,
  candidates,
  candidatesLoading = false,
  candidatesError = null,
  onRetryCandidates,
  onClose,
  onOpenConsentSettings,
  onCreateManually,
  live = false,
  startMode = "ai",
  onOpenThing,
}: CoeyDraftReviewProps) {
  const manual = startMode === "manual";
  const [stage, setStage] = useState<Stage>(manual ? "review" : "input");
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<DraftFailureReason | null>(null);
  const [fields, setFields] = useState<DraftFields>({
    title: manual ? change.title.slice(0, 300) : "",
    description: "",
    assigneeActorId: null,
    dueDate: null,
    ownerImportance: "next",
  });
  const [attempted, setAttempted] = useState(false);
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const [acknowledgeSource, setAcknowledgeSource] = useState(false);
  const [result, setResult] = useState<{ thingId: string; replayed: boolean } | null>(null);
  const [status, setStatus] = useState("");

  const key = useRef(newKey());
  const abort = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const action = aiActionState(role, consent);
  const validation = useMemo(() => validateDraft(fields, candidates), [fields, candidates]);
  const counts = useMemo(() => countChecks(change.checks), [change.checks]);
  const chosen = candidates.find((c) => c.actorId === fields.assigneeActorId) ?? null;
  const assigneesUnavailable = candidatesLoading || candidatesError !== null;

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    headingRef.current?.focus();
  }, [stage]);

  const generate = useCallback(async () => {
    if (!action.visible || !action.enabled) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setStage("generating");
    setStatus("Drafting started.");
    try {
      const out = await adapter.generateDraft({ change, note }, controller.signal);
      if (controller.signal.aborted) return;
      if (out.ok) {
        setFields((f) => ({ ...f, title: out.fields.title, description: out.fields.description }));
        setAttempted(false);
        setSubmit({ status: "idle" });
        setStage("review");
        setStatus("Draft ready for review. Nothing has been created.");
      } else {
        setFailure(out.reason);
        setStage("failed");
        setStatus("Drafting failed. Nothing was created.");
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      setFailure("unavailable");
      setStage("failed");
      setStatus("Drafting failed. Nothing was created.");
    }
  }, [action, adapter, change, note]);

  const cancelGeneration = () => {
    abort.current?.abort();
    setStage("input");
    setStatus("Drafting cancelled. Your note was kept.");
  };

  const confirm = useCallback(
    async (acknowledged: boolean) => {
      setAttempted(true);
      if (!validation.ok || assigneesUnavailable || submit.status === "pending") return;
      const payload: DraftPayload = {
        ...fields,
        evidence: {
          changeId: change.id,
          headSha: change.headSha,
          number: change.number,
          title: change.title,
          sourceUrl: change.sourceUrl,
        },
        aiGenerated: !manual,
        acknowledgeSourceChange: acknowledged,
      };
      setSubmit({ status: "pending" });
      setStatus("Creating.");
      try {
        const out = await adapter.confirmDraft({ key: key.current, draft: payload });
        if (out.ok) {
          setResult({ thingId: out.thingId, replayed: out.replayed });
          setStage("done");
          setSubmit({ status: "idle" });
          setStatus(out.replayed ? "Your earlier request had already succeeded." : live ? "Thing created." : "Preview confirmation complete.");
        } else {
          setSubmit({ status: "failed", reason: out.reason });
          setStatus("Could not confirm. Nothing from this draft is lost.");
        }
      } catch {
        // A thrown error is treated like a lost response: the same key makes a retry safe.
        setSubmit({ status: "failed", reason: "no_response" });
        setStatus("We did not get a reply.");
      }
    },
    [adapter, assigneesUnavailable, change, fields, live, manual, submit.status, validation.ok],
  );

  const heading = (text: string) => (
    <h3 ref={headingRef} tabIndex={-1} className="text-[18px] font-semibold text-[#000533] outline-none">
      {text}
    </h3>
  );

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-[12px] font-medium tracking-wide text-[#6a769c]">
          {manual ? "CREATE A THING" : "DRAFT WITH COEY"}
          {live ? "" : ` · ${PREVIEW_TAG}`}
        </div>
        {heading(
          stage === "review"
            ? manual
              ? "Create a Thing from this change"
              : "Review draft"
            : stage === "done"
              ? live
                ? "Thing created"
                : "Preview confirmation"
              : stage === "failed" && failure
                ? FAILURE_COPY[failure].title
                : "Draft with Coey",
        )}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 px-7 py-5">
      <div role="status" aria-live="polite" className="sr-only">
        {status}
      </div>
      {header}

      {stage === "input" ? (
        <>
          {!action.visible ? (
            <Notice tone="info">Drafting is for Owners and Collaborators. You can still read this change.</Notice>
          ) : !action.enabled ? (
            <Notice tone="warn">
              <b>Drafting is turned off.</b> {action.message}
              {action.reason === "consent_off_owner" ? (
                <button
                  type="button"
                  onClick={onOpenConsentSettings}
                  className="ml-2 min-h-[28px] cursor-pointer rounded-md border border-[#e0b95c] bg-white px-2 text-[12px] font-medium text-[#4a3a10] outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2]"
                >
                  Open consent settings
                </button>
              ) : null}
            </Notice>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="coey-note" className="text-[12.5px] font-semibold text-[#000533]">
              What do you want verified or followed up?
            </label>
            <textarea
              id="coey-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className={cn(FIELD, "min-h-[84px] resize-y")}
              placeholder="Optional. For example: check why the build fails on narrow screens."
            />
            <p className="text-[12px] text-[#6a769c]">Optional. Coey drafts a Thing from this change and your note.</p>
          </div>

          <div>
            <div className="mb-1.5 text-[12.5px] font-semibold text-[#000533]">Evidence Coey will read</div>
            <ul className="flex flex-wrap gap-2">
              <li className="rounded-lg border border-[#eaeffa] bg-[#fafbff] px-2.5 py-1 text-[12px] text-[#26304f]">
                {change.number ? `PR #${change.number} · ` : ""}title and description
              </li>
              <li className="rounded-lg border border-[#eaeffa] bg-[#fafbff] px-2.5 py-1 text-[12px] text-[#26304f]">
                {change.files.length} file {change.files.length === 1 ? "patch" : "patches"}
                {change.headSha ? ` · rev ${shortSha(change.headSha)}` : ""}
              </li>
              {counts.failing > 0 ? (
                <li className="rounded-lg border border-[#eaeffa] bg-[#fafbff] px-2.5 py-1 text-[12px] text-[#26304f]">
                  Check results ({counts.failing} failing)
                </li>
              ) : null}
            </ul>
          </div>

          {action.visible && action.enabled ? (
            <Notice tone="info">
              This change&rsquo;s text and patches are sent to an AI service to write the draft. Nothing is created until you
              confirm.{live ? "" : <b> (Preview: nothing is sent.)</b>}
            </Notice>
          ) : null}

          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              disabled={!(action.visible && action.enabled)}
              onClick={() => void generate()}
              className="inline-flex h-[42px] cursor-pointer items-center gap-2 rounded-[9px] bg-[#975ee2] px-4 text-[14px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Generate draft
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-[42px] cursor-pointer items-center rounded-[9px] border border-[#eaeffa] bg-white px-4 text-[14px] font-medium text-[#1d1d1d] outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2]"
            >
              Cancel
            </button>
          </div>
        </>
      ) : null}

      {stage === "generating" ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5 text-[14px] font-semibold text-[#000533]">
            <Spinner className="text-[#975ee2]" />
            Reading the change and drafting a Thing…
          </div>
          <div aria-hidden="true" className="space-y-2">
            <div className="h-3 w-[92%] rounded-md bg-[#eef0f6]" />
            <div className="h-3 w-[78%] rounded-md bg-[#eef0f6]" />
            <div className="h-3 w-[60%] rounded-md bg-[#eef0f6]" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={cancelGeneration}
              className="inline-flex h-[42px] cursor-pointer items-center rounded-[9px] border border-[#eaeffa] bg-white px-4 text-[14px] font-medium outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2]"
            >
              Cancel
            </button>
            <span className="text-[12px] text-[#6a769c]">Cancelling keeps your note and evidence. Nothing has been created.</span>
          </div>
        </div>
      ) : null}

      {stage === "failed" && failure ? (
        <div className="flex flex-col gap-3">
          <Notice tone="bad" live="alert">
            {FAILURE_COPY[failure].body}
          </Notice>
          <div className="flex flex-wrap gap-2.5">
            {failure !== "consent_withdrawn" ? (
              <button
                type="button"
                onClick={() => void generate()}
                className="inline-flex h-[42px] cursor-pointer items-center rounded-[9px] bg-[#975ee2] px-4 text-[14px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2] focus-visible:ring-offset-2"
              >
                Try again
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setStage("input")}
              className="inline-flex h-[42px] cursor-pointer items-center rounded-[9px] border border-[#eaeffa] bg-white px-4 text-[14px] font-medium outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2]"
            >
              Back to your note
            </button>
            {onCreateManually ? (
              <button
                type="button"
                onClick={onCreateManually}
                className="inline-flex h-[42px] cursor-pointer items-center rounded-[9px] border border-[#eaeffa] bg-white px-4 text-[14px] font-medium outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2]"
              >
                Create a Thing yourself
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {stage === "review" ? (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void confirm(acknowledgeSource);
          }}
        >
          <p className="text-[12.5px] text-[#6a769c]">
            {manual ? "Created from" : "Drafted by Coey from"} {change.number ? `PR #${change.number}` : "this change"}
            {change.headSha ? ` at revision ${shortSha(change.headSha)}` : ""}. {manual ? "Write what you need" : "Review and edit"} before creating.{" "}
            <b className="text-[#26304f]">Nothing has been created.</b>
          </p>

          <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="draft-title" className="text-[12.5px] font-semibold text-[#000533]">
                  Title {manual ? null : <span className="ml-1 rounded-full border border-[#eaeffa] px-2 py-px text-[12px] font-normal text-[#4d5878]">Suggested</span>}
                </label>
                <input
                  id="draft-title"
                  value={fields.title}
                  onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))}
                  aria-invalid={attempted && validation.errors.title ? true : undefined}
                  aria-describedby={validation.errors.title ? "draft-title-error" : undefined}
                  className={cn(FIELD, "min-h-[42px]", attempted && validation.errors.title && "border-[#fc404d]")}
                />
                {attempted && validation.errors.title ? (
                  <p id="draft-title-error" className="text-[12px] text-[#a61b2b]">{validation.errors.title}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="draft-description" className="text-[12.5px] font-semibold text-[#000533]">
                  Description {manual ? <span className="font-normal text-[#6a769c]">optional</span> : <span className="ml-1 rounded-full border border-[#eaeffa] px-2 py-px text-[12px] font-normal text-[#4d5878]">Suggested</span>}
                </label>
                <textarea
                  id="draft-description"
                  rows={6}
                  value={fields.description}
                  onChange={(e) => setFields((f) => ({ ...f, description: e.target.value }))}
                  aria-invalid={attempted && validation.errors.description ? true : undefined}
                  className={cn(FIELD, "resize-y text-[13px]")}
                />
                <div className="flex flex-wrap items-center gap-x-3 text-[12px] text-[#6a769c]">
                  <span>Evidence:</span>
                  <SourceLink href={change.sourceUrl}>{change.number ? `PR #${change.number}` : "Change"}</SourceLink>
                  {change.checkState === "failing" ? <span>failing check on revision {shortSha(change.checksRevision)}</span> : null}
                </div>
              </div>
              <Notice tone="info">
                <b>Starts as Waiting for Catch.</b> Every new Thing does, including one you assign to yourself. This status is
                not editable here.
              </Notice>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-semibold text-[#000533]">List</span>
                <div className="rounded-[9px] border border-[#eaeffa] bg-[#f7f8fc] px-3 py-2.5 text-[14px]">
                  {listName} <span className="text-[12px] text-[#6a769c]">· fixed for this draft</span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="draft-assignee" className="text-[12.5px] font-semibold text-[#000533]">
                  Assignee <span className="font-normal text-[#a61b2b]">required</span>
                </label>
                <select
                  id="draft-assignee"
                  disabled={assigneesUnavailable || candidates.length === 0}
                  value={fields.assigneeActorId ?? ""}
                  onChange={(e) => setFields((f) => ({ ...f, assigneeActorId: e.target.value === "" ? null : e.target.value }))}
                  aria-invalid={attempted && validation.errors.assignee ? true : undefined}
                  aria-describedby="draft-assignee-help"
                  className={cn(FIELD, "min-h-[42px]", attempted && validation.errors.assignee && "border-[#fc404d]")}
                >
                  <option value="">{candidatesLoading ? "Loading List assignees…" : candidatesError ? "Assignees unavailable" : candidates.length === 0 ? "No assignees available" : "Choose an assignee"}</option>
                  {candidates.map((c) => (
                    <option key={c.actorId} value={c.actorId}>
                      {c.isSelf ? "Assign to me" : c.name} · {c.role === "owner" ? "Owner" : "Collaborator"}
                    </option>
                  ))}
                </select>
                <p id="draft-assignee-help" role={candidatesError ? "alert" : undefined} aria-live="polite" className={cn("text-[12px]", candidatesError || (attempted && validation.errors.assignee) ? "text-[#a61b2b]" : "text-[#6a769c]")}>
                  {candidatesLoading ? "Loading the List owner and current Collaborators." : candidatesError ?? (attempted && validation.errors.assignee
                    ? validation.errors.assignee
                    : "Katalist does not choose for you. Only the Owner and current Collaborators can be assigned from here.")}
                </p>
                {candidatesError && onRetryCandidates ? (
                  <button type="button" onClick={onRetryCandidates} className="self-start rounded-lg border border-[#eaeffa] px-3 py-2 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2]">Retry assignees</button>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="draft-due" className="text-[12.5px] font-semibold text-[#000533]">
                  Due date <span className="font-normal text-[#6a769c]">optional</span>
                </label>
                <input
                  id="draft-due"
                  type="date"
                  value={fields.dueDate ?? ""}
                  onChange={(e) => setFields((f) => ({ ...f, dueDate: e.target.value === "" ? null : e.target.value }))}
                  className={cn(FIELD, "min-h-[42px]")}
                />
                <p className="text-[12px] text-[#6a769c]">Not set unless you pick a date. Katalist does not guess one from words like “Friday”.</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="draft-importance" className="text-[12.5px] font-semibold text-[#000533]">
                  Owner importance
                </label>
                <select
                  id="draft-importance"
                  value={fields.ownerImportance}
                  onChange={(e) => setFields((f) => ({ ...f, ownerImportance: e.target.value as DraftFields["ownerImportance"] }))}
                  className={cn(FIELD, "min-h-[42px]")}
                >
                  <option value="now">Now</option>
                  <option value="next">Next</option>
                  <option value="later">Later</option>
                </select>
              </div>

              <p className="text-[12px] text-[#6a769c]" aria-live="polite">
                {chosen === null
                  ? "If you choose someone else, they get an in-app notification, “A Thing is waiting for your Catch.” Choosing yourself sends none."
                  : chosen.isSelf
                    ? "No notification is sent for a Thing assigned to you."
                    : `${chosen.name} will get an in-app notification: “A Thing is waiting for your Catch.”`}
              </p>
            </div>
          </div>

          {submit.status === "failed" ? <SubmitFailure reason={submit.reason} onCheckAgain={() => void confirm(acknowledgeSource)} onConfirmAgain={() => { setAcknowledgeSource(true); void confirm(true); }} onEdit={() => setSubmit({ status: "idle" })} onCreateManually={onCreateManually} onReviewChange={onClose} /> : null}

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="submit"
              disabled={!validation.ok || assigneesUnavailable || submit.status === "pending"}
              className="inline-flex h-[42px] cursor-pointer items-center gap-2 rounded-[9px] bg-[#975ee2] px-4 text-[14px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submit.status === "pending" ? <Spinner /> : null}
              {submit.status === "pending" ? "Creating…" : "Create Thing"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-[42px] cursor-pointer items-center rounded-[9px] border border-[#eaeffa] bg-white px-4 text-[14px] font-medium outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2]"
            >
              Discard draft
            </button>
            <span className="text-[12px] text-[#6a769c]">
              {validation.ok ? "Nothing is created until you confirm." : "Create Thing is disabled until the required fields are complete."}
            </span>
          </div>
        </form>
      ) : null}

      {stage === "done" && result ? (
        live ? (
          <div className="flex flex-col gap-3" data-code-activity-state="thing-created">
            <div className="rounded-xl border border-[#bfe3cd] bg-[#f6fbf8] p-4">
              <div className="text-[16px] font-semibold text-[#000533]">
                {result.replayed ? "Your earlier request had already succeeded" : `“${fields.title}” was created`}
              </div>
              <p className="mt-1 text-[13px] text-[#26304f]">
                It is in <b>{listName}</b> and assigned to <b>{chosen?.isSelf ? "you" : chosen?.name}</b>. It starts as <b>Waiting for Catch</b>.
                {result.replayed ? " Retrying with the same request did not make a second one." : ""}
              </p>
            </div>
            <div className="flex gap-2.5">
              {onOpenThing ? (
                <button
                  type="button"
                  onClick={() => onOpenThing(result.thingId)}
                  className="inline-flex h-[42px] cursor-pointer items-center rounded-[9px] bg-[#975ee2] px-4 text-[14px] font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2] focus-visible:ring-offset-2"
                >
                  Open Things
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-[42px] cursor-pointer items-center rounded-[9px] border border-[#eaeffa] bg-white px-4 text-[14px] font-medium outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2]"
              >
                Back to change
              </button>
            </div>
          </div>
        ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-dashed border-[#bfe3cd] bg-[#f6fbf8] p-4">
            <div className="text-[12px] font-semibold tracking-wide text-[#17663f]">PREVIEW · SAMPLE DATA</div>
            <div className="mt-1 text-[16px] font-semibold text-[#000533]">
              {result.replayed ? "Your earlier request had already succeeded" : "This is how a confirmed draft would look"}
            </div>
            <p className="mt-1 text-[13px] text-[#26304f]">
              <b>No Thing was created.</b> In the live feature, “{fields.title}” would be created in <b>{listName}</b> and assigned to{" "}
              <b>{chosen?.isSelf ? "you" : chosen?.name}</b>. It would start as <b>Waiting for Catch</b>.
            </p>
            {result.replayed ? (
              <p className="mt-1 text-[12px] text-[#4d5878]">
                Retrying with the same request did not make a second one. (Sample id <span className="font-mono">{result.thingId}</span>)
              </p>
            ) : (
              <p className="mt-1 text-[12px] text-[#4d5878]">Sample id <span className="font-mono">{result.thingId}</span>. There is nothing to open.</p>
            )}
          </div>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-[42px] cursor-pointer items-center rounded-[9px] border border-[#eaeffa] bg-white px-4 text-[14px] font-medium outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2]"
            >
              Back to change
            </button>
          </div>
        </div>
        )
      ) : null}
    </div>
  );
}


function SubmitFailure({
  reason,
  onCheckAgain,
  onConfirmAgain,
  onEdit,
  onCreateManually,
  onReviewChange,
}: {
  reason: ConfirmFailureReason;
  onCheckAgain: () => void;
  onConfirmAgain: () => void;
  onEdit: () => void;
  onCreateManually?: () => void;
  onReviewChange: () => void;
}) {
  const button = "inline-flex min-h-[34px] cursor-pointer items-center rounded-lg border border-[#d6dbea] bg-white px-3 text-[13px] font-medium outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2]";
  if (reason === "no_response") {
    return (
      <Notice tone="warn" live="alert">
        <b>We did not get a reply.</b> Your Thing may already exist. Please do not create it again. Checking uses the same
        request, so it cannot make a second one.
        <div className="mt-2">
          <button type="button" className={button} onClick={onCheckAgain}>
            Check again
          </button>
        </div>
      </Notice>
    );
  }
  if (reason === "source_changed") {
    return (
      <Notice tone="warn" live="alert">
        <b>This pull request changed</b> since you started. Review the draft, then confirm again if it is still right.
        <div className="mt-2 flex gap-2">
          <button type="button" className={button} onClick={onReviewChange}>
            Review change
          </button>
          <button type="button" className={cn(button, "border-[#975ee2] bg-[#975ee2] text-white hover:bg-[#8a52d6]")} onClick={onConfirmAgain}>
            Confirm again
          </button>
        </div>
      </Notice>
    );
  }
  if (reason === "consent_withdrawn") {
    return (
      <Notice tone="bad" live="alert">
        <b>Drafting was turned off for this List.</b> Generated text cannot be created until it is submitted as your own.
        <div className="mt-2">
          <button type="button" className={button} onClick={onEdit}>
            Edit draft
          </button>
        </div>
      </Notice>
    );
  }
  return (
    <Notice tone="bad" live="alert">
      <b>{reason === "conflict" ? "That request conflicts with an earlier one." : "You can no longer create this."}</b> Your access, the
      connection, or the chosen assignee&rsquo;s eligibility may have changed. Nothing was created, and nothing from this draft is lost.
      <div className="mt-2 flex gap-2">
        <button type="button" className={button} onClick={onEdit}>
          Edit draft
        </button>
        {onCreateManually ? (
          <button type="button" className={button} onClick={onCreateManually}>
            Create a Thing yourself
          </button>
        ) : null}
      </div>
    </Notice>
  );
}
