import { ArrowUp, GitBranch, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { initialsOf, relativeTime, sizeLabel } from "./format";
import { CheckPill, PullRequestPill } from "./ui-parts";
import type { ActivityChange } from "./types";

interface ActivityRowProps {
  change: ActivityChange;
  selected: boolean;
  onSelect: (id: string) => void;
  now: number;
}

function formatGapRange(from: string, to: string): string {
  const fmt = (iso: string) => new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
  return `${fmt(from)} to ${fmt(to)}`;
}

/** One entry in the activity feed. A history gap is shown, never hidden, and is not selectable. */
export function ActivityRow({ change, selected, onSelect, now }: ActivityRowProps) {
  if (change.kind === "gap" && change.gap) {
    return (
      <li className="border-b border-[#eef0f6] px-5 py-3.5">
        <div className="flex gap-3 rounded-[10px] border border-dashed border-[#e0b95c] bg-[#fffaf0] px-3.5 py-3 text-[13px] text-[#4a3a10]">
          <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <div className="font-medium">Some history could not be rebuilt</div>
            <div className="text-[12px] text-[#6b5518]">
              Activity between {formatGapRange(change.gap.from, change.gap.to)} could not be reconstructed. Current pull
              requests and checks are up to date.
            </div>
          </div>
        </div>
      </li>
    );
  }

  const author = change.author;
  const meta = [
    author.kind === "unknown" ? "Unknown author" : author.name,
    change.headBranch,
    relativeTime(change.updatedAt, now),
  ];

  return (
    <li className="border-b border-[#eef0f6]">
      <button
        type="button"
        data-change-id={change.id}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(change.id)}
        className={cn(
          "group flex min-h-[88px] w-full cursor-pointer gap-3 px-5 py-3.5 text-left outline-none transition-colors duration-200 motion-reduce:transition-none",
          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#975ee2]",
          selected ? "bg-[#f5f4fe] shadow-[inset_3px_0_0_#975ee2]" : "hover:bg-[#fafaff]",
        )}
      >
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f1f3f9] text-[#4d5878]"
        >
          {change.kind === "push" ? <ArrowUp className="h-3.5 w-3.5" /> : <GitBranch className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
            <span className="min-w-0 break-words text-[14px] font-medium leading-snug text-black sm:truncate">{change.title}</span>
            <span className="shrink-0 font-mono text-[12px] text-[#4d5878]">
              {sizeLabel(change.additions, change.deletions, change.changedFiles)}
            </span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[#6a769c]">
            <span
              aria-hidden="true"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#d9cff7] text-[12px] font-semibold text-[#503188]"
            >
              {author.kind === "unknown" ? "?" : initialsOf(author.name)}
            </span>
            <span>{meta[0]}</span>
            {meta[1] ? <span className="font-mono">{meta[1]}</span> : null}
            <span>· {meta[2]}</span>
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <PullRequestPill change={change} />
            <CheckPill change={change} />
            <span className="ml-auto text-[12px] font-medium text-[#503188] group-hover:underline">View change →</span>
          </span>
        </span>
      </button>
    </li>
  );
}
