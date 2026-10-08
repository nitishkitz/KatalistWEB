import { Check, LoaderCircle, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { checkRunOutcome, checkSummaryText, shortSha } from "./format";
import { CODE_ACTIVITY_LIMITS } from "./limits";
import { Notice, SourceLink } from "./ui-parts";
import type { ActivityChange, CheckRun } from "./types";

const OUTCOME = {
  failing: { label: "Failed", Icon: X, className: "bg-[#fdebed] text-[#a61b2b]" },
  pending: { label: "Running", Icon: LoaderCircle, className: "bg-[#fff2d6] text-[#7a4d00]" },
  passed: { label: "Passed", Icon: Check, className: "bg-[#e6f5ec] text-[#17663f]" },
  other: { label: "Not a pass or fail", Icon: Minus, className: "bg-[#f1f2f6] text-[#4d5878]" },
} as const;

function RunRow({ run }: { run: CheckRun }) {
  const o = OUTCOME[checkRunOutcome(run)];
  const detail =
    run.status === "completed"
      ? `${o.label}${run.durationLabel ? ` after ${run.durationLabel}` : ""}`
      : run.status === "queued"
        ? "Queued"
        : "Running now";
  return (
    <li className="flex min-h-[56px] items-center gap-3 border-b border-[#eef0f6] px-7 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-black">{run.name}</div>
        <div className="text-[12px] text-[#6a769c]">{detail}</div>
      </div>
      <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-px text-[12px] font-medium", o.className)}>
        <o.Icon className="h-3 w-3" aria-hidden="true" />
        {o.label}
      </span>
      <SourceLink href={run.url}>View</SourceLink>
    </li>
  );
}

/**
 * Check results for the revision a change currently points to.
 * Distinguishes: current results, none reported, unavailable, stale (older revision), and partial lists.
 */
export function ChecksPanel({ change, onRetry }: { change: Pick<ActivityChange, "checks" | "checkState" | "checksRevision" | "headSha" | "checksStale" | "checksPartial">; onRetry?: () => void }) {
  const revision = shortSha(change.checksRevision);
  const head = shortSha(change.headSha);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-7 pb-2 pt-4 text-[12px] text-[#6a769c]">
        {change.checks.length > 0 ? <span className="font-medium text-[#26304f]">{checkSummaryText(change.checks)}</span> : null}
        {revision ? (
          <span>
            Evaluated on revision <span className="font-mono">{revision}</span>
          </span>
        ) : null}
      </div>

      {change.checkState === "unavailable" ? (
        <div className="px-7 py-3">
          <Notice tone="bad" live="status">
            <b>Check status unavailable.</b> GitHub did not respond. The change is still shown.
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="ml-2 min-h-[28px] cursor-pointer rounded-md border border-[#f3b7be] bg-white px-2 text-[12px] font-medium text-[#6b1320] outline-none focus-visible:ring-2 focus-visible:ring-[#975ee2]"
              >
                Retry
              </button>
            ) : null}
          </Notice>
        </div>
      ) : change.checks.length === 0 ? (
        <div className="px-7 py-3">
          <Notice tone="info">
            <b>No checks reported</b> for this revision. This repository may not run checks, or none have started yet.
          </Notice>
        </div>
      ) : (
        <>
          {change.checksStale ? (
            <div className="px-7 py-2">
              <Notice tone="warn">
                <b>Checks are for an older revision</b> (<span className="font-mono">{revision}</span>). The newest revision{" "}
                <span className="font-mono">{head}</span> has not reported yet, so these results are not current.
              </Notice>
            </div>
          ) : null}
          <ul aria-label="Check runs">
            {change.checks.slice(0, CODE_ACTIVITY_LIMITS.checksMax).map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </ul>
          {change.checksPartial || change.checks.length > CODE_ACTIVITY_LIMITS.checksMax ? (
            <div className="px-7 py-3">
              <Notice tone="info">
                <b>Showing the first {CODE_ACTIVITY_LIMITS.checksMax} checks.</b> More exist on GitHub.
              </Notice>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
