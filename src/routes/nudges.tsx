import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bell, Clock, Hand, Sparkles } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { nudgeGroups, type NudgeGroup } from "@/features/nudges/fixtures";
import { useNudges } from "@/features/nudges/use-nudges";
import { cn } from "@/lib/utils";
import { rpcNudgeThing } from "@/features/things/rpc";
import { toast } from "sonner";
import { getMergedThings, useLocalVersion } from "@/features/things/local-state";
import { ThingDetailSheet } from "@/features/things/ThingDetailSheet";
import type { Thing, Person } from "@/domain/thing";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useAvatarUrl } from "@/features/people/directory";

function NudgePerson({ name, thingAssignee }: { name: string; thingAssignee?: Person }) {
  const src = useAvatarUrl(name, null, thingAssignee?.avatarUrl);
  return (
    <span className="inline-flex items-center gap-1.5">
      <PersonAvatar name={name} initials={thingAssignee?.initials ?? name.slice(0, 2)} src={src} size={20} />
      {name}
    </span>
  );
}

export const Route = createFileRoute("/nudges")({
  head: () => ({
    meta: [
      { title: "Nudges — Katalist" },
      { name: "description", content: "Gentle follow-up, without the awkwardness." },
    ],
  }),
  component: NudgesPage,
});

function NudgesPage() {
  useLocalVersion();
  const [group, setGroup] = useState<NudgeGroup>("waiting_for_catch");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const things = getMergedThings();
  const { rows: allRows, recent, counts } = useNudges();
  const selected = things.find((t) => t.id === selectedId) ?? null;
  const rows = allRows.filter((n) => n.group === group);

  return (
    <AppShell title="Nudges" subtitle="Gentle follow-up, without the awkwardness">
      <p className="mb-4 flex items-center gap-2 text-[13px] text-muted-foreground">
        <img src="/katalist-mark-app.png" alt="" className="h-4 w-4 opacity-70" />
        Coey here—see what might need a nudge.
      </p>

      <div className="mb-5 flex flex-wrap gap-2">
        {nudgeGroups.map((g) => {
          const active = group === g.id;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => setGroup(g.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                active
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {g.id === "waiting_for_catch" ? (
                <Clock className="h-3.5 w-3.5" />
              ) : g.id === "needs_a_tap" ? (
                <Hand className="h-3.5 w-3.5" />
              ) : g.id === "recently_nudged" ? (
                <Bell className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {g.label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px]",
                  active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {counts[g.id]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-6 overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full table-fixed">
          <thead>
            <tr className="text-left text-[11px] font-medium text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Thing</th>
              <th className="px-2 py-2.5 font-medium">Person</th>
              <th className="px-2 py-2.5 font-medium">Nudge Reason</th>
              <th className="px-2 py-2.5 font-medium">Acknowledged</th>
              <th className="px-2 py-2.5 font-medium">Work Status</th>
              <th className="px-2 py-2.5 font-medium">Due</th>
              <th className="px-2 py-2.5 font-medium">Last Movement</th>
              <th className="px-2 py-2.5 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border/80 hover:bg-muted/40">
                <td className="px-4 py-3 text-[13px] font-medium text-foreground">{row.title}</td>
                <td className="px-2 text-[13px] text-foreground">
                  <NudgePerson name={row.person} thingAssignee={things.find((t) => t.id === row.id)?.assignee} />
                </td>
                <td className="px-2 text-[12px] text-muted-foreground">{row.reason}</td>
                <td className="px-2 text-[12px] text-foreground">{row.acknowledged}</td>
                <td className="px-2 text-[12px] text-foreground">{row.workStatus}</td>
                <td className="px-2 text-[12px] text-muted-foreground">{row.due}</td>
                <td className="px-2 text-[12px] text-muted-foreground">{row.lastMovement}</td>
                <td className="px-2">
                  {row.canNudge ? (
                    <button
                      type="button"
                      className="rounded-lg bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
                      onClick={() => {
                        const thing = things.find((t) => t.id === row.id);
                        void rpcNudgeThing(thing?.id ?? row.id).then(
                          () => toast.success("Just a gentle paw tap on this one."),
                          (err) => toast.error(err instanceof Error ? err.message : "Couldn’t nudge"),
                        );
                      }}
                    >
                      Nudge
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rounded-lg border border-border px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-muted"
                      onClick={() => {
                        const thing = things.find((t) => t.id === row.id) ?? null;
                        if (thing) setSelectedId(thing.id);
                        else setSelectedId(row.id);
                      }}
                    >
                      Open
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                  Nothing needs a paw tap in this group.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <section>
        <h2 className="mb-3 katalist-section-title">Recently Nudged</h2>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {recent.map((r) => (
            <article
              key={r.id}
              className="min-w-[220px] rounded-xl border border-border bg-card p-3"
            >
              <p className="text-[11px] text-muted-foreground">{r.when}</p>
              <p className="mt-1 text-[13px] font-medium text-foreground">{r.title}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {r.person} · {r.state}
              </p>
            </article>
          ))}
        </div>
      </section>
      <ThingDetailSheet thing={selected} open={Boolean(selected)} onOpenChange={(v) => !v && setSelectedId(null)} />
    </AppShell>
  );
}
