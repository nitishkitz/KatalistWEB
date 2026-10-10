import { useEffect, useMemo, useState } from "react";
import { Columns3, Download, Plus, RotateCcw, Search, User } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { collectAll } from "../api";
import { downloadTable } from "../download";
import { runCasesToRows, newIdempotencyKey, STATUS_LABEL } from "../domain";
import { QA_EXPORT_CHUNK, QA_EXPORT_MAX_ROWS, QaOperationError } from "../qa-queries";
import { useQaAccess, useQaBuilds, useQaMutations, useQaRun, useQaRunCases, useQaRuns, useQaThingLinks, useQaTotals } from "../use-qa";
import { DEFAULT_RUN_FILTER, RESULT_STATUSES, type QaApplication, type QaEnvironment, type QaMember, type QaResultStatus, type QaRunCase, type QaRunFilter, type QaThingSummary } from "../types";
import { EmptyNotice, ErrorNotice, Spinner, inputClass, primaryButton, secondaryButton } from "../ui";
import { ExecutionGrid, type GridColumns } from "./ExecutionGrid";
import { RunFormPanel } from "./RunFormPanel";
import { CompleteRunDialog, RetestDialog } from "./RunDialogs";
import { ResultDetailPanel } from "./ResultDetailPanel";
import { StatusMark } from "../ui";

export function RunsWorkspace({
  listId, canManage, profileId, members, things, apps, envs, listContext, scope, runId, onRunChange, caseId: _caseId,
  newRunRequest, onNewRunHandled, openRunCaseId, onRunCaseChange, onOpenThing, onViewDefects, onDirtyChange,
}: {
  listId: string;
  canManage: boolean;
  profileId: string | undefined;
  members: readonly QaMember[];
  things: readonly QaThingSummary[];
  apps: readonly QaApplication[];
  envs: readonly QaEnvironment[];
  listContext: "work" | "home";
  scope: { applicationId: string; environmentId: string } | null;
  runId: string | null;
  onRunChange: (id: string | null) => void;
  caseId?: string | null;
  /** Cases chosen in the library for a new run, or an empty list to open the form with none chosen. */
  newRunRequest: readonly string[] | null;
  onNewRunHandled: () => void;
  openRunCaseId: string | null;
  onRunCaseChange: (id: string | null) => void;
  onOpenThing: (thingId: string, runCaseId: string | null) => void;
  onViewDefects: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { api, preview } = useQaAccess(listId);
  const m = useQaMutations(listId);
  const runs = useQaRuns(listId);
  const builds = useQaBuilds(listId, {});
  const [filter, setFilter] = useState<QaRunFilter>(DEFAULT_RUN_FILTER);
  const [searchText, setSearchText] = useState("");
  const [columns, setColumns] = useState<GridColumns>({ module: true, assignee: true, thing: true, version: false });
  const [panel, setPanel] = useState<{ preselected: readonly string[] } | null>(null);
  const [retestOpen, setRetestOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [preset, setPreset] = useState<{ id: string; status: "fail" | "blocked" } | null>(null);
  const [detailDirty, setDetailDirty] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [exportStatus, setExportStatus] = useState("");

  useEffect(() => onDirtyChange(detailDirty || (panel !== null && formDirty)), [detailDirty, formDirty, panel, onDirtyChange]);
  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => (f.search === searchText ? f : { ...f, search: searchText })), 250);
    return () => clearTimeout(t);
  }, [searchText]);
  useEffect(() => {
    if (newRunRequest) { setPanel({ preselected: newRunRequest }); onNewRunHandled(); }
  }, [newRunRequest, onNewRunHandled]);

  // Default to the newest run when none is chosen (or the chosen one disappeared).
  useEffect(() => {
    if (!runs.hasFetchedOnce) return;
    if (runId && runs.items.some((r) => r.id === runId)) return;
    if (!runId || runs.items.length > 0) onRunChange(runs.items[0]?.id ?? null);
  }, [runs.hasFetchedOnce, runs.items, runId, onRunChange]);

  const run = useQaRun(listId, runId);
  const activeRun = run.data ?? runs.items.find((r) => r.id === runId) ?? null;
  const rowsQuery = useQaRunCases(listId, runId, filter);
  const totals = useQaTotals(listId, runId);
  const links = useQaThingLinks(listId);
  const rows = rowsQuery.items;
  const build = builds.data?.find((b) => b.id === activeRun?.buildId);
  const app = apps.find((a) => a.id === activeRun?.applicationId);
  const env = envs.find((e) => e.id === activeRun?.environmentId);
  const open = rows.find((r) => r.id === openRunCaseId) ?? null;
  const openIndex = open ? rows.findIndex((r) => r.id === open.id) : -1;
  const canRecord = canManage && activeRun?.status === "active";
  const recordedFor = (r: QaRunCase) => r.status;
  void recordedFor;

  const quick = (id: string, status: "pass" | "not_applicable") =>
    m.recordAttempt.mutate({ runCaseId: id, status, actual: "", idempotencyKey: newIdempotencyKey("att") }, { onError: (e) => toast.error(e instanceof QaOperationError ? e.message : "That result was not saved.") });

  const exportResults = async (format: "csv" | "xlsx") => {
    if (!runId || !activeRun) return;
    try {
      setExportStatus("Preparing export…");
      const { items, truncated } = await collectAll<QaRunCase, { position: number }>((c) => api.listRunCases(listId, runId, DEFAULT_RUN_FILTER, c, QA_EXPORT_CHUNK), QA_EXPORT_MAX_ROWS);
      downloadTable(`${activeRun.name}-results`, "Results", runCasesToRows(items), format);
      setExportStatus(`Exported ${items.length} result${items.length === 1 ? "" : "s"}${truncated ? ` (stopped at ${QA_EXPORT_MAX_ROWS})` : ""}.`);
    } catch (e) {
      toast.error(e instanceof QaOperationError ? e.message : "The export failed.");
    }
  };

  const t = totals.data;
  const detail = useMemo(() => open, [open]);

  if (runs.isLoading) return <Spinner label="Loading runs…" />;
  if (runs.error && !runs.hasFetchedOnce) return <ErrorNotice error={runs.error} onRetry={() => void runs.refetch()} />;

  const newRunButton = canManage ? <button type="button" className={primaryButton} onClick={() => setPanel({ preselected: [] })}><Plus className="h-4 w-4" aria-hidden="true" /> New run</button> : null;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#eef0f6] px-4 py-3">
        <div className="min-w-0">
          {runs.items.length > 0 ? (
            <>
              <label className="sr-only" htmlFor="qa-run-select">Run</label>
              <select id="qa-run-select" className="m-0 max-w-full cursor-pointer rounded-md border-0 bg-transparent py-0 pl-0 pr-6 text-[20px] font-semibold text-[#000533] outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2]" value={runId ?? ""} onChange={(e) => { onRunChange(e.target.value || null); onRunCaseChange(null); }}>
                {runs.items.map((r) => <option key={r.id} value={r.id}>{r.name}{r.status !== "active" ? ` (${r.status})` : ""}</option>)}
              </select>
              <div className="text-[13px] text-[#6a769c]">
                {[env?.name, app?.name.replace(" application", ""), build?.identifier, activeRun?.config ? Object.values(activeRun.config)[0] : null].filter(Boolean).join(" • ")}
                {activeRun?.status !== "active" && activeRun && <span className="ml-2 rounded-full bg-[#eef0fb] px-2 py-0.5 text-[12px] font-medium capitalize text-[#4a5578]">{activeRun.status}</span>}
                {activeRun?.predecessorRunId && <span className="ml-2 text-[#975ee2]">Retest of {runs.items.find((r) => r.id === activeRun.predecessorRunId)?.name ?? "an earlier run"}</span>}
              </div>
            </>
          ) : (
            <h2 className="m-0 text-[20px] font-semibold">Runs</h2>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeRun && (t?.fail ?? 0) + (t?.blocked ?? 0) > 0 && canManage && <button type="button" className={secondaryButton} onClick={() => setRetestOpen(true)}><RotateCcw className="h-4 w-4" aria-hidden="true" /> Retest</button>}
          {activeRun?.status === "active" && canManage && <button type="button" className={secondaryButton} onClick={() => setCompleteOpen(true)}>Complete run</button>}
          {activeRun && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button type="button" className={secondaryButton}><Download className="h-4 w-4" aria-hidden="true" /> Export</button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void exportResults("csv")}>Results · CSV</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportResults("xlsx")}>Results · Excel (.xlsx)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {newRunButton}
        </div>
      </div>

      {runs.items.length === 0 && !panel ? (
        <EmptyNotice title="No runs yet" body={canManage ? "A run tests a chosen set of cases against one build. Create one from the cases in your Test Sheet." : "A List owner or collaborator can start a run."} action={newRunButton ?? undefined} />
      ) : (
        <div className="qa-exec" data-detail={panel || detail ? "open" : "closed"}>
          <div className="qa-exec-main min-w-0">
            {activeRun && (
              <div className="flex flex-wrap items-center gap-2 border-b border-[#eef0f6] px-4 py-2.5">
                <div className="relative min-w-[200px] flex-1 basis-56">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#9aa3c0]" aria-hidden="true" />
                  <input aria-label="Search test cases in this run" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search test cases…" className={cn(inputClass, "pl-8")} />
                </div>
                <select aria-label="Result" className={cn(inputClass, "w-auto")} value={filter.result} onChange={(e) => setFilter({ ...filter, result: e.target.value as QaRunFilter["result"] })}>
                  <option value="all">All results</option>{RESULT_STATUSES.map((s: QaResultStatus) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
                <button type="button" aria-pressed={filter.assignee !== "all"} disabled={!profileId} className={cn(secondaryButton, filter.assignee !== "all" && "border-[#975ee2] bg-[#f3ecfc] text-[#975ee2]")} onClick={() => setFilter({ ...filter, assignee: filter.assignee === "all" ? (profileId ?? "all") : "all" })}><User className="h-4 w-4" aria-hidden="true" /> Assigned to me</button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><button type="button" className={secondaryButton}><Columns3 className="h-4 w-4" aria-hidden="true" /> Columns</button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                    {(["module", "version", "assignee", "thing"] as const).map((k) => <DropdownMenuCheckboxItem key={k} checked={columns[k]} onCheckedChange={(v) => setColumns((c) => ({ ...c, [k]: Boolean(v) }))} onSelect={(e) => e.preventDefault()}>{{ module: "Module", version: "Case version", assignee: "Assigned", thing: "Linked Thing" }[k]}</DropdownMenuCheckboxItem>)}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
            {rowsQuery.isLoading ? <Spinner label="Loading results…" /> : rowsQuery.error && !rowsQuery.hasFetchedOnce ? <ErrorNotice error={rowsQuery.error} onRetry={() => void rowsQuery.refetch()} /> : rows.length === 0 ? (
              <EmptyNotice title={filter.result !== "all" || filter.search || filter.assignee !== "all" ? "No cases match these filters" : "This run has no cases"} body={filter.result !== "all" || filter.search || filter.assignee !== "all" ? "Clear a filter to see every case." : undefined} action={filter.result !== "all" || filter.search || filter.assignee !== "all" ? <button type="button" className={secondaryButton} onClick={() => { setFilter(DEFAULT_RUN_FILTER); setSearchText(""); }}>Clear filters</button> : undefined} />
            ) : (
              <ExecutionGrid
                rows={rows} activeId={openRunCaseId} focusId={focusId} onFocusId={setFocusId} canRecord={canRecord} columns={columns} members={members} links={links.data ?? []} things={things}
                onOpen={(id, p) => { setPanel(null); onRunCaseChange(id); setPreset(p ? { id, status: p } : null); }} onQuick={quick} onOpenThing={(thingId) => onOpenThing(thingId, openRunCaseId)}
              />
            )}
            {activeRun && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[#eef0f6] px-4 py-2.5 text-[13px]" aria-live="polite" data-testid="run-totals">
                <span className="text-[#6a769c]">{t?.total ?? rows.length} test case{(t?.total ?? rows.length) === 1 ? "" : "s"}</span>
                {t && (
                  <>
                    <StatusMark status="pass" className="text-[13px]" /><span className="-ml-3">{t.pass}</span>
                    <StatusMark status="fail" /><span className="-ml-3">{t.fail}</span>
                    <StatusMark status="blocked" /><span className="-ml-3">{t.blocked}</span>
                    <StatusMark status="not_applicable" /><span className="-ml-3">{t.notApplicable}</span>
                    <StatusMark status="not_run" /><span className="-ml-3">{t.notRun}</span>
                  </>
                )}
                {rowsQuery.hasNextPage && <button type="button" className={cn(secondaryButton, "ml-auto")} disabled={rowsQuery.isFetchingNextPage} onClick={() => void rowsQuery.fetchNextPage()}>{rowsQuery.isFetchingNextPage ? "Loading…" : "Load more cases"}</button>}
                {exportStatus && <span role="status" className="text-[#6a769c]">{exportStatus}</span>}
                {totals.error && <span role="alert" className="text-[#c42a3b]">Totals could not be refreshed.</span>}
              </div>
            )}
            {activeRun?.status === "completed" && activeRun.summary && (
              <div role="status" className="border-t border-[#eef0f6] bg-[#f4fbf6] px-4 py-2 text-[12.5px] text-[#16803f]">
                Completed. {activeRun.summary.pass} passed, {activeRun.summary.fail} failed, {activeRun.summary.blocked} blocked, {activeRun.summary.notApplicable} not applicable, {activeRun.summary.notRun} not run.
                {" "}<button type="button" className="cursor-pointer text-[#975ee2] underline" onClick={onViewDefects}>View linked Things</button>
              </div>
            )}
          </div>

          {panel ? (
            <div className="qa-exec-detail" style={{ maxHeight: 820, overflowY: "auto" }}>
              <RunFormPanel
                listId={listId} apps={apps} envs={envs} members={members} defaultScope={scope} preselected={panel.preselected}
                onCancel={() => { setPanel(null); setFormDirty(false); }}
                onCreated={(created) => { setPanel(null); setFormDirty(false); onRunChange(created.id); onRunCaseChange(null); }}
                onDirtyChange={setFormDirty}
              />
            </div>
          ) : detail && activeRun ? (
            <div className="qa-exec-detail">
              <ResultDetailPanel
                key={detail.id + (preset?.id === detail.id ? preset.status : "")}
                listId={listId} run={activeRun} runCase={detail} position={openIndex + 1} total={rows.length} canRecord={canManage}
                buildIdentifier={build?.identifier ?? ""} environmentName={env?.name ?? ""} links={(links.data ?? []).filter((l) => l.runCaseId === detail.id)} things={things}
                listContext={listContext} preview={preview} members={members} preset={preset?.id === detail.id ? preset.status : undefined}
                onPrev={() => rows[openIndex - 1] && onRunCaseChange(rows[openIndex - 1].id)} onNext={() => rows[openIndex + 1] && onRunCaseChange(rows[openIndex + 1].id)}
                onClose={() => { onRunCaseChange(null); setPreset(null); setDetailDirty(false); if (openRunCaseId) setFocusId(openRunCaseId); }}
                onOpenThing={(thingId) => onOpenThing(thingId, detail.id)} onDirtyChange={setDetailDirty}
              />
            </div>
          ) : null}
        </div>
      )}

      {activeRun && <RetestDialog listId={listId} open={retestOpen} onOpenChange={setRetestOpen} run={activeRun} builds={builds.data ?? []} totals={t} onCreated={(r) => { onRunChange(r.id); onRunCaseChange(null); }} />}
      {activeRun && <CompleteRunDialog key={activeRun.id} listId={listId} open={completeOpen} onOpenChange={setCompleteOpen} run={activeRun} totals={t} onCompleted={() => void run.refetch()} />}
    </div>
  );
}
