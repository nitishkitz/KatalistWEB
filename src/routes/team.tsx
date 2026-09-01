import { createFileRoute } from "@tanstack/react-router";
import { Users, UserPlus, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useAssignablePeople } from "@/features/people/use-assignable";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useAvatarUrl } from "@/features/people/directory";

export const Route = createFileRoute("/team")({
  head: () => ({
    meta: [
      { title: "Team — Katalist" },
      { name: "description", content: "Your connected teammates and contacts." },
    ],
  }),
  component: TeamPage,
});

function TeamMemberRow({ person }: { person: { id: string; name: string; initials: string; avatarUrl?: string | null; role?: string } }) {
  const avatar = useAvatarUrl(person.name, null, person.avatarUrl);
  return (
    <div className="flex items-center justify-between rounded-xl border border-border/70 bg-white p-4 shadow-2xs transition-all hover:border-border">
      <div className="flex items-center gap-3">
        <PersonAvatar name={person.name} initials={person.initials} src={avatar} size={36} />
        <div>
          <span className="block text-sm font-semibold text-foreground">{person.name}</span>
          <span className="block text-xs text-muted-foreground">{person.role ?? "Connected Teammate"}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-600 border border-emerald-200/60">
          <ShieldCheck className="h-3.5 w-3.5" />
          Connected
        </span>
      </div>
    </div>
  );
}

function TeamPage() {
  const people = useAssignablePeople();

  return (
    <AppShell
      title="Team"
      subtitle="People you collaborate with on Katalist."
      actions={
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-semibold text-white shadow-xs hover:bg-primary/90 transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          Add Teammate
        </button>
      }
    >
      <div className="mx-auto max-w-4xl pt-4">
        <div className="space-y-3">
          {people.map((person) => (
            <TeamMemberRow key={person.id} person={person} />
          ))}
          {people.length === 0 ? (
            <div className="flex min-h-[160px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-white p-6 text-center">
              <Users className="h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm font-semibold text-foreground">No teammates connected yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Add contacts to collaborate and assign Things.</p>
            </div>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
