import { useEffect, useMemo, useRef, useState } from "react";
import "./code-activity-workspace.css";
import { capabilitiesFor } from "../access";
import type { Person } from "@/domain/thing";
import type { AiStatus } from "../live/parse";
import type { ListRole, SyncStatus } from "../types";
import { Notice, Spinner } from "../ui-parts";
import { CreateFromChangeDialog } from "./CreateFromChangeDialog";
import { CreateThingDock } from "./CreateThingDock";
import { useCreateThingDock } from "./use-create-thing-dock";
import { useWorkspace } from "./use-workspace";
import { useActivityPagination } from "./use-activity-pagination";
import { WorkspaceDetailPane } from "./WorkspaceDetailPane";
import { WorkspaceList } from "./WorkspaceList";
import type { WorkspaceListHandle } from "./WorkspaceList";
import { ActivityToolbar, FilterBar, RepositoryToolbar } from "./WorkspaceToolbars";
import { tryHandleMagicBoxCapture } from "@/features/court/magic-box-entry";
import { CONTROL } from "./WorkspaceParts";
import type { WorkspaceDetail } from "./types";

const SYNC_LABEL: Record<SyncStatus, string> = { ok: "Up to date", syncing: "Syncing now…", partial: "Partial sync", stale: "Out of date", unavailable: "Sync unavailable" };

export interface CodeActivityWorkspaceProps {
  listId: string;
  listName: string;
  repositoryFullName?: string;
  role: ListRole;
  suspended: boolean;
  ai: AiStatus;
  people: Person[];
  onManage: () => void;
  onOpenConsent: () => void;
  onOpenThings?: () => void;
}

/**
 * The Code Activity workspace: repository toolbar, category and search, filters, then a persistent activity list beside the
 * selected change. Below 1024 px it shows one pane at a time with a real Back action.
 */
export function CodeActivityWorkspace({ listId, listName, repositoryFullName, role, suspended, ai, people, onManage, onOpenConsent, onOpenThings }: CodeActivityWorkspaceProps) {
  const caps = capabilitiesFor(role);
  const ws = useWorkspace(listId, repositoryFullName ?? "", caps.canRefresh && !suspended);
  const pagination = useActivityPagination({ key: ws.paginationKey, hasMore: ws.hasMorePages, busy: ws.loadingMore || ws.loading, failed: ws.pageError, loadMore: ws.loadMore });
  const data = ws.feed.phase.kind === "ready" ? ws.feed.phase.data : null;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const [view, setView] = useState<"list" | "detail">("list");
  const listRef = useRef<WorkspaceListHandle>(null);
  const dock = useCreateThingDock(caps.canCreateThings);
  const [creating, setCreating] = useState<WorkspaceDetail | null>(null);

  const syncStatus: SyncStatus = ws.feed.refreshing ? "syncing" : (data?.freshness.syncStatus ?? "unavailable");
  const prCount = useMemo(() => (data ? data.changes.filter((c) => c.kind === "pull_request").length : null), [data]);
  const branches = ws.branches.kind === "ready" ? ws.branches.data : null;

  // On a wide screen the detail pane is part of the layout, so the newest change is selected until the person picks another.
  const firstId = ws.items[0]?.id ?? null;
  useEffect(() => {
    if (ws.selectedId !== null || firstId === null) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1024px)").matches) ws.select(firstId);
  }, [ws.selectedId, firstId, ws.select]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (id: string) => {
    ws.select(id);
    setView("detail");
  };
  const back = () => {
    setView("list");
    const id = ws.selectedId;
    if (id) requestAnimationFrame(() => listRef.current?.focusRow(id));
  };

  const createGlobal = async () => {
    // The same function Ctrl/Cmd+K runs: reveal the List-scoped Magic Box here, or fall back to nothing special.
    if (!(await tryHandleMagicBoxCapture())) dock.reveal();
  };

  const empty = !ws.loading && ws.items.length === 0;
  const filtered = ws.filterCount > 0;

  return (
    <div data-code-activity-workspace data-view={view} className="relative">
      <RepositoryToolbar
        repository={data?.repositoryFullName || repositoryFullName || "Repository"}
        suspended={suspended}
        lastSyncedAt={data?.freshness.lastSyncedAt ?? null}
        syncLabel={SYNC_LABEL[syncStatus]}
        syncOk={syncStatus === "ok"}
        refreshing={ws.feed.refreshing}
        now={now}
        branches={ws.branches.kind === "ready" ? { kind: "ready", items: ws.branches.data.items, defaultBranch: ws.branches.data.defaultBranch, hasMore: ws.branches.data.nextCursor !== null, complete: ws.branches.data.complete } : ws.branches.kind === "error" ? { kind: "error", message: ws.branches.message } : { kind: ws.branches.kind }}
        branch={ws.branch}
        onBranch={ws.setBranch}
        onLoadMoreBranches={() => void ws.loadMoreBranches()}
        compare={ws.compare}
        compareBase={ws.compareBase}
        defaultBranch={ws.defaultBranch}
        onCompareBase={ws.setCompareBase}
        canRefresh={caps.canRefresh}
        canManage={caps.canManageConnection}
        onRefresh={() => void ws.refreshAll()}
        onManage={onManage}
      />
      <ActivityToolbar category={ws.category} onCategory={ws.setCategory} prCount={prCount} search={ws.filters.search} onSearch={(s) => ws.setFilters({ ...ws.filters, search: s })} canCreate={caps.canCreateThings} onCreate={() => void createGlobal()} />
      <FilterBar category={ws.category} filters={ws.filters} onFilters={ws.setFilters} onClear={ws.clearFilters} count={ws.filterCount} items={ws.items} branches={branches?.items ?? []} branch={ws.branch} onBranch={ws.setBranch} issues={ws.issues} />

      <div className="ca-list-chrome ca-status-strip empty:hidden">
        {suspended ? <Notice tone="warn" className="mt-2"><b>GitHub App suspended.</b> Saved activity is shown as of the last sync. Nothing new is read until it is unsuspended.</Notice> : null}
        {ws.feed.notice ? <Notice tone="bad" live="status" className="mt-2">{ws.feed.notice}</Notice> : null}
        {!ws.feed.refreshing && data?.freshness.syncStatus === "partial" ? <Notice tone="info" className="mt-2"><b>Partial sync.</b> What is shown is accurate, but some activity or check results could not be read within the limits.</Notice> : null}
        {ws.deploymentsPermissionNeeded && (ws.category === "deployments" || ws.category === "all") ? (
          <details className="ca-status-disclosure"><summary>Deployments unavailable · permission needed</summary><p>The GitHub App needs Deployments read access. Its owner can grant this in GitHub. Katalist never changes deployments.</p></details>
        ) : null}
        {ws.sourceErrors.map((e) => (
          <div key={e.source} className="ca-source-error" role="status">
            <details className="ca-status-disclosure"><summary>{e.source === "commits" ? "Commits" : e.source === "deployments" ? "Deployments" : "Saved activity"} could not be loaded.</summary><p>{e.message} Other loaded activity remains available.</p></details>
            <button type="button" title={e.message} onClick={() => ws.retrySource(e.source)} className="cursor-pointer rounded px-1 font-medium underline focus-visible:outline-2">Retry</button>
          </div>
        ))}
        {filtered && ws.hasMorePages ? <details className="ca-status-disclosure"><summary>Filters cover {ws.totalLoaded} loaded items</summary><p>Results may be incomplete. Load more activity to search older history.</p></details> : null}
        {!ws.commitsWindowComplete && (ws.category === "all" || ws.category === "commits") ? <details className="ca-status-disclosure"><summary>Recent commit window</summary><p>Narrow with a date, author or path to look further back.</p></details> : null}
        {ws.loading && ws.items.length > 0 ? <span role="status" className="inline-flex items-center gap-2"><Spinner /> Loading remaining activity…</span> : null}
      </div>

      <div className="ca-split">
        <div ref={pagination.rootRef} className="ca-feed" data-pane="list" role="region" aria-label="Git activity history" tabIndex={0}>
          {ws.loading && ws.items.length === 0 ? (
            <div role="status" aria-label="Loading activity" className="space-y-3 p-5">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-[72px] animate-pulse rounded-lg bg-[var(--ca-surface-soft)] motion-reduce:animate-none" />)}
            </div>
          ) : empty ? (
            <div className="px-6 py-14 text-center">
              <p className="text-[16px] font-semibold">
                {ws.sourceErrors.length > 0 ? "Some activity could not be loaded" : filtered ? "No activity matches these filters" : ws.category === "deployments" ? (ws.deploymentsPermissionNeeded ? "Deployments are not available yet" : "No deployments recorded") : data?.freshness.lastSyncedAt === null && ws.category !== "commits" ? "Not synced yet" : "No activity on this branch"}
              </p>
              <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-[var(--ca-muted)]">
                {ws.sourceErrors.length > 0 ? "Use Retry above. A failed read does not mean this repository is empty." : filtered ? "Try removing a filter or loading older activity." : ws.category === "deployments" ? (ws.deploymentsPermissionNeeded ? "Open the permission note above for details." : "GitHub has no deployments for this repository.") : ws.category === "checks" ? "Check results appear once commits or pull requests with checks have loaded." : "Choose another branch above or Sync to read its latest activity."}
              </p>
              {filtered ? <button type="button" onClick={ws.clearFilters} className={`${CONTROL} mt-4`}>Clear filters</button> : null}
            </div>
          ) : (
            <>
              <WorkspaceList ref={listRef} items={ws.items} selectedId={ws.selectedId} unchecked={ws.pathUnchecked} now={now} onSelect={select} label="Activity" />
            </>
          )}
          <div ref={pagination.endRef} aria-hidden="true" className="h-px" />
          {ws.hasMorePages ? <div className="px-4 py-3">
            {ws.pageError ? <p role="status" className="mb-2 text-[12px] text-[var(--ca-muted)]">Older activity could not be loaded. Your place is kept.</p> : null}
            <button type="button" disabled={ws.loadingMore} onClick={() => void ws.loadMore()} className={CONTROL}>{ws.loadingMore ? "Loading older activity…" : ws.pageError ? "Retry older activity" : "Load more activity"}</button>
          </div> : !ws.loading && ws.sourceErrors.length === 0 && ws.totalLoaded > 0 ? <p className="px-4 py-3 text-center text-[12px] text-[var(--ca-muted)]">End of available activity</p> : null}
        </div>
        <WorkspaceDetailPane phase={ws.detail} item={ws.selected} now={now} canCreate={caps.canCreateThings} onCreateThing={setCreating} onBack={back} onRetry={ws.retryDetail} />
      </div>

      {caps.canCreateThings ? <CreateThingDock open={dock.open} onClose={dock.close} listId={listId} listName={listName} people={people} /> : null}
      {creating && ws.selected ? <CreateFromChangeDialog item={ws.selected} listId={listId} listName={listName} role={role} ai={ai} onClose={() => setCreating(null)} onOpenConsent={onOpenConsent} onOpenThings={onOpenThings} /> : null}
    </div>
  );
}
