import { useMemo, useState } from "react";
import { Check, ChevronDown, Ellipsis, GitBranch, Github, Plus, RefreshCw, Search, Settings2, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { relativeTime } from "../format";
import type { BranchInfo, CompareInfo } from "../live/workspace-api";
import { Spinner } from "../ui-parts";
import { authorKey, STATUS_LABEL, statusOptions, typesFor } from "./filters";
import type { WorkspaceFilters } from "./filters";
import type { WorkspaceCategory, WorkspaceItem, WorkspaceKind } from "./types";
import { CheckOption, CONTROL, FilterPopover } from "./WorkspaceParts";

const KIND_LABEL: Record<WorkspaceKind, string> = { commit: "Commit", pull_request: "Pull request", push: "Push", check: "Check", deployment: "Deployment" };

// ---- repository toolbar ----------------------------------------------------------------------------

export interface RepositoryToolbarProps {
  repository: string;
  suspended: boolean;
  lastSyncedAt: string | null;
  syncLabel: string;
  syncOk: boolean;
  refreshing: boolean;
  now: number;
  branches: { kind: "idle" | "loading" | "error"; message?: string } | { kind: "ready"; items: BranchInfo[]; defaultBranch: string | null; hasMore: boolean; complete: boolean };
  branch: string | null;
  onBranch: (name: string) => void;
  onLoadMoreBranches: () => void;
  compare: { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: CompareInfo };
  compareBase: string | null;
  defaultBranch: string | null;
  onCompareBase: (name: string | null) => void;
  canRefresh: boolean;
  canManage: boolean;
  onRefresh: () => void;
  onManage: () => void;
}

export function RepositoryToolbar(p: RepositoryToolbarProps) {
  const [owner, repo] = p.repository.includes("/") ? (p.repository.split("/", 2) as [string, string]) : ["", p.repository];
  const items = p.branches.kind === "ready" ? p.branches.items : [];
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <Github className="h-7 w-7 shrink-0 text-[var(--ca-ink)]" aria-hidden="true" />
        <h2 className="min-w-0 truncate text-[16px] font-semibold leading-6">
          {owner ? <span className="font-medium text-[var(--ca-ink-2)]">{owner} / </span> : null}
          {repo}
        </h2>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-px text-[12px]", p.suspended ? "border-transparent bg-[var(--ca-warn-bg)] text-[var(--ca-warn-ink)]" : "border-transparent bg-[var(--ca-ok-bg)] text-[var(--ca-ok-ink)]")}>
          <Check className="h-3 w-3" aria-hidden="true" />
          {p.suspended ? "Suspended" : "Connected"}
        </span>
        <span className="text-[13px] text-[var(--ca-muted)]" aria-live="polite">
          {p.lastSyncedAt ? `Last synced ${relativeTime(p.lastSyncedAt, p.now)}` : "Not synced yet"}
        </span>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-px text-[12px]", p.syncOk ? "border-[var(--ca-line)] text-[var(--ca-ink-2)]" : "border-transparent bg-[var(--ca-warn-bg)] text-[var(--ca-warn-ink)]")}>
          {p.refreshing ? <Spinner className="h-3 w-3" /> : null}
          {p.syncLabel}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <BranchPicker items={items} loading={p.branches.kind === "loading"} error={p.branches.kind === "error" ? (p.branches.message ?? "Branches could not be loaded.") : null} branch={p.branch} defaultBranch={p.defaultBranch} complete={p.branches.kind === "ready" ? p.branches.complete : true} hasMore={p.branches.kind === "ready" && p.branches.hasMore} onPick={p.onBranch} onMore={p.onLoadMoreBranches} />
        <CompareChip compare={p.compare} base={p.compareBase} defaultBranch={p.defaultBranch} branch={p.branch} items={items} onBase={p.onCompareBase} />
        {p.canRefresh ? (
          <button type="button" onClick={p.onRefresh} disabled={p.refreshing || p.suspended} className={CONTROL}>
            <RefreshCw className={cn("h-4 w-4", p.refreshing && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
            Sync
          </button>
        ) : null}
        {p.canManage ? (
          <button type="button" onClick={p.onManage} className={CONTROL}>
            <Settings2 className="h-4 w-4" aria-hidden="true" />
            Manage
          </button>
        ) : null}
      </div>
    </div>
  );
}

function BranchPicker({ items, loading, error, branch, defaultBranch, complete, hasMore, onPick, onMore }: { items: BranchInfo[]; loading: boolean; error: string | null; branch: string | null; defaultBranch: string | null; complete: boolean; hasMore: boolean; onPick: (n: string) => void; onMore: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => items.filter((b) => b.name.toLowerCase().includes(query.trim().toLowerCase())), [items, query]);
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQuery(""); }}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(CONTROL, "max-w-[280px]")} aria-label={`Branch: ${branch ?? (loading ? "loading" : "none")}`} aria-haspopup="dialog">
          <GitBranch className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{branch ?? (loading ? "Loading branches…" : error ? "Branches unavailable" : "Choose a branch")}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-2" aria-label="Choose a branch">
        <label className="sr-only" htmlFor="ca-branch-search">Search branches</label>
        <input id="ca-branch-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search branches" className="mb-2 h-9 w-full rounded-lg border border-[var(--ca-line)] px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]" />
        {error ? <p role="alert" className="px-2 py-3 text-[13px] text-[var(--ca-bad-ink)]">{error}</p> : null}
        <ul role="listbox" aria-label="Branches" className="max-h-[260px] overflow-auto">
          {shown.map((b) => (
            <li key={b.name} role="option" aria-selected={b.name === branch}>
              <button type="button" onClick={() => { onPick(b.name); setOpen(false); }} className="flex min-h-[34px] w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 text-left text-[13px] outline-none hover:bg-[var(--ca-surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]">
                <span className="truncate">{b.name}</span>
                {b.name === defaultBranch ? <span className="shrink-0 text-[12px] text-[var(--ca-muted)]">default</span> : null}
                {b.name === branch ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
              </button>
            </li>
          ))}
        </ul>
        {shown.length === 0 && !error ? <p className="px-2 py-3 text-[13px] text-[var(--ca-muted)]">{loading ? "Loading…" : "No branch matches."}</p> : null}
        {hasMore ? <button type="button" onClick={onMore} className={cn(CONTROL, "mt-2 w-full justify-center")}>Load more branches</button> : null}
        {!complete ? <p className="px-2 pt-2 text-[12px] text-[var(--ca-muted)]">Only the first branches are listed. Use search on GitHub for others.</p> : null}
      </PopoverContent>
    </Popover>
  );
}

function CompareChip({ compare, base, defaultBranch, branch, items, onBase }: { compare: RepositoryToolbarProps["compare"]; base: string | null; defaultBranch: string | null; branch: string | null; items: BranchInfo[]; onBase: (n: string | null) => void }) {
  const target = base ?? defaultBranch;
  const sameAsBase = branch !== null && target === branch;
  const text =
    sameAsBase ? "Default branch"
    : compare.kind === "ready" ? (compare.data.status === "identical" ? "Up to date with" : `${compare.data.ahead ?? "?"} ahead · ${compare.data.behind ?? "?"} behind`)
    : compare.kind === "loading" ? "Comparing…"
    : compare.kind === "error" ? "Comparison unavailable"
    : "Not compared";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn("inline-flex min-h-[36px] max-md:min-h-[44px] cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[12px] text-[var(--ca-muted)] outline-none hover:bg-[var(--ca-surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]")} aria-label={`Comparison with ${target ?? "no branch"}: ${text}. Change base branch`} aria-live="polite">
          <span title={compare.kind === "error" ? compare.message : compare.kind === "ready" ? `Checked ${compare.data.checkedAt}` : undefined}>{text}</span>
          <span className="font-medium text-[var(--ca-ink-2)]">{target ?? ""}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[280px] p-2" aria-label="Compare against">
        <p className="px-2 pb-1 text-[12px] text-[var(--ca-muted)]">Compare this branch against</p>
        <ul className="max-h-[240px] overflow-auto">
          {items.filter((b) => b.name !== branch).map((b) => (
            <li key={b.name}>
              <button type="button" onClick={() => onBase(b.name === defaultBranch ? null : b.name)} className="flex min-h-[34px] w-full cursor-pointer items-center justify-between rounded-lg px-2 text-left text-[13px] outline-none hover:bg-[var(--ca-surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]">
                <span className="truncate">{b.name}</span>
                {b.name === target ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// ---- category, search and create -----------------------------------------------------------------

const CATEGORIES: Array<{ id: WorkspaceCategory; label: string }> = [
  { id: "all", label: "All activity" },
  { id: "commits", label: "Commits" },
  { id: "pull_requests", label: "Pull requests" },
  { id: "checks", label: "Checks" },
  { id: "deployments", label: "Deployments" },
];

export function ActivityToolbar({ category, onCategory, prCount, search, onSearch, canCreate, onCreate }: { category: WorkspaceCategory; onCategory: (c: WorkspaceCategory) => void; prCount: number | null; search: string; onSearch: (s: string) => void; canCreate: boolean; onCreate: () => void }) {
  return (
    <div className="ca-list-chrome flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[var(--ca-line)] px-5 py-2">
      <div role="tablist" aria-label="Activity category" className="ca-rail flex min-w-0 items-center gap-1">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={category === c.id}
            onClick={() => onCategory(c.id)}
            onKeyDown={(e) => {
              const i = CATEGORIES.findIndex((x) => x.id === category);
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next = CATEGORIES[(i + (e.key === "ArrowRight" ? 1 : CATEGORIES.length - 1)) % CATEGORIES.length];
                onCategory(next.id);
                requestAnimationFrame(() => (e.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-cat="${next.id}"]`))?.focus());
              }
            }}
            data-cat={c.id}
            tabIndex={category === c.id ? 0 : -1}
            className={cn("ca-control inline-flex min-h-[38px] shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-[10px] px-3.5 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]", category === c.id ? "bg-[var(--ca-accent-soft)] font-semibold text-[var(--ca-accent-ink)]" : "text-[var(--ca-ink-2)] hover:bg-[var(--ca-surface-soft)]")}
          >
            {c.label}
            {c.id === "pull_requests" && prCount !== null ? <span className="rounded-full bg-[var(--ca-surface-soft)] px-1.5 text-[12px] text-[var(--ca-ink-2)]">{prCount}</span> : null}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-3 max-md:flex-wrap">
        <label className="relative block w-full max-w-[400px] max-md:max-w-none max-md:basis-full">
          <span className="sr-only">Search commits, pull requests and files</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ca-muted)]" aria-hidden="true" />
          <input type="search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search commits, PRs, files…" className="ca-control h-[38px] w-full rounded-[10px] border border-[var(--ca-line)] bg-[var(--ca-surface)] pl-9 pr-3 text-[13px] outline-none placeholder:text-[var(--ca-muted)] focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]" />
        </label>
        {canCreate ? (
          <button type="button" onClick={onCreate} title="Open this List’s Magic Box (Ctrl/Cmd+K)" className="ca-control inline-flex h-[36px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[10px] border border-[var(--ca-line-strong)] px-3 text-[13px] font-medium text-[var(--ca-accent-ink)] outline-none hover:bg-[var(--ca-accent-soft)] focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)] focus-visible:ring-offset-2">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Capture Thing <kbd aria-hidden="true" className="ml-1 rounded bg-[var(--ca-surface-soft)] px-1 text-[12px]">⌘ K</kbd>
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---- filters -----------------------------------------------------------------------------------------

export interface FilterBarProps {
  category: WorkspaceCategory;
  filters: WorkspaceFilters;
  onFilters: (f: WorkspaceFilters) => void;
  onClear: () => void;
  count: number;
  items: readonly WorkspaceItem[];
  branches: BranchInfo[];
  branch: string | null;
  onBranch: (name: string) => void;
  issues: { date?: string; path?: string };
}

function FilterControls(p: FilterBarProps) {
  const authors = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of p.items) map.set(authorKey(i), i.author.name);
    for (const a of p.filters.authors) if (!map.has(a)) map.set(a, a);
    return [...map].sort((a, b) => a[1].localeCompare(b[1]));
  }, [p.items, p.filters.authors]);
  const toggle = <K extends "authors" | "statuses" | "types">(key: K, value: WorkspaceFilters[K][number], on: boolean) => {
    const current = p.filters[key] as Array<WorkspaceFilters[K][number]>;
    p.onFilters({ ...p.filters, [key]: on ? [...current, value] : current.filter((v) => v !== value) });
  };
  return (
    <>
      <FilterPopover label="Author" count={p.filters.authors.length}>
        {authors.length === 0 ? <p className="px-2 py-2 text-[13px] text-[var(--ca-muted)]">Authors appear as activity loads.</p> : authors.map(([key, name]) => <CheckOption key={key} checked={p.filters.authors.includes(key)} onChange={(on) => toggle("authors", key, on)}>{name}</CheckOption>)}
      </FilterPopover>
      <FilterPopover label="Branch" count={0}>
        <ul role="listbox" aria-label="Branch">
          {p.branches.map((b) => (
            <li key={b.name} role="option" aria-selected={b.name === p.branch}>
              <button type="button" onClick={() => p.onBranch(b.name)} className="flex min-h-[34px] w-full cursor-pointer items-center justify-between rounded-lg px-2 text-left text-[13px] outline-none hover:bg-[var(--ca-surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]">
                <span className="truncate">{b.name}</span>
                {b.name === p.branch ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              </button>
            </li>
          ))}
        </ul>
        <p className="px-2 pt-2 text-[12px] text-[var(--ca-muted)]">Same as the branch picker above.</p>
      </FilterPopover>
      <FilterPopover label="Status" count={p.filters.statuses.length}>
        {statusOptions(p.category).map((s) => <CheckOption key={s} checked={p.filters.statuses.includes(s)} onChange={(on) => toggle("statuses", s, on)}>{STATUS_LABEL[s] ?? s}</CheckOption>)}
      </FilterPopover>
      <FilterPopover label="Activity type" count={p.filters.types.length}>
        {typesFor(p.category).map((k) => <CheckOption key={k} checked={p.filters.types.includes(k)} onChange={(on) => toggle("types", k, on)}>{KIND_LABEL[k]}</CheckOption>)}
      </FilterPopover>
      <FilterPopover label="Date" count={p.filters.dateFrom || p.filters.dateTo ? 1 : 0} width={260}>
        <div className="space-y-2 p-1">
          <label className="block text-[12px] text-[var(--ca-muted)]">From
            <input type="date" value={p.filters.dateFrom ?? ""} onChange={(e) => p.onFilters({ ...p.filters, dateFrom: e.target.value || null })} className="mt-1 h-9 w-full rounded-lg border border-[var(--ca-line)] px-2 text-[13px] text-[var(--ca-ink)]" />
          </label>
          <label className="block text-[12px] text-[var(--ca-muted)]">To
            <input type="date" value={p.filters.dateTo ?? ""} onChange={(e) => p.onFilters({ ...p.filters, dateTo: e.target.value || null })} className="mt-1 h-9 w-full rounded-lg border border-[var(--ca-line)] px-2 text-[13px] text-[var(--ca-ink)]" />
          </label>
          <p className="text-[12px] text-[var(--ca-muted)]">Your local calendar days.</p>
          {p.issues.date ? <p role="alert" className="text-[12px] text-[var(--ca-bad-ink)]">{p.issues.date}</p> : null}
        </div>
      </FilterPopover>
      <FilterPopover label="File path" count={p.filters.path.trim() ? 1 : 0} width={280}>
        <div className="space-y-2 p-1">
          <label className="block text-[12px] text-[var(--ca-muted)]">Path or folder
            <input value={p.filters.path} onChange={(e) => p.onFilters({ ...p.filters, path: e.target.value })} placeholder="src/features/auth" aria-invalid={p.issues.path ? true : undefined} className="ca-code mt-1 h-9 w-full rounded-lg border border-[var(--ca-line)] px-2 text-[13px] text-[var(--ca-ink)]" />
          </label>
          <p className="text-[12px] text-[var(--ca-muted)]">Exact, folder prefix, or ending at a path boundary. No wildcards.</p>
          {p.issues.path ? <p role="alert" className="text-[12px] text-[var(--ca-bad-ink)]">{p.issues.path}</p> : null}
        </div>
      </FilterPopover>
    </>
  );
}

export function FilterBar(p: FilterBarProps) {
  return (
    <div className="ca-list-chrome border-t border-[var(--ca-line)] px-4 py-2">
      <div className="ca-filter-row flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <FilterControls {...p} />
        <button type="button" onClick={p.onClear} disabled={p.count === 0} className="ml-auto cursor-pointer rounded-md px-2 py-1 text-[13px] font-medium text-[var(--ca-accent)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)] disabled:cursor-default disabled:opacity-40 disabled:no-underline">
          Clear filters
        </button>
      </div>
      <div className="ca-filter-compact items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={cn(CONTROL, "min-h-[44px]")} aria-haspopup="dialog">
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              Filters{p.count > 0 ? ` (${p.count})` : ""}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" aria-label="Filters" className="w-[min(92vw,340px)] space-y-2 p-3">
            <div className="flex flex-wrap gap-2"><FilterControls {...p} /></div>
            <button type="button" onClick={p.onClear} disabled={p.count === 0} className="cursor-pointer text-[13px] font-medium text-[var(--ca-accent)] disabled:opacity-40">Clear filters</button>
          </PopoverContent>
        </Popover>
        <Ellipsis className="hidden" aria-hidden="true" />
      </div>
    </div>
  );
}
