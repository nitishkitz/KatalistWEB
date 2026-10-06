export type ListRole = "owner" | "collaborator" | "view_only";
export type ListContext = "work" | "home";

export type ListMember = {
  profileId?: string;
  actorId?: string;
  role?: ListRole;
  initials: string;
  name: string;
  avatarUrl?: string | null;
};

export type ListRow = {
  id: string;
  name: string;
  context: ListContext;
  role: ListRole;
  description?: string | null;
  coverUrl?: string | null;
  ownerLine: string;
  ownerActorId?: string;
  members: ListMember[];
  memberCount: number;
  thingCount: number;
  doneCount: number;
  inProgressCount: number;
  unread: number;
  latestActivity: string;
  updatedAt: string;
  /** Machine-readable source used for ordering and <time dateTime>. */
  updatedAtIso?: string | null;
  color: string;
};

export const listFixtures: ListRow[] = [
  {
    id: "l1",
    name: "Android Release",
    context: "work",
    role: "owner",
    ownerActorId: "p-priya",
    ownerLine: "Owned by Priya Sharma",
    description: "Release readiness for Android 8.4 — QA, store assets, rollout communication, and launch-day ownership.",
    members: [
      { actorId: "p-priya", role: "owner", initials: "PS", name: "Priya Sharma" },
      { actorId: "p-rahul", role: "collaborator", initials: "RM", name: "Rahul Mehta" },
      { actorId: "p-sai", role: "collaborator", initials: "SA", name: "Sai" },
      { actorId: "p-arjun", role: "collaborator", initials: "AM", name: "Arjun Mehta" },
    ],
    memberCount: 4, thingCount: 18, doneCount: 7, inProgressCount: 4, unread: 3,
    latestActivity: "Rahul moved release notes to Under Progress",
    updatedAt: "12m ago", updatedAtIso: "2026-10-05T17:48:00.000Z", color: "bg-violet-500",
  },
  {
    id: "l2", name: "Mobile App Launch", context: "work", role: "owner",
    ownerActorId: "p-priya", ownerLine: "Owned by Priya Sharma",
    description: "Coordinating the iOS and Android launch, beta feedback, support readiness, and store review milestones.",
    members: [
      { actorId: "p-priya", role: "owner", initials: "PS", name: "Priya Sharma" },
      { actorId: "p-neha", role: "collaborator", initials: "NR", name: "Neha Rao" },
      { actorId: "p-mike", role: "collaborator", initials: "MF", name: "Mike Fernandes" },
      { actorId: "p-arjun", role: "view_only", initials: "AM", name: "Arjun Mehta" },
    ],
    memberCount: 4, thingCount: 12, doneCount: 3, inProgressCount: 5, unread: 1,
    latestActivity: "Arjun attached the final QA evidence", updatedAt: "1h ago", updatedAtIso: "2026-10-05T17:00:00.000Z", color: "bg-sky-500",
  },
  {
    id: "l3", name: "Website Launch", context: "work", role: "collaborator",
    ownerActorId: "p-priya", ownerLine: "Owned by Priya Sharma",
    description: "Homepage, launch narrative, SEO checks, analytics, and the coordinated publishing plan.",
    members: [
      { actorId: "p-priya", role: "owner", initials: "PS", name: "Priya Sharma" },
      { actorId: "p-rahul", role: "collaborator", initials: "RM", name: "Rahul Mehta" },
      { actorId: "p-sarah", role: "view_only", initials: "SK", name: "Sarah Kapoor" },
    ],
    memberCount: 3, thingCount: 22, doneCount: 9, inProgressCount: 6, unread: 0,
    latestActivity: "Sarah approved the homepage narrative", updatedAt: "3h ago", updatedAtIso: "2026-10-05T15:00:00.000Z", color: "bg-emerald-500",
  },
  {
    id: "l4", name: "Q4 Growth Plan", context: "work", role: "collaborator",
    ownerActorId: "p-sarah", ownerLine: "Owned by Sarah Kapoor",
    description: "Campaign calendar, channel experiments, launch moments, and the weekly growth scorecard.",
    members: [
      { actorId: "p-sarah", role: "owner", initials: "SK", name: "Sarah Kapoor" },
      { actorId: "p-arjun", role: "collaborator", initials: "AM", name: "Arjun Mehta" },
      { actorId: "p-priya", role: "view_only", initials: "PS", name: "Priya Sharma" },
    ],
    memberCount: 3, thingCount: 9, doneCount: 2, inProgressCount: 2, unread: 2,
    latestActivity: "Sarah added the October campaign brief", updatedAt: "Yesterday", updatedAtIso: "2026-10-04T12:00:00.000Z", color: "bg-amber-500",
  },
  {
    id: "l5", name: "Office Move Checklist", context: "home", role: "view_only",
    ownerActorId: "p-neha", ownerLine: "Owned by Neha Rao",
    description: "Facilities, access cards, vendor handoffs, and the first-week office readiness checklist.",
    members: [
      { actorId: "p-neha", role: "owner", initials: "NR", name: "Neha Rao" },
      { actorId: "p-priya", role: "view_only", initials: "PS", name: "Priya Sharma" },
    ],
    memberCount: 2, thingCount: 14, doneCount: 8, inProgressCount: 1, unread: 0,
    latestActivity: "Neha completed the access-card handoff", updatedAt: "2d ago", updatedAtIso: "2026-10-03T12:00:00.000Z", color: "bg-rose-500",
  },
  {
    id: "l6", name: "Family Trip to Goa", context: "home", role: "owner",
    ownerActorId: "p-priya", ownerLine: "Owned by Priya Sharma",
    description: "Flights, the hotel, packing and who is picking up Mom on the way to the airport.",
    members: [
      { actorId: "p-priya", role: "owner", initials: "PS", name: "Priya Sharma" },
      { actorId: "p-neha", role: "collaborator", initials: "NR", name: "Neha Rao" },
      { actorId: "p-arjun", role: "collaborator", initials: "AM", name: "Arjun Mehta" },
    ],
    memberCount: 3, thingCount: 7, doneCount: 2, inProgressCount: 2, unread: 2,
    latestActivity: "Arjun shared the hotel photos", updatedAt: "1h ago", updatedAtIso: "2026-10-05T17:10:00.000Z", color: "bg-cyan-500",
  },
  {
    id: "l7", name: "Home Renovation", context: "home", role: "owner",
    ownerActorId: "p-priya", ownerLine: "Owned by Priya Sharma",
    description: "Bathroom tiles, the painter's quote and the kitchen lights.",
    members: [
      { actorId: "p-priya", role: "owner", initials: "PS", name: "Priya Sharma" },
      { actorId: "p-mike", role: "collaborator", initials: "MF", name: "Mike Fernandes" },
    ],
    memberCount: 2, thingCount: 6, doneCount: 3, inProgressCount: 1, unread: 0,
    latestActivity: "Mike sorted the tile order", updatedAt: "5h ago", updatedAtIso: "2026-10-05T13:00:00.000Z", color: "bg-orange-500",
  },
];
