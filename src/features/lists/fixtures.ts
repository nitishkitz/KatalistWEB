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
  description?: string | null;
  coverStoragePath?: string | null;
  context: ListContext;
  role: ListRole;
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
    members: [
      { actorId: "p-priya", role: "owner", initials: "PS", name: "Priya Sharma" },
      { actorId: "p-rahul", role: "collaborator", initials: "RM", name: "Rahul Mehta" },
      { actorId: "p-sai", role: "collaborator", initials: "SA", name: "Sai" },
      { actorId: "p-arjun", role: "collaborator", initials: "AM", name: "Arjun Mehta" },
    ],
    memberCount: 4, thingCount: 18, doneCount: 7, inProgressCount: 4, unread: 3,
    latestActivity: "Sai caught \"Prepare release notes\"",
    updatedAt: "12m ago", color: "bg-violet-500",
  },
  {
    id: "l2", name: "Mobile App Launch", context: "work", role: "owner",
    ownerActorId: "p-priya", ownerLine: "Owned by Priya Sharma",
    members: [
      { actorId: "p-priya", role: "owner", initials: "PS", name: "Priya Sharma" },
      { actorId: "p-neha", role: "collaborator", initials: "NR", name: "Neha Rao" },
      { actorId: "p-mike", role: "collaborator", initials: "MF", name: "Mike Fernandes" },
      { actorId: "p-arjun", role: "view_only", initials: "AM", name: "Arjun Mehta" },
    ],
    memberCount: 4, thingCount: 12, doneCount: 3, inProgressCount: 5, unread: 1,
    latestActivity: "Arjun waiting on QA coordination", updatedAt: "1h ago", color: "bg-sky-500",
  },
  {
    id: "l3", name: "Website Launch", context: "work", role: "collaborator",
    ownerActorId: "p-priya", ownerLine: "Owned by Priya Sharma",
    members: [
      { actorId: "p-priya", role: "owner", initials: "PS", name: "Priya Sharma" },
      { actorId: "p-rahul", role: "collaborator", initials: "RM", name: "Rahul Mehta" },
      { actorId: "p-sarah", role: "view_only", initials: "SK", name: "Sarah Kapoor" },
    ],
    memberCount: 3, thingCount: 22, doneCount: 9, inProgressCount: 6, unread: 0,
    latestActivity: "Priya updated launch copy", updatedAt: "3h ago", color: "bg-emerald-500",
  },
  {
    id: "l4", name: "Q3 Marketing Plan", context: "work", role: "collaborator",
    ownerActorId: "p-sarah", ownerLine: "Owned by Sarah Kapoor",
    members: [
      { actorId: "p-sarah", role: "owner", initials: "SK", name: "Sarah Kapoor" },
      { actorId: "p-arjun", role: "collaborator", initials: "AM", name: "Arjun Mehta" },
      { actorId: "p-priya", role: "view_only", initials: "PS", name: "Priya Sharma" },
    ],
    memberCount: 3, thingCount: 9, doneCount: 2, inProgressCount: 2, unread: 2,
    latestActivity: "Sarah added campaign brief", updatedAt: "Yesterday", color: "bg-amber-500",
  },
  {
    id: "l5", name: "Office Move Checklist", context: "home", role: "view_only",
    ownerActorId: "p-neha", ownerLine: "Owned by Neha Rao",
    members: [
      { actorId: "p-neha", role: "owner", initials: "NR", name: "Neha Rao" },
      { actorId: "p-priya", role: "view_only", initials: "PS", name: "Priya Sharma" },
    ],
    memberCount: 2, thingCount: 14, doneCount: 8, inProgressCount: 1, unread: 0,
    latestActivity: "Neha marked 2 items Sorted", updatedAt: "2d ago", color: "bg-rose-500",
  },
];
