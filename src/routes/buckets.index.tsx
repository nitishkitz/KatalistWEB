import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
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

export const Route = createFileRoute("/buckets/")({
  head: () => ({
    meta: [
      { title: "Buckets — Katalist" },
      { name: "description", content: "Your private focus spaces." },
    ],
  }),
  component: BucketsPage,
});

const BUCKET_ACCENTS = [
  { line: "bg-[#7c4dcc]", wash: "bg-[#f7f3fc]", text: "text-[#673aa9]" },
  { line: "bg-[#2874d8]", wash: "bg-[#f1f6fd]", text: "text-[#1f5da9]" },
  { line: "bg-[#16845a]", wash: "bg-[#eff8f4]", text: "text-[#126d4b]" },
  { line: "bg-[#bf7a18]", wash: "bg-[#fcf7ee]", text: "text-[#925a0c]" },
  { line: "bg-[#c84b69]", wash: "bg-[#fcf2f5]", text: "text-[#a43852]" },
];

function bucketAccent(name: string) {
  const code = (name.charCodeAt(0) || 0) % BUCKET_ACCENTS.length;
  return BUCKET_ACCENTS[code]!;
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

function BucketTableRow({ bucket }: { bucket: BucketCard }) {
  const navigate = useNavigate();
  const open = () => void navigate({ to: "/buckets/$bucketId", params: { bucketId: bucket.id } });
  const accent = bucketAccent(bucket.name);
  const progressTotal = bucket.progressTotal ?? 0;
  const progressCompleted = Math.min(bucket.progressCompleted ?? 0, progressTotal);
  const progressPercent = progressTotal ? Math.round((progressCompleted / progressTotal) * 100) : 0;
  return (
    <tr
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className="group cursor-pointer border-b border-[#f2f3f9] last:border-0 hover:bg-[#faf9fe]"
    >
      <td className="px-3 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("h-8 w-1 shrink-0 rounded-full", accent.line)} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold text-[#000533] group-hover:text-[#975ee2]">
                {bucket.name}
              </span>
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        <CollaboratorStack bucket={bucket} />
      </td>
      <td className="px-3 py-3 text-[12.5px] text-[#3d3f74]">{bucket.thingCount}</td>
      <td className="px-3 py-3 text-[12.5px] text-[#3d3f74]">{bucket.listCount}</td>
      <td className="px-3 py-3">
        <div className="flex min-w-[120px] items-center gap-2">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#efeff4]"
            role="progressbar"
            aria-label={`${bucket.name} progress`}
            aria-valuemin={0}
            aria-valuemax={progressTotal}
            aria-valuenow={progressCompleted}
          >
            <span className={cn("block h-full rounded-full", accent.line)} style={{ width: `${progressPercent}%` }} />
          </div>
          <span className="w-8 text-right text-[11px] tabular-nums text-[#777489]">
            {progressTotal ? `${progressPercent}%` : "—"}
          </span>
        </div>
      </td>
      <td className="px-3 py-3 whitespace-nowrap text-[11.5px] text-[#a3a9c9]">{bucket.updatedAt}</td>
    </tr>
  );
}

function BucketsPage() {
  useLocalVersion();
  const { buckets, create, isLoading } = useBuckets();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [personFilter, setPersonFilter] = useState<string | null>(null);

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
      <div className="-mt-2 mb-6 flex flex-wrap items-center gap-3 border-b border-[#ececf2] pb-4">
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

        {/* Create Bucket */}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#8250c8] px-4 text-[13px] font-medium text-white shadow-[0_2px_8px_rgba(86,45,143,0.2)] transition-[background-color,transform] duration-150 hover:bg-[#7343b8] active:scale-[0.96]"
          >
            <Plus className="h-4 w-4" />
            Create Bucket
          </button>
        </div>
      </div>

      {/* Buckets */}
      <div>
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-[13px] text-[#6a769c]">No buckets found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left">
              <thead>
                <tr className="border-b border-[#eef0f6] text-[11px] font-semibold uppercase tracking-wide text-[#8487a7]">
                  <th className="px-3 py-2.5 font-semibold">Bucket</th>
                  <th className="px-3 py-2.5 font-semibold">Members</th>
                  <th className="px-3 py-2.5 font-semibold">Things</th>
                  <th className="px-3 py-2.5 font-semibold">Lists</th>
                  <th className="px-3 py-2.5 font-semibold">Progress</th>
                  <th className="px-3 py-2.5 font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <BucketTableRow key={b.id} bucket={b} />
                ))}
              </tbody>
            </table>
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
