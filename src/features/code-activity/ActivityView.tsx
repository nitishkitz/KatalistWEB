import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { capabilitiesFor } from "./access";
import { ActivityFeed } from "./ActivityFeed";
import { ChangeInspector } from "./ChangeInspector";
import type { FeedFilter } from "./feed-filter";
import { relativeTime } from "./format";
import { createLiveAdapter } from "./live/adapter";
import type { AiStatus } from "./live/parse";
import { useAssigneeCandidates, useChangeDetail, useLiveFeed } from "./live/use-feed";
import { Notice, Spinner } from "./ui-parts";
import type { ListRole, SyncStatus } from "./types";

const SYNC_LABEL: Record<SyncStatus, string> = {
  ok: "Up to date",
  syncing: "Syncing now…",
  partial: "Partial sync",
  stale: "Out of date",
  unavailable: "Sync unavailable",
};

const BTN =
  "inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-lg border border-[#eaeffa] bg-white px-3 text-[13px] text-[#1d1d1d] outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2] disabled:cursor-not-allowed disabled:opacity-45";

interface ActivityViewProps {
  listId: string;
  listName: string;
  role: ListRole;
  /** From the server; the saved feed may be shown while the GitHub App is suspended. */
  suspended: boolean;
  /** Coey: `available` is the operator switch plus a configured model; `consent` is the owner's per-List setting. */
  ai: AiStatus;
  onManage: () => void;
  /** Opens the owner's consent setting (the Manage dialog). */
  onOpenConsent: () => void;
  onOpenThings?: () => void;
}

/** One change in a click-open overlay: Escape, a close button, focus trapping and focus return come from the dialog. */
function ChangeOverlay({
  listId,
  listName,
  role,
  changeId,
  fallbackTitle,
  now,
  ai,
  onClose,
  onOpenConsent,
  onOpenThings,
}: {
  listId: string;
  listName: string;
  role: ListRole;
  changeId: string;
  fallbackTitle: string;
  now: number;
  ai: AiStatus;
  onClose: () => void;
  onOpenConsent: () => void;
  onOpenThings?: () => void;
}) {
  const { phase, retry } = useChangeDetail(listId, changeId);
  const adapter = useMemo(() => createLiveAdapter(listId), [listId]);
  const candidates = useAssigneeCandidates(listId, capabilitiesFor(role).canCreateThings);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        aria-describedby={undefined}
        className="left-0 top-0 block h-[100dvh] max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none p-0 sm:left-1/2 sm:top-[4vh] sm:h-[92vh] sm:max-w-4xl sm:-translate-x-1/2 sm:translate-y-0 sm:rounded-xl"
      >
        <DialogTitle className="sr-only">{fallbackTitle}</DialogTitle>
        <DialogDescription className="sr-only">Details for this change, read from GitHub.</DialogDescription>
        {phase.kind === "loading" ? (
          <div role="status" aria-label="Loading change" className="space-y-3 px-6 py-8">
            <div className="text-[16px] font-semibold text-[#000533]">{fallbackTitle}</div>
            <div className="flex items-center gap-2 text-[13px] text-[#6a769c]">
              <Spinner className="h-4 w-4" /> Reading from GitHub…
            </div>
          </div>
        ) : phase.kind === "error" ? (
          <div role="alert" className="px-6 py-8">
            <div className="text-[16px] font-semibold text-[#000533]">{fallbackTitle}</div>
            <p className="mt-2 text-[13px] text-[#6a769c]">{phase.message} The saved summary is unaffected.</p>
            <button type="button" onClick={retry} className={cn(BTN, "mt-4")}>
              Try again
            </button>
          </div>
        ) : (
          <ChangeInspector
            change={phase.change}
            role={role}
            consent={ai.consent}
            aiEnabled={ai.available}
            live
            listName={listName}
            adapter={adapter}
            candidates={candidates.candidates}
            candidatesLoading={candidates.loading}
            candidatesError={candidates.error}
            onRetryCandidates={candidates.retryable ? candidates.retry : undefined}
            now={now}
            onBack={onClose}
            onOpenConsentSettings={() => {
              onClose();
              onOpenConsent();
            }}
            onCreateManually={onOpenThings}
            onOpenThing={() => {
              onClose();
              onOpenThings?.();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The connected view: saved activity from GitHub, manual Refresh, and click-open detail. */
export function ActivityView({ listId, listName, role, suspended, ai, onManage, onOpenConsent, onOpenThings }: ActivityViewProps) {
  const caps = capabilitiesFor(role);
  const { phase, refreshing, loadingMore, notice, refresh, loadMore } = useLiveFeed(listId, caps.canRefresh && !suspended);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setNow(Date.now()), [phase]);
  useEffect(() => setSelectedId(null), [listId]);

  const data = phase.kind === "ready" ? phase.data : null;
  const syncStatus: SyncStatus = refreshing ? "syncing" : (data?.freshness.syncStatus ?? "unavailable");
  const selected = data?.changes.find((c) => c.id === selectedId) ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef0f6] bg-[#fcfcfe] px-5 py-2.5 lg:px-8">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <span className="font-mono text-[13px] font-semibold text-[#000533]">{data?.repositoryFullName || "Repository"}</span>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-px text-[12px]",
              suspended ? "border-[#e0b95c] bg-[#fff2d6] text-[#7a4d00]" : "border-[#bfe3cd] bg-[#e6f5ec] text-[#17663f]",
            )}
          >
            {suspended ? "Suspended" : "Connected"}
          </span>
          <span className="text-[#6a769c]" aria-live="polite">
            {data?.freshness.lastSyncedAt ? `Last synced ${relativeTime(data.freshness.lastSyncedAt, now)}` : "Not synced yet"}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-px text-[12px]",
              syncStatus === "ok" ? "border-[#eaeffa] text-[#4d5878]" : "border-[#e0b95c] bg-[#fff2d6] text-[#7a4d00]",
            )}
          >
            {syncStatus === "syncing" ? <Spinner className="h-3 w-3" /> : null}
            {SYNC_LABEL[syncStatus]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {caps.canRefresh ? (
            <button type="button" onClick={() => void refresh()} disabled={refreshing || suspended} className={BTN}>
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
              Refresh
            </button>
          ) : null}
          {caps.canManageConnection ? (
            <button type="button" onClick={onManage} className={BTN}>
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
              Manage
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 px-5 pt-3 empty:hidden lg:px-8">
        {suspended ? (
          <Notice tone="warn">
            <b>GitHub App suspended.</b> Saved activity is shown as of the last sync. Nothing new is read until it is unsuspended.
          </Notice>
        ) : null}
        {notice ? (
          <Notice tone="bad" live="status">
            {notice}
          </Notice>
        ) : null}
        {!refreshing && data && data.freshness.syncStatus === "unavailable" && data.freshness.lastSyncedAt !== null ? (
          <Notice tone="bad" live="status">
            <b>GitHub is unavailable.</b> Showing saved activity.
          </Notice>
        ) : null}
        {!refreshing && data?.freshness.syncStatus === "partial" ? (
          <Notice tone="info">
            <b>Partial sync.</b> What is shown is accurate, but some activity or check results could not be read within the limits.
          </Notice>
        ) : null}
      </div>

      {phase.kind === "loading" ? (
        <div className="space-y-3 px-5 py-6 lg:px-8" role="status" aria-label="Loading activity">
          <div className="h-5 w-40 animate-pulse rounded-md bg-[#eef0f6] motion-reduce:animate-none" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[72px] animate-pulse rounded-xl bg-[#f4f5fa] motion-reduce:animate-none" />
          ))}
        </div>
      ) : phase.kind === "error" ? (
        <div className="mx-auto my-10 max-w-md rounded-xl border border-[#eaeffa] bg-white p-6 text-center" role="alert">
          <div className="text-[16px] font-semibold text-[#000533]">Activity could not be loaded</div>
          <p className="mt-1 text-[13px] text-[#6a769c]">{phase.message} Things, Chat, and Members are not affected.</p>
        </div>
      ) : data && data.changes.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <div className="text-[16px] font-semibold text-[#000533]">
            {data.freshness.lastSyncedAt === null ? (refreshing ? "Reading from GitHub…" : "Not synced yet") : "No activity yet"}
          </div>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-[#6a769c]">
            {data.freshness.lastSyncedAt === null
              ? caps.canRefresh
                ? "Use Refresh to load pull requests and pushes from GitHub."
                : "An owner or collaborator can refresh to load activity from GitHub."
              : "The repository is connected but GitHub returned no pull requests or pushes to show."}
          </p>
        </div>
      ) : data ? (
        <>
          <ActivityFeed changes={data.changes} filter={filter} onFilterChange={setFilter} selectedId={selectedId} onSelect={setSelectedId} now={now} />
          {phase.kind === "ready" && phase.nextCursor ? (
            <div className="px-5 py-4 lg:px-8">
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className={BTN}>
                {loadingMore ? "Loading…" : "Load more activity"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {selected ? (
        <ChangeOverlay
          key={selected.id}
          listId={listId}
          listName={listName}
          role={role}
          changeId={selected.id}
          fallbackTitle={selected.title}
          now={now}
          ai={ai}
          onClose={() => setSelectedId(null)}
          onOpenConsent={onOpenConsent}
          onOpenThings={onOpenThings}
        />
      ) : null}
    </div>
  );
}
