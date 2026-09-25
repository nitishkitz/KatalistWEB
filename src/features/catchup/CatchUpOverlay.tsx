import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AsyncState } from "@/components/katalist/AsyncState";
import type { Thing } from "@/domain/thing";
import { CatchUpStack } from "./CatchUpStack";
import type { CatchUpMoment } from "./use-catchup";

type Props = {
  open: boolean;
  onClose: () => void;
  moments: CatchUpMoment[];
  myActorId: string | null;
  surfaceMoment: (momentKey: string) => Promise<void>;
  onOpenThing: (thing: Thing) => void;
  onRefresh: () => void;
  /** T10-06: the same async facts `useCatchup()` already computes -- passed
   *  through so this dialog can show a real initial-loading/initial-failure/
   *  successful-empty/background-failure state instead of only ever
   *  rendering the stack (or nothing) once `moments.length > 0`. */
  isLoading: boolean;
  error: unknown;
  isEmpty: boolean;
  hasFetchedOnce: boolean;
};

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <div className="h-40 animate-pulse rounded-[16px] border border-slate-200 bg-slate-100" />
      <div className="flex justify-center gap-2">
        <div className="h-9 w-9 animate-pulse rounded-full bg-slate-100" />
        <div className="h-9 w-16 animate-pulse rounded-full bg-slate-100" />
        <div className="h-9 w-9 animate-pulse rounded-full bg-slate-100" />
      </div>
    </div>
  );
}

export function CatchUpOverlay({
  open,
  onClose,
  moments,
  myActorId,
  surfaceMoment,
  onOpenThing,
  onRefresh,
  isLoading,
  error,
  isEmpty,
  hasFetchedOnce,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* T10-06: ~960px max width on desktop (this codebase's breakpoints
          have no dedicated ~960px token -- `lg` (1024px) is the nearest
          established one and is what the rest of the app already keys
          responsive layout off of); full-height, edge-to-edge on mobile so
          the sticky action row at the bottom of CatchUpStack stays
          reachable without the dialog itself needing to scroll. */}
      <DialogContent className="flex h-dvh max-h-dvh w-full flex-col gap-0 overflow-hidden rounded-none border-none bg-slate-50 p-0 lg:h-auto lg:max-h-[85vh] lg:max-w-[960px] lg:gap-5 lg:rounded-2xl lg:border lg:p-6">
        <div className="shrink-0 border-b border-slate-200/70 px-4 pb-3 pt-4 lg:border-none lg:p-0">
          {/* F03: internal name (CatchUp*) stays -- only the user-visible label changes. */}
          <DialogTitle className="text-[18px] font-bold text-slate-900 lg:text-[20px]">Morning Brief</DialogTitle>
          <DialogDescription className="text-[12.5px] text-slate-500">
            {hasFetchedOnce
              ? `${moments.length} ${moments.length === 1 ? "moment needs" : "moments need"} you`
              : "Checking for updates…"}
          </DialogDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:overflow-visible lg:p-0">
          <AsyncState
            isLoading={isLoading}
            data={moments}
            error={error}
            onRetry={onRefresh}
            isEmpty={isEmpty}
            hasFetchedOnce={hasFetchedOnce}
            emptyTitle="You're all caught up"
            emptyDescription="No nudges, snoozes, or follow-ups need your attention right now."
            loadingContent={<LoadingSkeleton />}
          >
            {(data) =>
              open ? (
                <CatchUpStack
                  moments={data}
                  myActorId={myActorId}
                  surfaceMoment={surfaceMoment}
                  onOpenThing={onOpenThing}
                  onClose={onClose}
                  onRefresh={onRefresh}
                />
              ) : null
            }
          </AsyncState>
        </div>
      </DialogContent>
    </Dialog>
  );
}
