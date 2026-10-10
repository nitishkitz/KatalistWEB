import { useEffect, useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { QaMember, QaRunCase, QaThingLink, QaThingSummary } from "../types";
import { StatusMark } from "../ui";

export type GridColumns = { module: boolean; assignee: boolean; thing: boolean; version: boolean };

/**
 * Execution grid. Rows are the focus unit (roving tabindex): Arrow Up/Down move, Enter or Space opens
 * the result detail, and on an active run P records Pass and A records N/A immediately, while F and B
 * open the detail pre-set to Fail or Blocked because those need a note.
 */
export function ExecutionGrid({
  rows, activeId, focusId, onFocusId, onOpen, onQuick, canRecord, columns, members, links, things, onOpenThing,
}: {
  rows: readonly QaRunCase[];
  activeId: string | null;
  focusId: string | null;
  onFocusId: (id: string) => void;
  onOpen: (id: string, preset?: "fail" | "blocked") => void;
  onQuick: (id: string, status: "pass" | "not_applicable") => void;
  canRecord: boolean;
  columns: GridColumns;
  members: readonly QaMember[];
  links: readonly QaThingLink[];
  things: readonly QaThingSummary[];
  onOpenThing: (thingId: string) => void;
}) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const tabStop = focusId && rows.some((r) => r.id === focusId) ? focusId : rows[0]?.id;
  const nameOf = (id: string | null) => members.find((m) => m.profileId === id)?.name ?? "";

  // Keep real DOM focus on the focused row after a re-render (selection moves, saves, refetches).
  useEffect(() => {
    if (!focusId) return;
    const el = bodyRef.current?.querySelector<HTMLElement>(`tr[data-row-id="${focusId}"]`);
    if (el && document.activeElement && bodyRef.current?.contains(document.activeElement) && document.activeElement !== el) el.focus();
  }, [focusId]);

  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, index: number, row: QaRunCase) => {
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea") && e.target !== e.currentTarget) return;
    const go = (i: number) => {
      const next = rows[Math.min(rows.length - 1, Math.max(0, i))];
      if (!next) return;
      e.preventDefault();
      onFocusId(next.id);
      bodyRef.current?.querySelector<HTMLElement>(`tr[data-row-id="${next.id}"]`)?.focus();
    };
    if (e.key === "ArrowDown") go(index + 1);
    else if (e.key === "ArrowUp") go(index - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(rows.length - 1);
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(row.id); }
    else if (canRecord && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "p") { e.preventDefault(); onQuick(row.id, "pass"); }
      else if (k === "a") { e.preventDefault(); onQuick(row.id, "not_applicable"); }
      else if (k === "f") { e.preventDefault(); onOpen(row.id, "fail"); }
      else if (k === "b") { e.preventDefault(); onOpen(row.id, "blocked"); }
    }
  };

  return (
    <div className="qa-scroll">
      <table className="qa-table" role="grid" aria-label="Test run results" aria-rowcount={rows.length + 1} data-testid="run-grid">
        <thead>
          <tr role="row">
            <th scope="col" style={{ width: 52 }}>#</th>
            <th scope="col">ID</th>
            <th scope="col">Test case</th>
            {columns.module && <th scope="col">Module</th>}
            {columns.version && <th scope="col">Version</th>}
            <th scope="col">Result</th>
            {columns.assignee && <th scope="col">Assigned</th>}
            {columns.thing && <th scope="col">Linked Thing</th>}
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {rows.map((r, i) => {
            const rowLinks = links.filter((l) => l.runCaseId === r.id);
            return (
              <tr
                key={r.id}
                role="row"
                data-row-id={r.id}
                data-selected={r.id === activeId}
                tabIndex={r.id === tabStop ? 0 : -1}
                aria-selected={r.id === activeId}
                aria-rowindex={i + 2}
                onFocus={() => onFocusId(r.id)}
                onKeyDown={(e) => onKey(e, i, r)}
                onClick={(e) => { if (!(e.target as HTMLElement).closest("a, button")) onOpen(r.id); }}
                className="cursor-pointer outline-none focus-visible:[&>td:nth-child(n)]:bg-[#f7f3fd]"
              >
                <td role="gridcell" className="text-[#6a769c]">{r.position}</td>
                <td role="gridcell"><span className="text-[#975ee2]">{r.caseKey}</span></td>
                <td role="gridcell" className="qa-cell-wrap">{r.title}</td>
                {columns.module && <td role="gridcell" className="text-[#6a769c]">{r.module}</td>}
                {columns.version && <td role="gridcell" className="text-[#6a769c]">v{r.version}</td>}
                <td role="gridcell" data-cell="result" className={cn(r.id === activeId && "outline outline-2 -outline-offset-2 outline-[#975ee2]")}>
                  <StatusMark status={r.status} />
                  {r.attemptCount > 1 && <span className="ml-1.5 text-[12px] text-[#6a769c]" title={`${r.attemptCount} attempts`}>×{r.attemptCount}</span>}
                </td>
                {columns.assignee && <td role="gridcell" className="text-[#6a769c]">{nameOf(r.assigneeId) || "–"}</td>}
                {columns.thing && (
                  <td role="gridcell">
                    {rowLinks.length === 0 ? <span className="text-[#9aa3c0]">–</span> : rowLinks.map((l) => {
                      const t = things.find((x) => x.id === l.thingId);
                      return <button key={l.id} type="button" className="mr-1 inline-block max-w-[160px] cursor-pointer truncate text-left text-[#975ee2] hover:underline" onClick={() => onOpenThing(l.thingId)} title={t?.title}>{t?.title ?? "Linked Thing"}</button>;
                    })}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
