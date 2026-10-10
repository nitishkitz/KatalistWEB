import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatImportReport, guessMapping, parseTable, rowsToImport, type ColumnMapping } from "../domain";
import { readXlsx } from "../spreadsheet";
import { QaOperationError } from "../qa-queries";
import type { ImportReport, ImportRow, ImportStrategy } from "../types";
import { primaryButton, secondaryButton, textareaClass } from "../ui";

const FIELD_OPTIONS: Array<[keyof ImportRow | "", string]> = [
  ["", "Do not import"], ["case_key", "ID (match existing)"], ["title", "Title"], ["module", "Module"], ["priority", "Priority"], ["platforms", "Platforms"], ["preconditions", "Preconditions"], ["steps", "Steps (action => expected)"],
];
const MAX_ROWS = 1000;

/**
 * Import wizard: choose a file or paste, map columns, review every row, then import. Only case
 * definitions can be imported; there is no mapping for execution outcomes.
 */
export function ImportReview({
  open, onOpenChange, onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (rows: ImportRow[], strategy: ImportStrategy, atomic: boolean) => Promise<ImportReport>;
}) {
  const [table, setTable] = useState<{ header: string[]; body: string[][] } | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [strategy, setStrategy] = useState<ImportStrategy>("skip");
  const [atomic, setAtomic] = useState(true);
  const [pasted, setPasted] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);

  const reset = () => { setTable(null); setMapping([]); setPasted(""); setParseError(null); setReport(null); setBusy(false); };
  const load = (t: { header: string[]; body: string[][] }) => {
    if (t.body.length > MAX_ROWS) return setParseError(`That file has ${t.body.length} rows. Import at most ${MAX_ROWS} rows at a time.`);
    if (t.header.length === 0 || t.body.length === 0) return setParseError("The file needs a header row and at least one data row.");
    setParseError(null);
    setTable(t);
    setMapping(guessMapping(t.header));
  };
  const onFile = async (file: File) => {
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const rows = await readXlsx(new Uint8Array(await file.arrayBuffer()));
        load({ header: rows[0] ?? [], body: rows.slice(1) });
      } else {
        const text = new TextDecoder("utf-8", { fatal: false }).decode(await file.arrayBuffer());
        load(parseTable(text));
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "That file could not be read.");
    }
  };
  const parsed = useMemo(() => (table ? rowsToImport(table.body, mapping) : null), [table, mapping]);
  const hasTitle = mapping.includes("title");

  const run = async () => {
    if (!parsed) return;
    cancelled.current = false;
    setBusy(true);
    try {
      const r = await onImport(parsed.rows, strategy, atomic);
      if (cancelled.current) return;
      // Rows that failed client-side validation are reported alongside the server's own errors.
      setReport({ ...r, errors: [...parsed.errors, ...r.errors] });
    } catch (e) {
      toast.error(e instanceof QaOperationError ? e.message : "The import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { cancelled.current = true; reset(); } onOpenChange(o); }}>
      <DialogContent data-qa-root="" className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import test cases</DialogTitle>
          <DialogDescription>CSV, TSV or XLSX. Only case definitions are imported; results and credentials are never read.</DialogDescription>
        </DialogHeader>

        {report ? (
          <div className="space-y-3">
            <p role="status" className="text-[14px] font-medium">{formatImportReport(report)}</p>
            {report.errors.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-[#f3c4ca] bg-[#fff8f8] p-3 text-[12.5px]">
                {report.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
              </ul>
            )}
            <div className="flex justify-end"><button type="button" className={primaryButton} onClick={() => { reset(); onOpenChange(false); }}>Done</button></div>
          </div>
        ) : !table ? (
          <div className="space-y-3">
            <input type="file" accept=".csv,.tsv,.txt,.xlsx" aria-label="Choose a file to import" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
            <div className="text-[12.5px] text-[#6a769c]">or paste rows (with a header row):</div>
            <textarea className={textareaClass} rows={6} value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="Pasted rows" />
            {parseError && <p role="alert" className="text-[12.5px] text-[#c42a3b]">{parseError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={secondaryButton} onClick={() => onOpenChange(false)}>Cancel</button>
              <button type="button" className={primaryButton} disabled={!pasted.trim()} onClick={() => { try { load(parseTable(pasted)); } catch (e) { setParseError(e instanceof Error ? e.message : "Could not read that text."); } }}>Review pasted rows</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="qa-scroll rounded-lg border border-[#eaeffa]">
              <table className="qa-table" aria-label="Column mapping and preview" style={{ minWidth: 520 }}>
                <thead>
                  <tr>{table.header.map((h, c) => (
                    <th key={c} scope="col">
                      <div className="mb-1 font-normal">{h || `Column ${c + 1}`}</div>
                      <select aria-label={`Map column ${h || c + 1}`} className="h-8 w-full rounded border border-[#dfe3f0] bg-white text-[12px]" value={mapping[c] ?? ""} onChange={(e) => setMapping((m) => m.map((x, i) => (i === c ? ((e.target.value || null) as ColumnMapping[number]) : x)))}>
                        {FIELD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </th>
                  ))}</tr>
                </thead>
                <tbody>{table.body.slice(0, 8).map((r, i) => <tr key={i}>{table.header.map((_, c) => <td key={c} className="qa-truncate max-w-[200px]">{r[c] ?? ""}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <p className="text-[12.5px] text-[#6a769c]">Showing 8 of {table.body.length} rows. {parsed && <><strong>{parsed.rows.length}</strong> valid{parsed.errors.length > 0 && <>, <strong className="text-[#c42a3b]">{parsed.errors.length}</strong> with errors</>}.</>}</p>
            {!hasTitle && <p role="alert" className="text-[12.5px] text-[#c42a3b]">Map one column to Title.</p>}
            {parsed && parsed.errors.length > 0 && (
              <ul className="max-h-28 space-y-0.5 overflow-y-auto rounded-lg border border-[#f3c4ca] bg-[#fff8f8] p-2 text-[12px]">{parsed.errors.slice(0, 50).map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}</ul>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[12.5px] font-medium">If an ID already exists
                <select className="mt-1 h-9 w-full rounded-lg border border-[#dfe3f0] bg-white px-2 text-[13px] font-normal" value={strategy} onChange={(e) => setStrategy(e.target.value as ImportStrategy)}>
                  <option value="skip">Skip it</option><option value="update">Update it (creates a new version)</option><option value="create">Create a new case instead</option>
                </select>
              </label>
              <label className="flex items-start gap-2 pt-5 text-[12.5px]"><input type="checkbox" checked={atomic} onChange={(e) => setAtomic(e.target.checked)} className="mt-0.5" /> <span>All or nothing. Import nothing if any row is invalid.</span></label>
            </div>
            <div className="flex justify-between gap-2">
              <button type="button" className={secondaryButton} onClick={() => { cancelled.current = true; reset(); }}>Back</button>
              <div className="flex gap-2">
                <button type="button" className={secondaryButton} onClick={() => onOpenChange(false)}>Cancel</button>
                <button type="button" className={primaryButton} disabled={busy || !hasTitle || !parsed || parsed.rows.length === 0 || (atomic && parsed.errors.length > 0)} onClick={() => void run()}>
                  {busy ? "Importing…" : `Import ${parsed?.rows.length ?? 0} case${parsed?.rows.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
