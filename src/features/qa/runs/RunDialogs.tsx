import { useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { newIdempotencyKey } from "../domain";
import { QaOperationError } from "../qa-queries";
import { useQaMutations } from "../use-qa";
import type { QaBuild, QaRun, QaTotals } from "../types";
import { ErrorNotice, Field, inputClass, primaryButton, secondaryButton } from "../ui";

export function RetestDialog({
  listId, open, onOpenChange, run, builds, totals, onCreated,
}: {
  listId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  run: QaRun;
  builds: readonly QaBuild[];
  totals: QaTotals | undefined;
  onCreated: (run: QaRun) => void;
}) {
  const m = useQaMutations(listId);
  const candidates = builds.filter((b) => b.id !== run.buildId && b.applicationId === run.applicationId && b.environmentId === run.environmentId);
  const [buildId, setBuildId] = useState("");
  const [name, setName] = useState("");
  const key = useRef(newIdempotencyKey("retest"));
  const chosen = candidates.find((b) => b.id === (buildId || candidates[0]?.id));
  const count = (totals?.fail ?? 0) + (totals?.blocked ?? 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-qa-root="" className="max-w-md">
        <DialogHeader>
          <DialogTitle>Retest fixed build</DialogTitle>
          <DialogDescription>Starts a new run for the failed and blocked cases. The original run, its failures, evidence and Thing links stay exactly as they are.</DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p role="status" className="text-[13px]">There is no other build for this application and environment yet. Register the new build in Access, then come back. To try the same build again, record another attempt in this run.</p>
        ) : (
          <div className="space-y-3">
            <p className="m-0 text-[13px]"><strong>{count}</strong> case{count === 1 ? "" : "s"} will be retested (failed or blocked in <em>{run.name}</em>).</p>
            <Field label="Build to retest" htmlFor="retest-build"><select id="retest-build" className={inputClass} value={chosen?.id ?? ""} onChange={(e) => setBuildId(e.target.value)}>{candidates.map((b) => <option key={b.id} value={b.id}>{b.identifier}{b.displayVersion ? ` · ${b.displayVersion}` : ""}</option>)}</select></Field>
            <Field label="Run name" htmlFor="retest-name"><input id="retest-name" className={inputClass} value={name} placeholder={chosen ? `Retest on ${chosen.identifier}` : ""} onChange={(e) => setName(e.target.value)} maxLength={160} /></Field>
            {m.createRetestRun.error instanceof QaOperationError && <ErrorNotice error={m.createRetestRun.error} title="The retest was not started" />}
            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryButton} onClick={() => onOpenChange(false)}>Cancel</button>
              <button type="button" className={primaryButton} disabled={!chosen || count === 0 || m.createRetestRun.isPending}
                onClick={() => chosen && m.createRetestRun.mutate({ predecessorRunId: run.id, buildId: chosen.id, name: name.trim() || `Retest on ${chosen.identifier}`, idempotencyKey: key.current }, { onSuccess: (r) => { toast.success("Retest run started"); onOpenChange(false); onCreated(r); } })}>
                {m.createRetestRun.isPending ? "Starting…" : "Start retest"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CompleteRunDialog({
  listId, open, onOpenChange, run, totals, onCompleted,
}: {
  listId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  run: QaRun;
  totals: QaTotals | undefined;
  onCompleted: () => void;
}) {
  const m = useQaMutations(listId);
  const [blocked, setBlocked] = useState(false);
  const [notRun, setNotRun] = useState(false);
  const t = totals;
  const ready = t && (t.notRun === 0 || notRun) && (t.blocked === 0 || blocked);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-qa-root="" className="max-w-md">
        <DialogHeader>
          <DialogTitle>Complete run</DialogTitle>
          <DialogDescription>Completing closes {run.name}. Its results become a permanent record; a fix is tested in a new run.</DialogDescription>
        </DialogHeader>
        {!t ? <p className="text-[13px] text-[#6a769c]">Loading totals…</p> : (
          <div className="space-y-3">
            <dl className="m-0 grid grid-cols-3 gap-2 text-center text-[13px]">
              {([["Passed", t.pass], ["Failed", t.fail], ["Blocked", t.blocked], ["N/A", t.notApplicable], ["Not run", t.notRun], ["Total", t.total]] as const).map(([label, v]) => (
                <div key={label} className="rounded-lg border border-[#eaeffa] p-2"><dd className="m-0 text-[17px] font-semibold">{v}</dd><dt className="text-[12px] text-[#6a769c]">{label}</dt></div>
              ))}
            </dl>
            {t.notRun > 0 && <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-0.5" checked={notRun} onChange={(e) => setNotRun(e.target.checked)} /> <span>{t.notRun} case{t.notRun === 1 ? " has" : "s have"} not been run. Complete anyway and record them as not run.</span></label>}
            {t.blocked > 0 && <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-0.5" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} /> <span>{t.blocked} case{t.blocked === 1 ? " is" : "s are"} blocked. Accept them as unresolved.</span></label>}
            {t.fail > 0 && <p className="m-0 text-[12.5px] text-[#6a769c]">Failed cases stay failed in this record. Completing does not change any linked Thing.</p>}
            {m.completeRun.error instanceof QaOperationError && <ErrorNotice error={m.completeRun.error} title="The run was not completed" />}
            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryButton} onClick={() => onOpenChange(false)}>Cancel</button>
              <button type="button" className={primaryButton} disabled={!ready || m.completeRun.isPending} onClick={() => m.completeRun.mutate({ runId: run.id, blocked, notRun }, { onSuccess: () => { toast.success("Run completed"); onOpenChange(false); onCompleted(); } })}>
                {m.completeRun.isPending ? "Completing…" : "Complete run"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
