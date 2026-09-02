import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Folder, FolderPlus, Plus, X, ChevronRight, Check } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useBuckets } from "@/features/buckets/use-buckets";
import { rpcAddToBucket, rpcCreateBucket } from "@/features/things/rpc";
import { domainErrorMessage } from "@/lib/domain-error";
import { useAppContext } from "@/features/context/use-app-context";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface CourtBucketsSidePanelProps {
  onClose?: () => void;
}

const BUCKET_COLORS = [
  "bg-sky-500",
  "bg-emerald-500",
  "bg-purple-500",
  "bg-amber-500",
  "bg-teal-500",
  "bg-rose-500",
  "bg-indigo-500",
];

export function CourtBucketsSidePanel({ onClose }: CourtBucketsSidePanelProps) {
  const { buckets, isLoading } = useBuckets();
  const { context } = useAppContext();
  const [hoveredBucketId, setHoveredBucketId] = useState<string | null>(null);
  const [isNewBucketOpen, setIsNewBucketOpen] = useState(false);
  const [newBucketName, setNewBucketName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const qc = useQueryClient();

  const handleCreateBucket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBucketName.trim() || isCreating) return;
    setIsCreating(true);
    try {
      await rpcCreateBucket(newBucketName.trim(), context);
      toast.success(`Created bucket "${newBucketName.trim()}"`);
      setNewBucketName("");
      setIsNewBucketOpen(false);
      await qc.invalidateQueries({ queryKey: ["buckets"] });
    } catch (err: any) {
      toast.error(domainErrorMessage(err));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <aside className="flex flex-col w-[290px] shrink-0 rounded-2xl border border-border/80 bg-white/95 p-4 shadow-sm backdrop-blur-xs transition-all">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FolderPlus className="h-4 w-4" />
          </div>
          <h2 className="text-[14.5px] font-black tracking-tight text-slate-900">
            Buckets
          </h2>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Close Buckets panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Subheader */}
      <div className="flex items-center justify-between pt-3 pb-2 px-0.5">
        <span className="text-[12px] font-bold text-slate-700">Your Buckets</span>
        <button
          type="button"
          onClick={() => setIsNewBucketOpen(true)}
          className="inline-flex items-center gap-1 text-[11.5px] font-bold text-primary hover:text-primary/80 transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          New Bucket
        </button>
      </div>

      {/* Buckets List / Drop Targets */}
      <div className="flex-1 space-y-2 overflow-y-auto py-1 max-h-[480px] pr-0.5">
        {isLoading ? (
          <div className="py-8 text-center text-[11.5px] text-slate-400">
            Loading buckets...
          </div>
        ) : buckets.length === 0 ? (
          <div className="py-8 text-center text-[11.5px] text-slate-400">
            No active buckets in this context.
          </div>
        ) : (
          buckets.map((b, idx) => {
            const isTarget = hoveredBucketId === b.id;
            const colorClass = b.color || BUCKET_COLORS[idx % BUCKET_COLORS.length];

            return (
              <div
                key={b.id}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes("application/katalist-thing")) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    if (hoveredBucketId !== b.id) setHoveredBucketId(b.id);
                  }
                }}
                onDragEnter={(e) => {
                  if (e.dataTransfer.types.includes("application/katalist-thing")) {
                    e.preventDefault();
                    setHoveredBucketId(b.id);
                  }
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    if (hoveredBucketId === b.id) setHoveredBucketId(null);
                  }
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setHoveredBucketId(null);
                  try {
                    const raw =
                      e.dataTransfer.getData("application/katalist-thing") ||
                      e.dataTransfer.getData("text/plain");
                    if (!raw) return;
                    const data = JSON.parse(raw) as { thingId: string; title?: string };

                    const res = (await rpcAddToBucket(b.id, data.thingId)) as any;
                    if (res?.message?.includes("already") || res?.alreadyExists) {
                      toast.info(`"${data.title || "Thing"}" is already in 📁 ${b.name}`);
                    } else {
                      toast.success(
                        `Added "${data.title || "Thing"}" to 📁 ${b.name}`,
                      );
                    }
                    await qc.invalidateQueries({ queryKey: ["buckets"] });
                    await qc.invalidateQueries({ queryKey: ["bucket", b.id] });
                    await qc.invalidateQueries({ queryKey: ["bucket-items", b.id] });
                  } catch (err: any) {
                    toast.error(domainErrorMessage(err));
                  } finally {
                    onClose?.();
                  }
                }}
                className={cn(
                  "group relative flex items-center justify-between rounded-xl border p-2.5 transition-all duration-150 cursor-pointer",
                  isTarget
                    ? "border-sky-500 bg-sky-50/80 shadow-sm scale-[1.02] ring-2 ring-sky-300/50 border-dashed"
                    : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50/70 shadow-2xs",
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white font-bold text-[12px] shadow-2xs",
                      colorClass,
                    )}
                  >
                    <Folder className="h-4 w-4 fill-current opacity-90" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-slate-900 group-hover:text-primary transition-colors">
                      {b.name}
                    </span>
                    <span className="block text-[11px] text-slate-500 font-medium">
                      {b.thingCount} {b.thingCount === 1 ? "Thing" : "Things"}
                    </span>
                  </div>
                </div>

                <div className="shrink-0 pl-1.5">
                  {isTarget ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary text-white px-2 py-0.5 text-[10px] font-bold shadow-xs animate-pulse">
                      <Check className="h-3 w-3" />
                      Drop here to add
                    </span>
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500 transition-colors" />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer link */}
      <div className="pt-3 border-t border-border/60 text-center mt-2">
        <Link
          to="/buckets"
          className="inline-flex items-center justify-center text-[11.5px] font-bold text-slate-600 hover:text-foreground transition-colors"
        >
          View all buckets <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
        </Link>
      </div>

      {/* New Bucket Modal */}
      <Dialog open={isNewBucketOpen} onOpenChange={setIsNewBucketOpen}>
        <DialogContent className="sm:max-w-[380px] bg-white">
          <DialogHeader>
            <DialogTitle className="text-[16px] font-bold">Create New Bucket</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateBucket} className="space-y-4 pt-2">
            <div>
              <label htmlFor="bucket-name" className="block text-[12px] font-semibold text-slate-700 mb-1">
                Bucket Name
              </label>
              <input
                id="bucket-name"
                type="text"
                autoFocus
                value={newBucketName}
                onChange={(e) => setNewBucketName(e.target.value)}
                placeholder="e.g. Marketing Campaign, Architecture"
                className="w-full rounded-lg border border-border px-3 py-2 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <button
                type="button"
                onClick={() => setIsNewBucketOpen(false)}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newBucketName.trim() || isCreating}
                className="px-3.5 py-1.5 rounded-lg bg-primary text-white text-[12px] font-bold hover:bg-primary/90 disabled:opacity-50"
              >
                {isCreating ? "Creating..." : "Create Bucket"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
