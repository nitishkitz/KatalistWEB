import { CalendarDays, Inbox, Lock, RotateCw, Sparkles, User, Users } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DraftPlan } from "@/domain/coey/draft";
import type { Anchor, HolderLane } from "@/domain/coey/model";
import type { Check, FixOption } from "@/domain/coey/validation";
import type { HolderCalendar } from "@/domain/coey/calendar";

const LANE_STYLE: Record<"now" | "next" | "later", string> = {
  now: "border-red-300 bg-red-50 text-red-700",
  next: "border-blue-300 bg-blue-50 text-blue-700",
  later: "border-slate-300 bg-slate-50 text-slate-600 opacity-75",
};

function anchorLabel(anchor: Anchor, cal: HolderCalendar): string {
  const d = new Date(anchor.at);
  const day = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: cal.timezone });
  if (anchor.precision === "date") return day;
  return `${day}, ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: cal.timezone })}`;
}

export type ChipsProps = {
  plan: DraftPlan | null;
  status: "idle" | "pending" | "ready" | "failed";
  failure: string | null;
  calendar: HolderCalendar;
  lane: "now" | "next" | "later" | undefined;
  hint: Check | null;
  onLane(lane: "now" | "next" | "later"): void;
  onAcceptInferred(): void;
  onPickDate(): void;
  onHintFix(option: FixOption): void;
  onRetry(): void;
  onKeepPrivate(): void;
  dateEditor: React.ReactNode;
  dateOpen: boolean;
  onDateOpenChange(open: boolean): void;
};

/** Solid = typed, ghost = inferred (tap to accept), pulsing = unsure (§4.6). At most one Coey line. */
export function CoeyChips(props: ChipsProps) {
  const { plan, status, calendar } = props;
  if (status === "failed") {
    return (
      <div role="status" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-white px-2.5 py-2 text-xs text-slate-700 shadow-sm">
        <span>{props.failure ?? "Coey couldn’t read this right now."} Your text is safe.</span>
        <button type="button" onClick={props.onRetry} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 font-medium hover:bg-slate-50"><RotateCw className="h-3 w-3" /> Try again</button>
        <button type="button" onClick={props.onKeepPrivate} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 font-medium hover:bg-slate-50"><Lock className="h-3 w-3" /> Keep it to myself</button>
      </div>
    );
  }
  if (!plan) {
    return status === "pending" ? (
      <div role="status" aria-live="polite" className="mt-2 inline-flex items-center gap-1.5 px-2.5 text-xs text-slate-500">
        <Sparkles className="h-3 w-3 animate-pulse" /> Reading…
      </div>
    ) : null;
  }

  const first = plan.things[0];
  const draft = first?.draft;
  const court = plan.court;
  const lane: HolderLane | undefined = first?.lane.lane;
  const unsure = (draft?.confidence ?? 1) < 0.6;
  const people = court.kind === "with_others" || court.kind === "group" || court.kind === "chain" || court.kind === "ask_owner" ? court.holders : [];
  const shownLane = props.lane ?? (lane === "now" || lane === "next" || lane === "later" ? lane : undefined);

  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-xl bg-white px-2.5 py-2 text-xs shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5" aria-label="What Coey understood">
        {court.kind === "answer" ? (
          <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 font-medium text-violet-700">Question — Coey will answer, nothing is created</span>
        ) : null}
        {court.kind === "inbox" ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-800">
            <Inbox className="h-3 w-3" /> {court.reason === "thought" ? "Thought · Inbox" : "Inbox · nobody is notified"}
          </span>
        ) : null}
        {court.kind === "note" ? <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-700">Note</span> : null}
        {court.kind === "split" ? <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-700">{plan.things.length > 1 ? `${plan.things.length} Things` : "Several Things"}</span> : null}
        {court.kind === "my_court" ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700"><User className="h-3 w-3" /> You</span>
        ) : null}
        {court.kind === "with_others" && court.privateWait ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700"><Lock className="h-3 w-3" /> Waiting on {people[0]?.name ?? people[0]?.mention} · private</span>
        ) : people.length ? (
          <span className={cn("inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 font-medium text-violet-700", unsure && "animate-pulse")}>
            {people.length > 1 ? <Users className="h-3 w-3" /> : <User className="h-3 w-3" />}
            {court.kind === "chain" ? people.map((p) => p.name ?? p.mention).join(" → ") : people.map((p) => p.name ?? p.mention).join(", ")}
          </span>
        ) : null}

        {draft?.actionTime ? (
          <Popover open={props.dateOpen} onOpenChange={props.onDateOpenChange}>
            <PopoverTrigger asChild>
              <button type="button" className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-medium text-blue-700 hover:bg-blue-100" aria-label={`Time ${anchorLabel(draft.actionTime, calendar)}. Change`}>
                <CalendarDays className="h-3 w-3" /> {anchorLabel(draft.actionTime, calendar)}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-2 p-3" align="start" side="top">{props.dateEditor}</PopoverContent>
          </Popover>
        ) : draft?.inferredTime && !draft.inferredTime.accepted ? (
          <button type="button" onClick={props.onAcceptInferred} className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1 font-medium text-slate-500 hover:bg-slate-100" aria-label={`Suggested ${anchorLabel(draft.inferredTime, calendar)}. Tap to use it`}>
            <CalendarDays className="h-3 w-3" /> {anchorLabel(draft.inferredTime, calendar)}?
          </button>
        ) : court.kind !== "answer" ? (
          <Popover open={props.dateOpen} onOpenChange={props.onDateOpenChange}>
            <PopoverTrigger asChild>
              <button type="button" className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 font-medium text-slate-600 hover:bg-slate-50"><CalendarDays className="h-3 w-3" /> Add time</button>
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-2 p-3" align="start" side="top">{props.dateEditor}</PopoverContent>
          </Popover>
        ) : null}
        {draft?.eventTime ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600">For {anchorLabel(draft.eventTime, calendar)}</span>
        ) : null}
        {draft?.recurrence ? <span className="rounded-full border border-slate-200 px-2.5 py-1 font-medium text-slate-600">{draft.recurrence.phrase}</span> : null}

        {shownLane && court.kind !== "answer" && !(court.kind === "inbox" && court.reason !== "thought") ? (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={cn("rounded-full border px-2.5 py-1 font-semibold", LANE_STYLE[shownLane], first?.lane.ask && "animate-pulse")} aria-label={`Lane ${shownLane}. Change`}>
                {shownLane === "now" ? "Now" : shownLane === "next" ? "Next" : "Later"}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-1" align="start" side="top">
              {(["now", "next", "later"] as const).map((value) => (
                <button key={value} type="button" onClick={() => props.onLane(value)} aria-pressed={shownLane === value} className="block w-full rounded-md px-3 py-2 text-left text-xs font-medium hover:bg-primary/10">
                  {value === "now" ? "Now — urgent" : value === "next" ? "Next" : "Later — no rush"}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        ) : null}
        {status === "pending" ? <Sparkles className="h-3 w-3 animate-pulse text-slate-400" aria-label="Updating" /> : null}
      </div>
      {props.hint ? (
        <div className="flex flex-wrap items-center gap-1.5 text-slate-700" role="note">
          <span>{props.hint.message}</span>
          {props.hint.fixes.slice(0, 3).map((option) => (
            <button key={option.id} type="button" onClick={() => props.onHintFix(option)} className="rounded-full border border-slate-200 px-2 py-0.5 font-medium hover:bg-slate-50">{option.label}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
