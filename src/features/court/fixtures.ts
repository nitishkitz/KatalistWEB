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
const nithesh = person("p-nithesh", "Nithesh");
const sudheer = person("p-sudheer", "Sudheer");
const rohit = person("p-rohit", "Rohit");

const pdfBrief = {
  id: "f1",
  name: "Launch brief.pdf",
  type: "pdf" as const,
  sizeLabel: "1.8 MB",
  url: "https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf",
};
const docxCopy = {
  id: "f2",
  name: "Homepage copy.docx",
  type: "docx" as const,
  isNew: true,
};
const pngRefs = {
  id: "f3",
  name: "References.png",
  type: "png" as const,
  url: "https://picsum.photos/seed/katalist-refs/640/420",
};
const docxNotes = {
  id: "f4",
  name: "Research notes.docx",
  type: "docx" as const,
};

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
    id: "t-brief",
    title: "Review the launch brief",
    creator: sudheer,
    owner: sudheer,
    assignee: nithesh,
    ownerImportance: "now",
    personalPace: "now",
    workStatus: "under_progress",
    dueAt: at(16, 0),
    dueHasTime: true,
    listId: "l-website",
    listName: "Website launch",
    description: "Review the launch narrative and confirm the final scope before the team review. Check the pricing section, homepage copy and onboarding sequence. Leave feedback against the relevant file so the team can follow the changes. Please confirm any remaining blockers before 4 PM.",
    files: [pdfBrief, docxCopy, pngRefs],
    attachmentCount: 3,
  }),
  thing({
    id: "t-budget",
    title: "Confirm launch budget",
    creator: rohit,
    owner: rohit,
    assignee: nithesh,
    ownerImportance: "now",
    personalPace: "now",
    workStatus: "not_started",
    dueAt: at(17, 0),
    dueHasTime: true,
    listId: "l-website",
    listName: "Website launch",
    files: [pdfBrief],
  }),
  thing({
    id: "t-proposal",
    title: "Share the updated proposal",
    creator: rohit,
    owner: rohit,
    assignee: nithesh,
    ownerImportance: "next",
    personalPace: "now",
    workStatus: "not_started",
    dueAt: days(1),
    listId: "l-client",
    listName: "Client proposal",
  }),
  thing({
    id: "t-homepage",
    title: "Approve the homepage direction",
    creator: sudheer,
    owner: sudheer,
    assignee: nithesh,
    ownerImportance: "next",
    personalPace: "next",
    workStatus: "not_started",
    dueAt: days(1),
    listId: "l-website",
    listName: "Website launch",
    files: [pngRefs, docxCopy],
    attachmentCount: 2,
  }),
  thing({
    id: "t-interviews",
    title: "Prepare customer interviews",
    creator: nithesh,
    owner: nithesh,
    assignee: nithesh,
    ownerImportance: "next",
    personalPace: "next",
    workStatus: "not_started",
    dueAt: days(1),
    listId: "l-research",
    listName: "Research",
  }),
  thing({
    id: "t-review-onboarding",
    title: "Review onboarding copy",
    creator: sudheer,
    owner: sudheer,
    assignee: nithesh,
    ownerImportance: "later",
    personalPace: "next",
    workStatus: "not_started",
    dueAt: days(2),
    listId: "l-website",
    listName: "Website launch",
  }),
  thing({
    id: "t-onboarding",
    title: "Explore the customer onboarding flow",
    creator: nithesh,
    owner: nithesh,
    assignee: nithesh,
    ownerImportance: "later",
    personalPace: "later",
    workStatus: "not_started",
    dueAt: days(11),
    listId: "l-exp",
    listName: "Product experience",
    files: [docxNotes],
    attachmentCount: 1,
  }),
  thing({
    id: "t-research",
    title: "Plan the next research round",
    creator: rohit,
    owner: rohit,
    assignee: nithesh,
    ownerImportance: "later",
    personalPace: "later",
    workStatus: "not_started",
    dueAt: days(15),
  }),
  thing({
    id: "t-brand",
    title: "Organize brand references",
    creator: nithesh,
    owner: nithesh,
    assignee: nithesh,
    ownerImportance: "later",
    personalPace: "later",
    workStatus: "not_started",
    dueAt: days(18),
  }),
  thing({
    id: "theirs-budget",
    title: "Finalize launch budget",
    creator: nithesh,
    owner: nithesh,
    assignee: rohit,
    acknowledgement: "caught",
    workStatus: "not_started",
    personalPace: null,
    ownerImportance: "now",
    dueAt: days(-1),
    attachmentCount: 2,
    files: [pdfBrief, docxCopy],
  }),
  thing({
    id: "theirs-proposal",
    title: "Review the proposal",
    creator: nithesh,
    owner: nithesh,
    assignee: sudheer,
    acknowledgement: "waiting_for_catch",
    workStatus: "not_started",
    personalPace: null,
    ownerImportance: "next",
    attachmentCount: 1,
    files: [docxNotes],
  }),
  thing({
    id: "theirs-walkthrough",
    title: "Share the product walkthrough",
    creator: nithesh,
    owner: nithesh,
    assignee: rohit,
    acknowledgement: "caught",
    workStatus: "under_progress",
    personalPace: null,
    ownerImportance: "now",
  }),
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
