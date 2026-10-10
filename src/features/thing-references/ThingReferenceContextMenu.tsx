import type { MouseEvent, ReactNode } from "react";
import { Copy, Link2, MoreHorizontal, Sparkles } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useThingNavigation } from "./use-open-thing";
import { addThingToMagicBox, copyThingLink, copyThingReference } from "./thing-reference-actions";

/** Ordinary editing and selected-text copying keep the browser's own menu. */
function shouldKeepNativeMenu(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return true;
  const selection = typeof window === "undefined" ? null : window.getSelection();
  if (selection && !selection.isCollapsed && selection.toString().trim()) {
    const anchor = selection.anchorNode;
    if (anchor && event.currentTarget.contains(anchor)) return true;
  }
  return false;
}

function useThingReferenceActions(thingId: string) {
  const { openCourt } = useThingNavigation();
  return {
    copy: () => void copyThingReference(thingId),
    link: () => void copyThingLink(thingId),
    addToMagicBox: () => {
      if (!addThingToMagicBox(thingId)) openCourt();
    },
  };
}

/**
 * Right-click menu for any surface that renders a Thing. The innermost wrapper wins, so a nested Thing reference targets
 * itself while the surrounding detail surface targets the Thing it displays.
 */
export function ThingReferenceContextMenu({
  thingId,
  children,
  className,
}: {
  thingId: string;
  children: ReactNode;
  className?: string;
}) {
  const actions = useThingReferenceActions(thingId);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        onContextMenuCapture={(event) => {
          // Capture runs before Radix's own handler, so stopping here keeps the native menu for editable fields and selections.
          if (shouldKeepNativeMenu(event)) event.stopPropagation();
        }}
        onContextMenu={(event) => event.stopPropagation()}
      >
        <div className={cn("contents", className)}>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={actions.copy}>
          <Copy className="mr-2 h-4 w-4" />
          Copy Thing
        </ContextMenuItem>
        <ContextMenuItem onSelect={actions.addToMagicBox}>
          <Sparkles className="mr-2 h-4 w-4" />
          Add to Magic Box
        </ContextMenuItem>
        <ContextMenuItem onSelect={actions.link}>
          <Link2 className="mr-2 h-4 w-4" />
          Copy link
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Touch and keyboard equivalent of the right-click menu. */
export function ThingReferenceOverflowMenu({ thingId, className }: { thingId: string; className?: string }) {
  const actions = useThingReferenceActions(thingId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Thing options"
          title="Thing options"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] border border-slate-200 text-slate-500 outline-none transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
            className,
          )}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onSelect={actions.copy}>
          <Copy className="mr-2 h-4 w-4" />
          Copy Thing
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={actions.addToMagicBox}>
          <Sparkles className="mr-2 h-4 w-4" />
          Add to Magic Box
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={actions.link}>
          <Link2 className="mr-2 h-4 w-4" />
          Copy link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
