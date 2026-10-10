import { toCsv, writeXlsx, XLSX_MIME } from "./spreadsheet";

export type ExportFormat = "csv" | "xlsx";

/** Triggers a browser download of a spreadsheet. Formula-looking cells are neutralised in both formats. */
export function downloadTable(filename: string, sheetName: string, rows: ReadonlyArray<ReadonlyArray<string>>, format: ExportFormat) {
  const blob =
    format === "csv"
      ? new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" })
      : new Blob([writeXlsx(sheetName, rows) as BlobPart], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename.replace(/[^A-Za-z0-9._-]+/g, "-")}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
