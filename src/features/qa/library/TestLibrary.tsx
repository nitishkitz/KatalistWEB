import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type VisibilityState } from "@tanstack/react-table";
import { toast } from "sonner";
import { Columns3, Download, Plus, Search, Upload } from "lucide-react";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { collectAll } from "../api";
import { QA_EXPORT_CHUNK, QA_EXPORT_MAX_ROWS, QaOperationError } from "../qa-queries";
import { useQaAccess, useQaCases, useQaMutations, useQaSavedViews } from "../use-qa";
import { caseWithPatch, casesToRows, planPaste, type PastePlan, type PasteTarget } from "../domain";
import { downloadTable, type ExportFormat } from "../download";
import { DEFAULT_CASE_FILTER, PLATFORM_KINDS, PLATFORM_LABEL, PRIORITIES, type ImportRow, type QaCase, type QaCaseFilter } from "../types";
import { EmptyNotice, ErrorNotice, Spinner, formatDateTime, inputClass, primaryButton, secondaryButton } from "../ui";
import { CaseDetailPanel } from "./CaseDetailPanel";
import { ImportReview } from "./ImportReview";

const EDIT_COLS: readonly PasteTarget[] = ["title", "module", "priority"];
const COLUMN_LABEL: Record<string, string> = { module: "Module", priority: "Priority", platforms: "Platforms", version: "Version", updatedAt: "Updated" };
const DEFAULT_VISIBILITY: VisibilityState = { module: true, priority: true, platforms: true, version: false, updatedAt: false };
const PRIORITY_TONE: Record<string, string> = { critical: "#c42a3b", high: "#c42a3b", medium: "#b85f0a", low: "#6a769c" };

export function TestLibrary({
  listId, canManage, onCreateRun, onDirtyChange,
}: {
  listId: string;
  canManage: boolean;
  onCreateRun: (caseIds: string[]) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { api } = useQaAccess(listId);
  const m = useQaMutations(listId);
  const [filter, setFilter] = useState<QaCaseFilter>(DEFAULT_CASE_FILTER);
  const [searchText, setSearchText] = useState("");
  const cases = useQaCases(listId, filter);
  const views = useQaSavedViews(listId);
  const [visibility, setVisibility] = useState<VisibilityState>(DEFAULT_VISIBILITY);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [panelCase, setPanelCase] = useState<QaCase | "new" | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [focus, setFocus] = useState({ row: 0, col: 0 });
  const [editing, setEditing] = useState<{ row: number; col: number; value: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pastePlan, setPastePlan] = useState<PastePlan | null>(null);
  const [status, setStatus] = useState("");
  const [viewName, setViewName] = useState("");
  const gridRef = useRef<HTMLTableElement>(null);
  const restoredView = useRef(false);

  // Debounce the server search so each keystroke is not a request.
  useEffect(() => {
    const t = setTimeout(() => setFilter((f) => (f.search === searchText ? f : { ...f, search: searchText })), 250);
    return () => clearTimeout(t);
  }, [searchText]);

  // Restore the member's "Default" saved view once per List.
  useEffect(() => {
    const def = views.data?.find((v) => v.viewKind === "library" && v.name === "Default");
    if (!def || restoredView.current) return;
    restoredView.current = true;
    applyView(def.config);
  }, [views.data]);
  const applyView = (config: { columns?: string[]; filter?: Partial<QaCaseFilter> }) => {
    if (config.columns) setVisibility(Object.fromEntries(Object.keys(DEFAULT_VISIBILITY).map((k) => [k, config.columns!.includes(k)])));
    if (config.filter) {
      setFilter({ ...DEFAULT_CASE_FILTER, ...config.filter });
      setSearchText(config.filter.search ?? "");
    }
  };

  const items = cases.items;
  const modules = useMemo(() => [...new Set(items.map((c) => c.module).filter((x): x is string => Boolean(x)))].sort(), [items]);
  const selectedPanelCase = panelCase && panelCase !== "new" ? (items.find((c) => c.id === panelCase.id) ?? panelCase) : null;

  const columns = useMemo<ColumnDef<QaCase>[]>(
    () => [
      { id: "select", header: () => null, cell: () => null },
      { id: "caseKey", header: "ID", accessorKey: "caseKey" },
      { id: "title", header: "Test case", accessorKey: "title" },
      { id: "module", header: "Module", accessorKey: "module" },
      { id: "priority", header: "Priority", accessorKey: "priority" },
      { id: "platforms", header: "Platforms", accessorFn: (c) => c.platforms.map((p) => PLATFORM_LABEL[p].replace(" application", "")).join(", ") },
      { id: "version", header: "Version", accessorFn: (c) => `v${c.version}` },
      { id: "updatedAt", header: "Updated", accessorFn: (c) => formatDateTime(c.updatedAt) },
    ],
    [],
  );
  const table = useReactTable({ data: items, columns, state: { columnVisibility: visibility }, onColumnVisibilityChange: setVisibility, getCoreRowModel: getCoreRowModel(), getRowId: (c) => c.id });
  const visibleEditCols = EDIT_COLS.filter((c) => visibility[c] !== false);

  const saveRowPatch = useCallback(
    (testCase: QaCase, patch: Partial<Record<PasteTarget, string>>) => {
      m.saveCase.mutate(
        { ...caseWithPatch(testCase, patch), changeNote: "Edited in the grid" },
        {
          onSuccess: (r) => setStatus(r.outcome === "unchanged" ? `${testCase.caseKey} unchanged` : `${testCase.caseKey} saved as version ${r.version}`),
          onError: (e) => toast.error(e instanceof QaOperationError ? e.message : "That change was not saved."),
        },
      );
    },
    [m.saveCase],
  );

  const commitEdit = () => {
    if (!editing) return;
    const target = items[editing.row];
    const column = visibleEditCols[editing.col];
    setEditing(null);
    if (!target || !column) return;
    const value = editing.value.trim();
    if (column === "title" && !value) return toast.error("A case needs a title.");
    saveRowPatch(target, { [column]: value } as Partial<Record<PasteTarget, string>>);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>('td[tabindex="0"]')?.focus());
  };

  const onGridKey = (e: KeyboardEvent<HTMLTableElement>) => {
    if (!editMode || items.length === 0) return;
    if (editing) {
      if (e.key === "Escape") { e.preventDefault(); setEditing(null); requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>('td[tabindex="0"]')?.focus()); }
      if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
      return;
    }
    const clamp = (row: number, col: number) => ({ row: Math.min(items.length - 1, Math.max(0, row)), col: Math.min(visibleEditCols.length - 1, Math.max(0, col)) });
    const move = (row: number, col: number) => { e.preventDefault(); setFocus(clamp(row, col)); requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>('td[tabindex="0"]')?.focus()); };
    if (e.key === "ArrowDown") move(focus.row + 1, focus.col);
    else if (e.key === "ArrowUp") move(focus.row - 1, focus.col);
    else if (e.key === "ArrowRight") move(focus.row, focus.col + 1);
    else if (e.key === "ArrowLeft") move(focus.row, focus.col - 1);
    else if (e.key === "Tab") {
      const next = e.shiftKey ? { row: focus.row, col: focus.col - 1 } : { row: focus.row, col: focus.col + 1 };
      if (next.col < 0 && focus.row > 0) move(focus.row - 1, visibleEditCols.length - 1);
      else if (next.col >= visibleEditCols.length && focus.row < items.length - 1) move(focus.row + 1, 0);
      else if (next.col >= 0 && next.col < visibleEditCols.length) move(next.row, next.col);
    } else if ((e.key === "Enter" || e.key === "F2") && canManage) {
      e.preventDefault();
      const target = items[focus.row];
      const column = visibleEditCols[focus.col];
      if (target && column) setEditing({ row: focus.row, col: focus.col, value: String(target[column] ?? "") });
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTableElement>) => {
    if (!editMode || editing || !canManage) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const plan = planPaste(items, focus.row, visibleEditCols, focus.col, text);
    const single = text.replace(/\r?\n$/, "").split(/\r?\n/).length === 1 && !text.includes("\t");
    if (single && plan.errors.length === 0 && plan.updates.length === 1) saveRowPatch(items[focus.row], plan.updates[0].patch);
    else setPastePlan(plan);
  };

  const applyPaste = async (atomic: boolean) => {
    if (!pastePlan) return;
    const rows: ImportRow[] = pastePlan.updates.flatMap((u) => {
      const c = items.find((x) => x.id === u.caseId);
      if (!c) return [];
      const d = caseWithPatch(c, u.patch);
      return [{ case_key: c.caseKey, title: d.title, preconditions: d.preconditions, steps: d.steps, priority: d.priority, module: d.module, platforms: d.platforms, change_note: "Pasted from a spreadsheet" }];
    });
    try {
      const r = await m.importCases.mutateAsync({ rows, strategy: "update", atomic });
      setStatus(`Paste applied: ${r.updated} updated, ${r.skipped} unchanged${r.errors.length ? `, ${r.errors.length} rejected` : ""}.`);
      toast.success(`Paste applied: ${r.updated} updated`);
      setPastePlan(null);
    } catch (e) {
      toast.error(e instanceof QaOperationError ? e.message : "The paste was not applied.");
    }
  };

  const toggleRow = (id: string) => setSelection((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = items.length > 0 && items.every((c) => selection.has(c.id));
  const selectedIds = [...selection].filter((id) => items.some((c) => c.id === id));

  const exportCases = async (scope: "current" | "all", format: ExportFormat) => {
    const f = scope === "current" ? filter : DEFAULT_CASE_FILTER;
    try {
      setStatus("Preparing export…");
      const { items: all, truncated } = await collectAll<QaCase, { position: number }>((cursor) => api.listCases(listId, f, cursor, QA_EXPORT_CHUNK), QA_EXPORT_MAX_ROWS);
      downloadTable(`test-cases-${scope}`, "Test cases", casesToRows(all), format);
      setStatus(`Exported ${all.length} case${all.length === 1 ? "" : "s"}${truncated ? ` (stopped at ${QA_EXPORT_MAX_ROWS})` : ""}.`);
    } catch (e) {
      toast.error(e instanceof QaOperationError ? e.message : "The export failed.");
    }
  };

  const bulk = (patch: Parameters<typeof m.bulkUpdate.mutate>[0]["patch"]) =>
    m.bulkUpdate.mutate({ caseIds: selectedIds, patch }, {
      onSuccess: (r) => { toast.success(`${r.updated} updated${r.skipped ? `, ${r.skipped} skipped (not permitted)` : ""}`); setSelection(new Set()); },
      onError: (e) => toast.error(e instanceof QaOperationError ? e.message : "The bulk update failed."),
    });

  const detailOpen = panelCase !== null;
  const hasCriteria = filter.search || filter.priority !== "all" || filter.module !== "all" || filter.platform !== "all" || filter.archived;

  return (
    <div className="qa-lib" data-detail={detailOpen ? "open" : "closed"}>
      <div className="qa-lib-main min-w-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-[#eef0f6] px-4 py-3">
          <div className="relative min-w-[200px] flex-1 basis-56">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#9aa3c0]" aria-hidden="true" />
            <input aria-label="Search test cases" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search test cases…" className={cn(inputClass, "pl-8")} />
          </div>
          <select aria-label="Priority" className={cn(inputClass, "w-auto")} value={filter.priority} onChange={(e) => setFilter({ ...filter, priority: e.target.value as QaCaseFilter["priority"] })}>
            <option value="all">All priorities</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
          <select aria-label="Module" className={cn(inputClass, "w-auto")} value={filter.module} onChange={(e) => setFilter({ ...filter, module: e.target.value })}>
            <option value="all">All modules</option>{modules.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select aria-label="Platform" className={cn(inputClass, "w-auto")} value={filter.platform} onChange={(e) => setFilter({ ...filter, platform: e.target.value as QaCaseFilter["platform"] })}>
            <option value="all">All platforms</option>{PLATFORM_KINDS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
          </select>
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 text-[13px]"><input type="checkbox" checked={filter.archived} onChange={(e) => setFilter({ ...filter, archived: e.target.checked })} /> Archived</label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" className={secondaryButton}><Columns3 className="h-4 w-4" aria-hidden="true" /> Columns</button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Show columns</DropdownMenuLabel>
              {Object.keys(DEFAULT_VISIBILITY).map((k) => (
                <DropdownMenuCheckboxItem key={k} checked={visibility[k] !== false} onCheckedChange={(v) => setVisibility((s) => ({ ...s, [k]: Boolean(v) }))} onSelect={(e) => e.preventDefault()}>{COLUMN_LABEL[k]}</DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Saved views</DropdownMenuLabel>
              {(views.data ?? []).filter((v) => v.viewKind === "library").map((v) => (
                <DropdownMenuItem key={v.id} onSelect={() => applyView(v.config)}>{v.name}</DropdownMenuItem>
              ))}
              <div className="flex gap-1 p-2" onKeyDown={(e) => e.stopPropagation()}>
                <input aria-label="Saved view name" className={cn(inputClass, "h-8")} placeholder="View name (try Default)" value={viewName} onChange={(e) => setViewName(e.target.value)} maxLength={80} />
                <button type="button" className={secondaryButton} disabled={!viewName.trim()}
                  onClick={() => m.saveView.mutate({ viewKind: "library", name: viewName.trim(), config: { columns: Object.keys(DEFAULT_VISIBILITY).filter((k) => visibility[k] !== false), filter } }, { onSuccess: () => { toast.success("View saved"); setViewName(""); } })}>Save</button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" className={secondaryButton}><Download className="h-4 w-4" aria-hidden="true" /> Export</button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void exportCases("current", "csv")}>CSV · current filters</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportCases("all", "csv")}>CSV · all active cases</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportCases("current", "xlsx")}>Excel (.xlsx) · current filters</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportCases("all", "xlsx")}>Excel (.xlsx) · all active cases</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {canManage && (
            <>
              <button type="button" className={secondaryButton} onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" aria-hidden="true" /> Import</button>
              <button type="button" className={cn(secondaryButton, editMode && "border-[#975ee2] bg-[#f3ecfc] text-[#975ee2]")} aria-pressed={editMode} onClick={() => { setEditMode((v) => !v); setEditing(null); }}>Spreadsheet edit</button>
              <button type="button" className={primaryButton} onClick={() => setPanelCase("new")}><Plus className="h-4 w-4" aria-hidden="true" /> Add case</button>
            </>
          )}
        </div>

        {selectedIds.length > 0 && (
          <div role="region" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 border-b border-[#eef0f6] bg-[#f3ecfc] px-4 py-2 text-[13px]">
            <strong>{selectedIds.length} selected</strong>
            {canManage && (
              <>
                <select aria-label="Set priority for selected" className={cn(inputClass, "h-8 w-auto")} value="" onChange={(e) => e.target.value && bulk({ priority: e.target.value })}>
                  <option value="">Set priority…</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                </select>
                <button type="button" className={secondaryButton} onClick={() => bulk({ archived: !filter.archived })}>{filter.archived ? "Restore" : "Archive"}</button>
                {!filter.archived && <button type="button" className={primaryButton} onClick={() => onCreateRun(selectedIds)}>New run from selected</button>}
              </>
            )}
            <button type="button" className={secondaryButton} onClick={() => setSelection(new Set())}>Clear</button>
          </div>
        )}

        {cases.isLoading ? <Spinner label="Loading test cases…" /> : cases.error && !cases.hasFetchedOnce ? <ErrorNotice error={cases.error} onRetry={() => void cases.refetch()} /> : items.length === 0 ? (
          <EmptyNotice
            title={hasCriteria ? "No cases match these filters" : "No test cases yet"}
            body={hasCriteria ? "Clear a filter or change the search." : canManage ? "Add cases one by one, or import a spreadsheet. Cases are reusable across runs." : "A List owner or collaborator can add cases."}
            action={hasCriteria ? <button type="button" className={secondaryButton} onClick={() => { setFilter(DEFAULT_CASE_FILTER); setSearchText(""); }}>Clear filters</button> : canManage ? <button type="button" className={primaryButton} onClick={() => setPanelCase("new")}><Plus className="h-4 w-4" aria-hidden="true" /> Add case</button> : undefined}
          />
        ) : (
          <div className="qa-scroll">
            <table
              ref={gridRef}
              className="qa-table"
              aria-label="Test cases"
              role={editMode ? "grid" : undefined}
              aria-rowcount={editMode ? items.length + 1 : undefined}
              onKeyDown={onGridKey}
              onPaste={onPaste}
              data-testid="case-grid"
            >
              <thead>
                <tr>
                  {table.getHeaderGroups()[0].headers.filter((h) => h.column.getIsVisible()).map((h) => (
                    <th key={h.id} scope="col" style={h.id === "select" ? { width: 40 } : undefined}>
                      {h.id === "select" ? <input type="checkbox" aria-label="Select all loaded cases" checked={allSelected} onChange={() => setSelection(allSelected ? new Set() : new Set(items.map((c) => c.id)))} /> : flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row, rIdx) => {
                  const c = row.original;
                  return (
                    <tr key={row.id} data-selected={selection.has(c.id)} data-active={selectedPanelCase?.id === c.id}>
                      {row.getVisibleCells().map((cell) => {
                        const colId = cell.column.id;
                        if (colId === "select") return <td key={cell.id}><input type="checkbox" aria-label={`Select ${c.caseKey}`} checked={selection.has(c.id)} onChange={() => toggleRow(c.id)} /></td>;
                        const editIdx = visibleEditCols.indexOf(colId as PasteTarget);
                        const editable = editMode && editIdx >= 0;
                        const isFocus = editable && focus.row === rIdx && focus.col === editIdx;
                        const isEditing = editing && editing.row === rIdx && editing.col === editIdx;
                        const common = editable
                          ? { role: "gridcell" as const, tabIndex: isFocus ? 0 : -1, "data-cell": colId, onFocus: () => setFocus({ row: rIdx, col: editIdx }), onDoubleClick: () => canManage && setEditing({ row: rIdx, col: editIdx, value: String(c[colId as PasteTarget] ?? "") }), "aria-readonly": !canManage }
                          : {};
                        if (colId === "caseKey") return <td key={cell.id}><button type="button" className="cursor-pointer text-[#975ee2] hover:underline" onClick={() => setPanelCase(c)}>{c.caseKey}</button></td>;
                        if (isEditing && colId === "priority") {
                          return (
                            <td key={cell.id} {...common}>
                              <select autoFocus aria-label={`Priority for ${c.caseKey}`} className="h-8 w-full rounded border border-[#975ee2] bg-white text-[13px]" value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onBlur={commitEdit}>
                                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                              </select>
                            </td>
                          );
                        }
                        if (isEditing) return <td key={cell.id} {...common}><input autoFocus aria-label={`${COLUMN_LABEL[colId] ?? "Title"} for ${c.caseKey}`} className="h-8 w-full rounded border border-[#975ee2] bg-white px-2 text-[13px]" value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onBlur={commitEdit} /></td>;
                        if (colId === "title") return <td key={cell.id} className="qa-cell-wrap" {...common}><button type="button" tabIndex={editable ? -1 : 0} className="cursor-pointer text-left hover:underline" onClick={() => setPanelCase(c)}>{c.title}</button></td>;
                        if (colId === "priority") return <td key={cell.id} {...common}><span className="capitalize" style={{ color: PRIORITY_TONE[c.priority] }}>{c.priority}</span></td>;
                        return <td key={cell.id} className={colId === "module" ? "text-[#6a769c]" : undefined} {...common}>{String(cell.getValue() ?? "")}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#eef0f6] px-4 py-2 text-[12.5px] text-[#6a769c]">
          <span>{items.length} case{items.length === 1 ? "" : "s"} loaded{cases.hasNextPage ? " (more available)" : ""}</span>
          {editMode && <span>Arrow keys move, Enter edits, Esc cancels. Paste cells from a spreadsheet to fill down.</span>}
          {cases.hasNextPage && <button type="button" className={secondaryButton} disabled={cases.isFetchingNextPage} onClick={() => void cases.fetchNextPage()}>{cases.isFetchingNextPage ? "Loading…" : "Load more"}</button>}
          {cases.isFetchNextPageError && <span role="alert" className="text-[#c42a3b]">More cases could not be loaded.</span>}
        </div>
        <div role="status" aria-live="polite" className="px-4 pb-2 text-[12.5px] text-[#6a769c]">{status}</div>
      </div>

      {detailOpen && (
        <div className="qa-exec-detail border-l border-[#eef0f6]" style={{ maxHeight: 760 }}>
          <CaseDetailPanel
            key={panelCase === "new" ? "new" : (selectedPanelCase?.id ?? "x") + (selectedPanelCase?.version ?? 0)}
            testCase={selectedPanelCase}
            canManage={canManage}
            saving={m.saveCase.isPending}
            error={m.saveCase.error instanceof QaOperationError ? m.saveCase.error : null}
            onSave={(draft) => m.saveCase.mutate(draft, { onSuccess: (r) => { toast.success(r.outcome === "created" ? "Case created" : r.outcome === "updated" ? `Saved as version ${r.version}` : "No changes to save"); setPanelCase(null); onDirtyChange(false); } })}
            onArchive={(archived) => selectedPanelCase && m.archiveCase.mutate({ caseId: selectedPanelCase.id, archived }, { onSuccess: () => { toast.success(archived ? "Case archived" : "Case restored"); setPanelCase(null); onDirtyChange(false); } })}
            onClose={() => { setPanelCase(null); onDirtyChange(false); m.saveCase.reset(); }}
            onDirtyChange={onDirtyChange}
          />
        </div>
      )}

      <ImportReview open={importOpen} onOpenChange={setImportOpen} onImport={(rows, strategy, atomic) => m.importCases.mutateAsync({ rows, strategy, atomic })} />

      {pastePlan && (
        <div role="dialog" aria-modal="true" aria-label="Paste preview" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-qa-root="">
          <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 katalist-elevation-dialog">
            <h3 className="m-0 text-[17px] font-semibold">Paste preview</h3>
            <p className="mt-2 text-[13px]"><strong>{pastePlan.updates.length}</strong> row{pastePlan.updates.length === 1 ? "" : "s"} will be changed{pastePlan.ignoredColumns > 0 && <>; {pastePlan.ignoredColumns} extra column{pastePlan.ignoredColumns === 1 ? " was" : "s were"} ignored (only Title, Module and Priority can be pasted)</>}.</p>
            {pastePlan.errors.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-[#f3c4ca] bg-[#fff8f8] p-2 text-[12.5px]">{pastePlan.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>
            )}
            <p className="mt-2 text-[12px] text-[#6a769c]">Each changed case gets a new version. Identifiers, versions and credentials are never changed by a paste.</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className={secondaryButton} onClick={() => setPastePlan(null)}>Cancel</button>
              {pastePlan.errors.length > 0 && pastePlan.updates.length > 0 && <button type="button" className={secondaryButton} onClick={() => void applyPaste(false)}>Apply valid rows only</button>}
              <button type="button" className={primaryButton} disabled={pastePlan.errors.length > 0 || pastePlan.updates.length === 0 || m.importCases.isPending} onClick={() => void applyPaste(true)}>Apply all or nothing</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
