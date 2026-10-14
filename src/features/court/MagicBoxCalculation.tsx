import { Calculator, Copy, StickyNote, X } from "lucide-react";
import { toast } from "sonner";
import type { Calculation } from "./magic-box-calculations";

export function MagicBoxCalculation({ calculation, input, saving, onSave, onClose }: {
  calculation: Calculation;
  input: string;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <section aria-label="Magic Box calculation" className="relative z-10 mb-3 rounded-2xl border border-border bg-background p-4 text-foreground shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Calculator className="h-4 w-4" aria-hidden="true" />
        <span>{calculation.title}</span>
        <button type="button" onClick={onClose} aria-label="Close calculation" className="ml-auto rounded-md p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-4 w-4" /></button>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true">
        <p className="break-words text-xs text-muted-foreground">{input}</p>
        <p className="my-2 break-words text-2xl font-semibold tabular-nums">{calculation.result}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{calculation.detail}</p>
      </div>
      {!calculation.error && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={async () => {
            try { await navigator.clipboard.writeText(calculation.result); toast.success("Result copied"); }
            catch { toast.error("Couldn’t copy. Select the result to copy it."); }
          }}><Copy className="h-3.5 w-3.5" />Copy result</button>
          <button type="button" disabled={saving} onClick={onSave} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><StickyNote className="h-3.5 w-3.5" />{saving ? "Saving…" : "Save as note"}</button>
        </div>
      )}
    </section>
  );
}
