import { useState } from "react";
import { ImagePlus, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useAppContext } from "@/features/context/use-app-context";
import { useTeamDirectory } from "@/features/team/use-team-directory";
import { rpcAddConnectedListMember } from "@/features/things/rpc";
import { supabase } from "@/integrations/supabase/client";
import { domainErrorMessage } from "@/lib/domain-error";

type CreatedList = { id: string };
type Props = {
  open: boolean;
  onClose: () => void;
  create: {
    isPending: boolean;
    mutateAsync: (input: { name: string; description?: string }) => Promise<CreatedList | null>;
  };
};
type Role = "collaborator" | "view_only";

function normalizeIndianPhone(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

async function uploadCover(listId: string, file: File) {
  const body = new FormData(); body.set("file", file);
  const response = await fetch(`/api/lists/${listId}/cover`, { method: "POST", headers: await authHeaders(), body });
  if (!response.ok) throw new Error("Cover image could not be uploaded. Retry from List settings.");
}

async function invitePhone(listId: string, phone: string, role: Role) {
  const response = await fetch(`/api/lists/${listId}/invitations`, { method: "POST", headers: { ...(await authHeaders()), "content-type": "application/json" }, body: JSON.stringify({ phone, role }) });
  if (!response.ok) throw new Error("Invite could not be created.");
  return response.json() as Promise<{ shareUrl: string }>;
}

export function NewListDialog({ open, onClose, create }: Props) {
  const { context } = useAppContext();
  const team = useTeamDirectory();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [phone, setPhone] = useState("");
  const [phones, setPhones] = useState<string[]>([]);
  if (!open) return null;

  const close = () => { if (create.isPending) return; setStep(1); setName(""); setDescription(""); setCover(null); setRoles({}); setPhone(""); setPhones([]); onClose(); };
  const addPhone = (value: string) => { const normalized = normalizeIndianPhone(value); if (!normalized) return toast.error("Enter a valid 10-digit Indian mobile number."); setPhones((current) => current.includes(normalized) ? current : [...current, normalized]); setPhone(""); };
  const submit = async () => {
    try {
      const list = await create.mutateAsync({ name: name.trim(), description: description.trim() || undefined });
      if (!list) throw new Error("List could not be created.");
      for (const [profileId, role] of Object.entries(roles)) await rpcAddConnectedListMember(list.id, profileId, role);
      if (cover) await uploadCover(list.id, cover);
      const links = await Promise.all(phones.map((number) => invitePhone(list.id, number, "collaborator")));
      if (links[0]?.shareUrl) await navigator.clipboard?.writeText(links[0].shareUrl).catch(() => undefined);
      toast.success(links.length ? "List created. First invite link copied." : "List created.");
      close();
    } catch (error) { toast.error(domainErrorMessage(error)); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-start justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Step {step} of 2</p><h2 className="text-[17px] font-semibold">{step === 1 ? "List details" : "Add people"}</h2></div><button type="button" onClick={close} aria-label="Close"><X className="h-4 w-4" /></button></div>
        {step === 1 ? <div className="mt-4 space-y-3">
          <label className="block text-[12px] font-medium">Name<input autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-border px-3 text-[13px]" /></label>
          <label className="block text-[12px] font-medium">Description (optional)<textarea value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border border-border p-3 text-[13px]" /></label>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border p-3 text-[12px]"><ImagePlus className="h-4 w-4 text-primary" /><span className="flex-1">Cover image (optional){cover ? <span className="block text-muted-foreground">{cover.name}</span> : null}</span><input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => setCover(event.target.files?.[0] ?? null)} /></label>
          <p className="text-[11px] text-muted-foreground">Context: <span className="capitalize">{context}</span> · You · Owner</p>
          <div className="flex justify-end gap-2"><button type="button" onClick={close} className="px-3 py-2 text-[12px]">Cancel</button><button type="button" disabled={!name.trim()} onClick={() => setStep(2)} className="rounded-lg bg-primary px-4 py-2 text-[12px] text-primary-foreground disabled:opacity-50">Continue</button></div>
        </div> : <div className="mt-4 space-y-4">
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">{team.people.length === 0 ? <p className="p-3 text-[12px] text-muted-foreground">Your Team is empty. Invite by number below.</p> : team.people.map((person) => <div key={person.profileId} className="flex items-center gap-2 rounded-lg px-2 py-1.5"><input type="checkbox" checked={Boolean(roles[person.profileId])} onChange={(event) => setRoles((current) => { const next={...current}; if(event.target.checked) next[person.profileId]="collaborator"; else delete next[person.profileId]; return next; })} /><PersonAvatar name={person.name} initials={person.initials} src={person.avatarUrl} size={28} /><span className="min-w-0 flex-1 truncate text-[12px]">{person.name}</span>{roles[person.profileId] ? <select value={roles[person.profileId]} onChange={(event) => setRoles((current) => ({...current,[person.profileId]:event.target.value as Role}))} className="h-7 rounded-md border border-border text-[11px]"><option value="collaborator">Collaborator</option><option value="view_only">View only</option></select> : null}</div>)}</div>
          <div><p className="mb-1 text-[12px] font-medium">Invite by Indian mobile number</p><div className="flex gap-2"><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="10-digit number" className="h-9 flex-1 rounded-lg border border-border px-3 text-[12px]" /><button type="button" onClick={() => addPhone(phone)} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 text-[12px]"><UserPlus className="h-3.5 w-3.5" />Add</button></div>{phones.length ? <p className="mt-2 text-[11px] text-muted-foreground">Invited: {phones.join(", ")}</p> : null}</div>
          <div className="flex items-center justify-between"><button type="button" onClick={() => setStep(1)} className="px-2 py-2 text-[12px]">Back</button><div className="flex gap-2"><button type="button" disabled={create.isPending} onClick={() => void submit()} className="px-3 py-2 text-[12px]">Skip for now</button><button type="button" disabled={create.isPending} onClick={() => void submit()} className="rounded-lg bg-primary px-4 py-2 text-[12px] text-primary-foreground disabled:opacity-50">{create.isPending ? "Creating…" : "Create List"}</button></div></div>
        </div>}
      </div>
    </div>
  );
}
