import { User } from "lucide-react";
import type { Person } from "@/domain/thing";

export function PersonCell({ person }: { person: Person }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-foreground">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <User className="h-3 w-3" />
      </span>
      {person.name}
    </span>
  );
}
