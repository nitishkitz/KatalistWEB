import { forwardRef, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { reconcileMentions, type SelectedMention } from "@/features/lists/chat-mentions";
import { MentionMenu, handleMentionKey } from "./MentionMenu";
import { filterMentionPeople, findMentionTrigger, type MentionPerson, type MentionTrigger } from "./mention-trigger";

export type MentionInputHandle = { openMention: () => void; focus: () => void };

/**
 * Single-line text input with @mention suggestions: typing "@" (or calling
 * openMention) lists matching people with avatar and name; Arrow keys move,
 * Enter/Tab select, Escape closes. Selected mentions are tracked as
 * {id, label, start, end} ranges that survive edits elsewhere in the text and
 * are dropped when their label is edited, same contract as List chat.
 */
export const MentionInput = forwardRef<
  MentionInputHandle,
  {
    value: string;
    mentions: SelectedMention[];
    people: MentionPerson[];
    onChange: (value: string, mentions: SelectedMention[]) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    wrapperClassName?: string;
    ariaLabel?: string;
  }
>(function MentionInput(
  { value, mentions, people, onChange, placeholder, disabled, className, wrapperClassName, ariaLabel },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuId = useId();
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = useMemo(() => (trigger ? filterMentionPeople(people, trigger.query) : []), [trigger, people]);
  const active = Math.min(activeIndex, Math.max(matches.length - 1, 0));
  const open = Boolean(trigger) && matches.length > 0;

  const select = (person: MentionPerson) => {
    if (!trigger) return;
    const before = value.slice(0, trigger.start);
    const after = value.slice(trigger.start + 1 + trigger.query.length);
    const label = `@${person.name}`;
    const next = `${before}${label} ${after}`;
    onChange(next, [
      ...reconcileMentions(value, next, mentions),
      { id: person.id, label, start: before.length, end: before.length + label.length },
    ]);
    setTrigger(null);
    setActiveIndex(0);
    requestAnimationFrame(() => {
      const caret = before.length + label.length + 1;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  };

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    openMention: () => {
      const input = inputRef.current;
      const caret = input?.selectionStart ?? value.length;
      const needsSpace = caret > 0 && !/\s/.test(value[caret - 1] ?? "");
      const insert = needsSpace ? " @" : "@";
      const next = `${value.slice(0, caret)}${insert}${value.slice(caret)}`;
      onChange(next, reconcileMentions(value, next, mentions));
      setTrigger({ start: caret + insert.length - 1, query: "" });
      setActiveIndex(0);
      requestAnimationFrame(() => input?.focus());
    },
  }));

  return (
    <div className={wrapperClassName ?? "relative min-w-0 flex-1"}>
      {open ? (
        <MentionMenu id={menuId} people={matches} activeIndex={active} onSelect={select} onHover={setActiveIndex} />
      ) : null}
      <input
        ref={inputRef}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={menuId}
        aria-activedescendant={open ? `${menuId}-option-${active}` : undefined}
        className={className}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next, reconcileMentions(value, next, mentions));
          setTrigger(findMentionTrigger(next, event.target.selectionStart ?? next.length));
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (!trigger) return;
          handleMentionKey(
            event,
            { count: matches.length, activeIndex: active },
            {
              setActiveIndex,
              select: (index) => {
                const person = matches[index];
                if (person) select(person);
              },
              close: () => setTrigger(null),
            },
          );
        }}
        onBlur={() => setTrigger(null)}
      />
    </div>
  );
});
