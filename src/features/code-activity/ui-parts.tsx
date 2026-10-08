import type { ReactNode } from "react";
import {
  ArrowUp,
  Check,
  CircleAlert,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Info,
  LoaderCircle,
  Minus,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { countChecks } from "./format";
import type { ActivityChange, PullRequestState } from "./types";

/**
 * Small presentational parts shared by the feed and the inspector.
 * Every state pairs an icon with text, so color is never the only cue.
 * Check colors are proposed for this feature only (design-contract.md section 4).
 */

const PILL =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-px text-[12px] font-medium leading-[18px]";

const PR_STYLE: Record<PullRequestState, { label: string; className: string; Icon: typeof GitPullRequest }> = {
  open: { label: "Open", className: "border-transparent bg-[#eaf2ff] text-[#1f4fa3]", Icon: GitPullRequest },
  merged: { label: "Merged", className: "border-transparent bg-[#f1e9fd] text-[#503188]", Icon: GitMerge },
  closed: { label: "Closed", className: "border-transparent bg-[#f1f2f6] text-[#4d5878]", Icon: GitPullRequestClosed },
  draft: { label: "Draft", className: "border-dashed border-[#aab2c8] bg-white text-[#4d5878]", Icon: GitPullRequestDraft },
};

export function PullRequestPill({ change }: { change: Pick<ActivityChange, "kind" | "prState"> }) {
  if (change.kind === "push" || change.prState === null) {
    return (
      <span className={cn(PILL, "border-[#eaeffa] bg-white text-[#4d5878]")}>
        <ArrowUp className="h-3 w-3" aria-hidden="true" />
        Push · no pull request
      </span>
    );
  }
  const { label, className, Icon } = PR_STYLE[change.prState];
  return (
    <span className={cn(PILL, className)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">Pull request state: </span>
      {label}
    </span>
  );
}

export function CheckPill({
  change,
}: {
  change: Pick<ActivityChange, "checkState" | "checks" | "checksStale">;
}) {
  const counts = countChecks(change.checks);
  if (change.checksStale && change.checkState !== "unavailable") {
    return (
      <span className={cn(PILL, "border-dashed border-[#e0b95c] bg-white text-[#7a4d00]")}>
        <TriangleAlert className="h-3 w-3" aria-hidden="true" />
        Checks are for an older revision
      </span>
    );
  }
  switch (change.checkState) {
    case "passed":
      return (
        <span className={cn(PILL, "border-transparent bg-[#e6f5ec] text-[#17663f]")}>
          <Check className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">Check state: </span>
          Checks passed
        </span>
      );
    case "failing":
      return (
        <span className={cn(PILL, "border-transparent bg-[#fdebed] text-[#a61b2b]")}>
          <X className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">Check state: </span>
          {counts.failing === 1 ? "1 check failing" : `${counts.failing} checks failing`}
        </span>
      );
    case "pending":
      return (
        <span className={cn(PILL, "border-transparent bg-[#fff2d6] text-[#7a4d00]")}>
          <LoaderCircle className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">Check state: </span>
          Checks running
        </span>
      );
    case "unavailable":
      return (
        <span className={cn(PILL, "border-dashed border-[#aab2c8] bg-white text-[#4d5878]")}>
          <CircleAlert className="h-3 w-3" aria-hidden="true" />
          Check status unavailable
        </span>
      );
    default:
      return (
        <span className={cn(PILL, "border-[#eaeffa] bg-white text-[#4d5878]")}>
          <Minus className="h-3 w-3" aria-hidden="true" />
          No checks reported
        </span>
      );
  }
}

export type NoticeTone = "info" | "warn" | "bad" | "ok";

const NOTICE_TONE: Record<NoticeTone, string> = {
  info: "border-[#c9c4fc] bg-[#f5f4fe] text-[#2c2060]",
  warn: "border-[#e9d8a6] bg-[#fffaf0] text-[#4a3a10]",
  bad: "border-[#f3b7be] bg-[#fdebed] text-[#6b1320]",
  ok: "border-[#bfe3cd] bg-[#e6f5ec] text-[#0f4a2c]",
};

export function Notice({
  tone = "info",
  children,
  className,
  live,
}: {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
  /** "status" announces politely; "alert" interrupts. Omit for static notices. */
  live?: "status" | "alert";
}) {
  const Icon = tone === "warn" ? TriangleAlert : tone === "bad" ? CircleAlert : tone === "ok" ? Check : Info;
  return (
    <div role={live} className={cn("flex gap-2.5 rounded-[10px] border px-3.5 py-3 text-[13px] leading-[1.45]", NOTICE_TONE[tone], className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("h-4 w-4 animate-spin motion-reduce:animate-none", className)} aria-hidden="true" />;
}

/**
 * External link to the provider. Sample URLs use the reserved ".invalid" host and never navigate,
 * so a preview click cannot open a real page or leak the session.
 */
export function SourceLink({
  href,
  children,
  className,
}: {
  href: string | null;
  children: ReactNode;
  className?: string;
}) {
  if (!href) return null;
  const sample = /^https?:\/\/[^/]*\.invalid(\/|$)/.test(href);
  return (
    <a
      href={sample ? undefined : href}
      target={sample ? undefined : "_blank"}
      rel="noopener noreferrer"
      title={sample ? "Sample link. Opens nothing in preview." : undefined}
      aria-disabled={sample || undefined}
      onClick={sample ? (e) => e.preventDefault() : undefined}
      className={cn(
        "inline-flex min-h-[28px] items-center gap-1 rounded-sm text-[13px] text-[#503188] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2]",
        sample && "cursor-default",
        className,
      )}
    >
      {children}
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}
