import { ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { listOptionId } from "./list-token";

export function ListAutocomplete({ composerId, lists, highlight, query, floating = false, onPick }: {
  composerId: string;
  lists: Array<{ id: string; name: string }>;
  highlight: number;
  query: string;
  floating?: boolean;
  onPick: (list: { id: string; name: string }, index: number) => void;
}) {
  return <ul role="listbox" id={`${composerId}-listbox`} aria-label="Lists" className={cn("absolute left-0 right-0 z-30 max-h-56 overflow-auto rounded-lg border border-border bg-popover py-1 shadow-md", floating ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]")}>
    {lists.length === 0 ? <li className="px-3 py-2 text-[12px] text-muted-foreground">No matching List.</li> : lists.map((list, index) => <li key={list.id} role="option" aria-selected={index === highlight} id={listOptionId(composerId, list.id)}>
      <button type="button" className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] outline-none", index === highlight ? "bg-muted" : "hover:bg-muted/70")} onMouseDown={(event) => { event.preventDefault(); onPick(list, index); }}>
        <ListChecks className="h-4 w-4 text-primary" /><span className="min-w-0 flex-1 truncate">{list.name}</span>{query && index === highlight ? <span className="text-[10px] text-muted-foreground">Tab</span> : null}
      </button>
    </li>)}
  </ul>;
}
