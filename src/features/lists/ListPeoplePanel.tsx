import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import type { ListMember } from "./fixtures";
import { ListMemberPicker, type ListMemberSelection } from "./ListMemberPicker";
import { useListInvitations } from "./use-list-invitations";
import {
  rpcAddConnectedListMember,
  rpcChangeListRole,
  rpcRemoveListMember,
} from "@/features/things/rpc";
import { domainErrorMessage } from "@/lib/domain-error";

type Props = { listId: string; members: ListMember[]; isOwner: boolean };

export function ListPeoplePanel({ listId, members, isOwner }: Props) {
  const queryClient = useQueryClient();
  const pending = useListInvitations(listId, isOwner);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["list", listId] }),
      queryClient.invalidateQueries({ queryKey: ["lists"] }),
      queryClient.invalidateQueries({ queryKey: ["assignable-people"] }),
    ]);
  };

  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await work();
      await refresh();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(domainErrorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const choose = async (selection: ListMemberSelection) => {
    if (selection.kind === "connected") {
      const succeeded = await run(
        () => rpcAddConnectedListMember(listId, selection.profileId, selection.role),
        "Member added.",
      );
      if (succeeded) setPickerOpen(false);
      return;
    }
    try {
      const url = await pending.create(selection.phone, selection.role);
      setShareUrl(url);
      setPickerOpen(false);
      toast.success("Invite created. Share the private link.");
    } catch (error) {
      toast.error(domainErrorMessage(error));
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div><h2 className="text-[14px] font-semibold">Members & permissions</h2><p className="text-[11px] text-muted-foreground">Owner is always included. List roles do not change Thing assignment rules.</p></div>
        {isOwner ? <button type="button" onClick={() => setPickerOpen((open) => !open)} className="rounded-lg bg-primary px-3 py-2 text-[11px] text-primary-foreground">Add member</button> : null}
      </div>
      {pickerOpen ? <div className="mb-3"><ListMemberPicker existingProfileIds={members.flatMap((member) => member.profileId ? [member.profileId] : [])} onChoose={choose} /></div> : null}
      {shareUrl ? <div className="mb-3 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2"><span className="min-w-0 flex-1 truncate text-[11px]">Invite link ready</span><button type="button" onClick={() => void navigator.clipboard?.writeText(shareUrl).then(() => toast.success("Invite link copied."))} className="text-[11px] font-medium text-primary">Copy link</button><button type="button" onClick={() => setShareUrl(null)} className="text-[11px] text-muted-foreground">Hide</button></div> : null}
      <ul className="space-y-2">
        {members.map((member) => (
          <li key={member.profileId ?? member.name} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
            <PersonAvatar name={member.name} initials={member.initials} src={member.avatarUrl} size={28} />
            <span className="min-w-0 flex-1 truncate text-[13px]">{member.name}</span>
            {isOwner && member.role !== "owner" && member.profileId ? <><select value={member.role} disabled={busy} onChange={(event) => void run(() => rpcChangeListRole(listId, member.profileId!, event.target.value as "collaborator" | "view_only"), "Role updated.")} className="h-8 rounded-md border border-border bg-card px-2 text-[11px]"><option value="collaborator">Collaborator</option><option value="view_only">View only</option></select><button type="button" disabled={busy} onClick={() => void run(() => rpcRemoveListMember(listId, member.profileId!), "Member removed.")} className="text-[11px] text-muted-foreground hover:text-destructive">Remove</button></> : <span className="text-[11px] capitalize text-muted-foreground">{member.role === "view_only" ? "View only" : member.role}</span>}
          </li>
        ))}
      </ul>
      {isOwner && pending.invitations.length ? <div className="mt-4"><h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pending invitations</h3><ul className="space-y-2">{pending.invitations.map((invite) => <li key={invite.invitationId} className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-[11px]"><span className="flex-1">+91 •••••• {invite.phoneLast4 ?? "••••"} · {invite.role === "view_only" ? "View only" : "Collaborator"}</span><span className="text-muted-foreground">Expires {new Date(invite.expiresAt).toLocaleDateString()}</span><button type="button" disabled={busy} onClick={() => void (async () => { try { const url = await pending.replace(invite.invitationId); setShareUrl(url); toast.success("Invite link replaced."); } catch (error) { toast.error(domainErrorMessage(error)); } })()} className="text-primary">Replace link</button><button type="button" disabled={busy} onClick={() => void run(() => pending.revoke(invite.invitationId), "Invite revoked.")} className="text-destructive">Revoke</button></li>)}</ul></div> : null}
    </section>
  );
}
