import type { Thing } from "@/domain/thing";

const person = (id: string, name: string) => ({
  id,
  name,
  initials: name
    .split(" ")
    .map((n) => n[0])
    .join(""),
  avatarUrl: null as string | null,
});

const rahul = person("p-rahul", "Rahul Mehta");
const sai = person("p-sai", "Sai");
const priya = person("p-priya", "Priya Sharma");
const arjun = person("p-arjun", "Arjun Mehta");

function thing(partial: Partial<Thing> & Pick<Thing, "id" | "title">): Thing {
  return {
    creator: rahul,
    owner: rahul,
    assignee: priya,
    acknowledgement: "caught",
    workStatus: "not_started",
    ownerImportance: "next",
    personalPace: "now",
    dueAt: new Date().toISOString(),
    dueHasTime: false,
    context: "work",
    listId: "l1",
    listName: "Android Release",
    cancelledAt: null,
    sortedAt: null,
    caughtAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

const today = new Date();
const at = (h: number, m = 0) => {
  const d = new Date(today);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const days = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
};

export const MY_ACTOR_ID = "p-priya";

export const courtFixtures: Thing[] = [
  thing({
    id: "t1",
    title: "Finalize Play Store wording",
    assignee: rahul,
    ownerImportance: "now",
    personalPace: "now",
    workStatus: "under_progress",
    dueAt: at(17, 0),
    dueHasTime: true,
    listId: "l1",
    listName: "Android Release",
  }),
  thing({
    id: "t2",
    title: "Call vendor for shoot confirmation",
    assignee: sai,
    ownerImportance: "next",
    personalPace: "now",
    workStatus: "not_started",
    dueAt: at(12, 0),
    listId: "l2",
    listName: "Mobile App Launch",
  }),
  thing({
    id: "t3",
    title: "Prepare release notes",
    assignee: rahul,
    ownerImportance: "now",
    personalPace: "now",
    workStatus: "under_progress",
    dueAt: at(16, 0),
    listId: "l1",
    listName: "Android Release",
  }),
  thing({
    id: "t4",
    title: "Review in-app update flow",
    assignee: priya,
    ownerImportance: "next",
    personalPace: "now",
    workStatus: "not_started",
    dueAt: at(18, 0),
    listId: "l1",
    listName: "Android Release",
  }),
  thing({
    id: "t5",
    title: "Coordinate with QA on fixes",
    assignee: arjun,
    ownerImportance: "now",
    personalPace: "now",
    acknowledgement: "waiting_for_catch",
    workStatus: "not_started",
    dueAt: at(16, 0),
    dueHasTime: true,
    listId: "l2",
    listName: "Mobile App Launch",
    caughtAt: null,
  }),
  thing({
    id: "t6",
    title: "Review website launch copy",
    assignee: rahul,
    ownerImportance: "now",
    personalPace: "next",
    workStatus: "under_progress",
    dueAt: days(1),
    listId: "l3",
    listName: "Website Launch",
  }),
  thing({
    id: "t7",
    title: "Book launch photographer",
    assignee: sai,
    ownerImportance: "next",
    personalPace: "next",
    workStatus: "not_started",
    dueAt: days(5),
    listId: "l3",
    listName: "Website Launch",
  }),
  thing({
    id: "t8",
    title: "Confirm domain & hosting",
    assignee: priya,
    ownerImportance: "next",
    personalPace: "next",
    workStatus: "not_started",
    dueAt: days(6),
    listId: "l3",
    listName: "Website Launch",
  }),
  ...Array.from({ length: 18 }, (_, i) =>
    thing({
      id: `now-more-${i}`,
      title: `Additional NOW item ${i + 1}`,
      personalPace: "now",
      ownerImportance: i % 2 === 0 ? "now" : "next",
    }),
  ),
  ...Array.from({ length: 38 }, (_, i) =>
    thing({
      id: `next-more-${i}`,
      title: `Additional NEXT item ${i + 1}`,
      personalPace: "next",
      ownerImportance: "next",
    }),
  ),
  ...Array.from({ length: 128 }, (_, i) =>
    thing({
      id: `later-${i}`,
      title: `Later item ${i + 1}`,
      personalPace: "later",
      ownerImportance: "later",
    }),
  ),
  ...Array.from({ length: 8 }, (_, i) =>
    thing({
      id: `theirs-wait-${i}`,
      title: `Waiting catch ${i + 1}`,
      owner: priya,
      assignee: rahul,
      acknowledgement: "waiting_for_catch",
      personalPace: null,
      ownerImportance: "now",
    }),
  ),
  ...Array.from({ length: 24 }, (_, i) =>
    thing({
      id: `theirs-move-${i}`,
      title: `Moving ${i + 1}`,
      owner: priya,
      assignee: sai,
      acknowledgement: "caught",
      workStatus: "under_progress",
      personalPace: "now",
    }),
  ),
  ...Array.from({ length: 5 }, (_, i) =>
    thing({
      id: `theirs-attn-${i}`,
      title: `Needs attention ${i + 1}`,
      owner: priya,
      assignee: arjun,
      acknowledgement: "caught",
      workStatus: "not_started",
      dueAt: days(-2),
      personalPace: "now",
    }),
  ),
];
