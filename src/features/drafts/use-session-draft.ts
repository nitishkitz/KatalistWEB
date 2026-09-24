import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clearDraft, getDraft, getDraftRevision, setDraft, subscribeDraft, type DraftComposerKind } from "./session-drafts";

/** Same identity/entity slot across dock, Hub, List and call composers. */
export function useSessionDraft<T>(kind: DraftComposerKind, entityId: string, emptyValue: T) {
  const qc = useQueryClient();
  const subscribe = useCallback((listener: () => void) => subscribeDraft(qc, kind, entityId, listener), [qc, kind, entityId]);
  const snapshot = useCallback(() => getDraftRevision(qc, kind, entityId), [qc, kind, entityId]);
  const revision = useSyncExternalStore(subscribe, snapshot, () => 0);
  const current = getDraft<T>(qc, kind, entityId);
  const write = useCallback((value: T, attachments?: unknown[], metadata?: unknown) => {
    const previous = getDraft<T>(qc, kind, entityId);
    setDraft(qc, kind, entityId, {
      value,
      attachments: attachments === undefined ? previous?.attachments : attachments,
      metadata: metadata === undefined ? previous?.metadata : metadata,
    });
  }, [qc, kind, entityId]);
  const clear = useCallback(() => clearDraft(qc, kind, entityId), [qc, kind, entityId]);
  return { value: current?.value ?? emptyValue, attachments: current?.attachments, metadata: current?.metadata, revision, write, clear };
}
