import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bell, Clock, Hand, Sparkles } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { nudgeFixtures, nudgeGroups, recentNudgeFixtures, type NudgeGroup } from "@/features/nudges/fixtures";
import { cn } from "@/lib/utils";
import { rpcNudgeThing } from "@/features/things/rpc";
import { toast } from "sonner";
import { getMergedThings, useLocalVersion } from "@/features/things/local-state";
import { ThingDetailSheet } from "@/features/things/ThingDetailSheet";
import type { Thing } from "@/domain/thing";

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
  const [selected, setSelected] = useState<Thing | null>(null);
  const things = getMergedThings();

  const counts = useMemo(() => {
    const map = Object.fromEntries(nudgeGroups.map((g) => [g.id, 0])) as Record<NudgeGroup, number>;
    for (const n of nudgeFixtures) map[n.group] += 1;
    return map;
  }, []);

  const rows = nudgeFixtures.filter((n) => n.group === group);

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
                <td className="px-2 text-[13px] text-foreground">{row.person}</td>
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
                        const thing = things.find((t) => t.title === row.title);
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
                        const thing = things.find((t) => t.title === row.title) ?? null;
                        setSelected(thing);
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
          {recentNudgeFixtures.map((r) => (
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
      <ThingDetailSheet thing={selected} open={Boolean(selected)} onOpenChange={(v) => !v && setSelected(null)} />
    </AppShell>
  );
}
