import { useMemo, useState } from "react";
import { Mic, Sparkles } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { useAppContext } from "@/features/context/use-app-context";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { rpcCreateThing } from "@/features/things/rpc";
import { useAssignablePeople } from "@/features/people/use-assignable";
import { isPreviewMode } from "@/lib/session-mode";
import { parseToss, tossBlockedByPerson } from "./parse-toss";

export function MagicBox({ listId, listName }: { listId?: string; listName?: string }) {
  const [value, setValue] = useState("");
  const [tossed, setTossed] = useState(false);
  const { context } = useAppContext();
  const qc = useQueryClient();
  const people = useAssignablePeople();
  const parsed = useMemo(() => parseToss(value, people), [value, people]);
  const blocked = tossBlockedByPerson(parsed.chips);

  const mutation = useMutation({
    mutationFn: async () => {
      if (blocked) throw new Error("Pick a person — Coey won’t guess.");
      const live = !isPreviewMode();
      const assignee = live && parsed.assigneeId?.startsWith("p-") ? undefined : parsed.assigneeId;
      return rpcCreateThing({
        title: parsed.title,
        context,
        ownerImportance: parsed.importance,
        listId,
        assigneeActorId: assignee,
        dueAt: parsed.dueAt,
        dueHasTime: parsed.dueHasTime,
      });
    },
    onSuccess: async () => {
      setTossed(true);
      setValue("");
      await qc.invalidateQueries({ queryKey: keys.court("preview", context) });
      await qc.invalidateQueries({ queryKey: ["court"] });
      toast.success("Tossed.");
      window.setTimeout(() => setTossed(false), 240);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Couldn’t toss that.");
    },
  });

  return (
    <div className="mb-3">
      <div
        className={cn(
          "flex h-11 items-center gap-3 rounded-xl border border-border bg-card px-3.5 transition-opacity duration-200",
          tossed && "opacity-60",
        )}
      >
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) void mutation.mutate();
          }}
          placeholder={listName ? `Toss into ${listName}…` : "Toss a thought..."}
          className="h-full flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
          aria-label="Magic Box"
        />
        <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
          ⌘K
        </kbd>
        <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Voice input">
          <Mic className="h-4 w-4" />
        </button>
      </div>
      {parsed.chips.length > 0 && value.trim() ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {parsed.chips.map((c) => (
            <span
              key={c.kind + c.value}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                c.kind === "unresolved"
                  ? "border-status-waiting/40 bg-status-waiting-bg text-status-waiting"
                  : "border-border bg-card text-foreground",
              )}
            >
              {c.kind === "unresolved" ? c.label : `${c.kind === "assignee" ? "@" : ""}${c.label}`}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
