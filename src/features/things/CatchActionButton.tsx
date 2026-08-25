import { useState, type MouseEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Thing } from "@/domain/thing";
import { getThingCapabilities } from "@/domain/capabilities";
import { useCourt } from "@/features/court/use-court";
import { rpcCatchThing } from "@/features/things/rpc";
import { invalidatePersonalSurfaces } from "@/features/things/personal-shred";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";

export function CatchActionButton({
  thing,
  className,
  children,
}: {
  thing: Thing;
  className?: string;
  children?: ReactNode;
}) {
  const { myActorId } = useCourt();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const caps = getThingCapabilities(thing, myActorId);
  if (!caps.canCatch) return null;

  async function onCatch(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await rpcCatchThing(thing.id);
      toast.success("Caught.");
      await invalidatePersonalSurfaces(qc);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["thing"] }),
        qc.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    } catch (err) {
      setBusy(false);
      toast.error(domainErrorMessage(err));
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={(event) => void onCatch(event)}
      className={cn("disabled:cursor-not-allowed disabled:opacity-60", className)}
      aria-label={`Catch ${thing.title}`}
    >
      {children ?? "Catch"}
    </button>
  );
}
