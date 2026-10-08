import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { dayGroup } from "./format";
import { ActivityRow } from "./ActivityRow";
import { FEED_FILTERS, applyFeedFilter, type FeedFilter } from "./feed-filter";
import type { ActivityChange } from "./types";

interface ActivityFeedProps {
  changes: readonly ActivityChange[];
  filter: FeedFilter;
  onFilterChange: (filter: FeedFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  now: number;
}

/** Date-grouped, newest-first list of changes. Filter and selection are owned by the parent so they survive navigation. */
export function ActivityFeed({ changes, filter, onFilterChange, selectedId, onSelect, now }: ActivityFeedProps) {
  const visible = useMemo(
    () => applyFeedFilter(changes, filter).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    [changes, filter],
  );
  const groups = useMemo(() => {
    const out: Array<{ label: string; items: ActivityChange[] }> = [];
    for (const change of visible) {
      const label = dayGroup(change.updatedAt, now);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(change);
      else out.push({ label, items: [change] });
    }
    return out;
  }, [visible, now]);

  return (
    <div>
      <div role="group" aria-label="Filter activity" className="flex flex-wrap gap-2 border-b border-[#eef0f6] px-5 py-3">
        {FEED_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => onFilterChange(f.id)}
            className={cn(
              "min-h-[30px] cursor-pointer rounded-full border px-3 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#975ee2]",
              filter === f.id
                ? "border-[#c9c4fc] bg-[#f5f4fe] text-black"
                : "border-[#eaeffa] text-[#4d5878] hover:bg-[#fafaff]",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {groups.length === 0 ? (
        <div className="px-6 py-12 text-center text-[13px] text-[#6a769c]">
          <div className="text-[14px] font-medium text-black">No activity matches this filter</div>
          <button
            type="button"
            onClick={() => onFilterChange("all")}
            className="mt-2 cursor-pointer text-[#503188] underline-offset-2 hover:underline"
          >
            Show all activity
          </button>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h3 className="px-5 pb-1.5 pt-3.5 text-[12px] font-semibold text-[#6a769c]">{group.label}</h3>
            <ul>
              {group.items.map((change) => (
                <ActivityRow
                  key={change.id}
                  change={change}
                  selected={change.id === selectedId}
                  onSelect={onSelect}
                  now={now}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
