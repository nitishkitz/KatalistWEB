import { useId, useState } from "react";
import { MessageSquare, Unlink } from "lucide-react";
import { describeWriteError } from "./design-library-model";
import { DesignOperationError } from "./design-queries";
import { useDesignMutations, useDesignThingLinks } from "./use-designs";

export type LinkableThing = { id: string; title: string };

const small =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#eaeffa] bg-white px-3 text-[13px] font-medium text-[#1d1d1d] outline-none hover:bg-[#fafaff] focus-visible:ring-2 focus-visible:ring-[#975ee2] disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Things linked to one design. Only Things of this List are offered (the database enforces it too).
 * Discussion stays in the Thing's own comments and mentions; this panel only routes there.
 */
export function DesignThingLinksPanel({
  listId,
  resourceId,
  archived,
  things,
  canManage,
  onOpenThing,
}: {
  listId: string;
  resourceId: string;
  archived: boolean;
  things: readonly LinkableThing[];
  canManage: boolean;
  onOpenThing?: (thingId: string) => void;
}) {
  const uid = useId();
  const { links, isLoading, error, refetch } = useDesignThingLinks(listId, resourceId);
  const { linkThing, unlinkThing } = useDesignMutations(listId);
  const [pick, setPick] = useState("");
  const [actionError, setActionError] = useState<DesignOperationError | null>(null);

  const linkedIds = new Set(links.map((l) => l.thingId));
  const options = things.filter((t) => !linkedIds.has(t.id));
  const titleOf = (id: string) => things.find((t) => t.id === id)?.title ?? "Thing not loaded in this view";

  const link = async () => {
    if (!pick) return;
    setActionError(null);
    try {
      await linkThing.mutateAsync({ resourceId, thingId: pick });
      setPick("");
    } catch (e) {
      setActionError(e instanceof DesignOperationError ? e : new DesignOperationError("unknown", "That could not be linked."));
    }
  };
  const unlink = async (thingId: string) => {
    setActionError(null);
    try {
      await unlinkThing.mutateAsync({ resourceId, thingId });
    } catch (e) {
      setActionError(e instanceof DesignOperationError ? e : new DesignOperationError("unknown", "That could not be unlinked."));
    }
  };

  return (
    <section aria-label="Linked Things" data-testid="design-thing-links" className="mt-3 border-t border-[#eef0f6] pt-3">
      <h4 className="text-[13px] font-semibold text-[#000533]">Linked Things</h4>

      {error ? (
        <p role="alert" className="mt-1 text-[12.5px] text-[#b42318]">
          Linked Things could not be loaded.{" "}
          <button type="button" onClick={() => void refetch()} className="cursor-pointer font-medium underline">Retry</button>
        </p>
      ) : isLoading ? (
        <p role="status" className="mt-1 text-[12.5px] text-[#6a769c]">Loading linked Things…</p>
      ) : links.length === 0 ? (
        <p className="mt-1 text-[12.5px] text-[#6a769c]">No Things are linked to this design yet.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#fafaff] px-3 py-2">
              <span className="min-w-0 break-words text-[13px] text-[#000533]">{titleOf(l.thingId)}</span>
              <span className="flex gap-1.5">
                {onOpenThing && (
                  <button type="button" onClick={() => onOpenThing(l.thingId)} className={small} aria-label={`Open discussion for ${titleOf(l.thingId)}`}>
                    <MessageSquare className="h-4 w-4" aria-hidden="true" /> Open Thing
                  </button>
                )}
                {canManage && (
                  <button
                    type="button"
                    disabled={unlinkThing.isPending}
                    onClick={() => void unlink(l.thingId)}
                    className={small}
                    aria-label={`Unlink ${titleOf(l.thingId)}`}
                  >
                    <Unlink className="h-4 w-4" aria-hidden="true" /> Unlink
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canManage && !archived && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={`${uid}-thing`} className="text-[12.5px] font-medium text-[#4a5578]">Link a Thing from this List</label>
            <select
              id={`${uid}-thing`}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              disabled={options.length === 0}
              className="mt-1 h-10 w-full rounded-lg border border-[#dfe3f0] bg-white px-2.5 text-[13.5px] text-[#000533] outline-none focus:border-[#975ee2] focus-visible:ring-2 focus-visible:ring-[#975ee2]/40"
            >
              <option value="">{options.length === 0 ? "No Things available to link" : "Choose a Thing"}</option>
              {options.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>
          <button type="button" disabled={!pick || linkThing.isPending} onClick={() => void link()} className={small}>
            {linkThing.isPending ? "Linking…" : "Link Thing"}
          </button>
        </div>
      )}
      {actionError && <p role="alert" className="mt-1 text-[12.5px] text-[#b42318]">{describeWriteError(actionError)}</p>}
    </section>
  );
}
