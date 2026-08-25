import { useMemo, useState } from "react";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useTeamDirectory } from "@/features/team/use-team-directory";

export type ListMemberSelection =
  | { kind: "connected"; profileId: string; role: "collaborator" | "view_only" }
  | { kind: "phone"; phone: string; role: "collaborator" | "view_only" };

type Props = {
  existingProfileIds: string[];
  onChoose: (selection: ListMemberSelection) => Promise<void> | void;
};

function normalizeIndianPhone(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

export function ListMemberPicker({ existingProfileIds, onChoose }: Props) {
  const team = useTeamDirectory();
  const [search, setSearch] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"collaborator" | "view_only">("collaborator");
  const [busy, setBusy] = useState(false);
  const people = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return team.people.filter(
      (person) => !existingProfileIds.includes(person.profileId) &&
        (!needle || person.name.toLocaleLowerCase().includes(needle)),
    );
  }, [team.people, existingProfileIds, search]);

  const choose = async (selection: ListMemberSelection) => {
    setBusy(true);
    try {
      await onChoose(selection);
      setPhone("");
      setSearch("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-semibold">Add member</p>
        <select value={role} onChange={(event) => setRole(event.target.value as typeof role)} className="h-8 rounded-lg border border-border bg-card px-2 text-[11px]">
          <option value="collaborator">Collaborator</option>
          <option value="view_only">View only</option>
        </select>
      </div>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search accepted Team connections" className="h-9 w-full rounded-lg border border-border bg-card px-3 text-[12px]" />
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {people.map((person) => (
          <div key={person.profileId} className="flex items-center gap-2 rounded-lg bg-card px-2 py-1.5">
            <PersonAvatar name={person.name} initials={person.initials} src={person.avatarUrl} size={28} />
            <span className="min-w-0 flex-1 truncate text-[12px]">{person.name}</span>
            <button type="button" disabled={busy} onClick={() => void choose({ kind: "connected", profileId: person.profileId, role })} className="rounded-md bg-primary px-2.5 py-1 text-[11px] text-primary-foreground disabled:opacity-50">Add</button>
          </div>
        ))}
        {!team.isLoading && people.length === 0 ? <p className="px-2 py-1 text-[11px] text-muted-foreground">No matching Team connection.</p> : null}
      </div>
      <div className="border-t border-border pt-3">
        <p className="mb-1 text-[11px] text-muted-foreground">Or invite a validated 10-digit Indian mobile number</p>
        <div className="flex gap-2">
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="10-digit Indian mobile number" className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-[12px]" />
          <button type="button" disabled={busy || !normalizeIndianPhone(phone)} onClick={() => { const normalized = normalizeIndianPhone(phone); if (normalized) void choose({ kind: "phone", phone: normalized, role }); }} className="rounded-lg border border-border bg-card px-3 text-[11px] disabled:opacity-50">Invite</button>
        </div>
      </div>
    </div>
  );
}
