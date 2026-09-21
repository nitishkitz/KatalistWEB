import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Bell,
  Clock,
  Hand,
  TrendingUp,
  AlertTriangle,
  ChevronDown,
  Search,
  Settings2,
  ListFilter,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { NudgesSkeleton } from "@/components/katalist/ScreenSkeletons";
import { type NudgeGroup } from "@/features/nudges/fixtures";
import { useNudges } from "@/features/nudges/use-nudges";
import { useCourt } from "@/features/court/use-court";
import { cn } from "@/lib/utils";
import { rpcNudgeThing, type NudgeReason } from "@/features/things/rpc";
import { toast } from "sonner";
import { useLocalVersion } from "@/features/things/use-local-version";
import { InlineThingDetailWorkspace } from "@/features/things/InlineThingDetailWorkspace";
import { useThing } from "@/features/things/use-thing";
import { useQueryClient } from "@tanstack/react-query";
import { domainErrorMessage } from "@/lib/domain-error";
import type { Thing } from "@/domain/thing";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";

export const Route = createFileRoute("/nudges")({
  head: () => ({
    meta: [
      { title: "Nudges — Katalist" },
      { name: "description", content: "Gentle follow-up, without the awkwardness." },
    ],
  }),
  component: NudgesPage,
});

const CARD_SHADOW = "0 3px 9.4px 0 rgba(0,0,0,0.05)";

type GroupMeta = {
  id: NudgeGroup;
  label: string;
  sub: string;
  blurb: string;
  tile: string;
  Icon: typeof Hand;
};

const GROUPS: GroupMeta[] = [
  { id: "needs_a_tap", label: "Needs a Tap", sub: "Haven't moved recently", blurb: "These Things haven't moved recently. A quick nudge can help.", tile: "bg-[#e7f0fe] text-[#2874f4]", Icon: Hand },
  { id: "waiting_for_catch", label: "Waiting for Catch", sub: "Awaiting a response", blurb: "You've nudged, now waiting for a response.", tile: "bg-[#ede9ff] text-[#5c2af7]", Icon: Clock },
  { id: "recently_nudged", label: "Recently Nudged", sub: "In cooldown", blurb: "These Things are in cooldown.", tile: "bg-[#e4fcf0] text-[#12a15f]", Icon: Bell },
  { id: "caught_moving", label: "Caught & Moving", sub: "Progress after nudge", blurb: "Great! Progress after a nudge.", tile: "bg-[#ffebf8] text-[#d63aa0]", Icon: TrendingUp },
  { id: "stale", label: "Stale / Review", sub: "May need attention", blurb: "These may need a closer look.", tile: "bg-[#ffe0e1] text-[#e81a22]", Icon: AlertTriangle },
];

function timeSince(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  const h = Math.floor(s / 3600);
  if (h < 1) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function statusPill(groupId: NudgeGroup, thing?: Thing): { label: string; cls: string } {
  if (thing?.dueAt) {
    const ms = new Date(thing.dueAt).getTime() - Date.now();
    if (ms > 0 && ms < 24 * 3600 * 1000) return { label: "Due Soon", cls: "bg-[#fef6e1] text-[#d99f10]" };
  }
  switch (groupId) {
    case "needs_a_tap":
      return { label: "Needs a Tap", cls: "bg-[rgba(232,26,34,0.1)] text-[#e81a22]" };
    case "waiting_for_catch":
      return { label: "Waiting", cls: "bg-[rgba(66,33,252,0.1)] text-[#5c2af7]" };
    case "recently_nudged":
      return { label: "Nudged", cls: "bg-[#e4fcf0] text-[#12a15f]" };
    case "caught_moving":
      return { label: "Moving", cls: "bg-[#ffebf8] text-[#d63aa0]" };
    case "stale":
      return { label: "Stale", cls: "bg-[rgba(232,26,34,0.1)] text-[#e81a22]" };
  }
}

function NudgesPage() {
  useLocalVersion();
  const qc = useQueryClient();
  const [active, setActive] = useState<NudgeGroup>("needs_a_tap");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [nudgingId, setNudgingId] = useState<string | null>(null);
  const { rows: allRows, recent, counts, isLoading } = useNudges();
  const court = useCourt();
  const live = useThing(selectedId);
  const selected = live.thing;

  const thingById = useMemo(() => new Map(court.all.map((t) => [t.id, t])), [court.all]);

  const q = search.trim().toLowerCase();
  const activeRows = allRows.filter(
    (n) => n.group === active && (!q || n.title.toLowerCase().includes(q) || n.person.toLowerCase().includes(q)),
  );

  const handleNudge = (id: string, dbReason?: NudgeReason) => {
    if (nudgingId) return;
    setNudgingId(id);
    void rpcNudgeThing(id, dbReason).then(
      () => {
        toast.success("Just a gentle paw tap on this one.");
        setNudgingId(null);
        void qc.invalidateQueries({ queryKey: ["nudges"] });
        void qc.invalidateQueries({ queryKey: ["nudge-history"] });
        void qc.invalidateQueries({ queryKey: ["thing"] });
        void qc.invalidateQueries({ queryKey: ["thing-activity"] });
        void qc.invalidateQueries({ queryKey: ["notifications"] });
      },
      (err: unknown) => {
        setNudgingId(null);
        toast.error(domainErrorMessage(err));
      },
    );
  };

  if (isLoading) {
    return (
      <AppShell>
        <NudgesSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <InlineThingDetailWorkspace thing={selected} onClose={() => setSelectedId(null)} flatPanel>
        <div className="space-y-5">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-[20px] font-semibold text-black">Nudges</h1>
              <p className="mt-0.5 text-[12px] font-medium text-[#6a769c]">
                Gentle follow-ups to keep Things moving.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-9 items-center gap-2 rounded-[10px] border border-[#ebecf7] bg-white px-3">
                <Search className="h-4 w-4 text-[#8487a7]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search people, teams, or skills"
                  className="w-52 bg-transparent text-[12px] outline-none placeholder:text-[#8487a7]"
                />
              </label>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-[7px] border border-[#eaeffa] bg-white px-3 text-[13px] text-[#1d1d1d]"
              >
                <ListFilter className="h-4 w-4 text-[#6a769c]" />
                All lists
                <ChevronDown className="h-3.5 w-3.5 text-[#6a769c]" />
              </button>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-[7px] border border-[#eaeffa] bg-white px-3 text-[13px] text-[#1d1d1d]"
              >
                <Settings2 className="h-4 w-4 text-[#6a769c]" />
                Nudge settings
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="grid gap-5 xl:grid-cols-[1fr_372px]">
            {/* Main */}
            <div className="rounded-[6px] bg-white p-5" style={{ boxShadow: CARD_SHADOW }}>
              {/* Group tabs (switch like Court / Lists / Buckets) */}
              <div className="mb-4 flex items-center gap-6 overflow-x-auto border-b border-[#eef0f6] no-scrollbar">
                {GROUPS.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setActive(g.id)}
                    className={cn(
                      "relative -mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 pb-3 text-[13px] font-medium transition-colors",
                      active === g.id
                        ? "border-[#975ee2] text-[#000533]"
                        : "border-transparent text-[#6a769c] hover:text-[#000533]",
                    )}
                  >
                    {g.label}
                    <span
                      className={cn(
                        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10.5px] font-semibold",
                        active === g.id ? "bg-[#ece5fb] text-[#6638ec]" : "bg-[#eef0f6] text-[#6a769c]",
                      )}
                    >
                      {counts[g.id]}
                    </span>
                  </button>
                ))}
              </div>
              {(() => {
                return (
                  <>
                    {/* Table */}
                    <div className="overflow-x-auto rounded-[5px] border border-black/[0.04]">
                      <table className="w-full min-w-[760px] text-left">
                        <thead>
                          <tr className="bg-[#f4f6fd] text-[11.5px] font-medium text-[#000533]">
                            <th className="px-4 py-2.5 font-medium">Thing</th>
                            <th className="px-2 py-2.5 font-medium">List</th>
                            <th className="px-2 py-2.5 font-medium">Involves</th>
                            <th className="px-2 py-2.5 font-medium">Reason</th>
                            <th className="px-2 py-2.5 font-medium">Status</th>
                            <th className="px-2 py-2.5 font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#eef0f6]">
                          {activeRows.map((row) => {
                            const thing = thingById.get(row.id);
                            const pill = statusPill(row.group, thing);
                            const reasonText =
                              (row.group === "needs_a_tap" || row.group === "stale") && thing?.updatedAt
                                ? `No movement for ${timeSince(thing.updatedAt)}`
                                : row.reason;
                            return (
                              <tr key={row.id} className="hover:bg-muted/30">
                                <td className="px-4 py-3">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedId(row.id)}
                                    className="flex items-center gap-3 text-left"
                                  >
                                    <PersonAvatar
                                      name={row.person}
                                      initials={thing?.assignee.initials ?? row.person.slice(0, 2)}
                                      src={thing?.assignee.avatarUrl}
                                      size={38}
                                    />
                                    <span className="min-w-0">
                                      <span className="block text-[12px] font-medium text-[#000533]">{row.title}</span>
                                      <span className="block text-[10px] text-[#6a769c]">#{row.id.slice(0, 6)}</span>
                                    </span>
                                  </button>
                                </td>
                                <td className="px-2">
                                  {thing?.listName ? (
                                    <span className="inline-flex items-center gap-1.5 text-[10px] text-[#6a769c]">
                                      <span className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-[#ede9ff] text-[10px] font-medium text-[#975ee2]">
                                        {thing.listName.slice(0, 2).toUpperCase()}
                                      </span>
                                      {thing.listName}
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-[#9aa3bd]">—</span>
                                  )}
                                </td>
                                <td className="px-2">
                                  <PersonAvatar
                                    name={row.person}
                                    initials={thing?.assignee.initials ?? row.person.slice(0, 2)}
                                    src={thing?.assignee.avatarUrl}
                                    size={30}
                                  />
                                </td>
                                <td className="px-2 text-[10.5px] text-[#3d3f74]">{reasonText}</td>
                                <td className="px-2">
                                  <span className={cn("inline-flex items-center rounded-[5px] px-2 py-1 text-[10.5px]", pill.cls)}>
                                    {pill.label}
                                  </span>
                                </td>
                                <td className="px-2">
                                  {row.canNudge ? (
                                    <button
                                      type="button"
                                      disabled={nudgingId === row.id}
                                      onClick={() => handleNudge(row.id, row.dbReason)}
                                      className="inline-flex items-center gap-1.5 rounded-[5px] border border-[rgba(151,94,226,0.1)] px-3 py-1.5 text-[13px] text-[#975ee2] transition-colors hover:bg-[#f6f3fe] disabled:opacity-60"
                                    >
                                      <Bell className="h-3.5 w-3.5" />
                                      {nudgingId === row.id ? "Nudging…" : "Nudge"}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setSelectedId(row.id)}
                                      className="inline-flex items-center rounded-[5px] border border-border px-3 py-1.5 text-[13px] text-foreground hover:bg-muted"
                                    >
                                      Open
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {activeRows.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-4 py-10 text-center text-[13px] text-[#6a769c]">
                                Nothing needs a paw tap in this group.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>

                  </>
                );
              })()}
            </div>

            {/* Right sidebar */}
            <div className="space-y-5">
              {/* Recent nudge activity */}
              <section className="rounded-[6px] bg-white p-5" style={{ boxShadow: CARD_SHADOW }}>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-[16px] font-semibold text-black">Recent nudge activity</h2>
                  <span className="text-[12px] text-[#975ee2]">See all</span>
                </div>
                {recent.length === 0 ? (
                  <p className="py-4 text-[12px] text-[#6a769c]">No recent nudge activity.</p>
                ) : (
                  <ul className="space-y-4">
                    {recent.slice(0, 5).map((r) => {
                      const thing = thingById.get(r.id);
                      return (
                        <li key={r.id} className="flex items-start gap-3">
                          <PersonAvatar
                            name={r.person}
                            initials={thing?.assignee.initials ?? r.person.slice(0, 2)}
                            src={thing?.assignee.avatarUrl}
                            size={40}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] leading-snug text-[#000533]">
                              <span className="font-semibold">{r.person}</span> · {r.state}
                            </p>
                            <p className="truncate text-[10px] text-[#6a769c]">{r.title}</p>
                          </div>
                          <span className="shrink-0 text-[10px] text-[#6a769c]">{r.when}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

            </div>
          </div>
        </div>
      </InlineThingDetailWorkspace>
    </AppShell>
  );
}
