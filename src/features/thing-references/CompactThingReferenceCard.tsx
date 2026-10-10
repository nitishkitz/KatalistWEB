import { CalendarDays, CheckSquare, X } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";
import { useMotionPreference } from "@/hooks/use-motion-preference";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useAvatarUrl } from "@/features/people/directory";
import { useThing } from "@/features/things/use-thing";
import { formatCourtDue } from "@/features/court/court-view-model";
import { cn } from "@/lib/utils";
import type { Thing } from "@/domain/thing";

const paceTone = {
  now: "bg-red-50 text-red-600",
  next: "bg-blue-50 text-blue-600",
  later: "bg-purple-50 text-purple-600",
} as const;

/** Display pace uses the viewer's personal pace when set, otherwise the owner's importance. */
function displayPace(thing: Thing) {
  return thing.personalPace ?? thing.ownerImportance;
}

/**
 * A compact, non-interactive-by-default rendering of a referenced Thing: title, pace, small avatar and due date, with
 * stacked edges. Metadata comes from the viewer's authorized read; a missing or inaccessible Thing shows no cached detail.
 */
export function CompactThingReferenceCard({
  thingId,
  onOpen,
  onRemove,
  className,
  variant = "card",
}: {
  thingId: string;
  onOpen?: (thingId: string) => void;
  onRemove?: (thingId: string) => void;
  className?: string;
  variant?: "card" | "inline";
}) {
  const { thing, isLoading } = useThing(thingId);
  const avatar = useAvatarUrl(thing?.assignee.name, null, thing?.assignee.avatarUrl);
  const state = thing ? "available" : isLoading ? "loading" : "unavailable";
  const pace = thing ? displayPace(thing) : null;
  const due = thing?.dueAt ? formatCourtDue(thing).label : null;
  const title = thing?.title ?? (state === "loading" ? "Loading Thing…" : "Thing unavailable");
  const inlineRef = useRef<HTMLDivElement>(null);
  const removing = useRef(false);
  const { reduceMotion: reducedMotion } = useMotionPreference();
  useLayoutEffect(() => {
    const element = inlineRef.current;
    if (!element || variant !== "inline") return;
    if (reducedMotion) {
      gsap.set(element, { clearProps: "transform,opacity" });
      if (removing.current) { removing.current = false; onRemove?.(thingId); }
      return;
    }
    const entrance = gsap.fromTo(element,
      { opacity: 0, y: 6, scale: .975, transformOrigin: "left center" },
      { opacity: 1, y: 0, scale: 1, duration: .38, ease: "power3.out", delay: .04, clearProps: "transform,opacity", overwrite: "auto" },
    );
    return () => { entrance.kill(); gsap.killTweensOf(element); };
  }, [variant, reducedMotion]);

  const removeInline = () => {
    const element = inlineRef.current;
    if (removing.current || !onRemove) return;
    if (reducedMotion || !element) return onRemove(thingId);
    removing.current = true;
    const host = element.closest<HTMLElement>(".magic-box-root");
    if (host) {
      const bounds = element.getBoundingClientRect();
      const hostBounds = host.getBoundingClientRect();
      const ghost = element.cloneNode(true) as HTMLElement;
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      ghost.dataset.referenceExit = "true";
      Object.assign(ghost.style, { position: "absolute", left: `${bounds.left - hostBounds.left}px`, top: `${bounds.top - hostBounds.top}px`, width: `${bounds.width}px`, pointerEvents: "none", zIndex: "2" });
      host.appendChild(ghost);
      gsap.to(ghost, { opacity: 0, y: -3, scale: .98, duration: .16, ease: "power2.in", onComplete: () => ghost.remove() });
    }
    onRemove(thingId);
  };

  if (variant === "inline") {
    const content = (
      <>
        <CheckSquare className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-900">{title}</span>
        {thing && state === "available" ? (
          <>
            <PersonAvatar name={thing.assignee.name} initials={thing.assignee.initials} src={avatar} size={18} />
            {pace && <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold capitalize", paceTone[pace])}>{pace}</span>}
            {due && <span className="hidden shrink-0 items-center gap-1 text-[10px] text-slate-500 sm:inline-flex"><CalendarDays className="h-2.5 w-2.5" aria-hidden="true" />{due}</span>}
          </>
        ) : null}
      </>
    );
    return (
      <div ref={inlineRef} data-state={state} data-variant="inline" style={{ maxWidth: "min(100%, 360px)" }} className={cn("relative w-fit min-w-0 max-w-full shrink-0 pl-1 before:absolute before:inset-y-1 before:left-0 before:w-3 before:rounded-l-lg before:border before:border-violet-300 before:bg-violet-100 before:content-['']", className)}>
        <div className="relative flex h-8 max-w-full items-center gap-1 rounded-lg border border-violet-200 bg-white/95 px-2 shadow-[0_1px_3px_rgba(124,58,237,0.08)]">
          {onOpen && state === "available" ? (
            <button type="button" title={title} aria-label={`Open ${title}`} onClick={() => onOpen(thingId)} className="flex min-w-0 max-w-[420px] flex-1 items-center gap-2 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-violet-400">{content}</button>
          ) : <div className="flex min-w-0 max-w-[420px] flex-1 items-center gap-2" title={title}>{content}</div>}
          {onRemove && <button type="button" onClick={removeInline} aria-label={`Remove reference${thing ? ` to ${thing.title}` : ""}`} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 outline-none hover:bg-violet-50 hover:text-violet-600 focus-visible:ring-2 focus-visible:ring-violet-400"><X className="h-3 w-3" aria-hidden="true" /></button>}
        </div>
      </div>
    );
  }

  const body = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
        <CheckSquare className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[16px] font-semibold", state === "available" ? "text-slate-900" : "text-slate-500")}>
          {title}
        </span>
        {state === "available" && thing ? (
          <span className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-500">
            {pace ? (
              <span className={cn("rounded-full px-2 py-0.5 font-semibold capitalize", paceTone[pace])}>{pace}</span>
            ) : null}
            <PersonAvatar name={thing.assignee.name} initials={thing.assignee.initials} src={avatar} size={24} />
            {due ? (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3 w-3" aria-hidden="true" />
                {due}
              </span>
            ) : null}
          </span>
        ) : state === "unavailable" ? (
          <span className="mt-0.5 block text-[12px] text-slate-400">Deleted, or you no longer have access.</span>
        ) : null}
      </span>
    </>
  );

  return (
    <div
      data-state={state}
      className={cn(
        // Stacked edges behind the card suggest a compressed stack without scaling the full interactive card.
        "relative min-w-0 max-w-full pl-3 before:absolute before:inset-y-1 before:left-0 before:w-5 before:rounded-l-xl before:border before:border-slate-200 before:border-l-[4px] before:border-l-blue-500 before:bg-blue-50/50 before:content-[''] after:absolute after:inset-y-0.5 after:left-1.5 after:w-5 after:rounded-l-xl after:border after:border-slate-200 after:bg-white after:content-['']",
        className,
      )}
    >
      <div className="relative z-[1] flex min-h-[96px] min-w-0 items-start gap-2 rounded-xl border border-slate-200 bg-white p-3.5 shadow-[0_2px_5px_rgba(15,23,42,0.04)]">
        {onOpen && state === "available" ? (
          <button
            type="button"
            onClick={() => onOpen(thingId)}
            title={thing?.title}
            aria-label={`Open ${thing?.title ?? "Thing"}`}
            className="flex min-w-0 flex-1 items-start gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring rounded cursor-pointer"
          >
            {body}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-start gap-2" title={thing?.title}>
            {body}
          </div>
        )}
        {onRemove ? (
          <button
            type="button"
            onClick={() => onRemove(thingId)}
            aria-label={`Remove reference${thing ? ` to ${thing.title}` : ""}`}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
