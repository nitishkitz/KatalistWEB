import { useState, useRef, useEffect } from "react";
import { Folder, FolderPlus, Sparkles, Check, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useBuckets } from "./use-buckets";
import { rpcAddToBucket } from "@/features/things/rpc";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";

interface SpringLoadedBucketFlyoutProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SpringLoadedBucketFlyout({ isOpen, onClose }: SpringLoadedBucketFlyoutProps) {
  const { buckets, isLoading } = useBuckets();
  const [hoveredBucketId, setHoveredBucketId] = useState<string | null>(null);
  const qc = useQueryClient();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setHoveredBucketId(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      onDragLeave={(e) => {
        // If drag leaves the flyout entirely, close it
        if (!containerRef.current?.contains(e.relatedTarget as Node)) {
          onClose();
        }
      }}
      className="fixed z-50 overflow-hidden rounded-2xl border border-border/80 bg-white/95 p-3 shadow-2xl backdrop-blur-md animate-in fade-in-50 zoom-in-95 duration-150 md:left-[225px] md:top-[105px] md:w-[320px] left-4 right-4 bottom-16 max-h-[75vh]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 pb-2 px-1 mb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FolderPlus className="h-3.5 w-3.5" />
          </div>
          <div>
            <span className="block text-[12.5px] font-bold text-foreground leading-tight">
              File into Bucket
            </span>
            <span className="block text-[10px] text-muted-foreground">
              Drop card on a bucket to organize
            </span>
          </div>
        </div>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
          {buckets.length} Buckets
        </span>
      </div>

      {/* Bucket List */}
      <div className="max-h-[360px] space-y-1.5 overflow-y-auto pr-0.5">
        {isLoading ? (
          <div className="py-6 text-center text-[11.5px] text-muted-foreground">
            Loading buckets...
          </div>
        ) : buckets.length === 0 ? (
          <div className="py-6 text-center text-[11.5px] text-muted-foreground">
            No active buckets found.
          </div>
        ) : (
          buckets.map((b) => {
            const isTarget = hoveredBucketId === b.id;
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
                  setHoveredBucketId(null);
                  onClose();
                  try {
                    const raw = e.dataTransfer.getData("application/katalist-thing");
                    if (!raw) return;
                    const data = JSON.parse(raw) as { thingId: string; title?: string };

                    await rpcAddToBucket(b.id, data.thingId);
                    toast.success(
                      `Filed "${data.title || "Thing"}" into 📁 ${b.name}`,
                    );
                    await qc.invalidateQueries({ queryKey: ["buckets"] });
                    await qc.invalidateQueries({ queryKey: ["bucket", b.id] });
                    await qc.invalidateQueries({ queryKey: ["bucket-items", b.id] });
                  } catch (err: any) {
                    toast.error(domainErrorMessage(err));
                  }
                }}
                className={cn(
                  "group relative flex items-center justify-between rounded-xl border p-2.5 transition-all duration-150 cursor-pointer",
                  isTarget
                    ? "border-primary bg-primary/10 shadow-sm scale-[1.02] ring-2 ring-primary/40"
                    : "border-border/60 bg-white hover:border-border hover:bg-muted/40",
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white font-bold text-[11px] shadow-2xs",
                      b.color || "bg-violet-500",
                    )}
                  >
                    <Folder className="h-3.5 w-3.5 fill-current opacity-90" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-bold text-foreground group-hover:text-primary transition-colors">
                      {b.name}
                    </span>
                    <span className="block text-[10.5px] text-muted-foreground">
                      {b.thingCount} {b.thingCount === 1 ? "Thing" : "Things"}
                    </span>
                  </div>
                </div>

                <div className="shrink-0 pl-2">
                  {isTarget ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary text-white px-2 py-0.5 text-[10px] font-bold shadow-xs animate-pulse">
                      <Check className="h-3 w-3" />
                      Drop here
                    </span>
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
