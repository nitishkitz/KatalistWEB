import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSessionDraft } from "@/features/drafts/use-session-draft";
import { getDraft, setDraft, clearDraft } from "@/features/drafts/session-drafts";
import {
  mergeThingReferences,
  parseClipboardThingReferences,
  sanitizeThingReferences,
  supportedThingOrigins,
  type ThingReference,
} from "./thing-reference";

type ReferenceDraftKind = "list-chat-references" | "thing-comment-references";

/** Draft-scoped Thing references for a message or comment composer. Same identity/entity slot rules as the text draft. */
export function useReferenceDraft(kind: ReferenceDraftKind, entityId: string) {
  const qc = useQueryClient();
  const draft = useSessionDraft<ThingReference[]>(kind, entityId, []);
  const references = sanitizeThingReferences(draft.value);

  const add = useCallback(
    (incoming: ThingReference[]) => {
      const current = sanitizeThingReferences(getDraft<ThingReference[]>(qc, kind, entityId)?.value);
      const merged = mergeThingReferences(current, incoming);
      if (merged.added > 0) setDraft(qc, kind, entityId, { value: merged.references });
      if (merged.duplicates > 0) toast.info(merged.added > 0 ? "Some Things were already added." : "That Thing is already added.");
      if (merged.overflow > 0) toast.error("Up to 10 Things can be added.");
    },
    [qc, kind, entityId],
  );
  const remove = useCallback(
    (thingId: string) => {
      const next = sanitizeThingReferences(getDraft<ThingReference[]>(qc, kind, entityId)?.value).filter((r) => r.thingId !== thingId);
      if (next.length) setDraft(qc, kind, entityId, { value: next });
      else clearDraft(qc, kind, entityId);
    },
    [qc, kind, entityId],
  );
  const clear = useCallback(() => clearDraft(qc, kind, entityId), [qc, kind, entityId]);
  /** Puts a failed submission's references back, only when nothing was staged since. */
  const restore = useCallback(
    (refs: ThingReference[]) => {
      if (refs.length && !getDraft(qc, kind, entityId)) setDraft(qc, kind, entityId, { value: refs });
    },
    [qc, kind, entityId],
  );
  /** Paste handler for the composer's own input. Ordinary text, and any file paste, is left alone. */
  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLElement>) => {
      if (event.clipboardData.files?.length) return;
      const pasted = parseClipboardThingReferences(event.clipboardData.getData("text/plain"), supportedThingOrigins());
      if (!pasted) return;
      event.preventDefault();
      add(pasted);
    },
    [add],
  );
  return { references, add, remove, clear, restore, onPaste };
}
