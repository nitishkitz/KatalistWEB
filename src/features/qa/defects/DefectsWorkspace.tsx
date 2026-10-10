import { useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { useQaBuilds, useQaRuns, useQaThingLinks } from "../use-qa";
import type { QaRun, QaThingLink, QaThingSummary } from "../types";
import { EmptyNotice, ErrorNotice, Spinner, formatDateTime, inputClass, secondaryButton } from "../ui";
import { useQaAccess } from "../use-qa";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { QA_SCOPE_LIMIT, qaKeys } from "../qa-queries";
import { STATUS_LABEL } from "../domain";

/**
 * Defects: every Thing linked from QA results, grouped by Thing, with the affected cases and their
 * latest results. Owner, assignee, acknowledgement and work status are the Thing's own real values from
 * the List; QA only reads them and never changes them.
 */
export function DefectsWorkspace({
  listId, things, onOpenThing, onOpenResult,
}: {
  listId: string;
  things: readonly QaThingSummary[];
  onOpenThing: (thingId: string) => void;
  onOpenResult: (runId: string, runCaseId: string) => void;
}) {
  const links = useQaThingLinks(listId);
  const runs = useQaRuns(listId);
  const builds = useQaBuilds(listId, {});
  const { api } = useQaAccess(listId);
  const [search, setSearch] = useState("");

  const linkRows = useMemo(() => links.data ?? [], [links.data]);
  const runCaseIds = useMemo(() => [...new Set(linkRows.map((l) => l.runCaseId))].sort(), [linkRows]);
  // The affected run cases (latest result per case) for the linked defects, read through the same RLS view as the grid.
  const affected = useQuery({
    queryKey: [...qaKeys.list(listId), "defect-run-cases", ...runCaseIds],
    enabled: runCaseIds.length > 0,
    staleTime: 5_000,
    queryFn: () => api.listRunCasesByIds(listId, runCaseIds.slice(0, QA_SCOPE_LIMIT)),
  });

  const groups = useMemo(() => {
    const byThing = new Map<string, QaThingLink[]>();
    for (const l of linkRows) byThing.set(l.thingId, [...(byThing.get(l.thingId) ?? []), l]);
    const t = search.trim().toLowerCase();
    return [...byThing.entries()]
      .map(([thingId, ls]) => ({ thingId, ls, thing: things.find((x) => x.id === thingId) }))
      .filter((g) => !t || (g.thing?.title ?? "").toLowerCase().includes(t));
  }, [linkRows, things, search]);

  if (links.isLoading || runs.isLoading) return <Spinner label="Loading defects…" />;
  if (links.error) return <ErrorNotice error={links.error} onRetry={() => void links.refetch()} />;
  const runById = (id: string): QaRun | undefined => runs.items.find((r) => r.id === id);
  const buildName = (run?: QaRun) => builds.data?.find((b) => b.id === run?.buildId)?.identifier ?? "";

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="m-0 text-[20px] font-semibold">Defects</h2><p className="mt-0.5 text-[13px] text-[#6a769c]">Things linked from failed or blocked results. Work on them continues in the existing Thing workflow.</p></div>
        <div className="relative w-64 max-w-full"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#9aa3c0]" aria-hidden="true" /><input aria-label="Search defects" className={cn(inputClass, "pl-8")} placeholder="Search defects…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>
      {groups.length === 0 ? (
        <EmptyNotice title={search ? "No defects match that search" : "No defects linked yet"} body={search ? undefined : "When a result fails, create or link a Thing from the result panel in Runs. It will appear here with the cases it affects."} />
      ) : (
        <div className="qa-scroll rounded-lg border border-[#eaeffa]">
          <table className="qa-table" aria-label="Defects">
            <thead><tr><th scope="col">Thing</th><th scope="col">Owner → assignee</th><th scope="col">Status</th><th scope="col">Affected cases</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.thingId}>
                  <td className="qa-cell-wrap font-medium">{g.thing?.title ?? <span className="text-[#6a769c]">Not visible to you</span>}</td>
                  <td className="text-[#4a5578]">{g.thing ? `${g.thing.ownerName} → ${g.thing.assigneeName}` : "–"}</td>
                  <td className="capitalize text-[#4a5578]">{g.thing ? <>{g.thing.workStatus.replace(/_/g, " ")}<span className="block text-[12px] text-[#6a769c]">{g.thing.acknowledgement.replace(/_/g, " ")}</span></> : "–"}</td>
                  <td className="qa-cell-wrap">
                    <ul className="m-0 list-none space-y-1 p-0">
                      {g.ls.map((l) => {
                        const rc = affected.data?.find((r) => r.id === l.runCaseId);
                        const run = runById(rc?.runId ?? "");
                        return (
                          <li key={l.id} className="text-[13px]">
                            <button type="button" className="cursor-pointer text-left text-[#975ee2] hover:underline" disabled={!rc} onClick={() => rc && onOpenResult(rc.runId, rc.id)}>{rc ? `${rc.caseKey} ${rc.title}` : "Loading case…"}</button>
                            {rc && <span className="text-[12px] text-[#6a769c]"> · {STATUS_LABEL[rc.status]} · {run?.name}{buildName(run) ? ` · ${buildName(run)}` : ""} · linked {formatDateTime(l.createdAt)}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </td>
                  <td><button type="button" className={secondaryButton} disabled={!g.thing} onClick={() => onOpenThing(g.thingId)}><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open Thing</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {affected.error && <p role="alert" className="mt-2 text-[12.5px] text-[#c42a3b]">Affected cases could not be loaded.</p>}
    </div>
  );
}
