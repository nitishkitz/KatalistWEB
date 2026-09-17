import { cn } from "@/lib/utils";

/**
 * Shimmer placeholder primitives and per-screen skeletons shown while a tab's
 * data loads. The shimmer sweep is defined in styles.css (.katalist-shimmer).
 */
export function Shimmer({ className }: { className?: string }) {
  return <div className={cn("katalist-shimmer rounded-md", className)} />;
}

function CardShimmer({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-[12px] border border-[#eef0f6] bg-white p-4", className)}>
      <div className="flex items-center gap-3">
        <Shimmer className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Shimmer className="h-3.5 w-1/2" />
          <Shimmer className="h-3 w-1/3" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Shimmer className="h-3 w-full" />
        <Shimmer className="h-3 w-5/6" />
      </div>
    </div>
  );
}

/** A page header block (title + subtitle + a couple of controls). */
function HeaderShimmer() {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <div className="space-y-2">
        <Shimmer className="h-6 w-40" />
        <Shimmer className="h-3.5 w-64" />
      </div>
      <Shimmer className="h-10 w-32 rounded-[9px]" />
    </div>
  );
}

/** Court: three lanes (Now / Next / Later) of stacked cards. */
export function CourtSkeleton() {
  return (
    <div className="animate-in fade-in">
      <HeaderShimmer />
      <div className="grid gap-4 lg:grid-cols-3">
        {["Now", "Next", "Later"].map((lane) => (
          <div key={lane} className="space-y-3">
            <Shimmer className="h-4 w-20" />
            {Array.from({ length: 3 }).map((_, i) => (
              <CardShimmer key={i} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Lists: a search row + a grid of list cards. */
export function ListsSkeleton() {
  return (
    <div className="animate-in fade-in">
      <HeaderShimmer />
      <Shimmer className="mb-5 h-11 w-full rounded-[10px]" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-[12px] border border-[#eef0f6] bg-white">
            <Shimmer className="h-24 w-full rounded-none" />
            <div className="space-y-2 p-4">
              <Shimmer className="h-4 w-2/3" />
              <Shimmer className="h-3 w-1/2" />
              <div className="flex -space-x-2 pt-1">
                {Array.from({ length: 3 }).map((_, j) => (
                  <Shimmer key={j} className="h-7 w-7 rounded-full border-2 border-white" />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Buckets: a grid of bucket tiles. AppShell already renders the title header. */
export function BucketsSkeleton() {
  return (
    <div className="animate-in fade-in">
      <Shimmer className="mb-5 h-11 w-full rounded-[10px]" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-[12px] border border-[#eef0f6] bg-white p-4">
            <div className="flex items-center justify-between">
              <Shimmer className="h-9 w-9 rounded-[8px]" />
              <Shimmer className="h-5 w-10 rounded-full" />
            </div>
            <Shimmer className="mt-4 h-4 w-3/4" />
            <Shimmer className="mt-2 h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Team: a vertical list of member rows. AppShell already renders the title header. */
export function TeamSkeleton() {
  return (
    <div className="mx-auto max-w-4xl animate-in fade-in pt-4">
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between rounded-xl border border-border/70 bg-white p-4">
            <div className="flex items-center gap-3">
              <Shimmer className="h-9 w-9 rounded-full" />
              <div className="space-y-2">
                <Shimmer className="h-4 w-32" />
                <Shimmer className="h-3 w-40" />
              </div>
            </div>
            <Shimmer className="h-6 w-24 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Nudges: a group tab row + a list of nudge rows. */
export function NudgesSkeleton() {
  return (
    <div className="animate-in fade-in">
      <HeaderShimmer />
      <div className="mb-5 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Shimmer key={i} className="h-8 w-28 rounded-full" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-[12px] border border-[#eef0f6] bg-white p-4">
            <Shimmer className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Shimmer className="h-4 w-1/3" />
              <Shimmer className="h-3 w-1/2" />
            </div>
            <Shimmer className="h-9 w-24 rounded-[9px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** List detail: sub-header card (back + identity + tabs) then a toolbar + rows. */
export function ListDetailSkeleton() {
  return (
    <div className="min-h-screen animate-in fade-in bg-[#edf2fe] px-4 py-3">
      {/* Sub-header + tabs card */}
      <div className="rounded-[10px] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 pt-4 pb-3">
          <div className="flex items-center gap-4">
            <Shimmer className="h-4 w-24" />
            <div className="h-8 w-px bg-[#eef0f6]" />
            <Shimmer className="h-11 w-11 rounded-[6px]" />
            <div className="space-y-2">
              <Shimmer className="h-4 w-40" />
              <Shimmer className="h-3 w-24" />
            </div>
          </div>
          <Shimmer className="h-10 w-24 rounded-[9px]" />
        </div>
        <div className="flex items-center gap-8 border-t border-[#eef0f6] px-5 py-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Shimmer key={i} className="h-4 w-16" />
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="mt-3 flex items-center gap-2">
        <Shimmer className="h-10 w-64 rounded-[10px]" />
        <Shimmer className="h-10 w-28 rounded-[10px]" />
        <Shimmer className="h-10 w-28 rounded-[10px]" />
      </div>

      {/* Rows */}
      <div className="mt-3 space-y-2 rounded-[10px] bg-white p-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-[#f4f5fb] py-3 last:border-0">
            <Shimmer className="h-8 w-8 rounded-full" />
            <Shimmer className="h-4 flex-1" />
            <Shimmer className="h-4 w-24" />
            <Shimmer className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Me: an identity header + a couple of setting sections. */
export function MeSkeleton() {
  return (
    <div className="animate-in fade-in">
      <div className="mb-6 flex items-center gap-4">
        <Shimmer className="h-20 w-20 rounded-full" />
        <div className="space-y-2">
          <Shimmer className="h-6 w-48" />
          <Shimmer className="h-3.5 w-32" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-[12px] border border-[#eef0f6] bg-white p-4">
            <Shimmer className="h-8 w-8 rounded-full" />
            <Shimmer className="mt-3 h-5 w-16" />
            <Shimmer className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <CardShimmer key={i} />
        ))}
      </div>
    </div>
  );
}
