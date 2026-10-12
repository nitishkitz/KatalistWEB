import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Thing } from "@/domain/thing";
import { getThingCapabilities } from "@/domain/capabilities";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { rpcNudgeThing } from "@/features/things/rpc";
import { claimThingMutation, releaseThingMutation } from "@/features/things/query-updates";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { domainErrorMessage } from "@/lib/domain-error";
import { AssistantThingRow, type RowNudgeState } from "./AssistantThingRow";
import type { useAssistantRowActions } from "./use-assistant-row-actions";

const COLLAPSED = 8;

type BulkResult = { id: string; ok: boolean; message?: string };

export function AssistantThingGroup({
  title,
  total,
  things,
  missingCount,
  notes,
  myActorId,
  nudgeFor,
  actions,
  onOpen,
}: {
  title: string;
  total: number;
  things: Thing[];
  /** Ids the server listed that the Court data no longer holds (changed or hidden since). */
  missingCount: number;
  notes?: Record<string, string>;
  myActorId: string | null;
  nudgeFor: (thingId: string) => RowNudgeState;
  actions: ReturnType<typeof useAssistantRowActions>;
  onOpen: (thingId: string) => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const shown = expanded ? things : things.slice(0, COLLAPSED);
  const eligible = things.filter((thing) => {
    const state = nudgeFor(thing.id);
    return (
      getThingCapabilities(thing, myActorId).canNudge &&
      state.allowed &&
      !state.lastNudgedAt &&
      !actions.pending[thing.id]
    );
  });

  // An explicit confirm step for multi-Thing actions. Each nudge still goes
  // through nudge_thing, which re-checks permission and cooldown server-side.
  const sendBulk = async () => {
    if (sending) return;
    const epoch = getIdentityEpoch(qc).epoch;
    setSending(true);
    const out: BulkResult[] = [];
    for (const thing of eligible) {
      const claim = claimThingMutation(qc, thing.id, epoch);
      if (!claim) {
        out.push({ id: thing.id, ok: false, message: "Already being updated." });
        continue;
      }
      try {
        await rpcNudgeThing(
          thing.id,
          thing.acknowledgement === "waiting_for_catch" ? "waiting_for_catch" : "stale",
        );
        out.push({ id: thing.id, ok: true });
      } catch (error) {
        out.push({ id: thing.id, ok: false, message: domainErrorMessage(error) });
      } finally {
        releaseThingMutation(qc, claim);
      }
    }
    if (!isEpochCurrent(qc, epoch)) return;
    await Promise.all(
      ["court", "nudges", "nudge-history", "assistant"].map((key) =>
        qc.refetchQueries({ queryKey: [key], type: "active" }),
      ),
    );
    if (!isEpochCurrent(qc, epoch)) return;
    void qc.invalidateQueries({ queryKey: ["notifications"] });
    setResults(out);
    setSending(false);
    setConfirming(false);
    const sent = out.filter((r) => r.ok).length;
    if (sent === out.length) toast.success(`${sent} nudge${sent === 1 ? "" : "s"} sent.`);
    else toast.warning(`${sent} of ${out.length} nudges sent. See the list for details.`);
  };

  return (
    <section className="mt-4 first:mt-2" aria-label={`${title}, ${total}`}>
      <div className="flex items-center justify-between gap-2 px-3 pb-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {title} · {total}
        </h3>
        {eligible.length >= 2 && !confirming && (
          <button
            type="button"
            onClick={() => {
              setResults(null);
              setConfirming(true);
            }}
            className="rounded-[7px] border border-[#eaeffa] bg-[#eff1fc] px-2.5 py-1 text-xs font-medium text-[#1d1d1d] hover:bg-[#e6eafb] focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            Nudge {eligible.length} eligible
          </button>
        )}
      </div>

      {confirming && (
        <div className="mx-3 mb-2 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
          <p className="text-xs font-semibold text-slate-900">
            Send {eligible.length} nudges? Each person gets one nudge per Thing.
          </p>
          <ul className="mt-2 space-y-1.5">
            {eligible.map((thing) => (
              <li key={thing.id} className="flex items-center gap-2 text-xs text-slate-700">
                <PersonAvatar name={thing.assignee.name} src={thing.assignee.avatarUrl} size={20} />
                <span className="truncate">{thing.title}</span>
                <span className="shrink-0 text-slate-500">
                  · {thing.assignee.name.split(" ")[0]}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={sending}
              onClick={() => void sendBulk()}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-[7px] bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700 focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60"
            >
              {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {sending ? "Sending…" : `Confirm ${eligible.length} nudges`}
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() => setConfirming(false)}
              className="rounded-[7px] px-3 text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {results && results.some((r) => !r.ok) && (
        <ul
          className="mx-3 mb-2 space-y-1 rounded-xl bg-amber-50 p-3 text-xs text-amber-900"
          role="status"
        >
          {results
            .filter((r) => !r.ok)
            .map((r) => (
              <li key={r.id}>
                {things.find((thing) => thing.id === r.id)?.title ?? "A Thing"}: {r.message}
              </li>
            ))}
        </ul>
      )}

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100">
        {shown.map((thing) => (
          <AssistantThingRow
            key={thing.id}
            thing={thing}
            myActorId={myActorId}
            note={notes?.[thing.id]}
            nudge={nudgeFor(thing.id)}
            pending={actions.pending[thing.id]}
            error={actions.errors[thing.id]}
            onRun={(kind, snooze) => void actions.run(thing, kind, snooze)}
            onOpen={onOpen}
          />
        ))}
      </ul>
      {(things.length > COLLAPSED || missingCount > 0) && (
        <div className="flex items-center justify-between px-3 pt-1.5 text-xs text-slate-500">
          <span>
            {missingCount > 0
              ? `${missingCount} not shown: changed or no longer visible. Refresh to update.`
              : `Showing ${shown.length} of ${things.length}`}
          </span>
          {things.length > COLLAPSED && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="rounded px-2 py-1 font-semibold text-violet-700 hover:bg-violet-50 focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              {expanded ? "Show fewer" : `Show all ${things.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
