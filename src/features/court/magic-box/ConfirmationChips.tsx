import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { cn } from "@/lib/utils";
import { KatalistIcon } from "../KatalistIcon";
import { DueChipEditor } from "./DueChipEditor";
import { ImportanceChipEditor } from "./ImportanceChipEditor";
import type { MagicBoxDraft, RankedPerson } from "./types";
import type { Importance, Person } from "@/domain/thing";

const ChipButton = forwardRef<
  HTMLButtonElement,
  {
    children: ReactNode;
    warning?: boolean;
    desktop?: boolean;
  } & ButtonHTMLAttributes<HTMLButtonElement>
>(function ChipButton({ children, warning = false, desktop = false, className, ...props }, ref) {
  return (
    <button
      type="button"
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
        desktop && "bg-white",
        warning
          ? desktop
            ? "border-status-waiting/50 text-status-waiting"
            : "border-status-waiting/40 bg-status-waiting-bg text-status-waiting"
          : desktop
            ? "border-border text-foreground"
            : "border-border bg-card text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

export function ConfirmationChips({
  draft,
  desktop,
  floating,
  people,
  chipEditor,
  setChipEditor,
  onAssignee,
  onSelf,
  onDue,
  onDueClear,
  onImportance,
}: {
  draft: MagicBoxDraft;
  desktop?: boolean;
  floating?: boolean;
  people: RankedPerson[] | Person[];
  chipEditor: null | "assignee" | "due" | "importance";
  setChipEditor: (next: null | "assignee" | "due" | "importance") => void;
  onAssignee: (person: Person) => void;
  onSelf: () => void;
  onDue: (dueAt: string, dueHasTime: boolean, label: string) => void;
  onDueClear: () => void;
  onImportance: (importance: Importance) => void;
}) {
  if (!draft.rawText.trim()) return null;

  const assigneeLabel =
    draft.assignee.status === "resolved"
      ? draft.assignee.person.name
      : draft.assignee.status === "unresolved"
        ? `Who is @${draft.assignee.rawMention}?`
        : "Self";
  const dueLabel =
    draft.due.status === "resolved" ? draft.due.label : draft.due.status === "ambiguous" ? "Check date" : "Due";
  const dueWarning = draft.due.status === "ambiguous";
  const personWarning = draft.assignee.status === "unresolved";

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <Popover open={chipEditor === "assignee"} onOpenChange={(open) => setChipEditor(open ? "assignee" : null)}>
        <PopoverTrigger asChild>
          <ChipButton warning={personWarning} desktop={desktop}>
            {desktop ? <KatalistIcon name="at-person" className="h-3 w-3" /> : null}
            {draft.assignee.status === "resolved" ? `@${assigneeLabel}` : assigneeLabel}
          </ChipButton>
        </PopoverTrigger>
        <PopoverContent side={floating ? "top" : "bottom"} align="start" className="w-64 p-2">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
            onClick={() => {
              onSelf();
              setChipEditor(null);
            }}
          >
            Self
          </button>
          <div className="max-h-48 overflow-auto">
            {people.map((person) => (
              <button
                key={person.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                onClick={() => {
                  onAssignee(person);
                  setChipEditor(null);
                }}
              >
                <PersonAvatar name={person.name} initials={person.initials} src={person.avatarUrl} size={20} />
                {person.name}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <Popover open={chipEditor === "due"} onOpenChange={(open) => setChipEditor(open ? "due" : null)}>
        <PopoverTrigger asChild>
          <ChipButton warning={dueWarning} desktop={desktop}>
            {desktop ? <KatalistIcon name="date-detection" className="h-3 w-3" /> : null}
            {dueLabel}
          </ChipButton>
        </PopoverTrigger>
        <PopoverContent side={floating ? "top" : "bottom"} align="start" className="w-auto p-3">
          <DueChipEditor
            draft={draft}
            onSet={(dueAt, dueHasTime, label) => {
              onDue(dueAt, dueHasTime, label);
              setChipEditor(null);
            }}
            onClear={() => {
              onDueClear();
              setChipEditor(null);
            }}
          />
        </PopoverContent>
      </Popover>

      <Popover open={chipEditor === "importance"} onOpenChange={(open) => setChipEditor(open ? "importance" : null)}>
        <PopoverTrigger asChild>
          <ChipButton desktop={desktop}>
            {desktop ? <KatalistIcon name="urgent" className="h-3 w-3" /> : null}
            {draft.ownerImportance.toUpperCase()}
          </ChipButton>
        </PopoverTrigger>
        <PopoverContent side={floating ? "top" : "bottom"} align="start" className="w-auto p-2">
          <ImportanceChipEditor
            value={draft.ownerImportance}
            onSet={(importance) => {
              onImportance(importance);
              setChipEditor(null);
            }}
          />
        </PopoverContent>
      </Popover>

      {draft.listName ? (
        <span className={cn("inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px]", desktop && "bg-white")}>
          {draft.listName}
        </span>
      ) : null}
    </div>
  );
}
