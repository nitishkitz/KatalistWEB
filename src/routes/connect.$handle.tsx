import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/katalist/Logo";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useSession } from "@/hooks/useSession";
import { domainErrorMessage } from "@/lib/domain-error";
import {
  rpcFindPersonForConnect,
  rpcRespondContactRequest,
  rpcSendContactRequest,
  type ConnectCandidate,
} from "@/features/hub/rpc";

export const Route = createFileRoute("/connect/$handle")({
  head: () => ({ meta: [{ title: "Connect — Katalist" }] }),
  component: ConnectPage,
});

/** A shared Katalist link identifies someone. Opening it never connects anyone. */
function ConnectPage() {
  const { handle } = Route.useParams();
  const navigate = useNavigate();
  const { session, loading } = useSession();
  const [state, setState] = useState<{ status: "loading" | "ready" | "missing" | "error"; person: ConnectCandidate | null }>({ status: "loading", person: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      void navigate({ to: "/auth", search: { redirect: `/connect/${handle}` }, replace: true });
      return;
    }
    let cancelled = false;
    rpcFindPersonForConnect(handle)
      .then((person) => { if (!cancelled) setState({ status: person ? "ready" : "missing", person }); })
      .catch(() => { if (!cancelled) setState({ status: "error", person: null }); });
    return () => { cancelled = true; };
  }, [handle, loading, navigate, session]);

  const act = async () => {
    const person = state.person;
    if (!person) return;
    setBusy(true);
    try {
      if (person.state === "pending_in" && person.request_id) {
        await rpcRespondContactRequest(person.request_id, true);
        setState({ status: "ready", person: { ...person, state: "connected" } });
        toast.success(`You and ${person.display_name.split(" ")[0]} are connected`);
      } else {
        await rpcSendContactRequest(person.profile_id);
        setState({ status: "ready", person: { ...person, state: "pending_out" } });
        toast.success(`Request sent to ${person.display_name.split(" ")[0]}`);
      }
    } catch (err) {
      toast.error(domainErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const person = state.person;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-[#fbfaff] px-6">
      <Logo />
      <section className="w-full max-w-sm rounded-[16px] border border-[#ebecf7] bg-white p-6 text-center shadow-sm" aria-live="polite">
        {state.status === "loading" ? <p className="text-[13px] text-[#6a769c]">Looking up this link…</p> : null}
        {state.status === "missing" ? <p className="text-[13px] text-[#6a769c]">This link isn’t active. Ask the person for a new one.</p> : null}
        {state.status === "error" ? <p role="alert" className="text-[13px] text-red-700">Couldn’t open this link. Check your connection and try again.</p> : null}
        {person ? (
          <div className="flex flex-col items-center gap-3">
            <PersonAvatar name={person.display_name} initials={person.display_name.slice(0, 2).toUpperCase()} src={person.avatar_url} size={64} />
            <p className="text-[16px] font-semibold text-[#000533]">{person.display_name}</p>
            {person.state === "self" ? <p className="text-[13px] text-[#6a769c]">This is your own link.</p> : null}
            {person.state === "connected" ? <p className="text-[13px] text-[#6a769c]">You’re connected.</p> : null}
            {person.state === "pending_out" ? <p className="text-[13px] text-[#6a769c]">Request sent. They’ll see it in Team.</p> : null}
            {person.state === "none" || person.state === "pending_in" ? (
              <button type="button" disabled={busy} onClick={() => void act()} className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#975ee2] px-4 text-[13px] font-semibold text-white disabled:opacity-50">
                {person.state === "pending_in" ? <><Check className="h-4 w-4" /> Accept their request</> : <><UserPlus className="h-4 w-4" /> Send a connection request</>}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
      <Link to="/" className="text-[12px] text-[#6a769c] underline">Go to Katalist</Link>
    </main>
  );
}
