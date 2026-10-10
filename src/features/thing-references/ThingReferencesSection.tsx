import { useThingNavigation } from "./use-open-thing";
import { LazyCompactThingReferenceCard } from "./lazy-card";
import { ThingReferenceContextMenu } from "./ThingReferenceContextMenu";
import { useThingReferences } from "./rpc";
import type { ThingReference } from "./thing-reference";

/** Saved references beneath a body of content. Each card is its own copy target, so right-click targets the reference. */
export function ThingReferenceList({ references, className }: { references: readonly ThingReference[]; className?: string }) {
  const { openThing } = useThingNavigation();
  if (references.length === 0) return null;
  return (
    <div className={className ?? "grid gap-2 sm:grid-cols-2"} aria-label="Referenced Things">
      {references.map((ref) => (
        <ThingReferenceContextMenu key={ref.thingId} thingId={ref.thingId}>
          <LazyCompactThingReferenceCard
            thingId={ref.thingId}
            onOpen={openThing}
          />
        </ThingReferenceContextMenu>
      ))}
    </div>
  );
}

/** Reads and renders the references saved on a Thing. Renders nothing while loading, on error, or when there are none. */
export function ThingReferencesSection({ thingId }: { thingId: string }) {
  const { data } = useThingReferences(thingId);
  if (!data?.length) return null;
  return (
    <div className="py-3 border-b border-[#eef0f6]">
      <h3 className="mb-1.5 text-[13px] font-medium text-[#000533]">Referenced Things</h3>
      <ThingReferenceList references={data} />
    </div>
  );
}
