import type { ThingReference } from "./thing-reference";
import { LazyCompactThingReferenceCard } from "./lazy-card";
import { useThingNavigation } from "./use-open-thing";

/** Staged references above a composer. Removing one drops only the draft reference; opening one leaves the draft intact. */
export function ThingReferenceDraftTray({
  references,
  onRemove,
  className,
}: {
  references: readonly ThingReference[];
  onRemove: (thingId: string) => void;
  className?: string;
}) {
  const { openThing } = useThingNavigation();
  if (references.length === 0) return null;
  return (
    <div className={className ?? "mb-2 grid gap-2 sm:grid-cols-2"} aria-label="Referenced Things">
      {references.map((ref) => (
        <LazyCompactThingReferenceCard key={ref.thingId} thingId={ref.thingId} onOpen={openThing} onRemove={onRemove} />
      ))}
    </div>
  );
}
