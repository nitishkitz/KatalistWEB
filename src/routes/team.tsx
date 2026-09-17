import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Search, ChevronDown, UserPlus, MoreVertical, Copy, Mail, Phone, Users } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useTeam, type TeamMember } from "@/features/people/use-team";
import { usePresence } from "@/features/people/presence";
import { TeamSkeleton } from "@/components/katalist/ScreenSkeletons";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Tab = "all" | "online" | "invited";

export const Route = createFileRoute("/team")({
  head: () => ({
    meta: [
      { title: "Team — Katalist" },
      { name: "description", content: "Your connected teammates and contacts." },
    ],
  }),
  component: TeamPage,
});

function StatusBadge({ online }: { online: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium",
        online ? "bg-[#e4fcf0] text-[#12a15f]" : "bg-[#f1f2f7] text-[#8487a7]",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-[#12a15f]" : "bg-[#b4b9cd]")} />
      {online ? "Online" : "Offline"}
    </span>
  );
}

function TeamRow({ member, online }: { member: TeamMember; online: boolean }) {
  return (
    <tr className="border-b border-[#f2f3f9] last:border-0 hover:bg-[#faf9fe]">
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          <PersonAvatar name={member.name} initials={member.initials} src={member.avatarUrl} size={34} />
          <span className="text-[13.5px] font-semibold text-[#000533]">{member.name}</span>
        </div>
      </td>
      <td className="px-3 py-3">
        <StatusBadge online={online} />
      </td>
      <td className="px-3 py-3 text-[13px] text-[#3d3f74]">{member.role ?? "—"}</td>
      <td className="px-3 py-3 text-[13px] text-[#3d3f74]">{member.phone ?? "—"}</td>
      <td className="px-3 py-3 text-[13px] text-[#3d3f74]">{member.email ?? "—"}</td>
      <td className="px-3 py-3 text-[13px] text-[#3d3f74]">
        {member.connectedSince ? format(new Date(member.connectedSince), "d MMM yyyy") : "—"}
      </td>
      <td className="py-3 pr-4 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#8487a7] hover:bg-muted hover:text-foreground"
              aria-label="Member actions"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44 bg-white">
            <DropdownMenuItem
              disabled={!member.email}
              onClick={() => {
                if (!member.email) return;
                void navigator.clipboard.writeText(member.email);
                toast.success("Email copied to clipboard");
              }}
              className="text-[12.5px] cursor-pointer"
            >
              <Mail className="mr-2 h-3.5 w-3.5" />
              Copy email
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!member.phone}
              onClick={() => {
                if (!member.phone) return;
                void navigator.clipboard.writeText(member.phone);
                toast.success("Phone number copied to clipboard");
              }}
              className="text-[12.5px] cursor-pointer"
            >
              <Phone className="mr-2 h-3.5 w-3.5" />
              Copy phone
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(member.name);
                toast.success("Name copied to clipboard");
              }}
              className="text-[12.5px] cursor-pointer"
            >
              <Copy className="mr-2 h-3.5 w-3.5" />
              Copy name
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

function TeamPage() {
  const { members, isLoading } = useTeam();
  const online = usePresence();
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const roles = useMemo(() => {
    const set = new Set<string>();
    for (const m of members) if (m.role) set.add(m.role);
    return Array.from(set).sort();
  }, [members]);

  const onlineCount = useMemo(() => members.filter((m) => online.has(m.id)).length, [members, online]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      if (tab === "online" && !online.has(m.id)) return false;
      if (roleFilter !== "all" && m.role !== roleFilter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        (m.role ?? "").toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [members, tab, roleFilter, query, online]);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "all", label: "All People", count: members.length },
    { id: "online", label: "Online", count: onlineCount },
    { id: "invited", label: "Invited", count: 0 },
  ];

  if (isLoading) {
    return (
      <AppShell>
        <TeamSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="rounded-2xl bg-white p-5" style={{ boxShadow: "0 1px 2px rgba(11,12,41,0.05)" }}>
        {/* Tabs */}
        <div className="flex items-center gap-1 rounded-xl bg-[#f6f7fc] p-1 w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] font-medium transition-colors",
                tab === t.id ? "bg-[#ece5fb] text-[#6638ec]" : "text-[#6a769c] hover:text-[#000533]",
              )}
            >
              {t.label}
              {t.count > 0 ? (
                <span
                  className={cn(
                    "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-semibold",
                    tab === t.id ? "bg-[#6638ec] text-white" : "bg-[#e3e5ef] text-[#6a769c]",
                  )}
                >
                  {t.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="flex h-10 w-full max-w-[320px] items-center gap-2 rounded-[10px] border border-[#ebecf7] bg-[#f9f9fe] px-3 focus-within:border-[#975ee2]">
            <Search className="h-4 w-4 text-[#8487a7]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people, teams, or skills"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[#000533] outline-none placeholder:text-[#8487a7]"
            />
          </label>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#ebecf7] bg-white px-3 text-[12.5px] font-medium text-[#3d3f74] hover:border-[#975ee2]"
              >
                {roleFilter === "all" ? "All roles" : roleFilter}
                <ChevronDown className="h-4 w-4 text-[#8487a7]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48 bg-white">
              <DropdownMenuRadioGroup value={roleFilter} onValueChange={setRoleFilter}>
                <DropdownMenuRadioItem value="all" className="text-[12.5px] cursor-pointer">
                  All roles
                </DropdownMenuRadioItem>
                {roles.map((r) => (
                  <DropdownMenuRadioItem key={r} value={r} className="text-[12.5px] cursor-pointer">
                    {r}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="ml-auto">
            <button
              type="button"
              onClick={() => toast("Invitations are not available yet.")}
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#975ee2] px-4 text-[13px] font-semibold text-white hover:brightness-95"
            >
              <UserPlus className="h-4 w-4" />
              Invite People
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="mt-4 overflow-x-auto">
          {tab === "invited" ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-[#e3e5ef] text-center">
              <Users className="h-8 w-8 text-[#c5cae0]" />
              <p className="mt-2 text-[13px] font-semibold text-[#000533]">No pending invitations</p>
              <p className="mt-1 text-[11.5px] text-[#6a769c]">Invited people will appear here.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-[#e3e5ef] text-center">
              <Users className="h-8 w-8 text-[#c5cae0]" />
              <p className="mt-2 text-[13px] font-semibold text-[#000533]">No people to show</p>
              <p className="mt-1 text-[11.5px] text-[#6a769c]">
                {tab === "online" ? "No teammates are online right now." : "Try a different search or filter."}
              </p>
            </div>
          ) : (
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="border-b border-[#eef0f6] text-[11px] font-semibold uppercase tracking-wide text-[#8487a7]">
                  <th className="px-5 py-2.5 font-semibold">Person</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold">Role</th>
                  <th className="px-3 py-2.5 font-semibold">Mobile Number</th>
                  <th className="px-3 py-2.5 font-semibold">Email ID</th>
                  <th className="px-3 py-2.5 font-semibold">Connected Since</th>
                  <th className="py-2.5 pr-4" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <TeamRow key={m.id} member={m} online={online.has(m.id)} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}
