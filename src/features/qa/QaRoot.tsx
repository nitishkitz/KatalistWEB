import { useCallback, useEffect, useMemo, useState } from "react";
import { Bug, ClipboardList, History as HistoryIcon, Lock, Play, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import "./qa-workspace.css";
import { AccessWorkspace, type QaScope } from "./access/AccessWorkspace";
import { DefectsWorkspace } from "./defects/DefectsWorkspace";
import { HistoryWorkspace } from "./history/HistoryWorkspace";
import { TestLibrary } from "./library/TestLibrary";
import { RunsWorkspace } from "./runs/RunsWorkspace";
import { useQaAccess, useQaApplications, useQaEnvironments } from "./use-qa";
import { EmptyNotice, ErrorNotice, PreviewBanner, Spinner, primaryButton } from "./ui";
import type { QaListRole, QaMember, QaThingSummary } from "./types";

export type QaView = "access" | "library" | "runs" | "defects" | "history";
export type QaReturnContext = { view: QaView; runId: string | null; runCaseId: string | null; scope: QaScope | null };

const NAV: Array<{ id: QaView; label: string; icon: typeof Lock }> = [
  { id: "access", label: "Access", icon: Lock },
  { id: "library", label: "Test Sheet", icon: ClipboardList },
  { id: "runs", label: "Runs", icon: Play },
  { id: "defects", label: "Defects", icon: Bug },
  { id: "history", label: "History", icon: HistoryIcon },
];

/**
 * Manual QA for one List: where testing happens (Access), reusable versioned cases (Test Sheet),
 * build-specific execution (Runs), the Things raised from failures (Defects) and the permanent record
 * (History). It lives inside the List workspace and never renders its own header or shell.
 */
export default function QaRoot({
  listId, listRole, listContext, members, things, initialContext, onContextChange, onOpenThing,
}: {
  listId: string;
  listRole: QaListRole;
  listContext: "work" | "home";
  members: readonly QaMember[];
  /** The List's real Things; QA only reads them. */
  things: readonly QaThingSummary[];
  initialContext: QaReturnContext | null;
  onContextChange: (ctx: QaReturnContext) => void;
  /** Routes to the existing Thing detail and remembers where to come back to. */
  onOpenThing: (thingId: string, ctx: QaReturnContext) => void;
}) {
  const canManage = listRole === "owner" || listRole === "collaborator";
  const { preview, profileId, available } = useQaAccess(listId);
  const apps = useQaApplications(listId);
  const envs = useQaEnvironments(listId);
  const [view, setView] = useState<QaView>(initialContext?.view ?? "access");
  const [scope, setScope] = useState<QaScope | null>(initialContext?.scope ?? null);
  const [runId, setRunId] = useState<string | null>(initialContext?.runId ?? null);
  const [runCaseId, setRunCaseId] = useState<string | null>(initialContext?.runCaseId ?? null);
  const [newRunRequest, setNewRunRequest] = useState<readonly string[] | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const markDirty = useCallback((key: string) => (v: boolean) => setDirty((d) => (d[key] === v ? d : { ...d, [key]: v })), []);
  const dirtyAccess = useMemo(() => markDirty("access"), [markDirty]);
  const dirtyLibrary = useMemo(() => markDirty("library"), [markDirty]);
  const dirtyRuns = useMemo(() => markDirty("runs"), [markDirty]);
  const anyDirty = Object.values(dirty).some(Boolean);

  // Default target: the first application and, preferably, the environment named QA.
  useEffect(() => {
    if (scope && apps.data?.some((a) => a.id === scope.applicationId) && envs.data?.some((e) => e.id === scope.environmentId)) return;
    const app = apps.data?.find((a) => !a.archived);
    const env = envs.data?.find((e) => !e.archived && /^qa$/i.test(e.name)) ?? envs.data?.find((e) => !e.archived);
    if (app && env) setScope({ applicationId: app.id, environmentId: env.id });
  }, [apps.data, envs.data, scope]);

  const ctx: QaReturnContext = useMemo(() => ({ view, runId, runCaseId, scope }), [view, runId, runCaseId, scope]);
  useEffect(() => onContextChange(ctx), [ctx, onContextChange]);

  // Unsaved edits get a leave warning for the browser and for in-feature navigation.
  useEffect(() => {
    if (!anyDirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [anyDirty]);
  const go = (next: QaView) => {
    if (next === view) return;
    if (anyDirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    setDirty({});
    setView(next);
  };
  const openThing = useCallback((thingId: string, rc?: string | null) => {
    onOpenThing(thingId, { view: view === "defects" || view === "history" ? view : "runs", runId, runCaseId: rc ?? runCaseId, scope });
  }, [onOpenThing, view, runId, runCaseId, scope]);

  if (!available) return <div className="rounded-[10px] bg-white p-4 text-[13px] text-[#6a769c]">Sign in to use QA.</div>;
  const setupMissing = apps.error?.code === "migration_missing" || envs.error?.code === "migration_missing";

  return (
    <section data-qa-root="" aria-label="Manual QA" className="qa-surface overflow-hidden">
      {preview && <PreviewBanner />}
      <div className="qa-nav" role="navigation" aria-label="QA sections">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className="qa-nav-item" aria-current={view === id ? "page" : undefined} onClick={() => go(id)}>
            <Icon className="h-4 w-4" aria-hidden="true" /> {label}
          </button>
        ))}
        <span className="flex-1" />
        {canManage && view === "library" && !setupMissing && (
          <button type="button" className={cn(primaryButton, "my-1.5 shrink-0")} onClick={() => { setNewRunRequest([]); setView("runs"); }}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New run
          </button>
        )}
      </div>

      {setupMissing ? (
        <div className="p-4">
          <ErrorNotice error={(apps.error ?? envs.error)!} />
          <p className="mx-4 text-[12.5px] text-[#6a769c]">QA stays unavailable until the QA migration is applied to this database. No data is shown or saved in the meantime.</p>
        </div>
      ) : apps.isLoading || envs.isLoading ? (
        <Spinner label="Loading QA…" />
      ) : (apps.error || envs.error) && !apps.hasFetchedOnce ? (
        <ErrorNotice error={(apps.error ?? envs.error)!} onRetry={() => { void apps.refetch(); void envs.refetch(); }} />
      ) : (
        <>
          {view === "access" && (
            <AccessWorkspace
              listId={listId} canManage={canManage} members={members} apps={apps.data ?? []} envs={envs.data ?? []} scope={scope}
              onScopeChange={setScope} onStartRun={() => { setNewRunRequest([]); setView("runs"); }} onDirtyChange={dirtyAccess}
            />
          )}
          {view === "library" && (
            <TestLibrary listId={listId} canManage={canManage} onDirtyChange={dirtyLibrary} onCreateRun={(ids) => { setNewRunRequest(ids); setView("runs"); }} />
          )}
          {view === "runs" && (
            <RunsWorkspace
              listId={listId} canManage={canManage} profileId={profileId} members={members} things={things} apps={apps.data ?? []} envs={envs.data ?? []} listContext={listContext}
              scope={scope} runId={runId} onRunChange={setRunId} newRunRequest={newRunRequest} onNewRunHandled={() => setNewRunRequest(null)}
              openRunCaseId={runCaseId} onRunCaseChange={setRunCaseId} onOpenThing={(id, rc) => openThing(id, rc)} onViewDefects={() => go("defects")} onDirtyChange={dirtyRuns}
            />
          )}
          {view === "defects" && (
            <DefectsWorkspace listId={listId} things={things} onOpenThing={(id) => openThing(id)} onOpenResult={(rid, rcid) => { setRunId(rid); setRunCaseId(rcid); setView("runs"); }} />
          )}
          {view === "history" && <HistoryWorkspace listId={listId} members={members} things={things} onOpenThing={(id) => openThing(id)} />}
          {(apps.data?.length ?? 0) === 0 && view !== "access" && view !== "history" && (
            <EmptyNotice title="Set up your applications first" body="Add an application and environment in Access so runs know where they are testing." action={<button type="button" className={primaryButton} onClick={() => go("access")}>Go to Access</button>} />
          )}
        </>
      )}
    </section>
  );
}
