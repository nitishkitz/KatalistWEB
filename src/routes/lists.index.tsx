import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Filter, MoreHorizontal, Plus, Search } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { type ListRow } from "@/features/lists/fixtures";
import { useLocalVersion } from "@/features/things/use-local-version";
import { useAppContext } from "@/features/context/use-app-context";
import { useLists } from "@/features/lists/use-lists";
import { cn } from "@/lib/utils";
import { useAvatarUrl } from "@/features/people/directory";
import { NewListDialog } from "@/features/lists/NewListDialog";

export const Route = createFileRoute("/lists/")({
  head: () => ({
    meta: [
      { title: "Lists — Katalist" },
      { name: "description", content: "Shared collaboration rooms for your things." },
    ],
  }),
  component: ListsPage,
});

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="flex min-w-[120px] flex-col gap-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary/80" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-muted-foreground">
        {done} done · {total - done} open
      </span>
    </div>
  );
}

function MemberFace({ name, initials, avatarUrl }: { name: string; initials: string; avatarUrl?: string | null }) {
  const src = useAvatarUrl(name, null, avatarUrl);
  return src ? (
    <img src={src} alt="" className="h-full w-full object-cover" />
  ) : (
    <>{initials}</>
  );
}

function MemberStack({ members, count }: { members: ListRow["members"]; count: number }) {
  const shown = members.slice(0, 3);
  const extra = Math.max(0, count - shown.length);
  return (
    <div className="flex items-center">
      <div className="flex -space-x-1.5">
        {shown.map((m) => (
          <span
            key={m.initials + m.name}
            className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-card bg-muted text-[9px] font-semibold text-foreground"
            title={m.name}
          >
            <MemberFace name={m.name} initials={m.initials} avatarUrl={m.avatarUrl} />
          </span>
        ))}
      </div>
      {extra > 0 ? <span className="ml-1.5 text-[11px] text-muted-foreground">+{extra}</span> : null}
    </div>
  );
}

function ListTable({ rows }: { rows: ListRow[] }) {
  const navigate = useNavigate();
  if (rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full table-fixed">
        <thead>
          <tr className="text-left text-[11px] font-medium text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">List</th>
            <th className="px-2 py-2.5 font-medium">Members</th>
            <th className="px-2 py-2.5 font-medium">Things</th>
            <th className="px-2 py-2.5 font-medium">Progress</th>
            <th className="px-2 py-2.5 font-medium">Unread</th>
            <th className="px-2 py-2.5 font-medium">Latest activity</th>
            <th className="w-10 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="cursor-pointer border-t border-border/80 hover:bg-muted/40"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("[data-stop-nav]")) return;
                void navigate({ to: "/lists/$listId", params: { listId: row.id } });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void navigate({ to: "/lists/$listId", params: { listId: row.id } });
                }
              }}
              role="link"
              tabIndex={0}
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg text-[11px] font-bold text-white", row.color)}>
                    {row.name.slice(0, 1)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground">{row.name}</span>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                        {row.context}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{row.ownerLine}</p>
                  </div>
                </div>
              </td>
              <td className="px-2">
                <MemberStack members={row.members} count={row.memberCount} />
              </td>
              <td className="px-2 text-[13px] text-foreground">{row.thingCount}</td>
              <td className="px-2">
                <ProgressBar done={row.doneCount} total={row.thingCount} />
              </td>
              <td className="px-2">
                {row.unread > 0 ? (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                    {row.unread}
                  </span>
                ) : (
                  <span className="text-[12px] text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-2">
                <p className="truncate text-[12px] text-foreground">{row.latestActivity}</p>
                <p className="text-[11px] text-muted-foreground">{row.updatedAt}</p>
              </td>
              <td className="pr-3 text-right">
                <button
                  type="button"
                  data-stop-nav
                  className="relative z-10 rounded p-1 text-muted-foreground hover:bg-muted"
                  aria-label="List actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Group({ title, rows }: { title: string; rows: ListRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="katalist-section-title">{title}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {rows.length}
        </span>
      </div>
      <ListTable rows={rows} />
    </section>
  );
}

function ListsPage() {
  useLocalVersion();
  const { context } = useAppContext();
  const { lists, create } = useLists();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [roleFilter, setRoleFilter] = useState<"all" | "owner" | "collaborator" | "view_only">("all");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lists.filter((l) => {
      if (q && !l.name.toLowerCase().includes(q)) return false;
      if (roleFilter !== "all" && l.role !== roleFilter) return false;
      return true;
    });
  }, [lists, query, roleFilter]);

  const owned = filtered.filter((l) => l.role === "owner");
  const collab = filtered.filter((l) => l.role === "collaborator");
  const viewOnly = filtered.filter((l) => l.role === "view_only");

  return (
    <AppShell
      title="Lists"
      subtitle="Shared collaboration rooms"
      actions={
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New List
        </button>
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <label className="flex h-9 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3 sm:max-w-xs">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search lists"
            className="w-full bg-transparent text-[13px] outline-none"
          />
        </label>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] text-foreground"
          onClick={() =>
            setRoleFilter((r) =>
              r === "all" ? "owner" : r === "owner" ? "collaborator" : r === "collaborator" ? "view_only" : "all",
            )
          }
        >
          <Filter className="h-3.5 w-3.5" />
          {roleFilter === "all" ? "Filter" : roleFilter}
        </button>
      </div>

      <div className="space-y-6">
        <Group title="Owned by Me" rows={owned} />
        <Group title="Collaborating" rows={collab} />
        <Group title="View Only" rows={viewOnly} />
      </div>

      <NewListDialog open={creating} onClose={() => setCreating(false)} create={create} />
    </AppShell>
  );
}
