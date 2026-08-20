import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { Lock, MoreHorizontal, Plus, Search } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useBucket } from "@/features/buckets/use-buckets";
import { useAccessibleLists, useAccessibleThings, useBucketItems, type BucketItem } from "@/features/buckets/use-bucket-items";
import { bucketItemsSurface } from "@/features/buckets/bucket-items-surface";
import { ThingDetailSheet } from "@/features/things/ThingDetailSheet";
import { useThing } from "@/features/things/use-thing";
import { ImportanceBadge, PaceBadge } from "@/components/katalist/ImportanceBadge";
import { AcknowledgementBadge } from "@/components/katalist/AcknowledgementBadge";
import { WorkStatusBadge } from "@/components/katalist/WorkStatusBadge";
import { PersonCell } from "@/components/katalist/PersonCell";
import { domainErrorMessage } from "@/lib/domain-error";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Thing } from "@/domain/thing";
import type { ListRow } from "@/features/lists/fixtures";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/buckets/$bucketId")({
  component: BucketDetailPage,
});

function matchesQuery(q: string, thing?: Thing, list?: ListRow) {
  if (!q) return true;
  const n = q.toLowerCase();
  if (thing) {
    return (
      thing.title.toLowerCase().includes(n) ||
      thing.assignee.name.toLowerCase().includes(n) ||
      (thing.listName ?? "").toLowerCase().includes(n)
    );
  }
  if (list) {
    return list.name.toLowerCase().includes(n) || list.ownerLine.toLowerCase().includes(n);
  }
  return false;
}

function BucketThingRow({ thing, onOpen, onRemove }: { thing: Thing; onOpen: () => void; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-3 border-t border-border/80 px-4 py-3 first:border-t-0">
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <p className="truncate text-[13px] font-medium text-foreground">{thing.title}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <ImportanceBadge value={thing.ownerImportance} />
          <PaceBadge value={thing.personalPace} />
          <AcknowledgementBadge value={thing.acknowledgement} />
          <WorkStatusBadge value={thing.workStatus} />
          <PersonCell person={thing.assignee} />
          {thing.dueAt ? (
            <span className="text-[11px] text-muted-foreground">
              {format(new Date(thing.dueAt), thing.dueHasTime ? "MMM d · h:mm a" : "MMM d")}
            </span>
          ) : null}
          <span className="text-[11px] text-muted-foreground">{thing.listName ?? "Standalone"}</span>
        </div>
      </button>
      <button
        type="button"
        className="shrink-0 text-[12px] text-muted-foreground hover:text-foreground"
        onClick={onRemove}
      >
        Remove from Bucket
      </button>
    </li>
  );
}

function BucketListRow({ list, onRemove }: { list: ListRow; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-3 border-t border-border/80 px-4 py-3 first:border-t-0">
      <Link to="/lists/$listId" params={{ listId: list.id }} className="flex min-w-0 flex-1 items-center gap-3">
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-bold text-white", list.color)}>
          {list.name.slice(0, 1)}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-foreground">{list.name}</span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
              {list.context}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {list.ownerLine} · {list.thingCount} Things · {list.doneCount} done
          </p>
        </div>
      </Link>
      <button
        type="button"
        className="shrink-0 text-[12px] text-muted-foreground hover:text-foreground"
        onClick={onRemove}
      >
        Remove from Bucket
      </button>
    </li>
  );
}

function BucketDetailPage() {
  const { bucketId } = Route.useParams();
  const navigate = useNavigate();
  const { bucket, isLoading, error, rename, remove: deleteBucket } = useBucket(bucketId);
  const { items, add, remove, isLoading: itemsLoading, error: itemsError } = useBucketItems(bucketId);
  const things = useAccessibleThings();
  const lists = useAccessibleLists();
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<"things" | "lists">("things");
  const [addQ, setAddQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const liveThing = useThing(selectedId);
  const thingItemsAll = items.filter((i): i is Extract<BucketItem, { kind: "thing" }> => i.kind === "thing");
  const listItemsAll = items.filter((i): i is Extract<BucketItem, { kind: "list" }> => i.kind === "list");
  const selectedThing = liveThing.thing ?? thingItemsAll.find((i) => i.thingId === selectedId)?.thing ?? null;

  const referencedThingIds = new Set(thingItemsAll.map((i) => i.thingId));
  const referencedListIds = new Set(listItemsAll.map((i) => i.listId));

  const visible = useMemo(
    () =>
      items.filter((item) =>
        item.kind === "thing" ? matchesQuery(q, item.thing) : matchesQuery(q, undefined, item.list),
      ),
    [items, q],
  );
  const thingItems = visible.filter((i) => i.kind === "thing");
  const listItems = visible.filter((i) => i.kind === "list");

  const addThings = things.filter(
    (t) =>
      !referencedThingIds.has(t.id) &&
      (!addQ || t.title.toLowerCase().includes(addQ.toLowerCase()) || t.assignee.name.toLowerCase().includes(addQ.toLowerCase())),
  );
  const addLists = lists.filter(
    (l) => !referencedListIds.has(l.id) && (!addQ || l.name.toLowerCase().includes(addQ.toLowerCase())),
  );

  if (isLoading) {
    return (
      <AppShell title="Bucket" subtitle="Loading">
        <p className="text-sm text-muted-foreground">Opening this Bucket…</p>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell title="Bucket" subtitle="Couldn’t load">
        <p className="text-sm text-muted-foreground">{domainErrorMessage(error)}</p>
      </AppShell>
    );
  }

  if (!bucket) {
    return (
      <AppShell title="Bucket" subtitle="Not found">
        <Link to="/buckets" className="text-sm text-primary">
          Back to Buckets
        </Link>
      </AppShell>
    );
  }

  const thingCount = items.filter((i) => i.kind === "thing").length;
  const listCount = items.filter((i) => i.kind === "list").length;
  const itemsSurface = bucketItemsSurface({
    itemsLoading,
    itemsError,
    itemCount: items.length,
  });

  return (
    <AppShell title={bucket.name} subtitle="Private focus space. References only.">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
              {bucket.context}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              <Lock className="h-3 w-3" />
              Private
            </span>
          </div>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {thingCount} Things · {listCount} Lists
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">Private focus space. References only.</p>
        </div>
        <details className="relative">
          <summary
            aria-label="Bucket settings"
            className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted"
          >
            <MoreHorizontal className="h-4 w-4" />
          </summary>
          <div className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-border bg-card p-1 shadow-md">
            <button
              type="button"
              className="block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted"
              onClick={() => {
                setRenameValue(bucket.name);
                setRenameOpen(true);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="block w-full rounded px-2 py-1.5 text-left text-[13px] text-destructive hover:bg-destructive/10"
              onClick={() => setDeleteOpen(true)}
            >
              Delete Bucket
            </button>
          </div>
        </details>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search this Bucket…"
            className="h-9 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-[13px]"
          />
        </label>
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-card px-3 text-[13px] font-medium"
            >
              <Plus className="h-3.5 w-3.5" />
              Add reference
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-3">
            <div className="mb-2 flex gap-1 rounded-lg bg-muted p-0.5">
              <button
                type="button"
                className={cn("flex-1 rounded-md px-2 py-1 text-[12px]", addTab === "things" ? "bg-card font-medium" : "text-muted-foreground")}
                onClick={() => setAddTab("things")}
              >
                Things
              </button>
              <button
                type="button"
                className={cn("flex-1 rounded-md px-2 py-1 text-[12px]", addTab === "lists" ? "bg-card font-medium" : "text-muted-foreground")}
                onClick={() => setAddTab("lists")}
              >
                Lists
              </button>
            </div>
            <input
              value={addQ}
              onChange={(e) => setAddQ(e.target.value)}
              placeholder={addTab === "things" ? "Search Things…" : "Search Lists…"}
              className="mb-2 h-8 w-full rounded-md border border-border bg-background px-2 text-[12px]"
            />
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {addTab === "things"
                ? addThings.slice(0, 40).map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        className="w-full rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                        onClick={() => {
                          void add.mutateAsync({ thingId: t.id }).then(
                            () => {
                              toast.success("Referenced. The Thing itself did not change.");
                              setAddOpen(false);
                            },
                            (err) => toast.error(domainErrorMessage(err)),
                          );
                        }}
                      >
                        {t.title}
                      </button>
                    </li>
                  ))
                : addLists.map((l) => (
                    <li key={l.id}>
                      <button
                        type="button"
                        className="w-full rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                        onClick={() => {
                          void add.mutateAsync({ listId: l.id }).then(
                            () => {
                              toast.success("List referenced. Ownership unchanged.");
                              setAddOpen(false);
                            },
                            (err) => toast.error(domainErrorMessage(err)),
                          );
                        }}
                      >
                        {l.name}
                      </button>
                    </li>
                  ))}
              {(addTab === "things" ? addThings : addLists).length === 0 ? (
                <li className="px-2 py-3 text-[12px] text-muted-foreground">Nothing else to add.</li>
              ) : null}
            </ul>
          </PopoverContent>
        </Popover>
      </div>

      {itemsSurface === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading references…</p>
      ) : itemsSurface === "error" ? (
        <p className="text-sm text-muted-foreground">{domainErrorMessage(itemsError)}</p>
      ) : itemsSurface === "empty" ? (
        <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center">
          <p className="text-[14px] font-medium">This Bucket is empty.</p>
          <p className="mt-1 text-[13px] text-muted-foreground">Add a Thing or List you already have access to.</p>
          <button
            type="button"
            className="mt-4 inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-[13px]"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add reference
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
              Things {thingItems.length}
            </h2>
            {thingItems.length ? (
              <ul className="overflow-hidden rounded-xl border border-border bg-card">
                {thingItems.map((item) =>
                  item.kind === "thing" ? (
                    <BucketThingRow
                      key={item.thingId}
                      thing={item.thing}
                      onOpen={() => setSelectedId(item.thingId)}
                      onRemove={() =>
                        void remove.mutateAsync({ thingId: item.thingId }).then(
                          () => toast.success("Removed from this Bucket. The Thing is unchanged."),
                          (err) => toast.error(domainErrorMessage(err)),
                        )
                      }
                    />
                  ) : null,
                )}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">No matching Things.</p>
            )}
          </section>
          <section>
            <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
              Lists {listItems.length}
            </h2>
            {listItems.length ? (
              <ul className="overflow-hidden rounded-xl border border-border bg-card">
                {listItems.map((item) =>
                  item.kind === "list" ? (
                    <BucketListRow
                      key={item.listId}
                      list={item.list}
                      onRemove={() =>
                        void remove.mutateAsync({ listId: item.listId }).then(
                          () => toast.success("Removed from this Bucket. The List is unchanged."),
                          (err) => toast.error(domainErrorMessage(err)),
                        )
                      }
                    />
                  ) : null,
                )}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">No matching Lists.</p>
            )}
          </section>
        </div>
      )}

      <ThingDetailSheet thing={selectedThing} open={Boolean(selectedId)} onOpenChange={(v) => !v && setSelectedId(null)} />

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Bucket</DialogTitle>
            <DialogDescription>Context stays {bucket.context}. Only the name changes.</DialogDescription>
          </DialogHeader>
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-[13px]"
          />
          <DialogFooter>
            <button type="button" className="rounded-lg px-3 py-1.5 text-[13px]" onClick={() => setRenameOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground"
              onClick={() => {
                void rename.mutateAsync(renameValue).then(
                  () => {
                    toast.success("Bucket renamed.");
                    setRenameOpen(false);
                  },
                  (err) => toast.error(domainErrorMessage(err)),
                );
              }}
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this Bucket?</DialogTitle>
            <DialogDescription>
              This removes only your private grouping. The Things and Lists inside it will not be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className="rounded-lg px-3 py-1.5 text-[13px]" onClick={() => setDeleteOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-destructive px-3 py-1.5 text-[13px] text-destructive-foreground"
              onClick={() => {
                void deleteBucket.mutateAsync().then(
                  () => {
                    toast.success("Bucket deleted. Referenced work is unchanged.");
                    setDeleteOpen(false);
                    void navigate({ to: "/buckets" });
                  },
                  (err) => toast.error(domainErrorMessage(err)),
                );
              }}
            >
              Delete Bucket
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
