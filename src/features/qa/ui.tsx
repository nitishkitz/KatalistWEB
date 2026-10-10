import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_TONE } from "./domain";
import type { QaOperationError } from "./qa-queries";
import type { QaResultStatus } from "./types";

export const secondaryButton =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-[#eaeffa] bg-white px-3 text-[13px] font-medium text-[#1d1d1d] outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2] disabled:cursor-not-allowed disabled:opacity-60";
export const primaryButton =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] bg-[#975ee2] px-3.5 text-[13px] font-medium text-white outline-none hover:bg-[#8650d1] focus-visible:ring-2 focus-visible:ring-[#975ee2] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
export const dangerButton =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] border border-[#f3c4ca] bg-white px-3 text-[13px] font-medium text-[#c42a3b] outline-none hover:bg-[#fff5f6] focus-visible:ring-2 focus-visible:ring-[#e5384a] disabled:cursor-not-allowed disabled:opacity-60";
export const iconButton =
  "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[#6a769c] outline-none hover:bg-[#f4f5fb] hover:text-[#000533] focus-visible:ring-2 focus-visible:ring-[#975ee2] disabled:cursor-not-allowed disabled:opacity-50";
export const inputClass =
  "h-9 w-full rounded-lg border border-[#dfe3f0] bg-white px-2.5 text-[13px] text-[#000533] outline-none placeholder:text-[#9aa3c0] focus:border-[#975ee2] focus-visible:ring-2 focus-visible:ring-[#975ee2]/40 disabled:bg-[#fafaff] disabled:opacity-70";
export const textareaClass = cn(inputClass, "h-auto min-h-[72px] resize-y py-2 leading-relaxed");

export function Field({ label, hint, htmlFor, children, optional }: { label: string; hint?: string; htmlFor: string; children: ReactNode; optional?: boolean }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-[12.5px] font-medium text-[#000533]">
        {label}
        {optional && <span className="ml-1 font-normal text-[#6a769c]">(optional)</span>}
      </label>
      {children}
      {hint && <p className="text-[12px] text-[#6a769c]">{hint}</p>}
    </div>
  );
}

export function StatusMark({ status, className }: { status: QaResultStatus; className?: string }) {
  const tone = STATUS_TONE[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px]", className)} style={{ color: tone.text }}>
      <span className="qa-dot" style={{ background: tone.dot }} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-2 p-6 text-[13px] text-[#6a769c]">
      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {label}
    </div>
  );
}

/** Access loss is not transient, so no retry is offered for it. */
export function ErrorNotice({ error, onRetry, title = "Could not load this" }: { error: QaOperationError; onRetry?: () => void; title?: string }) {
  const migration = error.code === "migration_missing";
  return (
    <div role="alert" className="m-4 rounded-lg border border-[#f3c4ca] bg-[#fff8f8] p-4 text-[13px]">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#c42a3b]" aria-hidden="true" />
        <div className="min-w-0">
          <div className="font-medium text-[#000533]">{migration ? "Manual QA is not set up on this database" : title}</div>
          <p className="mt-0.5 text-[#6a769c]">{error.message}</p>
          {error.isAccessLoss ? (
            <p className="mt-1 text-[#6a769c]">Your access to this List may have changed. Reload, or ask a List owner.</p>
          ) : onRetry && !migration ? (
            <button type="button" onClick={onRetry} className={cn(secondaryButton, "mt-2")}>Try again</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function EmptyNotice({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="mx-auto my-8 max-w-sm text-center">
      <div className="text-[14px] font-medium text-[#000533]">{title}</div>
      {body && <p className="mt-1 text-[12.5px] text-[#6a769c]">{body}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

export function SectionTitle({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="m-0 text-[20px] font-semibold leading-tight text-[#000533]">{title}</h2>
        {sub && <p className="mt-0.5 text-[13px] text-[#6a769c]">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

export function PreviewBanner() {
  return (
    <div role="note" className="border-b border-[#f0e3c4] bg-[#fffaf0] px-4 py-1.5 text-[12px] text-[#7a5b13]">
      Preview data. Nothing here is saved to the shared database, and it resets when you reload. Credentials are placeholders.
    </div>
  );
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
