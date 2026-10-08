import { useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { initialsOf, shortSha } from "../format";
import type { WorkspaceAuthor } from "./types";

export const CONTROL =
  "ca-control inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-[10px] border border-[var(--ca-line)] bg-[var(--ca-surface)] px-3 text-[13px] font-medium text-[var(--ca-ink)] outline-none transition-colors hover:bg-[var(--ca-surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)] disabled:cursor-not-allowed disabled:opacity-45";

export function Avatar({ author, size = 32 }: { author: WorkspaceAuthor; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(12, Math.round(size / 2.6)) };
  if (author.avatarUrl && !broken) {
    return <img src={author.avatarUrl} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} style={style} className="shrink-0 rounded-full bg-[var(--ca-line)] object-cover" />;
  }
  return (
    <span aria-hidden="true" style={style} className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--ca-accent-soft)] font-semibold text-[var(--ca-accent-ink)]">
      {initialsOf(author.name)}
    </span>
  );
}

/** The seven-character SHA with a copy button that copies the full SHA. */
export function ShaCopy({ sha, className }: { sha: string | null; className?: string }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  if (!sha) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sha);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 1800);
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-lg bg-[var(--ca-surface-soft)] px-2 py-0.5 text-[12px] text-[var(--ca-ink-2)]", className)}>
      <span className="ca-code">{shortSha(sha)}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void copy();
        }}
        aria-label={copied === "done" ? "Full SHA copied" : copied === "failed" ? "Copy failed. Select the SHA manually" : "Copy full SHA"}
        className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-[var(--ca-muted)] outline-none max-md:h-11 max-md:w-11 hover:bg-white focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]"
      >
        {copied === "done" ? <Check className="h-3.5 w-3.5 text-[var(--ca-ok-ink)]" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      <span role="status" className="sr-only">
        {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : ""}
      </span>
    </span>
  );
}

export function Signed({ value, kind }: { value: number | null; kind: "add" | "del" }) {
  if (value === null) return <span className="text-[var(--ca-muted)]" title="Not available">{kind === "add" ? "+–" : "−–"}</span>;
  return <span className={cn("font-semibold tabular-nums", kind === "add" ? "text-[var(--ca-add-ink)]" : "text-[var(--ca-del-ink)]")}>{kind === "add" ? `+${value}` : `−${value}`}</span>;
}

/** A filter control: a button that opens a small labelled panel. The count shows when something is chosen. */
export function FilterPopover({ label, count, children, width = 240 }: { label: string; count: number; children: ReactNode; width?: number }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn(CONTROL, count > 0 && "border-[var(--ca-accent)] bg-[var(--ca-accent-soft)] text-[var(--ca-accent-ink)]")} aria-haspopup="dialog">
          {label}
          {count > 0 ? <span className="rounded-full bg-[var(--ca-accent)] px-1.5 text-[12px] leading-[16px] text-white">{count}</span> : null}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={`${label} filter`} style={{ width }} className="max-h-[360px] overflow-auto p-2">
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function CheckOption({ checked, onChange, children }: { checked: boolean; onChange: (next: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-[34px] cursor-pointer items-center gap-2 rounded-lg px-2 text-[13px] hover:bg-[var(--ca-surface-soft)]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--ca-accent)]" />
      <span className="min-w-0 truncate">{children}</span>
    </label>
  );
}
