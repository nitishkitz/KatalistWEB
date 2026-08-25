import { LayoutGrid, List, Search, X } from "lucide-react";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import type { Person } from "@/domain/thing";
import type { ListStatusFilter } from "./list-board-model";
import { cn } from "@/lib/utils";

export type ListView = "board" | "table";

type Props = {
  view: ListView;
  onView: (view: ListView) => void;
  status: ListStatusFilter;
  onStatus: (status: ListStatusFilter) => void;
  query: string;
  onQuery: (query: string) => void;
  assignees: Person[];
  assigneeId: string | null;
  onAssignee: (id: string | null) => void;
};

export function ListThingsToolbar(props: Props) {
  const activeFilters = props.status !== "all" || props.assigneeId || props.query;
  return (
    <div className="mb-4 space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-8 min-w-52 flex-1 items-center gap-2 rounded-lg border border-border px-2.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder="Search Things" className="w-full bg-transparent text-[12px] outline-none" />
        </label>
        <div className="ml-auto flex rounded-lg border border-border p-0.5" aria-label="List view">
          <button type="button" aria-label="Board" onClick={() => props.onView("board")} className={cn("rounded-md p-1.5", props.view === "board" && "bg-muted text-primary")}><LayoutGrid className="h-4 w-4" /></button>
          <button type="button" aria-label="Table" onClick={() => props.onView("table")} className={cn("rounded-md p-1.5", props.view === "table" && "bg-muted text-primary")}><List className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {(["all", "due", "waiting", "progress", "completed"] as const).map((status) => (
          <button key={status} type="button" onClick={() => props.onStatus(status)} className={cn("rounded-full border px-2.5 py-1 text-[11px] capitalize", props.status === status ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
            {status === "due" ? "Due" : status === "progress" ? "In Progress" : status}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        {props.assignees.map((person) => (
          <button key={person.id} type="button" title={person.name} aria-label={`Filter by ${person.name}`} onClick={() => props.onAssignee(props.assigneeId === person.id ? null : person.id)} className={cn("rounded-full p-0.5", props.assigneeId === person.id && "ring-2 ring-primary ring-offset-1")}>
            <PersonAvatar name={person.name} initials={person.initials} src={person.avatarUrl} size={24} />
          </button>
        ))}
        {activeFilters ? (
          <button type="button" onClick={() => { props.onStatus("all"); props.onAssignee(null); props.onQuery(""); }} className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><X className="h-3 w-3" />Clear</button>
        ) : null}
      </div>
    </div>
  );
}
