import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, ChevronDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import coeyAvatar from "@/assets/coey-catchup.png";
import { useAppContext } from "@/features/context/use-app-context";
import type { Thing } from "@/domain/thing";
import { CourtDetailModal } from "@/features/court/CourtDetailModal";
import { useMotionPreference } from "@/hooks/use-motion-preference";
import { useCatchup, type CatchUpMoment } from "./use-catchup";
import { reasonLabelFor, type CatchUpMomentKind } from "./catchup-logic";

const SEVERITY: Record<CatchUpMomentKind, { label: string; dot: string; text: string }> = {
  nudge: { label: "High", dot: "bg-[#f04438]", text: "text-[#d92d20]" },
  follow_up: { label: "Medium", dot: "bg-[#f79009]", text: "text-[#b54708]" },
  ghost: { label: "Medium", dot: "bg-[#975ee2]", text: "text-[#6941c6]" },
  snooze_ended: { label: "Low", dot: "bg-[#1570ef]", text: "text-[#175cd3]" },
};

function severityFor(kind: CatchUpMomentKind | undefined) {
  return kind ? SEVERITY[kind] : null;
}

function momentLabel(moment: CatchUpMoment) {
  return moment.kind === "nudge"
    ? moment.actor?.name ? `${moment.actor.name} nudged you` : "Someone nudged you"
    : reasonLabelFor(moment.kind, moment.reason);
}

export function CatchUpNavCapsule() {
  const { context } = useAppContext();
  const catchup = useCatchup();
  const { reduceMotion } = useMotionPreference();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [autoExpanded, setAutoExpanded] = useState(false);
  const [selectedThing, setSelectedThing] = useState<Thing | null>(null);
  const [expandedHeight, setExpandedHeight] = useState(44);
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const previousMomentsRef = useRef<{ context: string; keys: Set<string> } | null>(null);
  const expansionTimerRef = useRef<number | null>(null);
  const count = catchup.count;
  const isChecking = catchup.isLoading && !catchup.hasFetchedOnce;
  const activeMoment = catchup.moments[activeIndex] ?? catchup.moments[0] ?? null;
  const severity = severityFor(activeMoment?.kind);
  const isExpanded = isHovered || hasFocus || isPinned || autoExpanded;

  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;
    const measure = () => setExpandedHeight(56 + details.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(details);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setActiveIndex((current) => (count > 0 ? Math.min(current, count - 1) : 0));
  }, [count]);

  useEffect(() => {
    if (!catchup.hasFetchedOnce) return;
    const keys = new Set(catchup.moments.map((moment) => moment.momentKey));
    const previous = previousMomentsRef.current;
    if (previous?.context === context) {
      const addedIndex = catchup.moments.findIndex((moment) => !previous.keys.has(moment.momentKey));
      if (addedIndex >= 0) {
        setActiveIndex(addedIndex);
        setAutoExpanded(true);
        if (expansionTimerRef.current !== null) window.clearTimeout(expansionTimerRef.current);
        expansionTimerRef.current = window.setTimeout(() => {
          setAutoExpanded(false);
          expansionTimerRef.current = null;
        }, 4200);
      }
    }
    previousMomentsRef.current = { context, keys };
  }, [catchup.hasFetchedOnce, catchup.moments, context]);

  useEffect(() => () => {
    if (expansionTimerRef.current !== null) window.clearTimeout(expansionTimerRef.current);
  }, []);

  useEffect(() => {
    if (reduceMotion || isPaused || isExpanded || count < 2) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % count);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [count, isExpanded, isPaused, reduceMotion]);

  const openThing = (thing: Thing) => {
    setIsPinned(false);
    setAutoExpanded(false);
    setSelectedThing(thing);
  };

  return (
    <>
    <div
      className="group/catchup relative h-11 w-[224px] shrink-0 md:w-[236px] lg:w-[292px]"
      onMouseEnter={() => { setIsHovered(true); setIsPaused(true); }}
      onMouseLeave={() => { triggerRef.current?.blur(); setHasFocus(false); setIsHovered(false); setIsPaused(false); setIsPinned(false); setAutoExpanded(false); }}
      onFocusCapture={() => { setHasFocus(true); setIsPaused(true); }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setHasFocus(false);
          setIsPaused(false);
          setIsPinned(false);
        }
      }}
    >
      <div
        style={{ height: isExpanded ? expandedHeight : 44 }}
        className={cn(
          "absolute left-1/2 top-0 z-50 -translate-x-1/2 overflow-hidden border bg-white transition-[width,height,border-radius,box-shadow,border-color] duration-[250ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
          isExpanded ? "w-[min(440px,calc(100vw-32px))] rounded-[25px] border-[#c9b4f4] shadow-[0_20px_48px_rgba(61,35,111,0.22)]" : "w-full rounded-full border-[#e4e8f1] shadow-[0_3px_12px_rgba(35,31,75,0.08)]",
        )}
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setIsPinned((current) => !current)}
          aria-expanded={isExpanded}
          aria-controls="catchup-island-details"
          aria-label={isChecking ? "Checking Catch Up" : count && activeMoment ? `Catch Up, ${activeIndex + 1} of ${count}: ${momentLabel(activeMoment)} about ${activeMoment.thing.title}` : "All caught up"}
          className={cn("flex w-full items-center gap-2 px-2 text-left outline-none transition-[height,padding] duration-[250ms] ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8b5cf6] motion-reduce:transition-none", isExpanded ? "h-14 px-3" : "h-[42px]", count > 0 && "bg-[linear-gradient(110deg,#fbf9ff_0%,#f4edff_52%,#fff9f3_100%)]")}
        >
          <span className={cn("relative inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/90 bg-[#eee5ff] shadow-sm transition-transform duration-300 group-hover/catchup:scale-105", count > 0 && "ring-2 ring-[#e7d9ff] ring-offset-1 ring-offset-[#faf8ff]")}>
            <img src={coeyAvatar} alt="" className="h-full w-full object-cover" aria-hidden="true" />
            {count > 0 ? <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border-2 border-white bg-[#f04438]" aria-hidden="true" /> : null}
          </span>
          <span className="min-w-0 flex-1 overflow-hidden">
            <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6941c6]">
              <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{isChecking ? "Checking" : activeMoment?.kind === "nudge" ? "New nudge" : count > 0 ? "Catch Up" : "All caught up"}</span>
              {count > 0 ? <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#eee5ff] px-1 text-[10px] font-bold tracking-normal text-[#6941c6]">{count}</span> : null}
            </span>
            <span key={activeMoment?.momentKey ?? (isChecking ? "checking" : "empty")} className="mt-0.5 block truncate text-[11px] font-semibold leading-tight text-[#2f234c] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 sm:text-[12px]">
              {isChecking ? "Looking for moments…" : activeMoment ? activeMoment.thing.title : "Nothing needs you"}
            </span>
          </span>
          {count > 0 && activeMoment ? <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full bg-white/75 px-1.5 py-0.5 text-[9px] font-semibold", severity?.text)}><span className={cn("h-1.5 w-1.5 rounded-full", severity?.dot)} aria-hidden="true" />{severity?.label}</span> : !isChecking ? <AlertCircle className="mr-1 h-3.5 w-3.5 shrink-0 text-[#98a2b3]" aria-hidden="true" /> : null}
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-[#6941c6] transition-[transform,opacity] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none", isExpanded && "rotate-180 opacity-0")} aria-hidden="true" />
        </button>
        <div id="catchup-island-details" aria-hidden={!isExpanded} inert={!isExpanded} className={cn("w-[min(440px,calc(100vw-32px))] transition-[opacity,transform] duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none", isExpanded ? "translate-y-0 opacity-100 delay-[40ms]" : "-translate-y-1 opacity-0 delay-0")}>
          <div ref={detailsRef} className="border-t border-[#eee8fa] px-4 pb-4 pt-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-[#6941c6]">{isChecking ? "Checking your Court" : count > 0 ? `${count} ${count === 1 ? "moment" : "moments"} need you` : "You’re all caught up"}</p>
              {isChecking ? <p className="text-xs text-slate-500">Looking for updates…</p> : count === 0 ? <p className="text-xs leading-relaxed text-slate-600">No nudges, snoozes, or follow-ups need your attention right now.</p> : (
                <div className="max-h-[300px] space-y-1 overflow-y-auto">
                  {catchup.moments.map((moment) => {
                    const level = severityFor(moment.kind);
                    return <div key={moment.momentKey} className={cn("rounded-xl border px-3 py-2.5", moment.momentKey === activeMoment?.momentKey ? "border-[#d9c5fa] bg-[#f4efff]" : "border-transparent bg-[#f8f6fd]")}><div className="flex items-start gap-2"><span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", level?.dot)} /><div className="min-w-0"><p className="text-[11px] font-semibold text-[#6941c6]">{momentLabel(moment)}</p><p className="mt-0.5 break-words text-[12px] font-semibold leading-snug text-[#2f234c]">{moment.thing.title}</p><button type="button" onClick={() => openThing(moment.thing)} className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-lg bg-[#e9defb] px-3 text-[11px] font-semibold text-[#6541ad] transition-colors hover:bg-[#decdf8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b5cf6]">Open Thing<ArrowRight className="h-3 w-3" aria-hidden="true" /></button></div></div></div>;
                  })}
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
    <CourtDetailModal thing={selectedThing} isOpen={Boolean(selectedThing)} onClose={() => setSelectedThing(null)} />
    </>
  );
}
