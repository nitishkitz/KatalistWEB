import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import type { Thing } from "@/domain/thing";
import { keys } from "@/domain/query-keys";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { WorkStatusBadge } from "@/components/katalist/WorkStatusBadge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CourtDetailModal } from "@/features/court/CourtDetailModal";
import { useThing } from "@/features/things/use-thing";
import { useSolvedThings } from "./use-solved-things";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives focus when the dialog is finally closed. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
};

function sortedLabel(thing: Thing) {
  if (!thing.sortedAt) return "Sorted";
  const date = new Date(thing.sortedAt);
  return Number.isNaN(date.getTime()) ? "Sorted" : `Sorted ${format(date, "MMM d, yyyy, h:mm a")}`;
}

function peopleLabel(thing: Thing) {
  return thing.owner.id === thing.assignee.id ? "Self-assigned" : `Assigned by ${thing.owner.name}`;
}

export function SolvedThingsDialog({ open, onOpenChange, returnFocusRef }: Props) {
  const qc = useQueryClient();
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const list = useSolvedThings(open);
  const [selected, setSelected] = useState<Thing | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const savedScroll = useRef(0);
  const selectedRef = useRef<Thing | null>(null);
  selectedRef.current = selected;
  const restoreRowId = useRef<string | null>(null);

  // Never carry rows or a selected detail across a sign-out or account switch.
  const userId = user?.id ?? null;
  const lastUserId = useRef(userId);
  useEffect(() => {
    if (lastUserId.current === userId) return;
    lastUserId.current = userId;
    setSelected(null);
    setUnavailable(false);
    restoreRowId.current = null;
    onOpenChange(false);
  }, [userId, onOpenChange]);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setUnavailable(false);
      restoreRowId.current = null;
    }
  }, [open]);

  // Freshness check for the selected Thing: the overview row must not stand
  // in as authorized detail once access has been lost.
  const detail = useThing(selected ? selected.id : null);
  const gone = Boolean(selected) && !preview && !detail.isLoading && !detail.error && detail.thing === null;
  useEffect(() => {
    if (!gone || !selected) return;
    restoreRowId.current = null;
    setSelected(null);
    setUnavailable(true);
    void qc.invalidateQueries({ queryKey: keys.solvedThings(user?.id) });
  }, [gone, selected, qc, user?.id]);

  const listVisible = open && !selected;

  // Restore scroll position and row focus when the list reappears.
  useLayoutEffect(() => {
    if (!listVisible) return;
    const container = scrollRef.current;
    if (container) container.scrollTop = savedScroll.current;
    const rowId = restoreRowId.current;
    if (rowId) {
      restoreRowId.current = null;
      container?.querySelector<HTMLElement>(`[data-solved-row="${CSS.escape(rowId)}"]`)?.focus({ preventScroll: true });
    }
  }, [listVisible]);

  const openRow = (thing: Thing) => {
    savedScroll.current = scrollRef.current?.scrollTop ?? 0;
    restoreRowId.current = thing.id;
    setUnavailable(false);
    setSelected(thing);
  };

  const closeDetail = () => {
    setSelected(null);
  };

  return (
    <>
      <Dialog open={listVisible} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl flex-col gap-3 p-0 sm:rounded-2xl"
          aria-describedby="solved-things-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!selectedRef.current) returnFocusRef?.current?.focus();
          }}
        >
          <DialogHeader className="px-5 pt-5 text-left">
            <DialogTitle>Sorted Things</DialogTitle>
            <DialogDescription id="solved-things-description">
              Things assigned to you that are currently solved.
            </DialogDescription>
          </DialogHeader>

          {unavailable ? (
            <p role="status" className="mx-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
              This Thing is no longer available.
            </p>
          ) : null}
          {list.isStale ? (
            <p role="alert" className="mx-5 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
              <span>This list may be out of date.</span>
              <button type="button" onClick={list.retry} className="shrink-0 font-semibold underline">Retry</button>
            </p>
          ) : null}

          <div ref={scrollRef} className="min-h-[160px] flex-1 overflow-y-auto px-5 pb-5">
            {list.isLoading ? (
              <p role="status" className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading sorted Things…
              </p>
            ) : list.isError ? (
              <div role="alert" className="py-6 text-[13px]">
                <p className="text-foreground">Sorted Things could not be loaded.</p>
                <button type="button" onClick={list.retry} className="mt-2 font-semibold text-primary underline">Retry</button>
              </div>
            ) : list.things.length === 0 ? (
              <p className="py-6 text-[13px] text-muted-foreground">No sorted Things yet.</p>
            ) : (
              <>
                <ul className="divide-y divide-[#eef0f6]">
                  {list.things.map((thing) => (
                    <li key={thing.id}>
                      <button
                        type="button"
                        data-solved-row={thing.id}
                        onClick={() => openRow(thing)}
                        className="flex w-full items-start justify-between gap-3 rounded-lg px-2 py-3 text-left outline-none hover:bg-[#f7f6fd] focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-[#000533]">{thing.title}</span>
                          <span className="mt-0.5 block text-[12px] text-[#6a769c]">
                            {peopleLabel(thing)} · {thing.context === "home" ? "Home" : "Work"} · {sortedLabel(thing)}
                          </span>
                        </span>
                        <WorkStatusBadge value="sorted" className="shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
                {list.hasNextPage ? (
                  <button
                    type="button"
                    disabled={list.isFetchingNextPage}
                    onClick={list.fetchNextPage}
                    className="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-border bg-white text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {list.isFetchingNextPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Load more
                  </button>
                ) : null}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <CourtDetailModal thing={selected} isOpen={open && Boolean(selected) && !gone} onClose={closeDetail} />
    </>
  );
}
