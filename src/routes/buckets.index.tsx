import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownUp,
  ArrowRight,
  ChevronDown,
  Filter,
  Lock,
  Plus,
  Search,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { type BucketCard } from "@/features/buckets/fixtures";
import { useLocalVersion } from "@/features/things/use-local-version";
import { useBuckets } from "@/features/buckets/use-buckets";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
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

function PinnedBucketCard({ bucket }: { bucket: BucketCard }) {
  const navigate = useNavigate();
  const letter = bucket.name.slice(0, 1).toUpperCase();
  const pastelStyles = [
    { bg: "bg-purple-100", text: "text-purple-700" },
    { bg: "bg-sky-100", text: "text-sky-700" },
    { bg: "bg-emerald-100", text: "text-emerald-700" },
    { bg: "bg-amber-100", text: "text-amber-700" },
    { bg: "bg-rose-100", text: "text-rose-700" },
  ];
  const charCode = (bucket.name.charCodeAt(0) || 0) % pastelStyles.length;
  const { bg, text } = pastelStyles[charCode]!;

  const tags = bucket.tags || [
    bucket.context === "work" ? "Work" : "Personal",
    "Yearly goals",
    "Docs",
  ];

  return (
    <article
      role="link"
      tabIndex={0}
      onClick={() => void navigate({ to: "/buckets/$bucketId", params: { bucketId: bucket.id } })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void navigate({ to: "/buckets/$bucketId", params: { bucketId: bucket.id } });
        }
      }}
      className="group flex flex-col justify-between rounded-2xl border border-border/80 bg-white p-5 shadow-2xs hover:shadow-xs transition-all duration-200 cursor-pointer min-h-[220px]"
    >
      <div>
        {/* Top Avatar Letter */}
        <div className="mb-3.5 flex items-center justify-between">
          <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl text-[15px] font-bold", bg, text)}>
            {letter}
          </span>
        </div>

        {/* Title + Lock */}
        <div className="flex items-center gap-1.5">
          <h3 className="text-[14.5px] font-bold text-foreground group-hover:text-primary transition-colors">
            {bucket.name}
          </h3>
          <Lock className="h-3.5 w-3.5 text-muted-foreground/80" />
        </div>

        {/* Counter */}
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
          {bucket.thingCount} Things · {bucket.listCount} {bucket.listCount === 1 ? "List" : "Lists"}
        </p>

        {/* Description */}
        <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground line-clamp-2">
          {bucket.description}
        </p>

        {/* Tag pills */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Footer: Collaborators Avatar Stack + View bucket link */}
      <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
        <div className="flex items-center -space-x-1.5 overflow-hidden">
          {(bucket.collaborators && bucket.collaborators.length > 0 ? bucket.collaborators : [
            { id: "c1", name: "Priya Sharma", avatarUrl: "/avatars/priya.jpg", initials: "PS" },
            { id: "c2", name: "Arjun Mehta", avatarUrl: "/avatars/arjun.jpg", initials: "AM" },
          ]).slice(0, 3).map((collab) => (
            <PersonAvatar
              key={collab.id}
              name={collab.name}
              src={collab.avatarUrl}
              initials={collab.initials || collab.name.slice(0, 2).toUpperCase()}
              size={22}
              className="ring-2 ring-white"
            />
          ))}
          {(bucket.collaborators?.length ?? 2) > 3 ? (
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-muted text-[9.5px] font-semibold text-muted-foreground ring-2 ring-white">
              +{bucket.collaborators!.length - 3}
            </span>
          ) : (
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-muted text-[9.5px] font-semibold text-muted-foreground ring-2 ring-white">
              +1
            </span>
          )}
        </div>

        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary group-hover:underline">
          View bucket <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </article>
  );
}

function AllBucketRow({ bucket }: { bucket: BucketCard }) {
  const navigate = useNavigate();
  const letter = bucket.name.slice(0, 1).toUpperCase();
  const pastelStyles = [
    { bg: "bg-amber-100", text: "text-amber-800" },
    { bg: "bg-rose-100", text: "text-rose-800" },
    { bg: "bg-emerald-100", text: "text-emerald-800" },
    { bg: "bg-orange-100", text: "text-orange-800" },
    { bg: "bg-purple-100", text: "text-purple-800" },
    { bg: "bg-sky-100", text: "text-sky-800" },
  ];
  const charCode = (bucket.name.charCodeAt(0) || 0) % pastelStyles.length;
  const { bg, text } = pastelStyles[charCode]!;

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => void navigate({ to: "/buckets/$bucketId", params: { bucketId: bucket.id } })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void navigate({ to: "/buckets/$bucketId", params: { bucketId: bucket.id } });
        }
      }}
      className="group flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border border-border/70 bg-white p-4 shadow-2xs hover:bg-muted/20 transition-all duration-200 cursor-pointer"
    >
      <div className="flex items-center gap-3.5 min-w-0">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[15px] font-bold", bg, text)}>
          {letter}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-[13.5px] font-bold text-foreground group-hover:text-primary transition-colors truncate">
              {bucket.name}
            </h3>
            <Lock className="h-3 w-3 text-muted-foreground/80 shrink-0" />
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            {bucket.thingCount} Things · {bucket.listCount} {bucket.listCount === 1 ? "List" : "Lists"}
          </p>
          <p className="text-[11.5px] text-muted-foreground truncate mt-0.5">
            {bucket.description}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between sm:justify-end gap-6 w-full sm:w-auto shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/50">
        {/* Collaborators Avatar Stack */}
        <div className="flex items-center -space-x-1.5 overflow-hidden">
          {(bucket.collaborators && bucket.collaborators.length > 0 ? bucket.collaborators : [
            { id: "c1", name: "Priya Sharma", avatarUrl: "/avatars/priya.jpg", initials: "PS" },
            { id: "c2", name: "Arjun Mehta", avatarUrl: "/avatars/arjun.jpg", initials: "AM" },
          ]).slice(0, 3).map((collab) => (
            <PersonAvatar
              key={collab.id}
              name={collab.name}
              src={collab.avatarUrl}
              initials={collab.initials || collab.name.slice(0, 2).toUpperCase()}
              size={22}
              className="ring-2 ring-white"
            />
          ))}
          {(bucket.collaborators?.length ?? 2) > 3 ? (
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-muted text-[9.5px] font-semibold text-muted-foreground ring-2 ring-white">
              +{bucket.collaborators!.length - 3}
            </span>
          ) : (
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-muted text-[9.5px] font-semibold text-muted-foreground ring-2 ring-white">
              +1
            </span>
          )}
        </div>

        <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary group-hover:underline">
          View bucket <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </div>
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
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="flex h-9 flex-1 items-center gap-2 rounded-xl border border-border/80 bg-white px-3 sm:max-w-md shadow-2xs">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search buckets..."
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </label>
        <label className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/80 bg-white px-3 text-[12.5px] text-foreground shadow-2xs">
          <ArrowDownUp className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "recent" | "name")}
            className="appearance-none bg-transparent pr-4 text-[12.5px] outline-none font-medium"
            aria-label="Sort buckets"
          >
            <option value="recent">Recently updated</option>
            <option value="name">Name</option>
          </select>
          <ChevronDown className="pointer-events-none -ml-5 h-3.5 w-3.5 text-muted-foreground" />
        </label>
        <button
          type="button"
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[12.5px] font-medium shadow-2xs transition-colors",
            pinnedOnly ? "border-primary bg-primary/10 text-primary" : "border-border/80 bg-white text-foreground hover:bg-muted/40",
          )}
          onClick={() => setPinnedOnly((v) => !v)}
        >
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Filter</span>
        </button>
      </div>

      {pinned.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3.5 text-[15px] font-bold text-foreground">Pinned Buckets</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pinned.map((b) => (
              <PinnedBucketCard key={b.id} bucket={b} />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3.5 text-[15px] font-bold text-foreground">All Buckets</h2>
        <div className="space-y-3">
          {rest.map((b) => (
            <AllBucketRow key={b.id} bucket={b} />
          ))}
          {rest.length === 0 && pinned.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted-foreground">No buckets found.</p>
          ) : null}
        </div>
      </section>

      {creating ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <form
            className="w-full max-w-sm rounded-2xl border border-border/80 bg-white p-5 shadow-xl"
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
