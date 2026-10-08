import { useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { capabilitiesFor } from "../access";
import { CoeyDraftReview } from "../CoeyDraftReview";
import { createLiveAdapter } from "../live/adapter";
import type { AiStatus } from "../live/parse";
import { useAssigneeCandidates, useChangeDetail } from "../live/use-feed";
import { Notice, Spinner } from "../ui-parts";
import { CommitThingForm } from "./CommitThingForm";
import type { ListRole } from "../types";
import type { WorkspaceItem } from "./types";

/**
 * Contextual creation: a reviewed Thing drafted from the change that is open. Saved pull requests and pushes use the existing
 * reviewed flow. Commits go through the manual form, which registers the commit as a source first.
 */
export function CreateFromChangeDialog({ item, listId, listName, role, ai, onClose, onOpenConsent, onOpenThings }: { item: WorkspaceItem; listId: string; listName: string; role: ListRole; ai: AiStatus; onClose: () => void; onOpenConsent: () => void; onOpenThings?: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent aria-describedby={undefined} className="max-h-[92vh] max-w-3xl overflow-y-auto p-0">
        <DialogTitle className="sr-only">Create a Thing from {item.title}</DialogTitle>
        <DialogDescription className="sr-only">Review the Thing before it is created. Nothing is created until you confirm.</DialogDescription>
        {item.savedId ? (
          <SavedChange item={item} savedId={item.savedId} listId={listId} listName={listName} role={role} ai={ai} onClose={onClose} onOpenConsent={onOpenConsent} onOpenThings={onOpenThings} />
        ) : item.kind === "commit" || item.kind === "pull_request" ? (
          <CommitThingForm item={item} listId={listId} canCreate={capabilitiesFor(role).canCreateThings} onClose={onClose} onOpenThings={onOpenThings} />
        ) : (
          <div className="space-y-3 p-6">
            <h2 className="text-[18px] font-semibold">Create a Thing from this change</h2>
            <Notice tone="info">Things can be created from commits and pull requests. For anything else, use Create Thing in the toolbar.</Notice>
            <button type="button" onClick={onClose} className="inline-flex min-h-[36px] cursor-pointer items-center rounded-[10px] border border-[var(--ca-line)] px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]">Close</button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SavedChange({ item, savedId, listId, listName, role, ai, onClose, onOpenConsent, onOpenThings }: { item: WorkspaceItem; savedId: string; listId: string; listName: string; role: ListRole; ai: AiStatus; onClose: () => void; onOpenConsent: () => void; onOpenThings?: () => void }) {
  const { phase, retry } = useChangeDetail(listId, savedId);
  const adapter = useMemo(() => createLiveAdapter(listId), [listId]);
  const candidates = useAssigneeCandidates(listId, capabilitiesFor(role).canCreateThings);
  if (phase.kind === "loading") return <div role="status" className="flex items-center gap-2 p-6 text-[13px]"><Spinner /> Reading {item.title} from GitHub…</div>;
  if (phase.kind === "error")
    return (
      <div role="alert" className="space-y-3 p-6">
        <p className="text-[13px]">{phase.message}</p>
        <button type="button" onClick={retry} className="inline-flex min-h-[36px] cursor-pointer items-center rounded-[10px] border border-[var(--ca-line)] px-3 text-[13px] font-medium">Try again</button>
      </div>
    );
  return (
    <CoeyDraftReview
      change={phase.change}
      role={role}
      consent={ai.consent}
      listName={listName}
      adapter={adapter}
      candidates={candidates.candidates}
      candidatesLoading={candidates.loading}
      candidatesError={candidates.error}
      onRetryCandidates={candidates.retryable ? candidates.retry : undefined}
      onClose={onClose}
      onOpenConsentSettings={() => {
        onClose();
        onOpenConsent();
      }}
      onCreateManually={onOpenThings}
      live
      startMode="manual"
      onOpenThing={() => {
        onClose();
        onOpenThings?.();
      }}
    />
  );
}
