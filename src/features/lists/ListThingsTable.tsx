import { format, formatDistanceToNowStrict } from "date-fns";
import { MoreHorizontal } from "lucide-react";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { laneOf, type Thing } from "@/domain/thing";

export function ListThingsTable({ things, onSelect }: { things: Thing[]; onSelect: (thing: Thing) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[760px] text-left">
        <thead><tr className="border-b border-border text-[11px] text-muted-foreground"><th className="px-4 py-2.5 font-medium">Thing</th><th className="px-3 py-2.5 font-medium">Assignee</th><th className="px-3 py-2.5 font-medium">State</th><th className="px-3 py-2.5 font-medium">Due</th><th className="px-3 py-2.5 font-medium">Updated</th><th className="w-16 px-3 py-2.5 font-medium">Actions</th></tr></thead>
        <tbody>{things.map((thing) => (
          <tr key={thing.id} className="border-b border-border/70 last:border-0 hover:bg-muted/30">
            <td className="px-4 py-3"><button type="button" onClick={() => onSelect(thing)} className="text-left"><span className="block text-[13px] font-medium">{thing.title}</span><span className="text-[10px] font-semibold uppercase text-primary">{laneOf(thing)}</span></button></td>
            <td className="px-3 py-3"><span className="flex items-center gap-2 text-[11px]"><PersonAvatar name={thing.assignee.name} initials={thing.assignee.initials} src={thing.assignee.avatarUrl} size={24} />{thing.assignee.name}</span></td>
            <td className="px-3 py-3 text-[11px]"><span className="block">{thing.acknowledgement === "caught" ? "Caught" : "Waiting"}</span><span className="text-muted-foreground">{thing.workStatus.replace("_", " ")}</span></td>
            <td className="px-3 py-3 text-[11px] text-muted-foreground">{thing.dueAt ? format(new Date(thing.dueAt), "MMM d, yyyy") : "—"}</td>
            <td className="px-3 py-3 text-[11px] text-muted-foreground" title={format(new Date(thing.updatedAt), "PPpp")}>{formatDistanceToNowStrict(new Date(thing.updatedAt), { addSuffix: true })}</td>
            <td className="px-3 py-3"><button type="button" onClick={() => onSelect(thing)} aria-label={`Actions for ${thing.title}`} className="rounded-md p-1.5 hover:bg-muted"><MoreHorizontal className="h-4 w-4" /></button></td>
          </tr>
        ))}</tbody>
      </table>
      {things.length === 0 ? <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">No Things match these filters.</p> : null}
    </div>
  );
}
