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
type DemoSessionLike = {
  user?: { id?: string; user_metadata?: Record<string, unknown> };
} | null | undefined;

export function setDemoActorForTests(actorId: string | null) {
  demoActorOverride = actorId;
}

export function resolveDemoActorId(
  session: DemoSessionLike,
): string {
  const explicitActorId = session?.user?.user_metadata?.actor_id;
  if (typeof explicitActorId === "string" && explicitActorId) return explicitActorId;
  const personaKey =
    (session?.user?.user_metadata?.persona_key as string | undefined) ??
    session?.user?.id?.replace(/^demo-/, "");
  return DEMO_ACTOR_BY_KEY[personaKey ?? ""]?.id ?? "p-priya";
}

export function resolveDemoPerson(session: DemoSessionLike): Person {
  const id = resolveDemoActorId(session);
  const canonical = Object.values(DEMO_ACTOR_BY_KEY).find((person) => person.id === id);
  if (canonical) return canonical;
  const name = session?.user?.user_metadata?.display_name;
  const initials = session?.user?.user_metadata?.initials;
  return {
    id,
    name: typeof name === "string" && name ? name : "You",
    initials: typeof initials === "string" && initials ? initials : "YO",
  };
}

export function currentDemoActorId(): string {
  if (demoActorOverride) return demoActorOverride;
  return resolveDemoActorId(getStoredDemoSession());
}

export function currentDemoPerson(): Person {
  if (demoActorOverride) {
    const hit = Object.values(DEMO_ACTOR_BY_KEY).find((person) => person.id === demoActorOverride);
    return hit ?? { id: demoActorOverride, name: "You", initials: "YO" };
  }
  return resolveDemoPerson(getStoredDemoSession());
}

export function demoDirectory(): Person[] {
  return Object.values(DEMO_ACTOR_BY_KEY);
}
