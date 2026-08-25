import { LayoutGrid, List, Search, X } from "lucide-react";
import type { Person } from "@/domain/thing";
import type { ListStatusFilter } from "./list-board-model";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          Status
          <Select value={props.status} onValueChange={(value) => props.onStatus(value as ListStatusFilter)}>
            <SelectTrigger className="h-8 w-44 text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="due">Due / Overdue</SelectItem>
              <SelectItem value="waiting">Waiting for Catch</SelectItem>
              <SelectItem value="not_started">Not Started</SelectItem>
              <SelectItem value="progress">Under Progress</SelectItem>
              <SelectItem value="sorted">Sorted</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          Assignee
          <Select value={props.assigneeId ?? "all"} onValueChange={(value) => props.onAssignee(value === "all" ? null : value)}>
            <SelectTrigger className="h-8 w-48 text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All people</SelectItem>
              {props.assignees.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        {activeFilters ? (
          <button type="button" onClick={() => { props.onStatus("all"); props.onAssignee(null); props.onQuery(""); }} className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><X className="h-3 w-3" />Clear</button>
        ) : null}
      </div>
    </div>
  );
}
