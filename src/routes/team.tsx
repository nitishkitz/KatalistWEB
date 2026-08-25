import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ContactRound, Link2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useTeamDirectory } from "@/features/team/use-team-directory";
import { supabase } from "@/integrations/supabase/client";
import { domainErrorMessage } from "@/lib/domain-error";

export const Route = createFileRoute("/team")({ component: TeamPage });

async function postPhone(phone: string) {
  const { data } = await supabase.auth.getSession();
  const response = await fetch("/api/team/requests", { method: "POST", headers: { authorization: `Bearer ${data.session?.access_token ?? ""}`, "content-type": "application/json" }, body: JSON.stringify({ phone }) });
  const result = await response.json() as { status?: string; shareUrl?: string; message?: string };
  if (!response.ok) throw new Error(result.message ?? "Request could not be sent.");
  return result;
}

function TeamPage() {
  const qc = useQueryClient();
  const team = useTeamDirectory();
  const [phone, setPhone] = useState("");
  const requests = useQuery({ queryKey: ["team-requests"], queryFn: async () => { const { data, error } = await supabase.rpc("list_team_requests"); if (error) throw error; return data ?? []; } });
  const invitations = useQuery({ queryKey: ["team-invitations"], queryFn: async () => { const { data, error } = await supabase.rpc("list_team_invitations"); if (error) throw error; return data ?? []; } });
  const add = useMutation({ mutationFn: postPhone, onSuccess: async (result) => { await Promise.all([qc.invalidateQueries({ queryKey: ["team-requests"] }), qc.invalidateQueries({ queryKey: ["team-invitations"] })]); if (result.shareUrl) { await navigator.clipboard?.writeText(result.shareUrl).catch(() => undefined); toast.success("Invite link copied. Share it through WhatsApp or SMS."); } else toast.success("Team request sent."); setPhone(""); }, onError: (error) => toast.error(domainErrorMessage(error)) });
  const accept = useMutation({ mutationFn: async (id: string) => { const { error } = await supabase.rpc("accept_team_request", { p_request_id: id }); if (error) throw error; }, onSuccess: async () => { await Promise.all([qc.invalidateQueries({ queryKey: ["team-directory"] }), qc.invalidateQueries({ queryKey: ["team-requests"] })]); toast.success("Added to each other’s Team."); } });
  const remove = useMutation({ mutationFn: async (id: string) => { const { error } = await supabase.rpc("remove_team_connection", { p_profile_id: id }); if (error) throw error; }, onSuccess: () => qc.invalidateQueries({ queryKey: ["team-directory"] }) });
  const syncSelected = async () => {
    const picker = (navigator as Navigator & { contacts?: { select: (properties: string[], options: { multiple: boolean }) => Promise<Array<{ tel?: string[] }>> } }).contacts;
    if (!picker) return toast.error("Selected-contact sync is not supported in this browser. Add the number manually.");
    const selected = await picker.select(["tel"], { multiple: true });
    for (const contact of selected) for (const number of contact.tel ?? []) await add.mutateAsync(number);
  };
  return <AppShell title="Team" subtitle="Mutual connections you can assign and invite">
    <section className="mb-5 rounded-xl border border-border bg-card p-4"><h2 className="text-[14px] font-semibold">Add to Team</h2><p className="mt-1 text-[11px] text-muted-foreground">India-first: enter a validated 10-digit mobile number. They must accept before becoming connected.</p><div className="mt-3 flex flex-wrap gap-2"><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="10-digit mobile number" className="h-9 min-w-60 flex-1 rounded-lg border border-border px-3 text-[13px]" /><button type="button" disabled={add.isPending} onClick={() => add.mutate(phone)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12px] text-primary-foreground"><UserPlus className="h-4 w-4" />Request</button><button type="button" onClick={() => void syncSelected()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[12px]"><ContactRound className="h-4 w-4" />Sync selected contacts</button></div></section>
    {(requests.data ?? []).length ? <section className="mb-5"><h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide">Requests</h2><div className="space-y-2">{requests.data!.map((request) => <div key={request.request_id} className="flex items-center gap-2 rounded-xl border border-border bg-card p-3"><PersonAvatar name={request.display_name} initials={request.display_name.slice(0,2).toUpperCase()} src={request.avatar_url} size={32} /><span className="flex-1 text-[13px]">{request.display_name}<span className="block text-[10px] capitalize text-muted-foreground">{request.direction}</span></span>{request.direction === "received" ? <button type="button" onClick={() => accept.mutate(request.request_id)} className="rounded-lg bg-primary px-3 py-1.5 text-[11px] text-primary-foreground">Accept</button> : <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Link2 className="h-3 w-3" />Pending</span>}</div>)}</div></section> : null}
    {(invitations.data ?? []).length ? <section className="mb-5"><h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide">Invited</h2><div className="space-y-2">{invitations.data!.map((invite) => <div key={invite.invitation_id} className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-[12px]"><UserPlus className="h-4 w-4 text-muted-foreground" /><span className="flex-1">+91 •••••• {invite.phone_last4}</span><span className="text-[11px] text-muted-foreground">Waiting for acceptance</span></div>)}</div></section> : null}
    <section><h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide">Connected</h2>{team.people.length === 0 ? <p className="rounded-xl border border-dashed border-border p-8 text-center text-[12px] text-muted-foreground">No Team connections yet.</p> : <div className="grid gap-2 md:grid-cols-2">{team.people.map((person) => <div key={person.profileId} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"><PersonAvatar name={person.name} initials={person.initials} src={person.avatarUrl} size={36} /><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{person.name}</p><p className="text-[11px] text-muted-foreground">{person.phone ?? "Connected"}</p></div><button type="button" onClick={() => remove.mutate(person.profileId)} className="text-[11px] text-muted-foreground hover:text-destructive">Remove</button></div>)}</div>}</section>
  </AppShell>;
}
