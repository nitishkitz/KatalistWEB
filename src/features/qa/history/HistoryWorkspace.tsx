import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQaApplications, useQaEnvironments, useQaEvidence, useQaEvidenceUrls, useQaHistory, useQaThingLinks } from "../use-qa";
import { DEFAULT_HISTORY_FILTER, type QaHistoryFilter, type QaHistoryItem, type QaMember, type QaThingSummary } from "../types";
import { STATUS_LABEL } from "../domain";
import { EmptyNotice, ErrorNotice, Spinner, StatusMark, formatDateTime, inputClass, secondaryButton } from "../ui";

function HistoryDetail({ listId, item, things, onOpenThing }: { listId: string; item: QaHistoryItem; things: readonly QaThingSummary[]; onOpenThing: (id: string) => void }) {
  const evidence = useQaEvidence(listId, [item.id]);
  const ready = (evidence.data ?? []).filter((e) => e.status === "ready");
  const urls = useQaEvidenceUrls(listId, ready.map((e) => e.id));
  const links = useQaThingLinks(listId);
  const mine = (links.data ?? []).filter((l) => l.runCaseId === item.runCaseId);
  return (
    <div className="space-y-2 bg-[#fafaff] px-4 py-3 text-[13px]">
      {item.actual ? <p className="m-0"><strong>Notes:</strong> {item.actual}</p> : <p className="m-0 text-[#6a769c]">No notes were recorded.</p>}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-[#6a769c]">
        <span>Run: {item.runName} ({item.runStatus})</span>
        <span>Case version: v{item.caseVersion}</span>
        {Object.keys(item.runConfig).length > 0 && <span>Configuration: {Object.entries(item.runConfig).map(([k, v]) => `${k} ${v}`).join(", ")}</span>}
        {item.previousAttemptId && <span>Replaced an earlier attempt of this case in the same run</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {ready.map((e) => {
          const url = urls.data?.[e.id];
          return url ? (e.mimeType.startsWith("image/") ? <a key={e.id} href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={`Evidence ${e.fileName}`} className="h-16 w-24 rounded border border-[#eaeffa] object-cover" /></a> : <a key={e.id} className="text-[#975ee2] underline" href={url} target="_blank" rel="noopener noreferrer">{e.fileName}</a>) : <span key={e.id} className="text-[#6a769c]">{e.fileName}</span>;
        })}
        {evidence.isLoading && <span className="text-[#6a769c]">Loading evidence…</span>}
        {!evidence.isLoading && ready.length === 0 && <span className="text-[#6a769c]">No evidence attached.</span>}
      </div>
      {mine.map((l) => (
        <div key={l.id}><button type="button" className={secondaryButton} onClick={() => onOpenThing(l.thingId)}><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> {things.find((t) => t.id === l.thingId)?.title ?? "Open linked Thing"}</button></div>
      ))}
    </div>
  );
}

/** Paginated attempt timeline. Every row is one append-only attempt with the context it ran in. */
export function HistoryWorkspace({
  listId, members, things, initialCaseKey, onOpenThing,
}: {
  listId: string;
  members: readonly QaMember[];
  things: readonly QaThingSummary[];
  initialCaseKey?: string;
  onOpenThing: (thingId: string) => void;
}) {
  const [filter, setFilter] = useState<QaHistoryFilter>({ ...DEFAULT_HISTORY_FILTER, caseKey: initialCaseKey ?? "" });
  const [caseKeyText, setCaseKeyText] = useState(initialCaseKey ?? "");
  const [expanded, setExpanded] = useState<string | null>(null);
  const history = useQaHistory(listId, filter);
  const apps = useQaApplications(listId);
  const envs = useQaEnvironments(listId);
  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => (f.caseKey === caseKeyText ? f : { ...f, caseKey: caseKeyText })), 300);
    return () => clearTimeout(t);
  }, [caseKeyText]);
  const nameOf = (id: string | null) => members.find((m) => m.profileId === id)?.name ?? "";

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#eef0f6] px-4 py-3">
        <div><h2 className="m-0 text-[20px] font-semibold">Execution history</h2><p className="mt-0.5 text-[13px] text-[#6a769c]">Who tested what, on which build and where. Earlier failures are never overwritten.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Filter by case ID" className={cn(inputClass, "w-32")} placeholder="Case, e.g. TC-002" value={caseKeyText} onChange={(e) => setCaseKeyText(e.target.value)} maxLength={20} />
          <input aria-label="Filter by build" className={cn(inputClass, "w-32")} placeholder="Build" value={filter.buildIdentifier} onChange={(e) => setFilter({ ...filter, buildIdentifier: e.target.value })} maxLength={40} />
          <select aria-label="Application" className={cn(inputClass, "w-auto")} value={filter.applicationId} onChange={(e) => setFilter({ ...filter, applicationId: e.target.value })}><option value="all">All applications</option>{apps.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select aria-label="Environment" className={cn(inputClass, "w-auto")} value={filter.environmentId} onChange={(e) => setFilter({ ...filter, environmentId: e.target.value })}><option value="all">All environments</option>{envs.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <select aria-label="Result" className={cn(inputClass, "w-auto")} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as QaHistoryFilter["status"] })}><option value="all">All results</option>{(["pass", "fail", "blocked", "not_applicable"] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
        </div>
      </div>
      {history.isLoading ? <Spinner label="Loading history…" /> : history.error && !history.hasFetchedOnce ? <ErrorNotice error={history.error} onRetry={() => void history.refetch()} /> : history.items.length === 0 ? (
        <EmptyNotice title="No attempts recorded" body={filter === DEFAULT_HISTORY_FILTER || (!filter.caseKey && !filter.buildIdentifier && filter.status === "all" && filter.applicationId === "all" && filter.environmentId === "all") ? "Results appear here as soon as someone records one in a run." : "No attempts match these filters."} />
      ) : (
        <div className="qa-scroll">
          <table className="qa-table" aria-label="Execution history" style={{ minWidth: 860 }}>
            <thead><tr><th scope="col" style={{ width: 36 }}><span className="sr-only">Details</span></th><th scope="col">Case</th><th scope="col">Result</th><th scope="col">Application · Environment</th><th scope="col">Build</th><th scope="col">Tester</th><th scope="col">When</th><th scope="col">Evidence</th><th scope="col">Thing</th></tr></thead>
            <tbody>
              {history.items.map((h) => (
                <FragmentRow key={h.id} item={h} open={expanded === h.id} onToggle={() => setExpanded(expanded === h.id ? null : h.id)} tester={nameOf(h.testerId)} listId={listId} things={things} onOpenThing={onOpenThing} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-[#eef0f6] px-4 py-2 text-[12.5px] text-[#6a769c]">
        <span>{history.items.length} attempt{history.items.length === 1 ? "" : "s"} loaded{history.hasNextPage ? " (more available)" : ""}</span>
        {history.hasNextPage && <button type="button" className={secondaryButton} disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? "Loading…" : "Load older attempts"}</button>}
        {history.isFetchNextPageError && <span role="alert" className="text-[#c42a3b]">Older attempts could not be loaded.</span>}
      </div>
    </div>
  );
}

function FragmentRow({ item, open, onToggle, tester, listId, things, onOpenThing }: { item: QaHistoryItem; open: boolean; onToggle: () => void; tester: string; listId: string; things: readonly QaThingSummary[]; onOpenThing: (id: string) => void }) {
  return (
    <>
      <tr>
        <td><button type="button" className="cursor-pointer text-[#6a769c]" onClick={onToggle} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} details for ${item.caseKey} attempt`}>{open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}</button></td>
        <td className="qa-cell-wrap"><span className="text-[#975ee2]">{item.caseKey}</span> {item.caseTitle}</td>
        <td><StatusMark status={item.status} /></td>
        <td>{item.applicationName} · {item.environmentName}</td>
        <td>{item.buildIdentifier}</td>
        <td>{tester || <span className="text-[#9aa3c0]">–</span>}</td>
        <td className="whitespace-nowrap text-[#4a5578]">{formatDateTime(item.createdAt)}</td>
        <td>{item.evidenceCount > 0 ? `${item.evidenceCount} file${item.evidenceCount === 1 ? "" : "s"}` : <span className="text-[#9aa3c0]">–</span>}</td>
        <td>{item.linkCount > 0 ? `${item.linkCount} linked` : <span className="text-[#9aa3c0]">–</span>}</td>
      </tr>
      {open && <tr><td colSpan={9} style={{ padding: 0 }}><HistoryDetail listId={listId} item={item} things={things} onOpenThing={onOpenThing} /></td></tr>}
    </>
  );
}
