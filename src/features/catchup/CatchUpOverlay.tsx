import { useState } from "react";
import { Bell, CalendarDays, ChevronRight, Clock } from "lucide-react";
import { useBriefGenie } from "./use-brief-genie";
import { digestCounts, type DigestCategory } from "./digest-categories";
import sunriseLandscape from "@/assets/morning-digest/sunrise-landscape.jpg";
import morningSymbol from "@/assets/morning-digest/morning-symbol.svg";
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
  const { panelRef, capture } = useBriefGenie(open);
  const closeBrief = () => { capture(); onClose(); };
  const openThing = (thing: Thing) => { capture(); onOpenThing(thing); };
  const [jump, setJump] = useState<{ category: DigestCategory; nonce: number } | null>(null);
  const counts = digestCounts(moments);
  const tiles: { category: DigestCategory; label: string; icon: typeof Bell; bg: string; chip: string }[] = [
    { category: "catch", label: "To catch", icon: Bell, bg: "#fff0f2", chip: "#ff8493" },
    { category: "stale", label: "Stale", icon: Clock, bg: "#fff7e9", chip: "#ffc858" },
    { category: "due", label: "Due soon", icon: CalendarDays, bg: "#eaf3ff", chip: "#4797ff" },
  ];
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeBrief();
      }}
    >
      {/* T10-06: ~960px max width on desktop (this codebase's breakpoints
          have no dedicated ~960px token -- `lg` (1024px) is the nearest
          established one and is what the rest of the app already keys
          responsive layout off of); full-height, edge-to-edge on mobile so
          the sticky action row at the bottom of CatchUpStack stays
          reachable without the dialog itself needing to scroll. */}
      <DialogContent aria-label="Morning Brief" data-brief-motion={open ? "pending" : undefined} ref={panelRef} overlayClassName="morning-brief-backdrop" className="morning-brief flex h-dvh max-h-dvh w-full flex-col gap-0 overflow-y-auto overscroll-contain rounded-none border-none bg-white p-0">
        <header className="brief-header relative overflow-hidden flex-shrink-0">
          <img
            src={sunriseLandscape}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover object-top opacity-90"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/95 via-white/85 to-white/40"
          />
          <div className="relative z-10 flex flex-col gap-3 px-5 py-3.5 lg:h-full lg:flex-row lg:items-center lg:justify-between lg:px-7 lg:py-2">
            <div className="flex items-center gap-3.5">
              <img
                src={morningSymbol}
                alt=""
                aria-hidden="true"
                className="h-10 w-11 shrink-0"
              />
              <div>
                {/* The accessible dialog name stays "Morning Brief"; the visible hero heading follows the Figma design. */}
                <DialogTitle className="sr-only">Morning Brief</DialogTitle>
                <p
                  aria-hidden="true"
                  className="text-xl font-bold leading-tight text-[#30104d] lg:text-[22px]"
                >
                  Morning Digest
                </p>
                <DialogDescription asChild>
                  <div className="mt-0.5 text-xs font-semibold leading-normal text-[#4a2e66]">
                    <span>A fresh day to make progress. </span>
                    <span>
                      {hasFetchedOnce
                        ? `${moments.length} ${moments.length === 1 ? "moment needs" : "moments need"} your attention.`
                        : "Checking for updates…"}
                    </span>
                  </div>
                </DialogDescription>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 lg:mr-12">
              {tiles.map(({ category, label, icon: Icon, bg, chip }) => (
                <button
                  key={category}
                  type="button"
                  data-testid={`digest-tile-${category}`}
                  onClick={() => setJump({ category, nonce: (jump?.nonce ?? 0) + 1 })}
                  style={{ background: bg }}
                  className="flex h-[52px] min-w-[145px] cursor-pointer items-center gap-2.5 rounded-xl border border-white/80 px-3.5 text-left shadow-xs outline-none transition-all hover:-translate-y-0.5 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-[#8d2bf5] active:scale-95"
                >
                  <span
                    style={{ background: chip }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-2xs"
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.8} />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-base font-bold leading-none text-[#30104d]">
                      {counts[category]}
                    </span>
                    <span className="mt-1 flex items-center gap-1 text-xs font-medium text-[#4a2e66]">
                      {label}
                      <ChevronRight className="h-3 w-3 opacity-60" strokeWidth={1.8} />
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </header>
        {/* The whole Brief scrolls as one page: the header scrolls away with the content. */}
        <div className="brief-body flex-1">
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
                  onOpenThing={openThing}
                  onClose={closeBrief}
                  onRefresh={onRefresh}
                  jump={jump}
                />
              ) : null
            }
          </AsyncState>
        </div>
      </DialogContent>
    </Dialog>
  );
}
