import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, LockKeyhole } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { AsyncState } from "@/components/katalist/AsyncState";
import { useLocalVersion } from "@/features/things/use-local-version";
import { useBuckets } from "@/features/buckets/use-buckets";
import type { Thing } from "@/domain/thing";
import { bucketTheme } from "@/features/buckets/BucketGalleryCard";
import "@/features/buckets/buckets-workspace.css";
import { BucketThingsTable } from "@/features/buckets/BucketThingsTable";
import { useBucketItems } from "@/features/buckets/use-bucket-items";
import { AddToBucketDialog } from "@/features/buckets/AddToBucketDialog";
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
  const {
    buckets,
    create,
    isLoading,
    error: bucketsError,
    refetch: refetchBuckets,
    hasFetchedOnce,
  } = useBuckets();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [selectedBucketId, setSelectedBucketId] = useState<string | null>(null);
  const [openThing, setOpenThing] = useState<Thing | null>(null);
  const [adding, setAdding] = useState(false);

  const activeBucket = buckets.find((b) => b.id === selectedBucketId) ?? buckets[0] ?? null;
  const {
    items,
    add,
    remove,
    isLoading: itemsLoading,
    error: itemsError,
    refetch: refetchItems,
  } = useBucketItems(activeBucket?.id);

  const activeIndex = Math.max(
    0,
    buckets.findIndex((b) => b.id === activeBucket?.id),
  );
  const total = activeBucket?.progressTotal ?? 0;
  const completed = Math.min(activeBucket?.progressCompleted ?? 0, total);
  const percent = total ? Math.round((completed / total) * 100) : 0;
  const quantity = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

  return (
    <AppShell noPadding>
      <div className="buckets-workspace">
        <aside className="buckets-rail" aria-label="Bucket navigation">
          <h1>Buckets</h1>
          <p className="buckets-privacy">
            <LockKeyhole aria-hidden="true" />
            Private to you
          </p>
          <button type="button" className="buckets-create" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            Create bucket
          </button>
          <AsyncState
            isLoading={isLoading}
            data={buckets}
            error={bucketsError}
            onRetry={refetchBuckets}
            isEmpty={buckets.length === 0}
            hasFetchedOnce={hasFetchedOnce}
            emptyTitle="No Buckets yet"
            emptyDescription="Create a private collection of Things and Lists."
            loadingContent={
              <div className="buckets-rail-loading" aria-label="Loading buckets">
                <span />
                <span />
              </div>
            }
          >
            {() => (
              <nav
                className="buckets-collection-list"
                data-testid="bucket-gallery"
                aria-label="Your buckets"
              >
                {buckets.map((bucket, index) => (
                  <button
                    type="button"
                    key={bucket.id}
                    className="buckets-collection"
                    data-testid="bucket-gallery-card"
                    data-selected={bucket.id === activeBucket?.id || undefined}
                    aria-pressed={bucket.id === activeBucket?.id}
                    aria-label={`Show ${bucket.name}`}
                    onClick={() => setSelectedBucketId(bucket.id)}
                  >
                    <img src={bucketTheme(index).art} alt="" draggable={false} />
                    <span className="buckets-collection-copy">
                      <strong>{bucket.name}</strong>
                      <span>
                        {quantity(bucket.thingCount, "Thing")} ·{" "}
                        {quantity(bucket.listCount, "List")}
                      </span>
                    </span>
                  </button>
                ))}
              </nav>
            )}
          </AsyncState>
        </aside>
        <div className="buckets-main">
          {activeBucket ? (
            <>
              <header className="buckets-heading">
                <img src={bucketTheme(activeIndex).art} alt="" draggable={false} />
                <div className="buckets-heading-copy">
                  <h2>{activeBucket.name}</h2>
                  <div>
                    <span>
                      {quantity(activeBucket.thingCount, "Thing")} ·{" "}
                      {quantity(activeBucket.listCount, "List")}
                    </span>
                    <span className="buckets-privacy">
                      <LockKeyhole aria-hidden="true" />
                      Private to you
                    </span>
                  </div>
                </div>
                <div className="buckets-completion">
                  <div
                    role="progressbar"
                    aria-label={`${activeBucket.name} progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                  <span>
                    <strong>{total ? `${percent}%` : "—"}</strong> complete
                  </span>
                </div>
              </header>
              <BucketThingsTable
                key={activeBucket.id}
                bucketId={activeBucket.id}
                items={items}
                isLoading={itemsLoading}
                error={itemsError}
                onRetry={() => void refetchItems()}
                onOpenThing={setOpenThing}
                onAdd={() => setAdding(true)}
                bucketName={activeBucket.name}
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
            </>
          ) : !isLoading && !bucketsError ? (
            <div className="buckets-page-empty">
              <h2>Your private focus space</h2>
              <p>Create a bucket to collect related Things and Lists.</p>
            </div>
          ) : null}
        </div>
      </div>

      {activeBucket ? (
        <AddToBucketDialog
          open={adding}
          bucketName={activeBucket.name}
          referencedThingIds={
            new Set(items.flatMap((i) => (i.kind === "thing" ? [i.thingId] : [])))
          }
          referencedListIds={new Set(items.flatMap((i) => (i.kind === "list" ? [i.listId] : [])))}
          onClose={() => setAdding(false)}
          onAdd={(target) => add.mutateAsync(target)}
        />
      ) : null}
      <CourtDetailModal
        thing={openThing}
        isOpen={Boolean(openThing)}
        onClose={() => setOpenThing(null)}
      />

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
