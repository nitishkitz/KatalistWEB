import { House, ArrowRight } from "lucide-react";

/** Home is a personal rhythm, not a second workspace. Keep the same Court
 * layout while giving its personal context a recognizable, useful arrival. */
export function HomeArrival({ now, next, later }: { now: number; next: number; later: number }) {
  return (
    <section aria-label="Your Home overview" className="home-arrival mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e8dff2] bg-[linear-gradient(110deg,#faf5ff_0%,#fffaf5_100%)] px-4 py-3 md:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/80 text-[#775196]" aria-hidden="true"><House className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#886599]">Your personal space</p>
          <h1 className="text-base font-semibold tracking-tight text-[#3c2855]">A little more room for life.</h1>
          <p className="mt-0.5 text-xs text-[#766680]">{now ? "Start with what matters now. The rest can wait." : "No rush. Capture a thought or make space for what’s next."}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-[#6b547f]" aria-label="Personal priorities">
        <span className="rounded-full border border-[#e8dff2] bg-white/80 px-2.5 py-1.5"><span className="font-semibold tabular-nums">{now}</span> now</span>
        <ArrowRight className="h-3 w-3 text-[#b5a4c3]" aria-hidden="true" />
        <span className="rounded-full bg-white/65 px-2.5 py-1.5"><span className="font-semibold tabular-nums">{next}</span> next</span>
        <span className="rounded-full bg-white/65 px-2.5 py-1.5"><span className="font-semibold tabular-nums">{later}</span> for later</span>
      </div>
    </section>
  );
}
