export type BucketCard = {
  id: string;
  name: string;
  description: string;
  color: string;
  pinned: boolean;
  thingCount: number;
  listCount: number;
  updatedAt: string;
  ownerActorId?: string;
  context: "work" | "home";
  thingIds?: string[];
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
    updatedAt: "Updated 20m ago",
    ownerActorId: "p-priya",
    context: "work",
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
    updatedAt: "Updated 2h ago",
    ownerActorId: "p-priya",
    context: "work",
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
    updatedAt: "Updated 3d ago",
    ownerActorId: "p-priya",
    context: "work",
    previews: [
      { title: "Call vendor for shoot confirmation", kind: "thing", state: "NOW", thingId: "t2" },
    ],
  },
  {
    id: "b5",
    name: "Q3 Planning",
    description: "Strategy notes and roadmap threads",
    color: "bg-emerald-500",
    pinned: false,
    thingCount: 8,
    listCount: 1,
    updatedAt: "Updated 5d ago",
    ownerActorId: "p-priya",
    context: "work",
    previews: [{ title: "Q3 Marketing Plan", kind: "list", listId: "l4" }],
  },
  {
    id: "b6",
    name: "Team Onboarding",
    description: "New joiner checklist and docs",
    color: "bg-indigo-500",
    pinned: false,
    thingCount: 5,
    listCount: 1,
    updatedAt: "Updated 1w ago",
    ownerActorId: "p-priya",
    context: "work",
    previews: [],
  },
];
