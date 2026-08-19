export type ListRole = "owner" | "collaborator" | "view_only";
export type ListContext = "work" | "home";

export type ListRow = {
  id: string;
  name: string;
  context: ListContext;
  role: ListRole;
  ownerLine: string;
  members: { initials: string; name: string }[];
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
    ownerLine: "Owned by you",
    members: [
      { initials: "RM", name: "Rahul" },
      { initials: "SK", name: "Sai" },
      { initials: "AM", name: "Arjun" },
    ],
    memberCount: 5,
    thingCount: 18,
    doneCount: 7,
    inProgressCount: 4,
    unread: 3,
    latestActivity: "Sai caught “Prepare release notes”",
    updatedAt: "12m ago",
    color: "bg-violet-500",
  },
  {
    id: "l2",
    name: "Mobile App Launch",
    context: "work",
    role: "owner",
    ownerLine: "Owned by you",
    members: [
      { initials: "NR", name: "Neha" },
      { initials: "MF", name: "Mike" },
    ],
    memberCount: 4,
    thingCount: 12,
    doneCount: 3,
    inProgressCount: 5,
    unread: 1,
    latestActivity: "Arjun waiting on QA coordination",
    updatedAt: "1h ago",
    color: "bg-sky-500",
  },
  {
    id: "l3",
    name: "Website Launch",
    context: "work",
    role: "collaborator",
    ownerLine: "Owned by Priya Sharma",
    members: [
      { initials: "PS", name: "Priya" },
      { initials: "RM", name: "Rahul" },
    ],
    memberCount: 6,
    thingCount: 22,
    doneCount: 9,
    inProgressCount: 6,
    unread: 0,
    latestActivity: "Priya updated launch copy",
    updatedAt: "3h ago",
    color: "bg-emerald-500",
  },
  {
    id: "l4",
    name: "Q3 Marketing Plan",
    context: "work",
    role: "collaborator",
    ownerLine: "Owned by Sarah Kapoor",
    members: [
      { initials: "SK", name: "Sarah" },
      { initials: "AM", name: "Arjun" },
    ],
    memberCount: 3,
    thingCount: 9,
    doneCount: 2,
    inProgressCount: 2,
    unread: 2,
    latestActivity: "Sarah added campaign brief",
    updatedAt: "Yesterday",
    color: "bg-amber-500",
  },
  {
    id: "l5",
    name: "Office Move Checklist",
    context: "home",
    role: "view_only",
    ownerLine: "Owned by Neha Rao",
    members: [{ initials: "NR", name: "Neha" }],
    memberCount: 2,
    thingCount: 14,
    doneCount: 8,
    inProgressCount: 1,
    unread: 0,
    latestActivity: "Neha marked 2 items Sorted",
    updatedAt: "2d ago",
    color: "bg-rose-500",
  },
];
