import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { BucketsSkeleton } from "@/components/katalist/ScreenSkeletons";
import { AsyncState } from "@/components/katalist/AsyncState";
import { useLocalVersion } from "@/features/things/use-local-version";
import { useBuckets } from "@/features/buckets/use-buckets";
import type { Thing } from "@/domain/thing";
import { BucketGalleryCard } from "@/features/buckets/BucketGalleryCard";
import { BucketThingsTable } from "@/features/buckets/BucketThingsTable";
import { useBucketItems } from "@/features/buckets/use-bucket-items";
import { useBucketNoteCounts } from "@/features/buckets/use-bucket-note-counts";
import { CourtDetailModal } from "@/features/court/CourtDetailModal";
import { domainErrorMessage } from "@/lib/domain-error";
import { toast } from "sonner";

export const Route = createFileRoute("/buckets/")({
  head: () => ({
    meta: [
      { title: "Buckets — Katalist" },
      { name: "description", content: "Your private focus spaces." },
    ],
  }),
  component: BucketsPage,
});

function BucketsPage() {
  useLocalVersion();
  const { buckets, create, isLoading, error: bucketsError, refetch: refetchBuckets, hasFetchedOnce } = useBuckets();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [selectedBucketId, setSelectedBucketId] = useState<string | null>(null);
  const [openThing, setOpenThing] = useState<Thing | null>(null);

  const noteCounts = useBucketNoteCounts(useMemo(() => buckets.map((b) => b.id), [buckets]));
  const activeBucket = buckets.find((b) => b.id === selectedBucketId) ?? buckets[0] ?? null;
  const {
    items,
    remove,
    isLoading: itemsLoading,
    error: itemsError,
    refetch: refetchItems,
  } = useBucketItems(activeBucket?.id);

  return (
    <AppShell>
      <div className="font-['Inter',sans-serif]">
        <div className="mb-[14px] flex min-h-[58px] items-center justify-between gap-4">
          <div className="flex flex-col gap-[1.4px] leading-normal">
            <h1 className="text-[34.56px] font-bold text-[#100d36]">Buckets</h1>
            <p className="text-[15.12px] text-[#7a81ab]">Organize your things, lists and notes in one place.</p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-10 items-center gap-1.5 rounded-[8px] bg-[#793aff] px-4 text-[13px] font-medium text-white transition-[background-color,transform] duration-150 hover:bg-[#6a2ee8] active:scale-[0.96]"
          >
            <Plus className="h-4 w-4" />
            Create bucket
          </button>
        </div>

        <AsyncState
          isLoading={isLoading}
          data={buckets}
          error={bucketsError}
          onRetry={refetchBuckets}
          isEmpty={buckets.length === 0}
          hasFetchedOnce={hasFetchedOnce}
          emptyTitle="No Buckets yet"
          emptyDescription="Create a Bucket to privately organize references to Things and Lists you already have access to."
          loadingContent={<BucketsSkeleton />}
        >
          {() => (
            <div className="flex flex-col gap-[14px]">
              <div className="flex gap-[10px] overflow-x-auto pb-1" data-testid="bucket-gallery">
                {buckets.map((b, i) => (
                  <BucketGalleryCard
                    key={b.id}
                    bucket={b}
                    index={i}
                    noteCount={noteCounts[b.id] ?? 0}
                    selected={b.id === activeBucket?.id}
                    onSelect={() => setSelectedBucketId(b.id)}
                  />
                ))}
              </div>
              {activeBucket ? (
                <BucketThingsTable
                  key={activeBucket.id}
                  bucketId={activeBucket.id}
                  items={items}
                  isLoading={itemsLoading}
                  error={itemsError}
                  onRetry={() => void refetchItems()}
                  onOpenThing={setOpenThing}
                  onRemoveThing={(t) =>
                    void remove.mutateAsync({ thingId: t.id }).then(
                      () => toast.success("Removed from bucket."),
                      (err) => toast.error(domainErrorMessage(err)),
                    )
                  }
                  onRemoveList={(l) =>
                    void remove.mutateAsync({ listId: l.id }).then(
                      () => toast.success("List removed from bucket."),
                      (err) => toast.error(domainErrorMessage(err)),
                    )
                  }
                />
              ) : null}
            </div>
          )}
        </AsyncState>
      </div>

      <CourtDetailModal thing={openThing} isOpen={Boolean(openThing)} onClose={() => setOpenThing(null)} />

      {creating ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <form
            className="w-full max-w-sm rounded-2xl border border-border/80 bg-white p-5 katalist-elevation-dialog"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              void create.mutateAsync(name.trim()).then(
                () => {
                  toast.success("Bucket created.");
                  setName("");
                  setCreating(false);
                },
                (err) => toast.error(domainErrorMessage(err)),
              );
            }}
          >
            <h2 className="text-[15px] font-bold text-foreground">Create Bucket</h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Buckets are private focus spaces for your references.
            </p>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My priorities, Q3 Research"
              className="mt-3.5 h-10 w-full rounded-xl border border-border px-3 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-ring"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-muted"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}
