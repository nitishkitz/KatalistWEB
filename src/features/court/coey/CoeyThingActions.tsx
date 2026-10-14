import { DateTimeField } from "@/components/ui/date-time-field";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Thing } from "@/domain/thing";
import { coeyLane } from "@/domain/thing";
import { zonedInstant } from "@/domain/coey/calendar";

type LooseRpc = (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as unknown as LooseRpc)(fn, args);

const RULE_TEXT: Record<string, string> = {
  PERSONAL: "you chose this placement in your Court",
  L1: "the sender marked it urgent", L2: "the sender said no rush", L3: "its date is within a working day",
  L4: "its date is a few working days away", L5: "its date is more than five working days away", L6: "no time is set yet",
  L7: "nothing set a date, so it waits in Next", L8: "nothing set a date, so it waits in Next", L9: "it is a thought, not a commitment yet",
  L10: "urgency and date disagree; Next until the sender chooses", M3: "it follows the promised date", M6: "it is snoozed",
  M10: "it is waiting on someone else", M15: "it is sorted",
};

/**
 * Holder and sender moves on one Thing (spec §8.4). The holder can promise,
 * flag a blocker, serve it back or say it is the wrong person; only the
 * sender changes the pace. The holder can never lower the sender's pace —
 * a promise calms it honestly.
 */
export function CoeyThingActions({ thing }: { thing: Thing }) {
  const qc = useQueryClient();
  const [panel, setPanel] = useState<"promise" | "blocker" | "question" | null>(null);
  const [text, setText] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const view = thing.coey;
  if (!view) return null;
  const s = view.schedule;
  const me = view.viewerProfileId;
  const isHolder = s.holderProfileId === me && s.senderProfileId !== me;
  const isSender = s.senderProfileId === me;
  const lane = coeyLane(thing);
  if (s.state === "sorted") return null;

  const run = async (fn: string, args: Record<string, unknown>, done: string) => {
    setBusy(true);
    const { error } = await rpc(fn, args);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setPanel(null);
    setText("");
    toast.success(done);
    void qc.invalidateQueries({ queryKey: ["court"] });
    void qc.invalidateQueries({ queryKey: ["thing", thing.id] });
  };
  const promiseAt = () => {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(when);
    return m ? new Date(zonedInstant(m[1]!, Number(m[2]) * 60 + Number(m[3]), view.holderCal.timezone)).toISOString() : null;
  };

  return (
    <section aria-label="Coey" className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px]">
      {lane ? (
        <p className="text-slate-600">
          <span className="font-semibold text-slate-800">Why is this here? </span>
          {lane.lane === "now" ? "Now" : lane.lane === "next" ? "Next" : lane.lane === "later" ? "Later" : "Out of the lanes"} because {RULE_TEXT[lane.rule] ?? "of how it was sent"}.
        </p>
      ) : null}
      {s.promiseAt ? <p className="mt-1 text-slate-600">Promised for {new Date(s.promiseAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: view.holderCal.timezone })}.</p> : null}
      {isHolder && s.nudgeCountCycle > 0 && s.lastNudgeAt ? (
        <p className="mt-1 text-violet-700">Coey: this one is in your court. A date or a quick comment lets {thing.owner.name.split(" ")[0]} know where it stands.</p>
      ) : null}
      {s.blockedOn ? <p className="mt-1 text-slate-600">Waiting on {s.blockedOn.note || (s.blockedOn.kind === "sender" ? "the sender" : "someone else")}.</p> : null}

      {isHolder ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" disabled={busy} onClick={() => setPanel(panel === "promise" ? null : "promise")} className="rounded-full border border-slate-200 px-2.5 py-1 font-medium hover:bg-slate-50">{s.promiseAt ? "Change my date" : "Promise a date"}</button>
          {s.state !== "blocked" ? <button type="button" disabled={busy} onClick={() => setPanel(panel === "blocker" ? null : "blocker")} className="rounded-full border border-slate-200 px-2.5 py-1 font-medium hover:bg-slate-50">Waiting on someone else</button> : (
            <button type="button" disabled={busy} onClick={() => void run("coey_unblock", { p_thing_id: thing.id }, "Back in your Court")} className="rounded-full border border-slate-200 px-2.5 py-1 font-medium hover:bg-slate-50">Unblocked</button>
          )}
          <button type="button" disabled={busy} onClick={() => setPanel(panel === "question" ? null : "question")} className="rounded-full border border-slate-200 px-2.5 py-1 font-medium hover:bg-slate-50">Ask a question back</button>
          <button type="button" disabled={busy} onClick={() => void run("coey_wrong_person", { p_thing_id: thing.id }, "Sent back so they can choose who takes it")} className="rounded-full border border-slate-200 px-2.5 py-1 font-medium hover:bg-slate-50">Wrong person</button>
        </div>
      ) : null}

      {isSender ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Pace you asked for">
          <span className="text-slate-500">Pace you asked for:</span>
          {(["urgent", "normal", "chill"] as const).map((pace) => (
            <button key={pace} type="button" disabled={busy || s.pace === pace} aria-pressed={s.pace === pace || (pace === "normal" && !s.pace)} onClick={() => void run("coey_set_pace", { p_thing_id: thing.id, p_pace: pace }, "Pace updated")} className="rounded-full border border-slate-200 px-2.5 py-1 font-medium hover:bg-slate-50 aria-pressed:border-violet-300 aria-pressed:bg-violet-50 aria-pressed:text-violet-700">
              {pace === "urgent" ? "Urgent" : pace === "normal" ? "Normal" : "No rush"}
            </button>
          ))}
        </div>
      ) : null}
      {isSender && s.state === "with_sender" ? (
        <button type="button" disabled={busy} onClick={() => void run("coey_unblock", { p_thing_id: thing.id }, "Back with them")} className="mt-2 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 font-medium text-violet-700">I’ve answered — send it back</button>
      ) : null}

      {panel === "promise" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-slate-600" htmlFor={`promise-${thing.id}`}>I’ll have it by</label>
          <DateTimeField required timezone={view.holderCal.timezone} id={`promise-${thing.id}`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="rounded-md border border-border px-2 py-1" />
          <button type="button" disabled={busy || !promiseAt()} onClick={() => void run("coey_promise", { p_thing_id: thing.id, p_promise_at: promiseAt() }, "Promise saved")} className="rounded-md bg-violet-600 px-3 py-1 font-semibold text-white disabled:opacity-50">Save</button>
        </div>
      ) : null}
      {panel === "blocker" || panel === "question" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input aria-label={panel === "blocker" ? "Who or what is it waiting on?" : "Your question"} placeholder={panel === "blocker" ? "e.g. the transporter" : "What do you need to know?"} value={text} onChange={(e) => setText(e.target.value)} maxLength={200} className="min-w-0 flex-1 rounded-md border border-border px-2 py-1" />
          <button type="button" disabled={busy || !text.trim()} onClick={() => void (panel === "blocker"
            ? run("coey_flag_blocker", { p_thing_id: thing.id, p_kind: "third_party", p_note: text.trim() }, "Parked until it’s unblocked. No nudges meanwhile.")
            : run("coey_serve_back", { p_thing_id: thing.id, p_question: text.trim() }, "Sent back with your question"))} className="rounded-md bg-violet-600 px-3 py-1 font-semibold text-white disabled:opacity-50">Send</button>
        </div>
      ) : null}
    </section>
  );
}
