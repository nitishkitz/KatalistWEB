import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { Check, CircleAlert, Ellipsis, FileText, GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, LoaderCircle, Minus, Rocket, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { dayGroup, relativeTime } from "../format";
import { statusOf } from "./types";
import type { WorkspaceItem } from "./types";
import { Avatar, ShaCopy, Signed } from "./WorkspaceParts";
import { STATUS_LABEL } from "./filters";

export interface WorkspaceListHandle {
  focusRow: (id: string) => void;
}

function Chip({ tone, icon, children }: { tone: "ok" | "bad" | "warn" | "neutral"; icon: React.ReactNode; children: React.ReactNode }) {
  const style = { ok: "bg-[var(--ca-ok-bg)] text-[var(--ca-ok-ink)]", bad: "bg-[var(--ca-bad-bg)] text-[var(--ca-bad-ink)]", warn: "bg-[var(--ca-warn-bg)] text-[var(--ca-warn-ink)]", neutral: "bg-[var(--ca-surface-soft)] text-[var(--ca-ink-2)]" }[tone];
  return <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium", style)}>{icon}{children}</span>;
}

/** The check summary chip. Icon and words, never color alone; an unread state says so. */
export function ChecksChip({ item }: { item: WorkspaceItem }) {
  const c = item.checks;
  const icon = (I: typeof Check) => <I className="h-3.5 w-3.5" aria-hidden="true" />;
  switch (item.checkState) {
    case "passed": return <Chip tone="ok" icon={icon(Check)}>{c ? `${c.passed} ${c.passed === 1 ? "check" : "checks"} passed` : "Checks passed"}</Chip>;
    case "failing": return <Chip tone="bad" icon={icon(X)}>{c ? `${c.failing} ${c.failing === 1 ? "check" : "checks"} failing` : "Checks failing"}</Chip>;
    case "pending": return <Chip tone="warn" icon={icon(LoaderCircle)}>Checks running</Chip>;
    case "none": return <Chip tone="neutral" icon={icon(Minus)}>No checks reported</Chip>;
    case "unavailable": return <Chip tone="neutral" icon={icon(CircleAlert)}>Check status unavailable</Chip>;
    default: return item.statsStatus === "unavailable" ? <Chip tone="neutral" icon={icon(CircleAlert)}>Check status unavailable</Chip> : <Chip tone="neutral" icon={icon(Minus)}>Checks not read yet</Chip>;
  }
}

const PR_ICON = { open: GitPullRequest, merged: GitMerge, closed: GitPullRequestClosed, draft: GitPullRequestDraft } as const;

function KindBadge({ item }: { item: WorkspaceItem }) {
  if (item.kind === "pull_request" && item.prState) {
    const Icon = PR_ICON[item.prState];
    return <Chip tone={item.prState === "merged" ? "neutral" : item.prState === "open" ? "ok" : "neutral"} icon={<Icon className="h-3.5 w-3.5" aria-hidden="true" />}>{`PR #${item.number} · ${STATUS_LABEL[item.prState]}`}</Chip>;
  }
  if (item.kind === "deployment") {
    const s = statusOf(item);
    return <Chip tone={s === "success" ? "ok" : s === "failure" || s === "error" ? "bad" : "warn"} icon={<Rocket className="h-3.5 w-3.5" aria-hidden="true" />}>{STATUS_LABEL[s] ?? s}</Chip>;
  }
  if (item.kind === "push") return <Chip tone="neutral" icon={<GitBranch className="h-3.5 w-3.5" aria-hidden="true" />}>Push · no pull request</Chip>;
  return null;
}

function Row({ item, selected, unchecked, now, onSelect, rowRef }: { item: WorkspaceItem; selected: boolean; unchecked: boolean; now: number; onSelect: () => void; rowRef: (el: HTMLButtonElement | null) => void }) {
  const files = item.stats?.files;
  return (
    <li className="ca-row @container group relative mx-2 my-0.5 rounded-lg" data-selected={selected} data-item-id={item.id}>
      <button
        type="button"
        ref={rowRef}
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        aria-label={`${item.title}. ${item.author.name}, ${relativeTime(item.occurredAt, now)}`}
        className="flex w-full cursor-pointer gap-2 rounded-lg px-3 py-2 pr-24 text-left @max-[440px]:pr-3 outline-none hover:bg-[var(--ca-surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]"
      >
        <Avatar author={item.author} size={28} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold leading-5 text-[var(--ca-ink)]">{item.title}</span>
          <span className="mt-0.5 block truncate text-[12.5px] text-[var(--ca-muted)]">
            <span className="font-medium text-[var(--ca-ink-2)]">{item.author.name}</span> · {relativeTime(item.occurredAt, now)}
          </span>
          {item.branch ? (
            <span className="mt-0.5 flex items-center gap-1.5 truncate text-[12.5px] text-[var(--ca-muted)]">
              <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.branch}</span>
            </span>
          ) : null}
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <KindBadge item={item} />
            {item.kind !== "deployment" ? <ChecksChip item={item} /> : null}
            {item.kind !== "deployment" ? (
              <span className="inline-flex items-center gap-1 text-[12.5px] text-[var(--ca-ink-2)]">
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                {files === null || files === undefined ? "– files" : `${files} ${files === 1 ? "file" : "files"}`}
              </span>
            ) : null}
            {item.kind !== "deployment" ? (
              <span className="inline-flex gap-2 text-[12.5px]">
                <Signed value={item.stats?.additions ?? null} kind="add" />
                <Signed value={item.stats?.deletions ?? null} kind="del" />
              </span>
            ) : null}
            {unchecked ? <span className="text-[12px] italic text-[var(--ca-muted)]">path not checked</span> : null}
          </span>
        </span>
      </button>
      <div className="absolute right-3 top-3 flex items-center gap-1 @max-[440px]:static @max-[440px]:pb-2 @max-[440px]:pl-[60px]">
        <ShaCopy sha={item.sha} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`More actions for ${item.title}`} className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[var(--ca-muted)] outline-none max-md:h-11 max-md:w-11 hover:bg-white focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]">
              <Ellipsis className="h-4 w-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {item.url ? (
              <DropdownMenuItem asChild>
                <a href={item.url} target="_blank" rel="noopener noreferrer">Open on GitHub</a>
              </DropdownMenuItem>
            ) : null}
            {item.sha ? <DropdownMenuItem onSelect={() => void navigator.clipboard?.writeText(item.sha as string)}>Copy full SHA</DropdownMenuItem> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

export const WorkspaceList = forwardRef<WorkspaceListHandle, { items: readonly WorkspaceItem[]; selectedId: string | null; unchecked: ReadonlySet<string>; now: number; onSelect: (id: string) => void; label: string }>(function WorkspaceList({ items, selectedId, unchecked, now, onSelect, label }, ref) {
  const rows = useRef(new Map<string, HTMLButtonElement>());
  useImperativeHandle(ref, () => ({ focusRow: (id) => rows.current.get(id)?.focus() }), []);
  const groups = useMemo(() => {
    const out: Array<{ label: string; items: WorkspaceItem[] }> = [];
    for (const item of items) {
      const g = dayGroup(item.occurredAt, now);
      const last = out[out.length - 1];
      if (last && last.label === g) last.items.push(item);
      else out.push({ label: g, items: [item] });
    }
    return out;
  }, [items, now]);
  return (
    <div role="region" aria-label={label}>
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h3 className="px-5 pb-1 pt-4 text-[13px] font-medium text-[var(--ca-muted)]">{g.label}</h3>
          <ul>
            {g.items.map((item) => (
              <Row key={item.id} item={item} selected={item.id === selectedId} unchecked={unchecked.has(item.id)} now={now} onSelect={() => onSelect(item.id)} rowRef={(el) => (el ? rows.current.set(item.id, el) : rows.current.delete(item.id))} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
});
