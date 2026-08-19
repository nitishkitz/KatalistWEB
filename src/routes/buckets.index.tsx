import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Filter, Lock, MoreHorizontal, Plus, Search } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { type BucketCard } from "@/features/buckets/fixtures";
import { useLocalVersion } from "@/features/things/local-state";
import { useBuckets } from "@/features/buckets/use-buckets";
import { domainErrorMessage } from "@/lib/domain-error";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/buckets/")({
  head: () => ({
    meta: [
      { title: "Buckets — Katalist" },
      { name: "description", content: "Your private focus spaces." },
    ],
  }),
  component: BucketsPage,
});

function BucketCardView({ bucket, large }: { bucket: BucketCard; large?: boolean }) {
  const navigate = useNavigate();
  return (
    <article
      role="link"
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-stop-nav]")) return;
        void navigate({ to: "/buckets/$bucketId", params: { bucketId: bucket.id } });
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void navigate({ to: "/buckets/$bucketId", params: { bucketId: bucket.id } });
        }
      }}
      className={cn(
        "group flex cursor-pointer flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/30",
        large ? "min-h-[210px]" : "min-h-[180px]",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold text-white", bucket.color)}>
            {bucket.name.slice(0, 1)}
          </span>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-[14px] font-semibold text-foreground">{bucket.name}</h3>
              <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Private" />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {bucket.thingCount} Things · {bucket.listCount} Lists
            </p>
          </div>
        </div>
        <button
          type="button"
          data-stop-nav
          className="relative z-10 rounded p-1 text-muted-foreground hover:bg-muted"
          aria-label="Bucket actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      <p className="mb-3 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">{bucket.description}</p>

      <ul className="mb-3 flex-1 space-y-1.5">
        {bucket.previews.slice(0, 3).map((p) => (
          <li key={p.title} className="flex items-center gap-2 text-[12px] text-foreground">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
            <span className="truncate">{p.title}</span>
            {p.state ? (
              <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {p.state}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="mt-auto flex items-center justify-between border-t border-border/70 pt-3">
        <span className="text-[11px] text-muted-foreground">{bucket.updatedAt}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void navigate({ to: "/buckets/$bucketId", params: { bucketId: bucket.id } });
          }}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-primary"
        >
          View bucket
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
}

function BucketsPage() {
  useLocalVersion();
  const { buckets, create } = useBuckets();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let source = buckets.filter(
      (b) =>
        (!q || b.name.toLowerCase().includes(q) || b.description.toLowerCase().includes(q)) &&
        (!pinnedOnly || b.pinned),
    );
    if (sort === "name") source = [...source].sort((a, b) => a.name.localeCompare(b.name));
    return source;
  }, [buckets, query, sort, pinnedOnly]);

  const pinned = filtered.filter((b) => b.pinned);
  const rest = filtered.filter((b) => !b.pinned);

  return (
    <AppShell
      title="Buckets"
      subtitle="Your private focus spaces"
      actions={
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Create Bucket
        </button>
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <label className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3 sm:max-w-sm">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your buckets"
            className="w-full bg-transparent text-[13px] outline-none"
          />
        </label>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] text-foreground"
          onClick={() => setSort((s) => (s === "recent" ? "name" : "recent"))}
        >
          Sort: {sort === "recent" ? "Recently updated" : "Name"}
        </button>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] text-foreground"
          onClick={() => setPinnedOnly((v) => !v)}
        >
          <Filter className="h-3.5 w-3.5" />
          {pinnedOnly ? "Pinned" : "Filter"}
        </button>
      </div>

      {pinned.length > 0 ? (
        <section className="mb-7">
          <h2 className="mb-3 katalist-section-title">Pinned Buckets</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pinned.map((b) => (
              <BucketCardView key={b.id} bucket={b} large />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 katalist-section-title">All Buckets</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {rest.map((b) => (
            <BucketCardView key={b.id} bucket={b} />
          ))}
        </div>
      </section>

      {creating ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
          <form
            className="w-full max-w-sm rounded-xl border border-border bg-card p-4"
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
            <h2 className="text-[14px] font-semibold">Create Bucket</h2>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bucket name"
              className="mt-3 h-9 w-full rounded-lg border border-border px-3 text-[13px]"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="text-[13px]" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button type="submit" className="rounded-lg bg-primary px-3 py-1.5 text-[13px] text-primary-foreground">
                Create
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </AppShell>
  );
}
