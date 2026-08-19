import { useMemo, useState } from "react";
import { Mic, Sparkles } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { keys } from "@/domain/query-keys";
import { useAppContext } from "@/features/context/use-app-context";
import { cn } from "@/lib/utils";
import type { Importance } from "@/domain/thing";
import { toast } from "sonner";
import { rpcCreateThing } from "@/features/things/rpc";
import { directoryPeople } from "@/features/things/local-state";

type Chip = { kind: "assignee" | "due" | "importance" | "unresolved"; label: string; value: string };

function parseToss(raw: string): { title: string; chips: Chip[]; importance: Importance; assigneeId?: string } {
  let title = raw.trim();
  const chips: Chip[] = [];
  let importance: Importance = "next";
  let assigneeId: string | undefined;

  const mention = title.match(/@([A-Za-z][\w.-]*)/);
  if (mention) {
    const people = directoryPeople();
    const hit = people.find((p) => p.name.toLowerCase().startsWith(mention[1].toLowerCase()));
    if (hit) {
      chips.push({ kind: "assignee", label: hit.name, value: hit.id });
      assigneeId = hit.id;
    } else {
      chips.push({ kind: "unresolved", label: `Who is @${mention[1]}?`, value: "person" });
    }
    title = title.replace(mention[0], "").trim();
  }

  if (/\bnow\b/i.test(title)) {
    importance = "now";
    chips.push({ kind: "importance", label: "NOW", value: "now" });
    title = title.replace(/\bnow\b/i, "").trim();
  } else if (/\blater\b/i.test(title)) {
    importance = "later";
    chips.push({ kind: "importance", label: "LATER", value: "later" });
    title = title.replace(/\blater\b/i, "").trim();
  } else {
    chips.push({ kind: "importance", label: "NEXT", value: "next" });
  }

  const dateMatch = title.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday)\b/i);
  if (dateMatch) {
    chips.push({ kind: "due", label: dateMatch[1], value: dateMatch[1] });
    title = title.replace(dateMatch[0], "").trim();
  }

  if (/\b\d{1,2}\/\d{1,2}\b/.test(raw) && !dateMatch) {
    chips.push({ kind: "unresolved", label: "Check date", value: "ambiguous" });
  }

  return { title: title || raw.trim(), chips, importance, assigneeId };
}

export function MagicBox({ listId, listName }: { listId?: string; listName?: string }) {
  const [value, setValue] = useState("");
  const [tossed, setTossed] = useState(false);
  const { context } = useAppContext();
  const qc = useQueryClient();
  const parsed = useMemo(() => parseToss(value), [value]);
  const blocked = parsed.chips.some((c) => c.kind === "unresolved" && c.value === "person");

  const mutation = useMutation({
    mutationFn: async () => {
      if (blocked) throw new Error("Pick a person — Coey won’t guess.");
      return rpcCreateThing({
        title: parsed.title,
        context,
        ownerImportance: parsed.importance,
        listId,
        assigneeActorId: parsed.assigneeId,
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
