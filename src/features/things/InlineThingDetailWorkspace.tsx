import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { Thing } from "@/domain/thing";
import { cn } from "@/lib/utils";
import { ThingDetailContent } from "./ThingDetailContent";

type InlineThingDetailWorkspaceProps = {
  thing: Thing | null;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  sourceClassName?: string;
};

export function InlineThingDetailWorkspace({
  thing,
  onClose,
  children,
  className,
  sourceClassName,
}: InlineThingDetailWorkspaceProps) {
  if (!thing) return <>{children}</>;

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close Thing details"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground outline-none hover:border-primary/45 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <X className="h-4 w-4" />
    </button>
  );

  return (
    <section
      aria-label="Inline Thing details"
      className={cn(
        "grid min-w-0 items-start gap-3 md:grid-cols-[minmax(280px,38%)_minmax(0,1fr)]",
        className,
      )}
    >
      <div className={cn("min-w-0", sourceClassName)}>{children}</div>
      <article className="min-w-0 overflow-hidden rounded-xl border border-border/80 bg-white">
        <div className="max-h-[calc(100vh-12rem)] overflow-y-auto overscroll-contain">
          <ThingDetailContent
            initialThing={thing}
            headerAction={closeButton}
            onAfterTerminalAction={onClose}
          />
        </div>
      </article>
    </section>
  );
}
