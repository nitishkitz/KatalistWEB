import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { cn } from "@/lib/utils";
import type { MentionPerson } from "./mention-trigger";

/**
 * Suggestion list for an in-progress "@mention". Presentational: the composer
 * owns the trigger, the active index and the keyboard handling (see
 * handleMentionKey). Rendered inline above the input and positioned by the
 * caller's `relative` wrapper, so it stays inside any dialog/focus layer.
 */
export function MentionMenu({
  people,
  activeIndex,
  onSelect,
  onHover,
  id,
}: {
  people: MentionPerson[];
  activeIndex: number;
  onSelect: (person: MentionPerson) => void;
  onHover?: (index: number) => void;
  id: string;
}) {
  if (people.length === 0) return null;
  return (
    <div
      id={id}
      role="listbox"
      aria-label="Mention someone"
      className="absolute bottom-full left-0 z-50 mb-1 w-64 max-w-full overflow-hidden rounded-[10px] border border-[#ebecf7] bg-white katalist-elevation-popover"
    >
      {people.map((person, index) => (
        <button
          key={person.id}
          id={`${id}-option-${index}`}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          // Keep focus in the input so typing continues after a click.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(person)}
          onMouseEnter={() => onHover?.(index)}
          className={cn(
            "flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
            index === activeIndex ? "bg-[#f1ecfc]" : "hover:bg-[#f6f7fc]",
          )}
        >
          <PersonAvatar name={person.name} initials={person.initials} src={person.avatarUrl} size={22} />
          <span className="truncate text-[12px] font-medium text-[#000533]">{person.name}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Arrow/Enter/Tab/Escape handling for an open MentionMenu. Returns true when
 * the key was consumed, so the caller can skip its own Enter/submit handling.
 */
export function handleMentionKey(
  event: { key: string; preventDefault: () => void },
  state: { count: number; activeIndex: number },
  actions: { setActiveIndex: (index: number) => void; select: (index: number) => void; close: () => void },
): boolean {
  if (state.count === 0) return false;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    actions.setActiveIndex((state.activeIndex + 1) % state.count);
    return true;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    actions.setActiveIndex((state.activeIndex - 1 + state.count) % state.count);
    return true;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    actions.select(state.activeIndex);
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    actions.close();
    return true;
  }
  return false;
}
