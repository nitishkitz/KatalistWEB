import type { Thing } from "@/domain/thing";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ThingDetailContent } from "./ThingDetailContent";

type Props = {
  thing: Thing | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ThingDetailSheet({ thing, open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto border-l border-border bg-white p-0 shadow-none sm:max-w-[440px]"
      >
        <ThingDetailContent
          initialThing={thing}
          onAfterTerminalAction={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
