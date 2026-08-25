import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Clock3, GripVertical, Lock } from "lucide-react";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { laneOf, type Pace, type Thing } from "@/domain/thing";
import { domainErrorMessage } from "@/lib/domain-error";
import { cn } from "@/lib/utils";
import { rpcSetPersonalPace } from "@/features/things/rpc";
import { canDragListThing } from "./list-board-model";

type Props = { things: Thing[]; myActorId: string | null; onSelect: (thing: Thing) => void };
const lanes: Array<{ pace: Pace; label: string; tone: string }> = [
  { pace: "now", label: "NOW", tone: "border-status-now/30" },
  { pace: "next", label: "NEXT", tone: "border-status-next/30" },
  { pace: "later", label: "LATER", tone: "border-status-later/30" },
];

export function ListThingsBoard({ things, myActorId, onSelect }: Props) {
  const qc = useQueryClient();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Pace>>({});
  const visible = useMemo(() => things.map((thing) => overrides[thing.id] ? { ...thing, personalPace: overrides[thing.id] } : thing), [things, overrides]);
  const move = useMutation({
    mutationFn: ({ thing, pace }: { thing: Thing; pace: Pace }) => rpcSetPersonalPace(thing.id, pace),
    onMutate: ({ thing, pace }) => setOverrides((current) => ({ ...current, [thing.id]: pace })),
    onSuccess: async (_, { thing, pace }) => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["list-things"] }), qc.invalidateQueries({ queryKey: ["thing", thing.id] })]);
      setOverrides((current) => { const next = { ...current }; delete next[thing.id]; return next; });
      toast.success(`Moved to ${pace.toUpperCase()}.`);
    },
    onError: (error, { thing }) => {
      setOverrides((current) => { const next = { ...current }; delete next[thing.id]; return next; });
      toast.error(domainErrorMessage(error));
    },
  });
  const drop = (pace: Pace) => {
    const thing = things.find((item) => item.id === draggedId);
    setDraggedId(null);
    if (!thing || !canDragListThing(thing, myActorId) || laneOf(thing) === pace) return;
    move.mutate({ thing, pace });
  };

  return (
    <div className="grid grid-cols-3 gap-3" aria-label="List Thing board">
      {lanes.map((lane) => {
        const items = visible.filter((thing) => laneOf(thing) === lane.pace);
        return (
          <section key={lane.pace} onDragOver={(event) => event.preventDefault()} onDrop={() => drop(lane.pace)} className={cn("min-h-48 rounded-xl border bg-muted/20 p-2", lane.tone)}>
            <div className="mb-2 flex items-center justify-between px-1"><h2 className="text-[11px] font-bold tracking-wide">{lane.label}</h2><span className="text-[11px] text-muted-foreground">{items.length}</span></div>
            <div className="space-y-2">
              {items.map((thing) => {
                const draggable = canDragListThing(thing, myActorId);
                return (
                  <article key={thing.id} draggable={draggable} onDragStart={() => setDraggedId(thing.id)} onDragEnd={() => setDraggedId(null)} className={cn("rounded-lg border border-border bg-card p-3 shadow-sm transition-opacity", draggedId === thing.id && "opacity-40")}>
                    <button type="button" onClick={() => onSelect(thing)} className="w-full text-left"><p className="text-[13px] font-medium leading-snug text-foreground">{thing.title}</p></button>
                    <div className="mt-3 flex items-center gap-2">
                      <PersonAvatar name={thing.assignee.name} initials={thing.assignee.initials} src={thing.assignee.avatarUrl} size={24} />
                      <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">{thing.acknowledgement === "waiting_for_catch" ? "Waiting for Catch" : thing.workStatus.replace("_", " ")}</span>
                      {thing.dueAt ? <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><Clock3 className="h-3 w-3" />{format(new Date(thing.dueAt), "MMM d")}</span> : null}
                      {draggable ? <GripVertical className="h-3.5 w-3.5 text-muted-foreground" /> : <Lock className="h-3 w-3 text-muted-foreground" />}
                    </div>
                  </article>
                );
              })}
              {items.length === 0 ? <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[11px] text-muted-foreground">No Things</p> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
