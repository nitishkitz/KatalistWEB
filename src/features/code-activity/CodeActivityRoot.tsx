import { useState } from "react";
import { capabilitiesFor } from "./access";
import { ActivityView } from "./ActivityView";
import { CodeActivityWorkspace } from "./workspace/CodeActivityWorkspace";
import type { Person } from "@/domain/thing";
import { ConnectedPanel, ManageDialog, ConnectorCard, NoRepositoriesPanel, RepositorySelection, ReverifyPanel, UnconnectedPanel } from "./ConnectionPanels";
import { relativeTime } from "./format";
import { useConnection } from "./live/use-connection";
import type { SelectableRepository } from "./repository";
import { Notice, Spinner } from "./ui-parts";
import type { ListRole } from "./types";

export interface CodeActivityRootProps {
  listId: string;
  listName: string;
  /** The signed-in person's List role. */
  listRole: ListRole;
  /** Opens the normal Things tab so a person can create a Thing by hand. */
  onOpenThings?: () => void;
  /** List members, offered as @-mention candidates in the Create Thing composer. */
  people?: Person[];
  /** Overrides the build default. Tests use it; the app does not. */
  workspace?: boolean;
}

/** The workspace is the default. VITE_CODE_ACTIVITY_WORKSPACE=false falls back to the earlier feed view. */
const WORKSPACE_DEFAULT = import.meta.env !== undefined && import.meta.env.VITE_CODE_ACTIVITY_WORKSPACE !== "false";

/**
 * Connection flow (G06) and real activity (G07 to G09). Every state comes from a validated server reply:
 * no sample data and no assumed connection.
 */
function Inner({ listId, listName, listRole, onOpenThings, people = [], workspace = WORKSPACE_DEFAULT }: CodeActivityRootProps) {
  const isOwner = capabilitiesFor(listRole).canManageConnection;
  const flow = useConnection(listId, isOwner);
  const [manageOpen, setManageOpen] = useState(false);
  const { phase } = flow;

  let body;
  if (phase.kind === "loading") {
    body = <ConnectorCard readiness="loading" isOwner={isOwner} />;
  } else if (phase.kind === "unavailable") {
    body = <ConnectorCard readiness="unavailable" isOwner={isOwner} />;
  } else if (phase.kind === "setup_pending") {
    body = <ConnectorCard readiness="setup_pending" isOwner={isOwner} />;
  } else if (phase.kind === "error") {
    body = (
      <div role="alert" className="mx-auto my-10 max-w-md rounded-xl border border-[#eaeffa] bg-white p-6 text-center">
        <div className="text-[16px] font-semibold text-[#000533]">Code Activity could not be loaded</div>
        <p className="mt-1 text-[13px] text-[#6a769c]">{phase.message} Things, Chat, and Members are not affected.</p>
        <button
          type="button"
          onClick={flow.reload}
          className="mt-4 inline-flex h-[42px] cursor-pointer items-center rounded-[9px] border border-[#eaeffa] bg-white px-4 text-[14px] font-medium text-[#1d1d1d] outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2]"
        >
          Try again
        </button>
      </div>
    );
  } else if (phase.kind === "selecting") {
    if (phase.repositories === null) {
      body = (
        <div role="status" aria-label="Loading repositories" className="flex items-center gap-2 px-6 py-10 text-[13px] text-[#6a769c]">
          <Spinner className="h-4 w-4" /> Loading repositories…
        </div>
      );
    } else if (phase.repositories.length === 0) {
      body = (
        <NoRepositoriesPanel
          busy={flow.busy}
          onInstall={() => void flow.startFlow("install")}
          onRetry={() => void flow.startFlow("oauth")}
          onCancel={flow.cancelSelecting}
        />
      );
    } else {
      const byName = new Map(phase.repositories.map((r) => [r.fullName, r.proofId]));
      const repositories: SelectableRepository[] = phase.repositories.map((r) => ({
        id: r.proofId,
        fullName: r.fullName,
        visibility: r.visibility,
        updatedLabel: r.updatedAt ? `updated ${relativeTime(r.updatedAt)}` : "update time unknown",
      }));
      body = (
        <RepositorySelection
          repositories={repositories}
          busy={flow.busy}
          error={flow.actionError}
          hasMore={phase.nextCursor !== null}
          loadingMore={phase.loadingMore}
          onLoadMore={() => void flow.loadMore()}
          onCancel={flow.cancelSelecting}
          onConnect={(fullName) => {
            const proofId = byName.get(fullName);
            if (proofId) void flow.connectProof(proofId);
          }}
        />
      );
    }
  } else {
    const { connection } = phase;
    const live = connection.status === "active" || connection.status === "suspended" || connection.status === "pending_repository";
    body = connection.needsReverification ? (
      <>
        {flow.actionError ? (
          <div className="px-5 pt-4 lg:px-8">
            <Notice tone="bad" live="alert">
              {flow.actionError}
            </Notice>
          </div>
        ) : null}
        <ReverifyPanel isOwner={isOwner} busy={flow.busy} onDisconnect={() => void flow.disconnect()} />
      </>
    ) : live ? (
      <>
        {connection.status === "pending_repository" ? (
          <ConnectedPanel repository={connection.repositoryFullName} status="pending_repository" isOwner={isOwner} onManage={() => setManageOpen(true)} />
        ) : (
          workspace ? (
            <CodeActivityWorkspace
              repositoryFullName={connection.repositoryFullName ?? undefined}
              listId={listId}
              listName={listName}
              role={listRole}
              suspended={connection.status === "suspended"}
              ai={flow.ai}
              people={people}
              onManage={() => setManageOpen(true)}
              onOpenConsent={() => setManageOpen(true)}
              onOpenThings={onOpenThings}
            />
          ) : (
            <ActivityView
              listId={listId}
              listName={listName}
              role={listRole}
              suspended={connection.status === "suspended"}
              ai={flow.ai}
              onManage={() => setManageOpen(true)}
              onOpenConsent={() => setManageOpen(true)}
              onOpenThings={onOpenThings}
            />
          )
        )}
        {isOwner ? (
          <ManageDialog
            open={manageOpen}
            onOpenChange={setManageOpen}
            repository={connection.repositoryFullName ?? "this repository"}
            showConsent={flow.ai.available}
            consent={flow.ai.consent}
            onConsentChange={(value) => void flow.setConsent(value)}
            busy={flow.busy}
            error={flow.actionError}
            onDisconnect={() => void flow.disconnect()}
          />
        ) : null}
      </>
    ) : (
      <>
        {flow.actionError ? (
          <div className="px-5 pt-4 lg:px-8">
            <Notice tone="bad" live="alert">
              {flow.actionError}
            </Notice>
          </div>
        ) : null}
        <UnconnectedPanel
          isOwner={isOwner}
          variant={connection.status === "revoked" ? "revoked" : connection.status === "disconnected" ? "disconnected" : "unconnected"}
          busy={flow.busy}
          onConnect={isOwner ? () => void flow.startFlow("oauth") : undefined}
        />
      </>
    );
  }

  return (
    <div data-code-activity-root className="overflow-hidden rounded-xl border border-[#eaeffa] bg-white">
      {flow.notice && phase.kind !== "unavailable" && phase.kind !== "setup_pending" && phase.kind !== "loading" ? (
        <div className="px-5 pt-4 lg:px-8">
          <Notice tone={flow.notice.tone} live="status">
            {flow.notice.text}
          </Notice>
        </div>
      ) : null}
      {body}
    </div>
  );
}

/** Lazy entry point for the List Detail tab. The error boundary wraps it in the List route, outside this lazy chunk. */
export default function CodeActivityRoot(props: CodeActivityRootProps) {
  return <Inner {...props} />;
}
