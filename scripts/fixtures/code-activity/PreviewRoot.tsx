// Fixture-backed preview harness. Kept for reference and tests only; it is NOT imported by the app runtime.
// The live Root (src/features/code-activity/CodeActivityRoot.tsx) replaces it as live adapters land (G08).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { capabilitiesFor } from "@/features/code-activity/access";
import { ActivityFeed } from "@/features/code-activity/ActivityFeed";
import { ChangeInspector } from "@/features/code-activity/ChangeInspector";
import { CodeActivityBoundary } from "@/features/code-activity/CodeActivityBoundary";
import { ManageDialog, RepositorySelection, UnconnectedPanel } from "@/features/code-activity/ConnectionPanels";
import type { FeedFilter } from "@/features/code-activity/feed-filter";
import { relativeTime } from "@/features/code-activity/format";
import { SAMPLE_REPOSITORY } from "./fixtures";
import { createPreviewAdapter, defaultScenario } from "./preview-adapter";
import type { PreviewScenario } from "./preview-adapter";
import { PreviewBar } from "./PreviewBar";
import { Notice, Spinner } from "@/features/code-activity/ui-parts";
import { useCodeActivity } from "@/features/code-activity/use-code-activity";
import type { ActivityFeedData, AssigneeCandidate, ListRole, SyncStatus } from "@/features/code-activity/types";

export interface CodeActivityRootProps {
  listId: string;
  listName: string;
  /** The signed-in person's List role. The preview can override it to show other views. */
  listRole: ListRole;
  /** Opens the normal Things tab so a person can create a Thing by hand. */
  onOpenThings?: () => void;
}

const SYNC_LABEL: Record<SyncStatus, string> = {
  ok: "Up to date",
  syncing: "Syncing now…",
  partial: "Partial sync",
  stale: "Out of date",
  unavailable: "Sync unavailable",
};

const BTN =
  "inline-flex min-h-[34px] cursor-pointer items-center gap-1.5 rounded-lg border border-[#eaeffa] bg-white px-3 text-[13px] text-[#1d1d1d] outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2] disabled:cursor-not-allowed disabled:opacity-45";

function Inner({ listId, listName, listRole, onOpenThings }: CodeActivityRootProps) {
  const [scenario, setScenario] = useState<PreviewScenario>(() => defaultScenario(listRole));
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;
  const rootRef = useRef<HTMLDivElement>(null);

  const adapter = useMemo(() => createPreviewAdapter({ getScenario: () => scenarioRef.current }), []);
  const caps = capabilitiesFor(scenario.role);

  const reloadKey = `${listId}|${scenario.feed}|${scenario.sync}|${scenario.connection === "active" || scenario.connection === "suspended" ? "live" : "none"}`;
  const { state, refreshing, refresh, retry } = useCodeActivity(adapter, reloadKey);

  const [filter, setFilter] = useState<FeedFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lastOpened = useRef<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [candidates, setCandidates] = useState<AssigneeCandidate[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
  }, [state]);

  useEffect(() => {
    const controller = new AbortController();
    adapter
      .loadAssigneeCandidates(controller.signal)
      .then((list) => setCandidates(list))
      .catch(() => {
        if (!controller.signal.aborted) setCandidates([]);
      });
    return () => controller.abort();
  }, [adapter, scenario.role]);

  const patch = useCallback((p: Partial<PreviewScenario>) => setScenario((s) => ({ ...s, ...p })), []);

  const data: ActivityFeedData | null = state.status === "ready" ? state.data : null;
  const selected = data?.changes.find((c) => c.id === selectedId && c.kind !== "gap") ?? null;

  const select = (id: string) => {
    lastOpened.current = id;
    setSelectedId(id);
  };
  const back = () => {
    const id = lastOpened.current;
    setSelectedId(null);
    // Restore keyboard focus to the row that opened the change.
    requestAnimationFrame(() => {
      if (id) rootRef.current?.querySelector<HTMLElement>(`[data-change-id="${CSS.escape(id)}"]`)?.focus();
    });
  };

  const connected = scenario.connection === "active" || scenario.connection === "suspended";
  const syncStatus: SyncStatus = refreshing ? "syncing" : (data?.freshness.syncStatus ?? "unavailable");
  const repo = data?.repositoryFullName ?? SAMPLE_REPOSITORY;

  let body;
  if (!connected) {
    body = selecting ? (
      <RepositorySelection
        onCancel={() => setSelecting(false)}
        onConnect={() => {
          setSelecting(false);
          patch({ connection: "active" });
        }}
      />
    ) : (
      <UnconnectedPanel
        isOwner={caps.canManageConnection}
        variant={scenario.connection === "revoked" ? "revoked" : scenario.connection === "disconnected" ? "disconnected" : "unconnected"}
        onConnect={() => setSelecting(true)}
      />
    );
  } else {
    body = (
      <>
        <div className={cn("flex-wrap items-center justify-between gap-2 border-b border-[#eef0f6] bg-[#fcfcfe] px-5 py-2.5 lg:px-8", selected ? "hidden lg:flex" : "flex")}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span className="font-mono text-[13px] font-semibold text-[#000533]">{repo}</span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-px text-[12px]",
                scenario.connection === "suspended" ? "border-[#e0b95c] bg-[#fff2d6] text-[#7a4d00]" : "border-[#bfe3cd] bg-[#e6f5ec] text-[#17663f]",
              )}
            >
              {scenario.connection === "suspended" ? "● Suspended" : "● Connected"}
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
            <button type="button" onClick={refresh} disabled={!caps.canRefresh || refreshing} className={BTN}>
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
              Refresh
            </button>
            {caps.canManageConnection ? (
              <button type="button" onClick={() => setManageOpen(true)} className={BTN}>
                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                Manage
              </button>
            ) : null}
          </div>
        </div>

        {scenario.connection === "suspended" ? (
          <div className="px-5 pt-3 lg:px-8">
            <Notice tone="warn">
              <b>GitHub App suspended.</b> Saved activity is shown as of the last sync. It resumes if the app is unsuspended and verified again.
            </Notice>
          </div>
        ) : null}
        {syncStatus === "stale" ? (
          <div className="px-5 pt-3 lg:px-8">
            <Notice tone="warn">
              <b>Activity may be out of date.</b> The last successful sync was a while ago. No automatic refresh is promised. Use Refresh to try again.
            </Notice>
          </div>
        ) : null}
        {syncStatus === "partial" ? (
          <div className="px-5 pt-3 lg:px-8">
            <Notice tone="info">
              <b>Partial sync.</b> Some activity could not be loaded within the limits. What is shown is accurate, but may be incomplete.
            </Notice>
          </div>
        ) : null}
        {syncStatus === "unavailable" && state.status === "ready" ? (
          <div className="px-5 pt-3 lg:px-8">
            <Notice tone="bad" live="status">
              <b>GitHub is unavailable.</b> Showing saved activity. Try again later.
            </Notice>
          </div>
        ) : null}

        {state.status === "loading" ? (
          <div className="space-y-3 px-5 py-6 lg:px-8" role="status" aria-label="Loading activity">
            <div className="h-5 w-40 animate-pulse rounded-md bg-[#eef0f6] motion-reduce:animate-none" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[88px] animate-pulse rounded-xl bg-[#f4f5fa] motion-reduce:animate-none" />
            ))}
          </div>
        ) : state.status === "error" ? (
          <div className="mx-auto my-10 max-w-md rounded-xl border border-[#eaeffa] bg-white p-6 text-center" role="alert">
            <div className="text-[16px] font-semibold text-[#000533]">Activity could not be loaded</div>
            <p className="mt-1 text-[13px] text-[#6a769c]">Things, Chat, and Members are not affected.</p>
            <button type="button" onClick={retry} className={cn(BTN, "mt-4 h-[42px] text-[14px]")}>
              Try again
            </button>
          </div>
        ) : data && data.changes.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <div className="text-[16px] font-semibold text-[#000533]">No activity yet</div>
            <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-[#6a769c]">
              The repository is connected but has no pull requests or pushes to show yet.
            </p>
          </div>
        ) : data ? (
          <div className="lg:flex lg:min-h-[640px]">
            <div className={cn("lg:block lg:w-[35%] lg:min-w-[360px] lg:border-r lg:border-[#eef0f6]", selected ? "hidden" : "block")}>
              <ActivityFeed changes={data.changes} filter={filter} onFilterChange={setFilter} selectedId={selected?.id ?? null} onSelect={select} now={now} />
            </div>
            <div className={cn("min-w-0 lg:block lg:flex-1", selected ? "block" : "hidden")}>
              {selected ? (
                <ChangeInspector
                  key={selected.id}
                  change={selected}
                  role={scenario.role}
                  consent={scenario.consent}
                  listName={listName}
                  adapter={adapter}
                  candidates={candidates}
                  now={now}
                  onBack={back}
                  onOpenConsentSettings={() => (caps.canChangeConsent ? setManageOpen(true) : undefined)}
                  onCreateManually={onOpenThings}
                />
              ) : (
                <div className="flex min-h-[420px] flex-col items-center justify-center gap-2 px-8 py-16 text-center">
                  <div className="text-[16px] font-semibold text-[#000533]">Select a change</div>
                  <p className="max-w-[300px] text-[13px] text-[#6a769c]">
                    Choose a pull request or push on the left to read its description, files, patches, and checks.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div ref={rootRef} data-code-activity-root className="overflow-hidden rounded-xl border border-[#eaeffa] bg-white">
      <PreviewBar scenario={scenario} onChange={patch} />
      {body}
      <ManageDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        repository={repo}
        consent={scenario.consent}
        onConsentChange={(consent) => patch({ consent })}
        onDisconnect={() => {
          setSelectedId(null);
          patch({ connection: "disconnected" });
        }}
      />
    </div>
  );
}

/** Lazy entry point for the List Detail tab. Failures stay inside this boundary. */
export default function PreviewCodeActivityRoot(props: CodeActivityRootProps) {
  return (
    <CodeActivityBoundary resetKey={props.listId}>
      <Inner {...props} />
    </CodeActivityBoundary>
  );
}
