import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { MagicBox } from "@/features/court/MagicBox";
import type { Person } from "@/domain/thing";

/**
 * The List-scoped Magic Box, revealed above the viewport's bottom edge, independent of workspace scrolling.
 *
 * Opening it never navigates, never replaces the detail pane, never submits anything and never shows a second composer: it is
 * the same Magic Box the Things tab uses, with this List already chosen. Once opened it stays mounted (hidden when closed),
 * so a half-written Thing is kept. Escape closes it and returns focus to where the person was.
 */
export function CreateThingDock({ open, onClose, listId, listName, people }: { open: boolean; onClose: () => void; listId: string; listName: string; people: Person[] }) {
  const [everOpened, setEverOpened] = useState(false);
  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);
  if ((!open && !everOpened) || typeof document === "undefined") return null;
  return createPortal(
    <section
      aria-label={`Create a Thing in ${listName}`}
      data-create-thing-dock
      hidden={!open}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.stopPropagation();
          onClose();
        }
      }}
      className="ca-capture-dock"
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between pb-1">
        <h3 className="text-[13px] font-semibold">Create a Thing in {listName}</h3>
        <button type="button" onClick={onClose} aria-label="Close Create a Thing" className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[var(--ca-muted)] outline-none hover:bg-[var(--ca-surface-soft)] focus-visible:ring-2 focus-visible:ring-[var(--ca-accent)]">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mx-auto max-w-2xl">
        <MagicBox listId={listId} listName={listName} desktop extraPeople={people} />
      </div>
    </section>,
    document.body,
  );
}
