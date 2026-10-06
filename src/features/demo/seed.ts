/**
 * Demo-mode seed content for the surfaces whose live data comes only from
 * Supabase: the Team roster (Contacts pile), presence, list chat, the Team
 * rail and notifications. Read only in preview sessions; never sent anywhere.
 *
 * Roster ids are UUID-shaped because the Contacts pile only renders people
 * with real profile ids (ContactsDialog filters with isUuid).
 */
import type { TeamMember } from "@/features/people/use-team";
import type { ChatAttachment } from "@/features/lists/use-list-messages";

const demoUuid = (n: number) => `00000000-de00-4000-8000-${String(n).padStart(12, "0")}`;

type RosterSeed = { key: string; name: string; role: string; online?: boolean };

const ROSTER: RosterSeed[] = [
  { key: "priya", name: "Priya Sharma", role: "Operations Manager", online: true },
  { key: "rahul", name: "Rahul Mehta", role: "Launch Lead", online: true },
  { key: "arjun", name: "Arjun Mehta", role: "Quality Lead" },
  { key: "sarah", name: "Sarah Kapoor", role: "Marketing Director", online: true },
  { key: "mike", name: "Mike Fernandes", role: "Event Producer" },
  { key: "neha", name: "Neha Rao", role: "Customer Success", online: true },
  { key: "sai", name: "Sai", role: "Photographer" },
  { key: "nithesh", name: "Nithesh", role: "Founder" },
  { key: "sudheer", name: "Sudheer", role: "Finance Partner" },
  { key: "rohit", name: "Rohit", role: "Field Operations" },
  { key: "ananya", name: "Ananya Iyer", role: "Wedding Planner", online: true },
  { key: "kabir", name: "Kabir Khanna", role: "Architect" },
  { key: "meera", name: "Meera Pillai", role: "School Principal" },
  { key: "daniel", name: "Daniel Thomas", role: "Account Manager", online: true },
  { key: "fatima", name: "Fatima Sheikh", role: "Interior Designer" },
  { key: "vikram", name: "Vikram Rao", role: "Contractor" },
  { key: "zoya", name: "Zoya Ali", role: "Content Creator" },
  { key: "arun", name: "Arun Nair", role: "Travel Agent" },
  { key: "emily", name: "Emily Carter", role: "Client Partner" },
  { key: "joseph", name: "Joseph D'Souza", role: "Caterer" },
  { key: "mom", name: "Lakshmi Menon", role: "Mom", online: true },
];

const initialsOf = (name: string) =>
  name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";

export const DEMO_ROSTER: TeamMember[] = ROSTER.map((p, i) => ({
  id: demoUuid(i + 1),
  name: p.name,
  initials: initialsOf(p.name),
  // Missing files fall back to initials inside PersonAvatar.
  avatarUrl: `/avatars/${p.key}.jpg`,
  role: p.role,
  email: null,
  phone: null,
  connectedSince: null,
}));

export const DEMO_ONLINE_IDS: ReadonlySet<string> = new Set(
  ROSTER.flatMap((p, i) => (p.online ? [demoUuid(i + 1)] : [])),
);

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export type SeedMessage = {
  id: string;
  body: string;
  author: string;
  at: string;
  kind?: "message" | "system";
  attachment?: ChatAttachment | null;
};

const image = (key: string, name: string, size: number): ChatAttachment => ({
  key: `demo/${key}`,
  name,
  mime: "image/jpeg",
  size,
  url: `/demo/film/${key}`,
});

/** Seeded list chat, keyed by list id. Lists without an entry start empty. */
export const SEED_LIST_MESSAGES: Record<string, SeedMessage[]> = {
  l1: [
    { id: "seed-l1-1", author: "Rahul Mehta", at: minutesAgo(52), body: "Morning! Release checklist is up. @Priya can you take the final pass?" },
    { id: "seed-l1-2", author: "Arjun Mehta", at: minutesAgo(47), body: "QA evidence is attached to the Thing. Two fixes left." },
    { id: "seed-l1-3", author: "Neha Rao", at: minutesAgo(41), kind: "system", body: "started a call" },
    { id: "seed-l1-4", author: "Rahul Mehta", at: minutesAgo(33), body: "Whiteboard from the call 👇", attachment: image("att-whiteboard.jpg", "whiteboard.jpg", 412_000) },
    { id: "seed-l1-5", author: "Priya Sharma", at: minutesAgo(29), body: "Caught it. I'll sort the checklist before 2." },
    { id: "seed-l1-6", author: "Sai", at: minutesAgo(12), body: "Rollout flow for reference", attachment: { key: "demo/release-flow", name: "Release-flow.svg", mime: "image/svg+xml", size: 18_400, url: "/demo/release-flow-preview.svg" } },
  ],
  l3: [
    { id: "seed-l3-1", author: "Sarah Kapoor", at: minutesAgo(180), body: "Homepage copy is approved 🎉" },
    { id: "seed-l3-2", author: "Mike Fernandes", at: minutesAgo(170), body: "Found the venue for the launch event!", attachment: image("att-venue.jpg", "venue.jpg", 655_000) },
    { id: "seed-l3-3", author: "Priya Sharma", at: minutesAgo(160), body: "Love it. @Sai can you book the photographer?" },
  ],
  l6: [
    { id: "seed-l6-1", author: "Neha Rao", at: minutesAgo(95), body: "Flights look cheapest on the 19th ✈️" },
    { id: "seed-l6-2", author: "Arjun Mehta", at: minutesAgo(88), body: "This is the hotel Mom liked", attachment: image("att-itinerary-photo.jpg", "hotel.jpg", 530_000) },
    { id: "seed-l6-3", author: "Priya Sharma", at: minutesAgo(80), body: "Tossed it — Neha, can you book by Friday?" },
  ],
  l7: [
    { id: "seed-l7-1", author: "Mike Fernandes", at: minutesAgo(300), body: "Tile samples from the store", attachment: image("att-tiles.jpg", "tiles.jpg", 480_000) },
    { id: "seed-l7-2", author: "Priya Sharma", at: minutesAgo(290), body: "The left one. Let's order Monday." },
  ],
};

export type SeedNotification = {
  id: string;
  recipientActorId: string;
  title: string;
  body: string;
  at: string;
  thingId?: string;
  type?: string;
};

/** Seeded notifications per demo recipient. */
export const SEED_NOTIFICATIONS: SeedNotification[] = [
  { id: "seed-n0", recipientActorId: "p-priya", title: "Your morning brief is ready", body: "3 Things need you today, 2 are waiting on others.", at: minutesAgo(3), type: "morning_brief" },
  { id: "seed-n1", recipientActorId: "p-priya", title: "Rahul tossed you a Thing", body: "Approve the final release checklist", at: minutesAgo(6), thingId: "now-more-0", type: "thing_assigned" },
  { id: "seed-n2", recipientActorId: "p-priya", title: "Rahul nudged you", body: "Resolve the checkout analytics gap", at: minutesAgo(18), thingId: "now-more-1", type: "nudged" },
  { id: "seed-n3", recipientActorId: "p-priya", title: "Sarah caught your Thing", body: "Publish the beta feedback summary", at: minutesAgo(44), thingId: "next-more-0", type: "thing_caught" },
  { id: "seed-n4", recipientActorId: "p-priya", title: "New message in Family Trip to Goa", body: "Neha: Flights look cheapest on the 19th", at: minutesAgo(95), type: "list_message" },
  { id: "seed-n5", recipientActorId: "p-priya", title: "Mike sorted a Thing", body: "Pick tiles for the bathroom", at: minutesAgo(240), type: "thing_sorted" },
];
