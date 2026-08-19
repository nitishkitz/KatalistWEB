import { useNavigate } from "@tanstack/react-router";
import { useAppContext } from "@/features/context/use-app-context";
import { useDoorman } from "./use-doorman";

export function GhostCard() {
  const { setContext } = useAppContext();
  const navigate = useNavigate();
  const { ghost, snooze } = useDoorman();
  if (!ghost) return null;

  const from = ghost.context === "work" ? "WORK BREAKTHROUGH" : "HOME BREAKTHROUGH";

  return (
    <aside className="pointer-events-auto fixed bottom-20 right-4 z-50 w-[320px] rounded-xl border border-border bg-card/90 p-3 shadow-sm backdrop-blur md:bottom-6">
      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground">{from}</p>
      <p className="mt-1 text-[13px] font-medium text-foreground">{ghost.title}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Time-sensitive in {ghost.context}. Same Thing — not a copy.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded-md bg-primary px-2.5 py-1 text-[12px] text-primary-foreground"
          onClick={() => {
            void setContext(ghost.context);
            void navigate({ to: "/" });
          }}
        >
          Switch context
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2.5 py-1 text-[12px]"
          onClick={() => void snooze.mutate(ghost.thingId)}
        >
          Later
        </button>
      </div>
    </aside>
  );
}
