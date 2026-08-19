import type { Person } from "@/domain/thing";
import { PersonAvatar } from "./PersonAvatar";
import { useAvatarUrl } from "@/features/people/directory";

export function PersonCell({ person }: { person: Person }) {
  const src = useAvatarUrl(person.name, null, person.avatarUrl);
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-foreground">
      <PersonAvatar name={person.name} initials={person.initials} src={src} size={20} />
      {person.name}
    </span>
  );
}