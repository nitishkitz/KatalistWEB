import { useState } from "react";
import { Check, Eye, Plus, Search, Users, X } from "lucide-react";
import type { Person } from "@/domain/thing";
import type { ListRow } from "@/features/lists/fixtures";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ListInviteRole = "collaborator" | "view_only";

interface ListInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: ListRow;
  people: Person[];
  addingPersonId: string | null;
  onAdd: (person: Person, role: ListInviteRole) => Promise<void>;
}

export function ListInviteDialog({ open, onOpenChange, list, people, addingPersonId, onAdd }: ListInviteDialogProps) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<ListInviteRole>("collaborator");
  const visiblePeople = people.filter((person) => !search.trim() || person.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white p-6">
        <DialogHeader>
          <DialogTitle>Invite to {list.name}</DialogTitle>
          <DialogDescription>Add an existing Katalist teammate. Email delivery is not configured.</DialogDescription>
        </DialogHeader>

        <fieldset className="mt-3">
          <legend className="mb-1.5 text-xs font-semibold text-foreground">Permission role</legend>
          <div className="grid grid-cols-2 gap-2">
            {(["collaborator", "view_only"] as const).map((value) => (
              <button key={value} type="button" onClick={() => setRole(value)} aria-pressed={role === value} className={cn("flex min-h-10 items-center justify-center gap-2 rounded-xl border text-xs font-medium", role === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
                {value === "collaborator" ? <Users className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {value === "collaborator" ? "Collaborator" : "View only"}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <div className="mb-1.5 flex items-center justify-between text-xs"><span className="font-semibold">Your team members</span><span className="text-muted-foreground">{people.length} contacts</span></div>
          <label className="flex min-h-10 items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 focus-within:ring-2 focus-within:ring-ring">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="sr-only">Search team members</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search team members" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
            {search ? <button type="button" onClick={() => setSearch("")} aria-label="Clear member search" className="rounded p-1 text-muted-foreground"><X className="h-3 w-3" /></button> : null}
          </label>

          <div className="mt-2.5 max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
            {visiblePeople.map((person) => {
              const alreadyMember = list.members.some((member) =>
                (person.profileId && member.profileId === person.profileId) || member.profileId === person.id || member.actorId === person.id || member.name.toLowerCase() === person.name.toLowerCase(),
              ) || list.ownerActorId === person.id || (person.profileId && list.ownerActorId === person.profileId);
              const adding = addingPersonId === person.id;
              return (
                <div key={person.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 p-2.5">
                  <div className="flex min-w-0 items-center gap-2.5"><PersonAvatar name={person.name} initials={person.initials} src={person.avatarUrl} size={28} /><span className="truncate text-xs font-bold">{person.name}</span></div>
                  {alreadyMember ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"><Check className="h-3 w-3" />In List</span> : (
                    <button type="button" disabled={addingPersonId !== null} onClick={() => void onAdd(person, role)} className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-primary/10 px-3 text-xs font-semibold text-primary disabled:opacity-50"><Plus className="h-3 w-3" />{adding ? "Adding…" : "Add"}</button>
                  )}
                </div>
              );
            })}
            {visiblePeople.length === 0 ? <p className="py-5 text-center text-xs text-muted-foreground">No team members match this search.</p> : null}
          </div>
        </div>

        <div className="mt-4 flex justify-end border-t border-border pt-3"><button type="button" onClick={() => onOpenChange(false)} className="min-h-9 rounded-xl border border-border px-4 text-xs font-medium">Done</button></div>
      </DialogContent>
    </Dialog>
  );
}
