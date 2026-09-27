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
import { AsyncState } from "@/components/katalist/AsyncState";
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
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import type { Thing } from "@/domain/thing";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

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
  // G05: "All lists" -- null means no filter (the "All lists" state itself).
  const [listFilter, setListFilter] = useState<string | null>(null);
  const [howNudgesWorkOpen, setHowNudgesWorkOpen] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const {
    rows: allRows,
    recent,
    counts,
    isLoading,
    rowsHasFetchedOnce,
    eligibilityLoading,
    eligibilityError,
    error: nudgesError,
    retry: retryNudges,
    retryEligibility,
  } = useNudges();
  const court = useCourt();
  const live = useThing(selectedId);
  const selected = live.thing;

  const thingById = useMemo(() => new Map(court.all.map((t) => [t.id, t])), [court.all]);

  // G05: the Lists available to filter by -- derived from the actually-
  // loaded, already-authorization-filtered rows (never a separate,
  // unscoped Lists fetch), so this can't surface a List the viewer
  // couldn't otherwise see here.
  const availableLists = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of allRows) {
      if (row.listId && row.listName) map.set(row.listId, row.listName);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allRows]);
  const listFilterLabel = listFilter ? availableLists.find(([id]) => id === listFilter)?.[1] ?? "All lists" : "All lists";

  const q = search.trim().toLowerCase();
  const activeRows = allRows.filter(
    (n) =>
      n.group === active &&
      (!q || n.title.toLowerCase().includes(q) || n.person.toLowerCase().includes(q)) &&
      (!listFilter || n.listId === listFilter),
  );

  const handleNudge = (id: string, dbReason?: NudgeReason) => {
    if (nudgingId) return;
    setNudgingId(id);
    const epoch = getIdentityEpoch(qc).epoch;
    void rpcNudgeThing(id, dbReason).then(
      () => {
        setNudgingId(null);
        if (!isEpochCurrent(qc, epoch)) return;
        toast.success("Just a gentle paw tap on this one.");
        void qc.invalidateQueries({ queryKey: ["nudges"] });
        void qc.invalidateQueries({ queryKey: ["nudge-history"] });
        void qc.invalidateQueries({ queryKey: ["thing"] });
        void qc.invalidateQueries({ queryKey: ["thing-activity"] });
        void qc.invalidateQueries({ queryKey: ["notifications"] });
      },
      (err: unknown) => {
        setNudgingId(null);
        if (isEpochCurrent(qc, epoch)) toast.error(domainErrorMessage(err));
      },
    );
  };

  return (
    <AppShell>
      <AsyncState
        isLoading={isLoading}
        data={allRows}
        error={nudgesError}
        onRetry={retryNudges}
        isEmpty={allRows.length === 0}
        hasFetchedOnce={rowsHasFetchedOnce}
        emptyTitle="You're all caught up"
        emptyDescription="No nudges need your attention right now."
        loadingContent={<NudgesSkeleton />}
      >
        {() => (
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
              <label className="flex h-9 items-center gap-2 rounded-[10px] border border-[#ebecf7] bg-white px-3 focus-within:border-[#975ee2] focus-within:ring-2 focus-within:ring-ring">
                <Search className="h-4 w-4 text-[#8487a7]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search Things or people"
                  className="w-52 bg-transparent text-[12px] outline-none placeholder:text-[#8487a7]"
                />
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-2 rounded-[7px] border border-[#eaeffa] bg-white px-3 text-[13px] text-[#1d1d1d]"
                  >
                    <ListFilter className="h-4 w-4 text-[#6a769c]" />
                    {listFilterLabel}
                    <ChevronDown className="h-3.5 w-3.5 text-[#6a769c]" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setListFilter(null)}>All lists</DropdownMenuItem>
                  {availableLists.map(([id, name]) => (
                    <DropdownMenuItem key={id} onSelect={() => setListFilter(id)}>
                      {name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                type="button"
                onClick={() => setHowNudgesWorkOpen(true)}
                className="inline-flex h-9 items-center gap-2 rounded-[7px] border border-[#eaeffa] bg-white px-3 text-[13px] text-[#1d1d1d]"
              >
                <Settings2 className="h-4 w-4 text-[#6a769c]" />
                How nudges work
              </button>
            </div>
          </div>

          {eligibilityError ? (
            // Rows loaded fine (from Court) — only the eligibility check
            // (which rows can actually be nudged) and/or cooldown history
            // failed. A failed check is not evidence a row is ineligible,
            // so this stays a dismissible warning alongside the still-real
            // rows rather than replacing them or silently rendering every
            // row as "not eligible" (see the eligibilityError handling in
            // the action column below).
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-900">
              <span>
                Couldn't check nudge eligibility or recent nudge activity — some actions and cooldown
                status below may be out of date. {domainErrorMessage(eligibilityError)}
              </span>
              <button
                type="button"
                onClick={() => retryEligibility()}
                className="inline-flex h-7 items-center rounded-[6px] border border-amber-300 bg-white px-2.5 text-[12px] font-medium text-amber-900 hover:bg-amber-100"
              >
                Retry
              </button>
            </div>
          ) : null}

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
                        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[12px] font-semibold",
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
                          <tr className="bg-[#f4f6fd] text-[12px] font-medium text-[#000533]">
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
                                      <span className="block text-[12px] text-[#6a769c]">#{row.id.slice(0, 6)}</span>
                                    </span>
                                  </button>
                                </td>
                                <td className="px-2">
                                  {thing?.listName ? (
                                    <span className="inline-flex items-center gap-1.5 text-[12px] text-[#6a769c]">
                                      <span className="flex h-6 w-6 items-center justify-center rounded-[5px] bg-[#ede9ff] text-[12px] font-medium text-[#975ee2]">
                                        {thing.listName.slice(0, 2).toUpperCase()}
                                      </span>
                                      {thing.listName}
                                    </span>
                                  ) : (
                                    <span className="text-[12px] text-[#9aa3bd]">—</span>
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
                                <td className="px-2 text-[12px] text-[#3d3f74]">{reasonText}</td>
                                <td className="px-2">
                                  <span className={cn("inline-flex items-center rounded-[5px] px-2 py-1 text-[12px]", pill.cls)}>
                                    {pill.label}
                                  </span>
                                </td>
                                <td className="px-2">
                                  {eligibilityLoading ? (
                                    // Eligibility (which rows can actually be nudged) hasn't
                                    // resolved yet — the row itself is real, so don't render a
                                    // confident "Open" (which implies "not eligible") before we
                                    // know either way. role="status" so assistive tech actually
                                    // announces this transient state, matching the accessible
                                    // explanation the other two branches below already give.
                                    <span
                                      role="status"
                                      aria-live="polite"
                                      className="inline-flex items-center rounded-[5px] border border-border px-3 py-1.5 text-[13px] text-muted-foreground opacity-60"
                                    >
                                      Checking…
                                    </span>
                                  ) : eligibilityError ? (
                                    // A failed eligibility check is not evidence this row is
                                    // ineligible — don't render a plain "Open" that looks like a
                                    // confirmed determination. Detail always stays reachable.
                                    <button
                                      type="button"
                                      onClick={() => setSelectedId(row.id)}
                                      title="Couldn't confirm whether this can be nudged"
                                      className="inline-flex items-center gap-1.5 rounded-[5px] border border-amber-200 bg-amber-50 px-3 py-1.5 text-[13px] text-amber-900 hover:bg-amber-100"
                                    >
                                      Open (unconfirmed)
                                    </button>
                                  ) : row.canNudge ? (
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
                                    // G12: confirmed ineligible (eligibility resolved, no
                                    // error, row.canNudge is false) previously gave no reason
                                    // at all here, unlike the "unconfirmed" branch above --
                                    // give the specific, known reason for cooldown, and an
                                    // honest generic one otherwise (we don't have a
                                    // server-returned reason for every other ineligibility
                                    // cause, and won't fabricate a more specific one).
                                    <button
                                      type="button"
                                      onClick={() => setSelectedId(row.id)}
                                      title={
                                        row.group === "recently_nudged"
                                          ? "In cooldown after a recent nudge — try again later"
                                          : "Not eligible for a nudge right now"
                                      }
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
                  {/* G12: "See all"/"Show less" toggles the already-loaded
                      list. This is genuinely the full list, not a truncated
                      page of it -- `recent` is defined as "still within the
                      cooldown window" and the underlying fetch itself is now
                      bounded by that same time window (see use-nudges.ts's
                      history query), not by an arbitrary row count, so
                      there is nothing further to paginate into. Only shown
                      when there's actually more than the 5-item preview. */}
                  {recent.length > 5 && (
                    <button
                      type="button"
                      onClick={() => setShowAllRecent((v) => !v)}
                      className="text-[12px] text-[#975ee2] hover:underline"
                    >
                      {showAllRecent ? "Show less" : "See all"}
                    </button>
                  )}
                </div>
                {recent.length === 0 ? (
                  <p className="py-4 text-[12px] text-[#6a769c]">No recent nudge activity.</p>
                ) : (
                  <ul className="space-y-4">
                    {(showAllRecent ? recent : recent.slice(0, 5)).map((r) => {
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
                            <p className="truncate text-[12px] text-[#6a769c]">{r.title}</p>
                          </div>
                          <span className="shrink-0 text-[12px] text-[#6a769c]">{r.when}</span>
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
        )}
      </AsyncState>

      {/* G05: replaces the old inert "Nudge settings" button -- there is
          no per-user editable nudge configuration to open here; this
          explains the actual, fixed server-side rules instead. */}
      <Dialog open={howNudgesWorkOpen} onOpenChange={setHowNudgesWorkOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>How nudges work</DialogTitle>
            <DialogDescription>
              Coey's nudging rules are fixed server-side, not a per-user setting.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2.5 text-[13px] text-[#3d3f74]">
            <li>• Pressing "Nudge" yourself is capped at once per Thing every 2 hours.</li>
            <li>• At most one automatic nudge per Thing every 24 hours — a separate, longer limit from the manual one above.</li>
            <li>
              • Quiet hours (9 PM–8 AM, if enabled on your profile): Coey's automatic nudges pause
              during this window. Pressing "Nudge" yourself is a deliberate action and is never
              blocked by quiet hours.
            </li>
            <li>• A Morning Brief digest is sent at most once per morning.</li>
            <li>• A weekly "spring clean" digest is capped at once per week.</li>
            <li>• Reactivation nudges for a fully stale Thing stop after two attempts (3-day, then 7-day).</li>
          </ul>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
