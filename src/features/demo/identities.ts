import { getStoredDemoSession } from "@/hooks/useSession";
import type { Person } from "@/domain/thing";

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
  const demo = getStoredDemoSession();
  const key = (demo?.user.user_metadata?.persona_key as string | undefined) ?? demo?.user.id?.replace("demo-", "");
  if (key && DEMO_ACTOR_BY_KEY[key]) return DEMO_ACTOR_BY_KEY[key]!.id;
  return "p-priya";
}

export function currentDemoPerson(): Person {
  const id = currentDemoActorId();
  const hit = Object.values(DEMO_ACTOR_BY_KEY).find((p) => p.id === id);
  return hit ?? { id, name: "You", initials: "YO" };
}

export function demoDirectory(): Person[] {
  return Object.values(DEMO_ACTOR_BY_KEY);
}
