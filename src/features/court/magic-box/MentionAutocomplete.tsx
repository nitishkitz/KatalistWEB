import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { cn } from "@/lib/utils";
import type { RankedPerson } from "./types";

export function MentionAutocomplete({
  people,
  highlight,
  query,
  onPick,
}: {
  people: RankedPerson[];
  highlight: number;
  query: string;
  onPick: (person: RankedPerson, index: number) => void;
}) {
  return (
    <ul
      role="listbox"
      id="magic-box-mentions"
      aria-label="People"
      className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-56 overflow-auto rounded-lg border border-border bg-popover py-1 shadow-md"
    >
      {people.length === 0 ? (
        <li className="px-3 py-2 text-[12px] text-muted-foreground">No matching person.</li>
      ) : (
        people.map((person, index) => (
          <li key={person.id} role="option" aria-selected={index === highlight} id={`magic-box-mention-${person.id}`}>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] outline-none",
                index === highlight ? "bg-muted" : "hover:bg-muted/70",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(person, index);
              }}
            >
              <PersonAvatar name={person.name} initials={person.initials} src={person.avatarUrl} size={22} />
              <span className="min-w-0 flex-1 truncate">{person.name}</span>
              {query ? (
                <span className="text-[10px] text-muted-foreground">{index === highlight ? "Tab" : ""}</span>
              ) : null}
            </button>
          </li>
        ))
      )}
    </ul>
  );
}
