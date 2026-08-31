import { useMemo, useRef, useState } from "react";
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
import { KatalistIcon, type KatalistIconName } from "./KatalistIcon";

export function MagicBox({
  listId,
  listName,
  desktop = false,
}: {
  listId?: string;
  listName?: string;
  desktop?: boolean;
}) {
  const [value, setValue] = useState("");
  const [tossed, setTossed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
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
  const canToss = Boolean(value.trim()) && !blocked && !mutation.isPending;

  return (
    <div
      className={cn(
        "mb-3",
        desktop &&
          "fixed bottom-3 left-[calc(50%+6.5rem)] z-50 mb-0 w-[min(840px,calc(100vw-18rem))] -translate-x-1/2",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 transition-opacity duration-200",
          desktop
            ? "h-[58px] rounded-[18px] border border-primary/70 bg-white px-4 shadow-[0_0_28px_rgba(88,71,255,0.2)]"
            : "rounded-xl border border-border bg-card px-1.5",
          tossed && "opacity-60",
        )}
      >
        {desktop ? (
          <KatalistIcon name="katalist-spark" className="h-4 w-4 shrink-0 text-primary" />
        ) : (
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim() && !blocked && !mutation.isPending)
              void mutation.mutate();
          }}
          placeholder={listName ? `Toss into ${listName}…` : "Toss a thought..."}
          className="h-full flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
          aria-label="Magic Box"
        />
        <kbd
          className={cn(
            "hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline",
            desktop ? "bg-white" : "bg-muted",
          )}
        >
          ⌘K
        </kbd>
        {desktop ? (
          <>
            {(["@", "#"] as const).map((token) => (
              <button
                key={token}
                type="button"
                onClick={() => {
                  const input = inputRef.current;
                  const start = input?.selectionStart ?? value.length;
                  const end = input?.selectionEnd ?? start;
                  const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
                  setValue(next);
                  requestAnimationFrame(() => {
                    input?.focus();
                    input?.setSelectionRange(start + 1, start + 1);
                  });
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[18px] text-muted-foreground outline-none hover:bg-primary/5 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={token === "@" ? "Insert @ person" : "Insert # list"}
              >
                {token}
              </button>
            ))}
            {value ? (
              <button
                type="button"
                onClick={() => setValue("")}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Clear Magic Box"
                title="Clear input"
              >
                <KatalistIcon name="clear-input" className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="button"
              disabled={!canToss}
              onClick={() => void mutation.mutate()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white shadow-[0_6px_16px_rgba(88,71,255,0.28)] outline-none disabled:cursor-not-allowed disabled:bg-primary/30 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Toss Thing"
              title="Toss Thing"
            >
              <KatalistIcon name="send-toss" className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Voice input"
          >
            <Mic className="h-4 w-4" />
          </button>
        )}
      </div>
      {parsed.chips.length > 0 && value.trim() ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {parsed.chips.map((c) => (
            <span
              key={c.kind + c.value}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                desktop && "inline-flex items-center gap-1 bg-white",
                c.kind === "unresolved"
                  ? desktop
                    ? "border-status-waiting/50 text-status-waiting"
                    : "border-status-waiting/40 bg-status-waiting-bg text-status-waiting"
                  : desktop
                    ? "border-border text-foreground"
                    : "border-border bg-card text-foreground",
              )}
            >
              {desktop ? (
                <KatalistIcon
                  name={
                    (
                      {
                        assignee: "at-person",
                        due: "date-detection",
                        importance: "urgent",
                        unresolved: "urgent",
                      } satisfies Record<typeof c.kind, KatalistIconName>
                    )[c.kind]
                  }
                  className="h-3 w-3"
                />
              ) : null}
              {c.kind === "unresolved" ? c.label : `${c.kind === "assignee" ? "@" : ""}${c.label}`}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
