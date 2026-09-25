import { Eye } from "lucide-react";

/**
 * E02: the one piece of ThingDetailContent's two variant render trees
 * (`variant="court"` vs the default detail panel) confirmed byte-identical
 * before extracting -- everywhere else the two variants diverge in real,
 * deliberate ways (different layouts, different Comments/Activity
 * implementations), which the plan's own "extract without changing
 * behavior" rule means they cannot be safely unified into one shared
 * component without a product decision on which design should win. See
 * KATALIST_D_TO_H_PROGRESS.md's E02 row for that material decision, named
 * rather than silently resolved.
 */
export function ThingViewOnlyBanner() {
  return (
    <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/80 px-3 py-2 text-[12px] font-semibold text-emerald-800">
      <Eye className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
      <span>View only mode · You can view details and post comments.</span>
    </div>
  );
}
