export type BucketCard = {
  id: string;
  name: string;
  description: string;
  color: string;
  pinned: boolean;
  thingCount: number;
  listCount: number;
  updatedAt: string;
  previews: { title: string; kind: "thing" | "list"; state?: string }[];
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
    previews: [
      { title: "Finalize Play Store wording", kind: "thing", state: "NOW" },
      { title: "Prepare release notes", kind: "thing", state: "Progress" },
      { title: "Android Release", kind: "list" },
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
    previews: [
      { title: "Review website launch copy", kind: "thing", state: "NEXT" },
      { title: "Book launch photographer", kind: "thing", state: "NEXT" },
      { title: "Website Launch", kind: "list" },
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
    previews: [
      { title: "Renew insurance documents", kind: "thing", state: "LATER" },
      { title: "Schedule AC service", kind: "thing", state: "NEXT" },
    ],
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
    previews: [
      { title: "Call vendor for shoot confirmation", kind: "thing", state: "NOW" },
      { title: "Waiting on printer quote", kind: "thing", state: "Waiting" },
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
    previews: [
      { title: "Q3 Marketing Plan", kind: "list" },
      { title: "Draft OKR summary", kind: "thing", state: "LATER" },
    ],
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
    previews: [
      { title: "Share access checklist", kind: "thing", state: "NEXT" },
    ],
  },
];
