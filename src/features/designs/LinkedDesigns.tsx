import { ExternalLink, LayoutGrid } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { KIND_LABELS } from "./design-library-model";
import { deriveDesignEmbed } from "./records";
import { useThingDesigns } from "./use-designs";

/**
 * "Designs" section for a Thing's detail. Each link opens the exact saved frame in Figma
 * (the canonical link keeps the node), or the Designs tab on this List. Renders nothing when
 * there is nothing to show, and says so plainly when the read fails.
 */
export function LinkedDesigns({ thingId, listId }: { thingId: string; listId: string | null | undefined }) {
  const { designs, isLoading, error, refetch } = useThingDesigns(thingId, listId);
  if (!listId) return null;
  if (error) {
    return (
      <section aria-label="Designs" className="space-y-1.5">
        <h3 className="katalist-section-title">Designs</h3>
        <p role="alert" className="text-[12px] text-[#b42318]">
          Linked designs could not be loaded.{" "}
          <button type="button" onClick={() => void refetch()} className="cursor-pointer font-medium underline">Retry</button>
        </p>
      </section>
    );
  }
  if (isLoading || designs.length === 0) return null;
  return (
    <section aria-label="Designs" data-testid="thing-linked-designs" className="space-y-1.5">
      <h3 className="katalist-section-title">Designs</h3>
      <ul className="space-y-1.5">
        {designs.map((d) => {
          const target = deriveDesignEmbed(d);
          return (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px] text-foreground">
              <span className="min-w-0 break-words">
                <LayoutGrid className="mr-1.5 inline h-3.5 w-3.5 text-primary" aria-hidden="true" />
                {d.title}
                <span className="ml-1.5 text-muted-foreground">
                  {KIND_LABELS[d.kind]}
                  {d.nodeId ? ` · frame ${d.nodeId}` : ""}
                  {d.archivedAt ? " · archived" : ""}
                </span>
              </span>
              <span className="flex gap-3">
                {target.ok && (
                  <a
                    href={target.value.normalizedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open in Figma
                    <span className="sr-only"> (opens in a new tab): {d.title}</span>
                  </a>
                )}
                <Link
                  to="/lists/$listId"
                  params={{ listId }}
                  search={{ tab: "designs", design: d.id } as never}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  View in Designs<span className="sr-only">: {d.title}</span>
                </Link>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
