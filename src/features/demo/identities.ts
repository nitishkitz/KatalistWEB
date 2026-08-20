import type { Person } from "@/domain/thing";
import { getStoredDemoSession } from "@/hooks/useSession";

export const DEMO_ACTOR_BY_KEY: Record<string, { id: string; name: string; initials: string }> = {
  priya: { id: "p-priya", name: "Priya Sharma", initials: "PS" },
  arjun: { id: "p-arjun", name: "Arjun Mehta", initials: "AM" },
  sarah: { id: "p-sarah", name: "Sarah Kapoor", initials: "SK" },
  mike: { id: "p-mike", name: "Mike Fernandes", initials: "MF" },
  neha: { id: "p-neha", name: "Neha Rao", initials: "NR" },
  rahul: { id: "p-rahul", name: "Rahul Mehta", initials: "RM" },
  sai: { id: "p-sai", name: "Sai", initials: "SA" },
};

/** Test-only persona override. Null restores session-based resolution. */
let demoActorOverride: string | null = null;

export function setDemoActorForTests(actorId: string | null) {
  demoActorOverride = actorId;
}

export function currentDemoActorId(): string {
  if (demoActorOverride) return demoActorOverride;
  const session = getStoredDemoSession();
  const personaKey =
    (session?.user.user_metadata?.persona_key as string | undefined) ??
    session?.user.id?.replace(/^demo-/, "");
  return DEMO_ACTOR_BY_KEY[personaKey ?? ""]?.id ?? "p-priya";
}

export function currentDemoPerson(): Person {
  const id = currentDemoActorId();
  const hit = Object.values(DEMO_ACTOR_BY_KEY).find((p) => p.id === id);
  return hit ?? { id, name: "You", initials: "YO" };
}

export function demoDirectory(): Person[] {
  return Object.values(DEMO_ACTOR_BY_KEY);
}
