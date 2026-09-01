import type { Thing } from "@/domain/thing";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ThingDetailContent } from "./ThingDetailContent";

type Props = {
  thing: Thing | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewOnly?: boolean;
};

export function ThingDetailSheet({ thing, open, onOpenChange, viewOnly = false }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-label="Thing details"
        className="w-full overflow-y-auto border-l border-border bg-white p-0 shadow-2xl sm:max-w-[480px] z-[60]"
      >
        <ThingDetailContent
          initialThing={thing}
          onAfterTerminalAction={() => onOpenChange(false)}
          viewOnly={viewOnly}
          variant="court"
        />
      </SheetContent>
    </Sheet>
  );
}
