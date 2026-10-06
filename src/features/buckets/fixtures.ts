export type BucketCard = {
  id: string;
  name: string;
  description: string;
  color: string;
  pinned: boolean;
  thingCount: number;
  listCount: number;
  progressCompleted?: number;
  progressTotal?: number;
  updatedAt: string;
  ownerActorId?: string;
  context: "work" | "home";
  thingIds?: string[];
  tags?: string[];
  collaborators?: {
    id: string;
    name: string;
    avatarUrl?: string | null;
    initials: string;
  }[];
  previews: {
    title: string;
    kind: "thing" | "list";
    state?: string;
    thingId?: string;
    listId?: string;
  }[];
};

export const bucketFixtures: BucketCard[] = [
  {
    id: "b1",
    name: "Android Ship Week",
    description: "Everything needed to ship the Play Store build",
    color: "bg-violet-500",
    pinned: true,
    thingCount: 14,
    listCount: 2,
    progressCompleted: 9,
    progressTotal: 14,
    updatedAt: "Updated 20m ago",
    ownerActorId: "p-priya",
    context: "work",
    collaborators: [
      { id: "p-priya", name: "Priya Sharma", initials: "PS", avatarUrl: "/avatars/priya.jpg" },
      { id: "p-rahul", name: "Rahul Mehta", initials: "RM", avatarUrl: "/avatars/rahul.jpg" },
      { id: "p-arjun", name: "Arjun Mehta", initials: "AM", avatarUrl: "/avatars/arjun.jpg" },
    ],
    previews: [
      { title: "Finalize Play Store wording", kind: "thing", state: "NOW", thingId: "t1" },
      { title: "Prepare release notes", kind: "thing", state: "Progress", thingId: "t3" },
      { title: "Android Release", kind: "list", listId: "l1" },
    ],
  },
  {
    id: "b2",
    name: "Website Launch Focus",
    description: "Copy, domain, photographer, launch checklist",
    color: "bg-sky-500",
    pinned: true,
    thingCount: 9,
    listCount: 1,
    progressCompleted: 6,
    progressTotal: 9,
    updatedAt: "Updated 2h ago",
    ownerActorId: "p-priya",
    context: "work",
    collaborators: [
      { id: "p-priya", name: "Priya Sharma", initials: "PS", avatarUrl: "/avatars/priya.jpg" },
      { id: "p-sarah", name: "Sarah Kapoor", initials: "SK", avatarUrl: "/avatars/sarah.jpg" },
    ],
    previews: [
      { title: "Review website launch copy", kind: "thing", state: "NEXT", thingId: "t6" },
      { title: "Book launch photographer", kind: "thing", state: "NEXT", thingId: "t7" },
      { title: "Website Launch", kind: "list", listId: "l3" },
    ],
  },
  {
    id: "b3",
    name: "Home Admin",
    description: "Personal ops and household follow-ups",
    color: "bg-amber-500",
    pinned: true,
    thingCount: 6,
    listCount: 0,
    progressCompleted: 4,
    progressTotal: 6,
    updatedAt: "Updated yesterday",
    ownerActorId: "p-priya",
    context: "home",
    previews: [],
  },
  {
    id: "b4",
    name: "Vendor Follow-ups",
    description: "People and threads that need a gentle push",
    color: "bg-rose-500",
    pinned: false,
    thingCount: 11,
    listCount: 0,
    progressCompleted: 7,
    progressTotal: 11,
    updatedAt: "Updated 3d ago",
    ownerActorId: "p-priya",
    context: "work",
    previews: [
      { title: "Call vendor for shoot confirmation", kind: "thing", state: "NOW", thingId: "t2" },
    ],
  },
  {
    id: "b5",
    name: "Q4 Growth Planning",
    description: "October experiments, channel bets, and weekly growth reviews",
    color: "bg-emerald-500",
    pinned: false,
    thingCount: 8,
    listCount: 1,
    progressCompleted: 3,
    progressTotal: 8,
    updatedAt: "Updated 5d ago",
    ownerActorId: "p-priya",
    context: "work",
    previews: [{ title: "Q4 Growth Plan", kind: "list", listId: "l4" }],
  },
  {
    id: "b6",
    name: "Team Onboarding",
    description: "New joiner checklist and docs",
    color: "bg-indigo-500",
    pinned: false,
    thingCount: 5,
    listCount: 1,
    progressCompleted: 2,
    progressTotal: 5,
    updatedAt: "Updated 1w ago",
    ownerActorId: "p-priya",
    context: "work",
    previews: [],
  },
];
