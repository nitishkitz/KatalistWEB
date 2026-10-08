import { useMemo, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { parsePatch, shortSha } from "./format";
import { CODE_ACTIVITY_LIMITS } from "./limits";
import { Notice, SourceLink } from "./ui-parts";
import type { ChangeFile } from "./types";

interface FileDiffProps {
  file: ChangeFile;
  /** Revision the patch belongs to. Always shown so a patch is never mistaken for another revision. */
  revision: string | null;
  openUrl: string | null;
}

const LINE_STYLE = {
  add: "bg-[#e8f7ee]",
  del: "bg-[#fdebed]",
  hunk: "bg-[#f6f7fb] text-[#6a769c]",
  ctx: "",
  meta: "text-[#6a769c] italic",
} as const;

const SIGN = { add: "+", del: "−", hunk: "", ctx: "", meta: "" } as const;
const SIGN_LABEL = { add: "added: ", del: "removed: " } as const;

/**
 * Renders one file's patch. The patch is provider-supplied text, so it is only ever placed in the
 * DOM as text nodes. Nothing here uses innerHTML or interprets markup.
 */
export function FileDiff({ file, revision, openUrl }: FileDiffProps) {
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => (file.patch ? parsePatch(file.patch) : []), [file.patch]);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0 text-[13px]">
        <span className="break-all font-mono font-semibold text-black">{file.path}</span>
        {revision ? (
          <span className="ml-2 text-[12px] text-[#6a769c]">
            patch for revision <span className="font-mono">{shortSha(revision)}</span>
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {file.patch ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-pressed={expanded}
            className="inline-flex min-h-[30px] cursor-pointer items-center gap-1.5 rounded-lg border border-[#eaeffa] bg-white px-2.5 text-[12px] text-[#1d1d1d] outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2]"
          >
            {expanded ? <Minimize2 className="h-3 w-3" aria-hidden="true" /> : <Maximize2 className="h-3 w-3" aria-hidden="true" />}
            {expanded ? "Collapse" : "Expand"}
          </button>
        ) : null}
        <SourceLink href={openUrl}>Open on GitHub</SourceLink>
      </div>
    </div>
  );

  if (file.patchState === "binary") {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <Notice tone="info">
          <b>Binary file.</b> No preview is available for <span className="font-mono">{file.path}</span>.
        </Notice>
      </div>
    );
  }
  if (file.patchState === "empty") {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <Notice tone="info">
          <b>No line changes.</b> This file was renamed or its mode changed, so there is no patch text to show.
        </Notice>
      </div>
    );
  }
  if (file.patchState === "omitted") {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <Notice tone="warn">
          <b>Patch omitted.</b> GitHub did not include a patch because the diff is too large. Open it on GitHub to read it.
        </Notice>
      </div>
    );
  }
  if (file.patchState === "unavailable" || !file.patch) {
    return (
      <div className="flex flex-col gap-3">
        {header}
        <Notice tone="warn" live="status">
          <b>This patch is no longer available.</b> The commit may have been rewritten or removed on GitHub. The record of
          the change is kept.
        </Notice>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {header}
      <div
        role="region"
        aria-label={`Patch for ${file.path}`}
        tabIndex={0}
        className={cn(
          "overflow-auto rounded-[10px] border border-[#eaeffa] font-mono text-[12px] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2]",
          expanded ? "max-h-[78vh]" : "max-h-[420px]",
        )}
      >
        <div className="min-w-max">
          {lines.map((line, i) => (
            <div key={i} className={cn("flex", LINE_STYLE[line.kind])}>
              <span aria-hidden="true" className="w-11 shrink-0 select-none pr-2 text-right text-[#9aa3bd]">
                {line.oldNo ?? ""}
              </span>
              <span aria-hidden="true" className="w-11 shrink-0 select-none pr-2 text-right text-[#9aa3bd]">
                {line.newNo ?? ""}
              </span>
              <span
                aria-hidden="true"
                className={cn("w-[18px] shrink-0 select-none text-center font-bold", line.kind === "add" ? "text-[#17663f]" : "text-[#a61b2b]")}
              >
                {SIGN[line.kind]}
              </span>
              <span className="whitespace-pre pr-3">
                {line.kind === "add" || line.kind === "del" ? <span className="sr-only">{SIGN_LABEL[line.kind]}</span> : null}
                {line.text}
              </span>
            </div>
          ))}
        </div>
      </div>
      {file.patchState === "truncated" ? (
        <Notice tone="warn">
          <b>Patch truncated</b> at {Math.round(CODE_ACTIVITY_LIMITS.patchMaxBytes / 1024)} KiB or{" "}
          {CODE_ACTIVITY_LIMITS.patchMaxLines.toLocaleString("en")} lines. The rest is on GitHub.
        </Notice>
      ) : null}
    </div>
  );
}
