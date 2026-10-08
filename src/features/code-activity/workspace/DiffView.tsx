import { useMemo, useState } from "react";
import { Copy, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { parsePatch, shortSha } from "../format";
import { CODE_ACTIVITY_LIMITS } from "../limits";
import type { ChangeFile } from "../types";
import { Notice, SourceLink } from "../ui-parts";
import { splitFromPatch } from "./diff";
import type { SplitCell } from "./diff";
import { Signed } from "./WorkspaceParts";

export type DiffMode = "unified" | "split";

const STATUS_MARK: Record<ChangeFile["status"], { letter: string; label: string; className: string }> = {
  modified: { letter: "M", label: "Modified", className: "bg-[var(--ca-accent-soft)] text-[var(--ca-accent-ink)]" },
  added: { letter: "A", label: "Added", className: "bg-[var(--ca-ok-bg)] text-[var(--ca-ok-ink)]" },
  removed: { letter: "D", label: "Removed", className: "bg-[var(--ca-bad-bg)] text-[var(--ca-bad-ink)]" },
  renamed: { letter: "R", label: "Renamed", className: "bg-[var(--ca-warn-bg)] text-[var(--ca-warn-ink)]" },
};

export function FileMark({ status }: { status: ChangeFile["status"] }) {
  const m = STATUS_MARK[status];
  return (
    <span title={m.label} className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold", m.className)}>
      <span aria-hidden="true">{m.letter}</span>
      <span className="sr-only">{m.label}</span>
    </span>
  );
}

const LINE = { add: "bg-[var(--ca-add-bg)]", del: "bg-[var(--ca-del-bg)]", hunk: "bg-[var(--ca-surface-soft)] text-[var(--ca-muted)]", ctx: "", meta: "italic text-[var(--ca-muted)]" } as const;
const SIGN = { add: "+", del: "−", hunk: "", ctx: "", meta: "" } as const;

/** One cell of a split row. The text is placed as a text node only. */
function Cell({ cell, kind }: { cell: SplitCell; kind: "add" | "del" | "ctx" }) {
  return (
    <div className={cn("flex min-w-0", cell ? (kind === "add" ? LINE.add : kind === "del" ? LINE.del : "") : "bg-[var(--ca-surface-soft)]")}>
      <span aria-hidden="true" className="w-10 shrink-0 select-none pr-2 text-right text-[var(--ca-muted)]">{cell?.no ?? ""}</span>
      <span className="whitespace-pre pr-3">{cell?.text ?? ""}</span>
    </div>
  );
}

/** Provider patch text, rendered as text only. Unified or side by side; both come from the same lines. */
export function PatchBody({ patch, mode, path, tall }: { patch: string; mode: DiffMode; path: string; tall: boolean }) {
  const lines = useMemo(() => parsePatch(patch), [patch]);
  const rows = useMemo(() => (mode === "split" ? splitFromPatch(patch) : []), [patch, mode]);
  return (
    <div role="region" aria-label={`${mode === "split" ? "Side by side" : "Unified"} patch for ${path}`} tabIndex={0} className={cn("ca-code ca-scroll-x overflow-auto bg-[var(--ca-surface)] text-[12.5px] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]", tall ? "max-h-[78vh]" : "max-h-[560px]")}>
      {mode === "unified" ? (
        <div className="min-w-max">
          {lines.map((line, i) => (
            <div key={i} className={cn("flex", LINE[line.kind])}>
              <span aria-hidden="true" className="w-11 shrink-0 select-none pr-2 text-right text-[var(--ca-muted)]">{line.newNo ?? line.oldNo ?? ""}</span>
              <span aria-hidden="true" className={cn("w-[18px] shrink-0 select-none text-center font-bold", line.kind === "add" ? "text-[var(--ca-add-ink)]" : "text-[var(--ca-del-ink)]")}>{SIGN[line.kind]}</span>
              <span className="whitespace-pre pr-3">
                {line.kind === "add" ? <span className="sr-only">added: </span> : line.kind === "del" ? <span className="sr-only">removed: </span> : null}
                {line.text}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="min-w-[640px]">
          {rows.map((row, i) =>
            row.type === "hunk" || row.type === "meta" ? (
              <div key={i} className={cn("px-3", row.type === "hunk" ? LINE.hunk : LINE.meta)}><span className="whitespace-pre">{row.text}</span></div>
            ) : (
              <div key={i} className="grid grid-cols-2 divide-x divide-[var(--ca-line)]">
                <Cell cell={row.type === "ctx" ? row.left : row.left} kind={row.type === "ctx" ? "ctx" : "del"} />
                <Cell cell={row.type === "ctx" ? row.right : row.right} kind={row.type === "ctx" ? "ctx" : "add"} />
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function FileDiffPanel({ file, revision, openUrl, mode }: { file: ChangeFile; revision: string | null; openUrl: string | null; mode: DiffMode }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(file.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const hasPatch = (file.patchState === "available" || file.patchState === "truncated") && !!file.patch;
  return (
    <div className="min-w-0 rounded-[10px] border border-[var(--ca-line)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ca-line)] px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <FileMark status={file.status} />
          <span className="truncate text-[13px] font-semibold" title={file.path}>{file.path}</span>
        </div>
        <div className="flex items-center gap-2 text-[13px]">
          <Signed value={file.additions} kind="add" />
          <Signed value={file.deletions} kind="del" />
          <button type="button" onClick={() => void copyPath()} aria-label={copied ? "Path copied" : `Copy path ${file.path}`} className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[var(--ca-muted)] outline-none hover:bg-[var(--ca-surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]">
            <Copy className="h-4 w-4" aria-hidden="true" />
          </button>
          {hasPatch ? (
            <button type="button" onClick={() => setExpanded(true)} aria-label={`Expand ${file.path}`} className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[var(--ca-muted)] outline-none hover:bg-[var(--ca-surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]">
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
          <SourceLink href={openUrl}>GitHub</SourceLink>
        </div>
      </div>
      {revision ? <p className="px-3 pt-2 text-[12px] text-[var(--ca-muted)]">Patch for revision <span className="ca-code">{shortSha(revision)}</span></p> : null}
      <Body file={file} mode={mode} tall={false} />
      {hasPatch ? (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent aria-describedby={undefined} className="max-w-[min(96vw,1200px)] p-0">
            <DialogTitle className="truncate border-b border-[var(--ca-line)] px-4 py-3 pr-12 text-[14px]">{file.path}</DialogTitle>
            <DialogDescription className="sr-only">Full patch for {file.path}</DialogDescription>
            <Body file={file} mode={mode} tall />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function Body({ file, mode, tall }: { file: ChangeFile; mode: DiffMode; tall: boolean }) {
  switch (file.patchState) {
    case "binary":
      return <div className="p-3"><Notice tone="info"><b>Binary file.</b> No preview is available.</Notice></div>;
    case "empty":
      return <div className="p-3"><Notice tone="info"><b>No line changes.</b> The file was renamed or its mode changed.</Notice></div>;
    case "omitted":
      return <div className="p-3"><Notice tone="warn"><b>Patch omitted.</b> GitHub left this patch out because it is too large. Open it on GitHub.</Notice></div>;
    case "unavailable":
      return <div className="p-3"><Notice tone="warn" live="status"><b>Patch not available.</b> GitHub did not include one for this file.</Notice></div>;
    default:
      return file.patch ? (
        <>
          <PatchBody patch={file.patch} mode={mode} path={file.path} tall={tall} />
          {file.patchState === "truncated" ? <div className="p-3"><Notice tone="warn"><b>Patch truncated</b> at {Math.round(CODE_ACTIVITY_LIMITS.patchMaxBytes / 1024)} KiB or {CODE_ACTIVITY_LIMITS.patchMaxLines.toLocaleString("en")} lines. The rest is on GitHub.</Notice></div> : null}
        </>
      ) : (
        <div className="p-3"><Notice tone="warn"><b>Patch not available.</b></Notice></div>
      );
  }
}
