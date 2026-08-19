import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useBucket } from "@/features/buckets/use-buckets";
import { useAccessibleLists, useAccessibleThings, useBucketItems } from "@/features/buckets/use-bucket-items";
import { domainErrorMessage } from "@/lib/domain-error";
import { toast } from "sonner";

export const Route = createFileRoute("/buckets/$bucketId")({
  component: BucketDetailPage,
});

function BucketDetailPage() {
  const { bucketId } = Route.useParams();
  const { bucket, isLoading, error } = useBucket(bucketId);
  const { items, add, remove } = useBucketItems(bucketId);
  const things = useAccessibleThings();
  const lists = useAccessibleLists();
  const [q, setQ] = useState("");

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

  return (
    <AppShell title={bucket.name} subtitle="Private focus space — references only">
      <div className="mb-4 flex items-center gap-2 text-[12px] text-muted-foreground">
        <Lock className="h-3.5 w-3.5" />
        Private. No share, invite, members, chat, or huddle.
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search in this bucket"
        className="mb-4 h-9 w-full max-w-sm rounded-lg border border-border bg-card px-3 text-[13px]"
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <label className="text-[12px] text-muted-foreground">
          Add an existing Thing
          <select
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-[13px] text-foreground"
            defaultValue=""
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return;
              void add.mutateAsync({ thingId: id }).then(
                () => toast.success("Referenced. The Thing itself did not change."),
                (err) => toast.error(domainErrorMessage(err)),
              );
              e.target.value = "";
            }}
          >
            <option value="">Choose…</option>
            {things.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-muted-foreground">
          Add an existing List
          <select
            className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-[13px] text-foreground"
            defaultValue=""
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return;
              void add.mutateAsync({ listId: id }).then(
                () => toast.success("List referenced. Ownership unchanged."),
                (err) => toast.error(domainErrorMessage(err)),
              );
              e.target.value = "";
            }}
          >
            <option value="">Choose…</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {items
          .filter((r) => r.title.toLowerCase().includes(q.toLowerCase()))
          .map((r) => (
            <li key={`${r.kind}-${r.thingId ?? r.listId ?? r.title}`} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-[13px] font-medium">{r.title}</p>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{r.kind}</p>
              </div>
              <button
                type="button"
                className="text-[12px] text-muted-foreground hover:text-foreground"
                onClick={() =>
                  void remove.mutateAsync({ thingId: r.thingId, listId: r.listId }).then(
                    () => toast.success("Reference removed. Underlying object unchanged."),
                    (err) => toast.error(domainErrorMessage(err)),
                  )
                }
              >
                Remove
              </button>
            </li>
          ))}
      </ul>
    </AppShell>
  );
}
