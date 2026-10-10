import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Link2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { newIdempotencyKey, requiresActual, validateAttempt, STATUS_TONE } from "../domain";
import { EvidencePanel } from "../evidence/EvidencePanel";
import { QaOperationError } from "../qa-queries";
import { createDefectThing, readPendingThing, writePendingThing } from "../thing-actions";
import { useQaAttempts, useQaMutations } from "../use-qa";
import type { QaAttemptStatus, QaMember, QaRun, QaRunCase, QaThingLink, QaThingSummary } from "../types";
import { STATUS_LABEL } from "../domain";
import { ErrorNotice, StatusMark, formatDateTime, iconButton, inputClass, primaryButton, secondaryButton, textareaClass } from "../ui";

const CHOICES: QaAttemptStatus[] = ["pass", "fail", "blocked", "not_applicable"];

export function ResultDetailPanel({
  listId, run, runCase, position, total, canRecord, buildIdentifier, environmentName, links, things, listContext, preview, members,
  preset, onPrev, onNext, onClose, onOpenThing, onDirtyChange,
}: {
  listId: string;
  run: QaRun;
  runCase: QaRunCase;
  position: number;
  total: number;
  canRecord: boolean;
  buildIdentifier: string;
  environmentName: string;
  links: readonly QaThingLink[];
  things: readonly QaThingSummary[];
  listContext: "work" | "home";
  preview: boolean;
  members: readonly QaMember[];
  preset?: "fail" | "blocked";
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onOpenThing: (thingId: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const m = useQaMutations(listId);
  const attempts = useQaAttempts(listId, runCase.id);
  const previous = useQaAttempts(listId, runCase.retestOfRunCaseId);
  const [status, setStatus] = useState<QaAttemptStatus | null>(preset ?? (runCase.status === "not_run" ? null : runCase.status));
  const [actual, setActual] = useState(runCase.actual ?? "");
  const [validation, setValidation] = useState<string | null>(null);
  const [linkChoice, setLinkChoice] = useState("");
  const [pendingThing, setPendingThing] = useState<string | null>(() => readPendingThing(runCase.id));
  const [busyThing, setBusyThing] = useState(false);
  const [thingError, setThingError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const idempotency = useRef(newIdempotencyKey("att"));
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const dirty = status !== (runCase.status === "not_run" ? null : runCase.status) || actual !== (runCase.actual ?? "");
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => { if (preset) notesRef.current?.focus(); }, [preset, runCase.id]);

  const readOnly = !canRecord || run.status !== "active";
  const hasAttempt = Boolean(runCase.attemptId);
  const attemptIds = useMemo(() => (attempts.data ?? []).map((a) => a.id), [attempts.data]);
  const previousAttempt = previous.data?.[0];
  const tone = status ? STATUS_TONE[status] : STATUS_TONE.not_run;
  const nameOf = (id: string | null) => members.find((x) => x.profileId === id)?.name ?? "";

  const save = () => {
    if (!status) return setValidation("Choose a result.");
    const problem = validateAttempt(status, actual);
    setValidation(problem);
    if (problem) return;
    m.recordAttempt.mutate(
      { runCaseId: runCase.id, status, actual, idempotencyKey: idempotency.current },
      { onSuccess: () => { toast.success("Result saved"); idempotency.current = newIdempotencyKey("att"); } },
    );
  };

  const link = async (thingId: string) => {
    if (!runCase.attemptId) return;
    await m.linkThing.mutateAsync({ runCaseId: runCase.id, attemptId: runCase.attemptId, thingId });
  };
  const createThing = async () => {
    setThingError(null);
    setBusyThing(true);
    try {
      // A Thing created by an earlier click that failed to link is reused, never duplicated.
      let thingId = pendingThing;
      if (!thingId) {
        thingId = await createDefectThing({ listId, context: listContext, preview, ctx: { caseKey: runCase.caseKey, title: runCase.title, buildIdentifier, environmentName, actual: runCase.actual ?? actual, steps: runCase.steps, runName: run.name } });
        writePendingThing(runCase.id, thingId);
        setPendingThing(thingId);
      }
      await link(thingId);
      writePendingThing(runCase.id, null);
      setPendingThing(null);
      toast.success("Thing created and linked");
    } catch (e) {
      setThingError(e instanceof QaOperationError ? e.message : e instanceof Error ? e.message : "The Thing could not be created.");
    } finally {
      setBusyThing(false);
    }
  };
  const linkExisting = async () => {
    setThingError(null);
    try {
      await link(linkChoice);
      setLinkChoice("");
      toast.success("Thing linked");
    } catch (e) {
      setThingError(e instanceof QaOperationError ? e.message : "The Thing could not be linked.");
    }
  };

  const stepsWithExpected = runCase.steps.filter((s) => s.expected);
  const linkedIds = new Set(links.map((l) => l.thingId));
  const linkable = things.filter((t) => !linkedIds.has(t.id));

  return (
    <aside aria-label={`${runCase.caseKey} result`} className="flex min-h-0 flex-1 flex-col">
      <div className="qa-exec-detail-body">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-[#6a769c]">{runCase.caseKey} · version {runCase.version}</span>
          <span className="flex items-center gap-1 text-[12.5px] text-[#6a769c]">
            <button type="button" className={iconButton} onClick={onPrev} disabled={position <= 1} aria-label="Previous case"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
            {position} of {total}
            <button type="button" className={iconButton} onClick={onNext} disabled={position >= total} aria-label="Next case"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" className={iconButton} onClick={onClose} aria-label="Close result panel"><X className="h-4 w-4" aria-hidden="true" /></button>
          </span>
        </div>
        <h3 className="m-0 text-[19px] font-semibold leading-snug">{runCase.title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[12.5px] text-[#6a769c]">
          <StatusMark status={runCase.status} /> <span>·</span> <span>{environmentName} · {buildIdentifier}{Object.values(run.config)[0] ? ` · ${Object.values(run.config).join(" · ")}` : ""}</span>
        </div>
        {run.status !== "active" && <p className="mt-2 rounded-md bg-[#fffaf0] p-2 text-[12.5px] text-[#7a5b13]">This run is {run.status}. Results are a closed record. Start a retest run to test again.</p>}
        {runCase.retestOfRunCaseId && (
          <p className="mt-2 rounded-md bg-[#f3ecfc] p-2 text-[12.5px]">Retest of an earlier failure{previousAttempt ? <>: it was <strong>{STATUS_LABEL[previousAttempt.status]}</strong>{previousAttempt.actual ? <> ({previousAttempt.actual})</> : null}. That record is kept.</> : <>. The earlier record is kept.</>}</p>
        )}

        {runCase.preconditions && <><h4 className="mb-1 mt-4 text-[13px] font-semibold">Preconditions</h4><p className="m-0 text-[13px] text-[#4a5578]">{runCase.preconditions}</p></>}
        <h4 className="mb-1.5 mt-4 text-[13px] font-semibold">Steps to reproduce</h4>
        <ol className="m-0 list-none space-y-1.5 p-0">
          {runCase.steps.map((s, i) => (
            <li key={i} className="flex gap-2.5 text-[13px]"><span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#eef0fb] text-[12px] font-medium">{i + 1}</span><span>{s.action}</span></li>
          ))}
          {runCase.steps.length === 0 && <li className="text-[#6a769c]">This case has no steps recorded.</li>}
        </ol>
        {stepsWithExpected.length > 0 && (
          <>
            <h4 className="mb-1 mt-4 text-[13px] font-semibold">Expected result</h4>
            <div className="rounded-lg bg-[#f4f5fb] px-3 py-2 text-[13px]">{stepsWithExpected.map((s, i) => <p key={i} className="m-0 py-0.5">{stepsWithExpected.length > 1 ? `${runCase.steps.indexOf(s) + 1}. ` : ""}{s.expected}</p>)}</div>
          </>
        )}

        <h4 className="mb-1 mt-4 text-[13px] font-semibold"><label htmlFor={`actual-${runCase.id}`}>Actual result{status && !requiresActual(status) ? " (optional)" : ""}</label></h4>
        <textarea
          id={`actual-${runCase.id}`}
          ref={notesRef}
          className={cn(textareaClass, status === "fail" && "bg-[#fdf2f4]")}
          style={status ? { borderColor: tone.dot } : undefined}
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          readOnly={readOnly}
          maxLength={4000}
          aria-describedby={validation ? `actual-err-${runCase.id}` : undefined}
          aria-invalid={Boolean(validation)}
        />
        {validation && <p id={`actual-err-${runCase.id}`} role="alert" className="mt-1 text-[12.5px] text-[#c42a3b]">{validation}</p>}
        {m.recordAttempt.error instanceof QaOperationError && <ErrorNotice error={m.recordAttempt.error} title="The result was not saved" />}
        {runCase.attemptedAt && <p className="mt-1 text-[12px] text-[#6a769c]">Last recorded {formatDateTime(runCase.attemptedAt)}{runCase.testerId ? ` by ${nameOf(runCase.testerId) || "a member"}` : ""}.</p>}

        <div className="mt-4"><EvidencePanel listId={listId} attemptId={runCase.attemptId} attemptIds={attemptIds} canUpload={canRecord && run.status !== "archived"} /></div>

        <section aria-label="Linked Things" className="mt-4">
          <h4 className="m-0 mb-1 text-[13px] font-semibold">Linked Thing</h4>
          {links.length === 0 && <p className="m-0 text-[12.5px] text-[#6a769c]">{hasAttempt ? "No Thing is linked to this case in this run." : "Save a result first, then link or create a Thing for it."}</p>}
          <ul className="m-0 list-none space-y-1.5 p-0">
            {links.map((l) => {
              const t = things.find((x) => x.id === l.thingId);
              return (
                <li key={l.id} className="rounded-lg border border-[#eaeffa] p-2 text-[13px]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="qa-truncate font-medium">{t?.title ?? "A linked Thing"}</div>
                      {t ? <div className="text-[12px] text-[#6a769c]">{t.ownerName} → {t.assigneeName} · {t.workStatus.replace(/_/g, " ")} · {t.acknowledgement.replace(/_/g, " ")}</div> : <div className="text-[12px] text-[#6a769c]">Details are not available to you.</div>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" className={secondaryButton} onClick={() => onOpenThing(l.thingId)}><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open</button>
                      {!readOnly && <button type="button" className={iconButton} aria-label="Unlink Thing" onClick={() => m.unlinkThing.mutate(l.id)}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {!readOnly && hasAttempt && (
            <div className="mt-2 space-y-2">
              {pendingThing && <p role="status" className="rounded-md bg-[#fffaf0] p-2 text-[12.5px] text-[#7a5b13]">A Thing was created but not linked yet. Retrying links that same Thing; no duplicate is created.</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={secondaryButton} disabled={busyThing} onClick={() => void createThing()}><Plus className="h-3.5 w-3.5" aria-hidden="true" /> {pendingThing ? "Retry linking" : "Create Thing"}</button>
                <select aria-label="Existing Thing to link" className={cn(inputClass, "h-9 w-auto min-w-[140px] flex-1")} value={linkChoice} onChange={(e) => setLinkChoice(e.target.value)}>
                  <option value="">Link existing…</option>{linkable.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
                <button type="button" className={secondaryButton} disabled={!linkChoice || m.linkThing.isPending} onClick={() => void linkExisting()}><Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Link</button>
              </div>
              <p className="m-0 text-[12px] text-[#6a769c]">Linking never changes the Thing's owner, assignee, caught state or status.</p>
            </div>
          )}
          {thingError && <p role="alert" className="mt-1 text-[12.5px] text-[#c42a3b]">{thingError}</p>}
        </section>

        <div className="mt-4">
          <button type="button" className="cursor-pointer text-[12.5px] text-[#975ee2] underline" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>Attempt history ({runCase.attemptCount})</button>
          {showHistory && (
            <ol className="m-0 mt-1.5 list-none space-y-1 p-0 text-[12.5px]">
              {(attempts.data ?? []).map((a) => <li key={a.id} className="rounded border border-[#eef0f6] p-1.5"><StatusMark status={a.status} /> <span className="text-[#6a769c]">· {formatDateTime(a.createdAt)}{a.testerId ? ` · ${nameOf(a.testerId) || "member"}` : ""}</span>{a.actual && <div className="text-[#4a5578]">{a.actual}</div>}</li>)}
              {attempts.data?.length === 0 && <li className="text-[#6a769c]">No attempts yet.</li>}
            </ol>
          )}
        </div>
      </div>

      {!readOnly && (
        <div className="qa-exec-detail-foot">
          <div className="flex flex-wrap items-center gap-2">
            <span id={`set-${runCase.id}`} className="text-[12.5px] font-medium">Set result</span>
            <div role="radiogroup" aria-labelledby={`set-${runCase.id}`} className="inline-flex overflow-hidden rounded-lg border border-[#eaeffa] bg-[#f4f5fb]">
              {CHOICES.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={status === c} onClick={() => { setStatus(c); setValidation(null); }}
                  className={cn("h-9 cursor-pointer px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2]", status === c ? "font-medium text-white" : "text-[#4a5578] hover:bg-white")}
                  style={status === c ? { background: c === "pass" ? "#1fb25a" : c === "fail" ? "#e5384a" : c === "blocked" ? "#f08a24" : "#7d8bb4" } : undefined}>
                  {STATUS_LABEL[c]}
                </button>
              ))}
            </div>
            <button type="button" className={cn(primaryButton, "ml-auto")} disabled={m.recordAttempt.isPending || !dirty} onClick={save}>{m.recordAttempt.isPending ? "Saving…" : "Save result"}</button>
          </div>
        </div>
      )}
    </aside>
  );
}
