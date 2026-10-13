import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useCoeyPresence, type CoeyPresence } from "./use-coey-presence";

const OPTIONS: Array<{ value: CoeyPresence; title: string; body: string }> = [
  { value: "full", title: "Full", body: "Coey’s full personality, briefings and small moments." },
  { value: "light", title: "Light", body: "Smaller moments, drier wit, no surprises." },
  { value: "quiet", title: "Quiet", body: "Only what keeps work moving: questions, follow-ups and handoffs. Nothing opens by itself." },
];

/** §12.9: applies immediately; functional moments continue in every setting. */
export function CoeyPresenceSettings() {
  const { presence, setPresence, saving } = useCoeyPresence();
  return (
    <fieldset className="space-y-2 text-[13px]">
      <legend className="sr-only">How present should Coey be?</legend>
      {OPTIONS.map((o) => (
        <label key={o.value} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2", presence === o.value ? "border-violet-400 bg-violet-50" : "border-border")}>
          <input type="radio" name="coey-presence" value={o.value} checked={presence === o.value} disabled={saving}
            onChange={() => void setPresence(o.value).then(() => toast.success(`Coey is now ${o.title}`), () => toast.error("Couldn’t save that. Try again."))}
            className="mt-1 accent-violet-600" />
          <span><span className="block font-semibold">{o.title}</span><span className="block text-[12px] text-muted-foreground">{o.body}</span></span>
        </label>
      ))}
    </fieldset>
  );
}
