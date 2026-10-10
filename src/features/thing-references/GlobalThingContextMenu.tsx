import { useEffect, useState } from "react";
import { Copy, Link2, Sparkles } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { isThingId } from "./thing-reference";
import { addThingToMagicBox, copyThingLink, copyThingReference } from "./thing-reference-actions";
import { useThingNavigation } from "./use-open-thing";

/** Surfaces mark themselves with `data-thing-id`; the innermost marked ancestor of the right-click target wins. */
export const THING_ID_ATTRIBUTE = "data-thing-id";

type Anchor = { thingId: string; x: number; y: number };

function keepNativeMenu(target: HTMLElement): boolean {
  if (target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return true;
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
}

/**
 * One app-level right-click menu for every surface that carries `data-thing-id`. Menus opened by an explicit wrapper
 * (which prevents default) are left alone, as are editable fields and text selections.
 */
export function GlobalThingContextMenu() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const { openCourt } = useThingNavigation();

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target || keepNativeMenu(target)) return;
      const host = target.closest<HTMLElement>(`[${THING_ID_ATTRIBUTE}]`);
      const thingId = host?.getAttribute(THING_ID_ATTRIBUTE);
      if (!host || !isThingId(thingId)) return;
      event.preventDefault();
      // Keyboard-invoked menus (Menu key, Shift+F10) report no pointer position, so anchor to the element.
      const rect = host.getBoundingClientRect();
      const keyboard = event.clientX === 0 && event.clientY === 0;
      setAnchor({ thingId, x: keyboard ? rect.left + 16 : event.clientX, y: keyboard ? rect.top + 16 : event.clientY });
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  if (!anchor) return null;
  const close = () => setAnchor(null);
  return (
    <DropdownMenu open onOpenChange={(open) => !open && close()} modal={false}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden="true" style={{ position: "fixed", left: anchor.x, top: anchor.y, width: 1, height: 1, pointerEvents: "none" }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52" onCloseAutoFocus={(event) => event.preventDefault()}>
        <DropdownMenuItem onSelect={() => void copyThingReference(anchor.thingId)}>
          <Copy className="mr-2 h-4 w-4" />
          Copy Thing
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { if (!addThingToMagicBox(anchor.thingId)) openCourt(); }}>
          <Sparkles className="mr-2 h-4 w-4" />
          Add to Magic Box
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyThingLink(anchor.thingId)}>
          <Link2 className="mr-2 h-4 w-4" />
          Copy link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
