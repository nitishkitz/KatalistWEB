import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Thing } from "@/domain/thing";
import { useCourt } from "../use-court";
import { useCoeyContext } from "./use-coey-context";

type LooseRpc = (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as unknown as LooseRpc)(fn, args);

function reasonLabel(thing: Thing): string {
  const s = thing.coey!.schedule;
  if (s.state === "blocked") return `Waiting on ${s.blockedOn?.note || "someone else"}`;
  if (s.inboxReason === "wrong_person") return "Sent back: who should take this?";
  if (s.inboxReason === "unresolved_capture") return "Saved as typed";
  return "Who should take this?";
}

/**
 * The sender's Inbox (C10, C14) and parked Things (M10). Nobody is notified
 * about these until the sender picks a person; Coey never guesses.
 */
export function CoeyInbox({ className }: { className?: string }) {
  const { inbox, refetch } = useCourt();
  const ctx = useCoeyContext();
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!inbox?.length) return null;
  const connected = ctx.candidates.filter((c) => c.connected);

  const act = async (thingId: string, fn: string, args: Record<string, unknown>, done: string) => {
    setBusy(thingId);
    const { error } = await rpc(fn, args);
    setBusy(null);
    if (error) {
      toast.error(error.message.includes("connect") ? "Connect with that person first." : "That didn’t work. Try again.");
      return;
    }
    setOpen(null);
    toast.success(done);
    void qc.invalidateQueries({ queryKey: ["court"] });
    void refetch();
  };

  return (
    <section aria-label="Inbox" className={className}>
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2">
        <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-amber-900">
          <Inbox className="h-3.5 w-3.5" /> Inbox · {inbox.length}
        </p>
        <ul className="space-y-1">
          {inbox.map((thing) => {
            const s = thing.coey!.schedule;
            const blocked = s.state === "blocked";
            return (
              <li key={thing.id} className="rounded-lg bg-white px-2.5 py-1.5 text-[12.5px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{thing.title}</span>
                  <span className="text-[12px] text-slate-500">{reasonLabel(thing)}</span>
                  {blocked ? (
                    <button type="button" disabled={busy === thing.id} onClick={() => void act(thing.id, "coey_unblock", { p_thing_id: thing.id }, "Back in your Court")} className="rounded-full border border-slate-200 px-2.5 py-0.5 text-[12px] font-medium hover:bg-slate-50 disabled:opacity-50">Unblocked</button>
                  ) : (
                    <>
                      <button type="button" aria-expanded={open === thing.id} onClick={() => setOpen(open === thing.id ? null : thing.id)} className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[12px] font-medium text-violet-700 hover:bg-violet-100">Choose a person</button>
                      <button type="button" disabled={busy === thing.id} onClick={() => void act(thing.id, "coey_resolve_holder", { p_thing_id: thing.id, p_holder_profile_id: thing.coey!.viewerProfileId }, "Kept in your Court")} className="rounded-full border border-slate-200 px-2.5 py-0.5 text-[12px] font-medium hover:bg-slate-50 disabled:opacity-50">Keep it for me</button>
                    </>
                  )}
                </div>
                {open === thing.id ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={`Who should take ${thing.title}?`}>
                    {connected.length === 0 ? <span className="text-[12px] text-slate-500">No connections yet. Add people in Team.</span> : null}
                    {connected.map((c) => (
                      <button key={c.profileId} type="button" disabled={busy === thing.id} onClick={() => void act(thing.id, "coey_resolve_holder", { p_thing_id: thing.id, p_holder_profile_id: c.profileId }, `Sent to ${c.name.split(" ")[0]}`)} className="rounded-full border border-slate-200 px-2.5 py-0.5 text-[12px] font-medium hover:border-violet-300 hover:bg-violet-50 disabled:opacity-50">
                        {c.name}
                      </button>
                    ))}
                  </div>
                ) : null}
                {s.textRaw && s.textRaw !== thing.title ? <p className="mt-0.5 truncate text-[12px] text-slate-500">“{s.textRaw}”</p> : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
