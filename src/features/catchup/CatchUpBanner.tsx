import { AlertTriangle, ArrowRight, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatchUpMoment } from "./use-catchup";
import type { CatchUpMomentKind } from "./catchup-logic";

const KIND_SUMMARY: Record<CatchUpMomentKind, { dot: string; singular: string; plural: string }> = {
  nudge: { dot: "bg-red-500", singular: "nudge", plural: "nudges" },
  snooze_ended: { dot: "bg-blue-500", singular: "snooze ended", plural: "snoozes ended" },
  ghost: { dot: "bg-purple-500", singular: "breakthrough", plural: "breakthroughs" },
  follow_up: { dot: "bg-amber-500", singular: "follow-up", plural: "follow-ups" },
};

const KIND_ORDER: CatchUpMomentKind[] = ["nudge", "snooze_ended", "ghost", "follow_up"];

type Props = {
  moments: CatchUpMoment[];
  onReview: () => void;
  /** T10-06: the same async facts `useCatchup()` computes, so Manual Review
   *  stays reachable on an initial failure or a genuinely empty result --
   *  not gated on `moments.length > 0` (an error or an empty settled
   *  result must never make the entry point itself disappear). */
  error?: unknown;
  hasFetchedOnce?: boolean;
};

function ReviewButton({ label, onReview }: { label: string; onReview: () => void }) {
  return (
    <button
      type="button"
      onClick={onReview}
      className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground outline-none transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
    >
      {label}
      <ArrowRight className="h-4 w-4" />
    </button>
  );
}

export function CatchUpBanner({ moments, onReview, error, hasFetchedOnce = true }: Props) {
  // Before anything has ever settled, showing nothing avoids an empty-state
  // flash on every load -- this is the ONLY case that suppresses the
  // banner; a settled error or a settled empty result both still render it
  // (T10-06: "avoid the current count > 0 gate at both banner and Court
  // level").
  if (!hasFetchedOnce) return null;

  if (error != null && moments.length === 0) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <p className="text-[14px] font-bold text-slate-900">Morning Brief</p>
            <p className="text-[12px] text-amber-800">Couldn’t load just now.</p>
          </div>
        </div>
        <ReviewButton label="Review" onReview={onReview} />
      </div>
    );
  }

  if (moments.length === 0) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
            <Layers className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <p className="text-[14px] font-bold text-slate-900">Morning Brief</p>
            <p className="text-[12px] text-slate-500">You're all caught up.</p>
          </div>
        </div>
        <ReviewButton label="Review" onReview={onReview} />
      </div>
    );
  }

  const counts = new Map<CatchUpMomentKind, number>();
  for (const m of moments) counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);

  const chips = KIND_ORDER.filter((k) => counts.has(k)).map((k) => {
    const n = counts.get(k)!;
    const meta = KIND_SUMMARY[k];
    return { key: k, dot: meta.dot, label: `${n} ${n === 1 ? meta.singular : meta.plural}` };
  });

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/15 bg-gradient-to-r from-primary/[0.06] to-transparent px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Layers className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            {/* F03: internal name (CatchUpBanner) stays -- only the user-visible label changes. */}
            <p className="text-[14px] font-bold text-slate-900">Morning Brief</p>
            <p className="text-[12px] text-slate-500">
              {moments.length} {moments.length === 1 ? "moment needs" : "moments need"} you
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <span
              key={c.key}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-600"
            >
              <span className={cn("h-2 w-2 rounded-full", c.dot)} />
              {c.label}
            </span>
          ))}
        </div>
      </div>
      <ReviewButton label={`Review ${moments.length}`} onReview={onReview} />
    </div>
  );
}
