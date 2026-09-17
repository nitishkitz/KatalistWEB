import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Briefcase,
  Home,
  LayoutGrid,
  List as ListIcon,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { BucketsSkeleton } from "@/components/katalist/ScreenSkeletons";
import { type BucketCard } from "@/features/buckets/fixtures";
import { useLocalVersion } from "@/features/things/use-local-version";
import { useBuckets } from "@/features/buckets/use-buckets";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { domainErrorMessage } from "@/lib/domain-error";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/buckets/")({
  head: () => ({
    meta: [
      { title: "Buckets — Katalist" },
      { name: "description", content: "Your private focus spaces." },
    ],
  }),
  component: BucketsPage,
});

const SQUARE_TINTS = [
  "bg-[#e9e2fb] text-[#6638ec]",
  "bg-[#e0edff] text-[#2874f4]",
  "bg-[#e4fcf0] text-[#12a15f]",
  "bg-[#fff1de] text-[#d99f10]",
  "bg-[#ffe6ec] text-[#e0466b]",
];

function squareTint(name: string): string {
  const code = (name.charCodeAt(0) || 0) % SQUARE_TINTS.length;
  return SQUARE_TINTS[code]!;
}

function BucketMenu({ onOpen }: { onOpen: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-stop-nav
          onClick={(e) => e.stopPropagation()}
          aria-label="Bucket actions"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#8487a7] hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40 bg-white">
        <DropdownMenuItem
          className="text-[12.5px] cursor-pointer"
          onSelect={(e) => {
            e.preventDefault();
            onOpen();
          }}
        >
          Open bucket
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CollaboratorStack({ bucket }: { bucket: BucketCard }) {
  const people = bucket.collaborators ?? [];
  if (people.length === 0) return <div />;
  return (
    <div className="flex items-center -space-x-1.5 overflow-hidden">
      {people.slice(0, 3).map((c) => (
        <PersonAvatar
          key={c.id}
          name={c.name}
          src={c.avatarUrl}
          initials={c.initials || c.name.slice(0, 2).toUpperCase()}
          size={22}
          className="ring-2 ring-white"
        />
      ))}
      {people.length > 3 ? (
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-muted text-[9.5px] font-semibold text-muted-foreground ring-2 ring-white">
          +{people.length - 3}
        </span>
      ) : null}
    </div>
  );
}

function BucketGridCard({ bucket }: { bucket: BucketCard }) {
  const navigate = useNavigate();
  const open = () => void navigate({ to: "/buckets/$bucketId", params: { bucketId: bucket.id } });
  const Icon = bucket.context === "home" ? Home : Briefcase;
  const tags = bucket.tags ?? [];
  return (
    <article
      role="link"
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-stop-nav]")) return;
        open();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className="group flex cursor-pointer flex-col rounded-[14px] border border-[#eef0f6] bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
    >
      <div className="flex items-start justify-between">
        <span className={cn("flex h-11 w-11 items-center justify-center rounded-[12px]", squareTint(bucket.name))}>
          <Icon className="h-5 w-5" />
        </span>
        <BucketMenu onOpen={open} />
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <h3 className="text-[15px] font-bold text-[#000533] transition-colors group-hover:text-[#975ee2]">
          {bucket.name}
        </h3>
        <Lock className="h-3.5 w-3.5 text-[#8487a7]" />
      </div>
      <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-[#6a769c]">{bucket.description}</p>

      <p className="mt-2.5 text-[12px] font-medium text-[#3d3f74]">
        {bucket.thingCount} Things • {bucket.listCount} {bucket.listCount === 1 ? "List" : "Lists"}
      </p>

      {tags.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-[#f1ecff] px-2 py-0.5 text-[10.5px] font-medium text-[#6638ec]"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between border-t border-[#f2f3f9] pt-3">
        <CollaboratorStack bucket={bucket} />
        <div className="flex items-center gap-4">
          <span className="whitespace-nowrap text-[11px] text-[#a3a9c9]">Updated {bucket.updatedAt}</span>
          <span className="text-[12px] font-semibold text-[#975ee2] group-hover:underline">Open bucket</span>
        </div>
      </div>
    </article>
  );
}

function BucketListRow({ bucket }: { bucket: BucketCard }) {
  const navigate = useNavigate();
  const open = () => void navigate({ to: "/buckets/$bucketId", params: { bucketId: bucket.id } });
  const Icon = bucket.context === "home" ? Home : Briefcase;
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-stop-nav]")) return;
        open();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className="group flex cursor-pointer flex-col items-start justify-between gap-3 rounded-[12px] border border-[#eef0f6] bg-white p-4 transition-all duration-200 hover:bg-[#faf9fe] sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]", squareTint(bucket.name))}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[13.5px] font-bold text-[#000533] group-hover:text-[#975ee2]">{bucket.name}</h3>
            <Lock className="h-3 w-3 shrink-0 text-[#8487a7]" />
          </div>
          <p className="text-[11.5px] text-[#6a769c]">
            {bucket.thingCount} Things • {bucket.listCount} {bucket.listCount === 1 ? "List" : "Lists"}
          </p>
          <p className="mt-0.5 truncate text-[11.5px] text-[#6a769c]">{bucket.description}</p>
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-6 border-t border-[#f2f3f9] pt-2 sm:w-auto sm:justify-end sm:border-t-0 sm:pt-0">
        <CollaboratorStack bucket={bucket} />
        <span className="whitespace-nowrap text-[11px] text-[#a3a9c9]">Updated {bucket.updatedAt}</span>
        <span className="text-[12px] font-semibold text-[#975ee2] group-hover:underline">Open bucket</span>
      </div>
    </div>
  );
}

function BucketsPage() {
  useLocalVersion();
  const { buckets, create, isLoading } = useBuckets();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");

  // People involved across all buckets (their Things' assignees/owners, their
  // Lists' members) — shown as avatar filters in place of a sort dropdown.
  const people = useMemo(() => {
    const map = new Map<string, { id: string; name: string; avatarUrl?: string | null; initials: string }>();
    for (const b of buckets) {
      for (const c of b.collaborators ?? []) {
        const key = c.name.trim().toLowerCase();
        if (!key || key === "someone") continue;
        if (!map.has(key)) {
          map.set(key, {
            id: c.id || key,
            name: c.name.trim(),
            avatarUrl: c.avatarUrl,
            initials: c.initials || c.name.slice(0, 2).toUpperCase(),
          });
        }
      }
    }
    return Array.from(map.values());
  }, [buckets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let source = buckets.filter((b) => {
      if (q && !b.name.toLowerCase().includes(q) && !b.description.toLowerCase().includes(q)) return false;
      if (personFilter) {
        const has = (b.collaborators ?? []).some(
          (c) => c.name.toLowerCase() === personFilter.toLowerCase() || c.id === personFilter,
        );
        if (!has) return false;
      }
      return true;
    });
    // Pinned first, then most recent by name fallback.
    source = [...source].sort((a, b) => Number(b.pinned) - Number(a.pinned));
    return source;
  }, [buckets, query, personFilter]);

  if (isLoading) {
    return (
      <AppShell>
        <BucketsSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Toolbar: search, people avatars (instead of a sort dropdown), create */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex h-10 flex-1 items-center gap-2 rounded-[10px] border border-[#ebecf7] bg-white px-3 sm:max-w-md">
          <Search className="h-4 w-4 text-[#8487a7]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search buckets..."
            className="w-full bg-transparent text-[13px] text-[#000533] outline-none placeholder:text-[#8487a7]"
          />
        </label>

        {people.length > 0 ? (
          <div className="flex items-center gap-2">
            <div className="flex items-center -space-x-1.5">
              {people.slice(0, 6).map((p) => {
                const active = personFilter?.toLowerCase() === p.name.toLowerCase();
                return (
                  <button
                    key={p.id}
                    type="button"
                    title={p.name}
                    onClick={() => setPersonFilter(active ? null : p.name)}
                    className={cn(
                      "rounded-full ring-2 transition-transform hover:z-10 hover:-translate-y-0.5",
                      active ? "z-10 ring-[#975ee2]" : "ring-white",
                    )}
                  >
                    <PersonAvatar name={p.name} src={p.avatarUrl} initials={p.initials} size={30} />
                  </button>
                );
              })}
            </div>
            {personFilter ? (
              <button
                type="button"
                onClick={() => setPersonFilter(null)}
                className="text-[12px] font-medium text-[#975ee2] hover:underline"
              >
                Clear
              </button>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#975ee2] px-4 text-[13px] font-medium text-white transition hover:brightness-95"
        >
          <Plus className="h-4 w-4" />
          Create Bucket
        </button>
      </div>

      {/* All Buckets card */}
      <div className="rounded-[14px] bg-white p-5" style={{ boxShadow: "0 1px 2px rgba(11,12,41,0.05)" }}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-bold text-[#000533]">All Buckets</h2>
            <p className="mt-0.5 text-[12px] text-[#6a769c]">
              All your focus spaces. Create, organize, and make progress.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[12px] text-[#6a769c]">
              {filtered.length} {filtered.length === 1 ? "bucket" : "buckets"}
            </span>
            <div className="flex items-center gap-0.5 rounded-lg border border-[#ebecf7] p-0.5">
              <button
                type="button"
                onClick={() => setView("grid")}
                aria-label="Grid view"
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                  view === "grid" ? "bg-[#f0e9fb] text-[#6638ec]" : "text-[#8487a7] hover:bg-muted",
                )}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                aria-label="List view"
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                  view === "list" ? "bg-[#f0e9fb] text-[#6638ec]" : "text-[#8487a7] hover:bg-muted",
                )}
              >
                <ListIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="py-12 text-center text-[13px] text-[#6a769c]">No buckets found.</p>
        ) : view === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((b) => (
              <BucketGridCard key={b.id} bucket={b} />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((b) => (
              <BucketListRow key={b.id} bucket={b} />
            ))}
          </div>
        )}
      </div>

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
