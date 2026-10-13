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
        <header className="brief-header">
          <img
            src={sunriseLandscape}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="pointer-events-none absolute left-[-4.41%] top-[-14.25%] h-[365.21%] w-[108.81%] max-w-none select-none object-cover"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-[76px] top-[14px] hidden h-[116px] w-[440px] bg-gradient-to-r from-[#fff7f0] to-[#f6e0eb] blur-[5.8px] lg:block"
          />
          <div className="relative z-10 flex flex-col gap-4 px-5 pb-5 pt-6 lg:block lg:h-full lg:w-full lg:p-0">
            <div className="flex items-start gap-[14px] lg:contents">
              <img
                src={morningSymbol}
                alt=""
                aria-hidden="true"
                className="h-[44px] w-[50px] shrink-0 lg:absolute lg:left-[82.2px] lg:top-[28.9px] lg:h-[44.3px] lg:w-[50.1px]"
              />
              <div className="lg:contents">
                {/* The accessible dialog name stays "Morning Brief"; the visible hero heading follows the Figma design. */}
                <DialogTitle className="sr-only">Morning Brief</DialogTitle>
                <p
                  aria-hidden="true"
                  className="font-bold leading-normal text-[#30104d] [font-size:28.255px] lg:absolute lg:left-[145.77px] lg:top-[31.47px] lg:whitespace-nowrap"
                >
                  Morning Digest
                </p>
                <DialogDescription asChild>
                  <div className="mt-[7px] text-[15.412px] font-semibold leading-[1.4] !text-black lg:absolute lg:left-[145.77px] lg:top-[73.21px] lg:mt-0 lg:w-[395px]">
                    <p>A fresh day to make progress.</p>
                    <p>
                      {hasFetchedOnce
                        ? `${moments.length} ${moments.length === 1 ? "moment needs" : "moments need"} your attention.`
                        : "Checking for updates…"}
                    </p>
                  </div>
                </DialogDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-[12.843px] lg:absolute lg:left-[82.2px] lg:top-[132.93px]">
              {tiles.map(({ category, label, icon: Icon, bg, chip }) => (
                <button
                  key={category}
                  type="button"
                  data-testid={`digest-tile-${category}`}
                  onClick={() => setJump({ category, nonce: (jump?.nonce ?? 0) + 1 })}
                  style={{ background: bg }}
                  className="flex h-[81.554px] w-[201.639px] cursor-pointer items-center gap-[16.054px] rounded-[5.137px] px-[17.338px] text-left shadow-[0_3.211px_11.559px_rgba(87,65,99,0.1)] outline-none transition-transform hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-[#8d2bf5]"
                >
                  <span
                    style={{ background: chip }}
                    className="flex h-[44.309px] w-[43.667px] shrink-0 items-center justify-center rounded-[10.917px] text-white"
                  >
                    <Icon className="h-[22.476px] w-[22.476px]" strokeWidth={1.6} />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[26.971px] font-semibold leading-[1.1] text-[#30104d]">{counts[category]}</span>
                    <span className="flex items-center gap-[5.137px] text-[12.843px] font-medium text-[#30104d]">
                      {label}
                      <ChevronRight className="h-[12.843px] w-[12.843px]" strokeWidth={1.6} />
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
