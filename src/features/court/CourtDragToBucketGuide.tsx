import { GripVertical, MoveRight, ArrowRight, FolderDown, CheckCircle2, Sparkles, Hand } from "lucide-react";

export function CourtDragToBucketGuide() {
  return (
    <section aria-label="Drag and Drop Guide" className="w-full space-y-3 pt-2">
      {/* 4 Step Cards */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Step 1 */}
        <div className="relative flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3.5 shadow-2xs">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
            <GripVertical className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white">
                1
              </span>
              <span className="text-[12.5px] font-bold text-slate-900">
                Grab the Grip
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              Click and hold the grip icon (<code className="font-bold text-slate-700">⋮⋮</code>) on any Thing card.
            </p>
          </div>
        </div>

        {/* Step 2 */}
        <div className="relative flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3.5 shadow-2xs">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <MoveRight className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                2
              </span>
              <span className="text-[12.5px] font-bold text-slate-900">
                Drag Across
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              Drag the card towards the Buckets panel on the right.
            </p>
          </div>
        </div>

        {/* Step 3 */}
        <div className="relative flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3.5 shadow-2xs">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <FolderDown className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-600 text-[10px] font-bold text-white">
                3
              </span>
              <span className="text-[12.5px] font-bold text-slate-900">
                Drop in Bucket
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              Release the card over a Bucket to add it instantly.
            </p>
          </div>
        </div>

        {/* Step 4 */}
        <div className="relative flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-3.5 shadow-2xs">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-xs">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
                4
              </span>
              <span className="text-[12.5px] font-bold text-emerald-950">
                Added Successfully
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-emerald-800">
              The Thing appears inside the Bucket and stays in your Court.
            </p>
          </div>
        </div>
      </div>

      {/* Note Pill */}
      <div className="flex items-center justify-center gap-2 rounded-2xl bg-purple-50/80 px-4 py-2.5 text-center border border-purple-100/70">
        <Sparkles className="h-4 w-4 text-purple-600 shrink-0" />
        <span className="text-[12px] font-medium text-purple-950">
          <strong>Moving a Thing to a Bucket does not remove it from your Court.</strong> Buckets are personal lenses to focus and group what matters to you.
        </span>
      </div>
    </section>
  );
}
