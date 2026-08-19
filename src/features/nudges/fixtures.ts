export type NudgeGroup =
  | "waiting_for_catch"
  | "needs_a_tap"
  | "recently_nudged"
  | "caught_moving"
  | "stale";

export type NudgeRow = {
  id: string;
  title: string;
  person: string;
  reason: string;
  acknowledged: "Waiting" | "Caught" | "Open";
  workStatus: string;
  due: string;
  lastMovement: string;
  group: NudgeGroup;
  canNudge: boolean;
};

export type RecentNudge = {
  id: string;
  title: string;
  person: string;
  when: string;
  state: string;
};

export const nudgeFixtures: NudgeRow[] = [
  {
    id: "n1",
    title: "Coordinate with QA on fixes",
    person: "Arjun",
    reason: "Waiting 1 hr 12 min",
    acknowledged: "Waiting",
    workStatus: "Not Started",
    due: "Today 4:00 PM",
    lastMovement: "Assigned 1h ago",
    group: "waiting_for_catch",
    canNudge: true,
  },
  {
    id: "n2",
    title: "Call vendor for shoot confirmation",
    person: "Sai",
    reason: "No movement for 18 hrs",
    acknowledged: "Caught",
    workStatus: "Not Started",
    due: "Today",
    lastMovement: "Caught yesterday",
    group: "needs_a_tap",
    canNudge: true,
  },
  {
    id: "n3",
    title: "Finalize Play Store wording",
    person: "Rahul",
    reason: "Due in 3 hrs",
    acknowledged: "Caught",
    workStatus: "Under Progress",
    due: "Today 5:00 PM",
    lastMovement: "Status update 40m ago",
    group: "needs_a_tap",
    canNudge: true,
  },
  {
    id: "n4",
    title: "Review website launch copy",
    person: "Rahul",
    reason: "Reassigned twice",
    acknowledged: "Caught",
    workStatus: "Under Progress",
    due: "Tomorrow",
    lastMovement: "Reassigned 6h ago",
    group: "needs_a_tap",
    canNudge: true,
  },
  {
    id: "n5",
    title: "Share access checklist",
    person: "Neha",
    reason: "Nudged 25 min ago",
    acknowledged: "Open",
    workStatus: "Not Started",
    due: "Fri",
    lastMovement: "Nudged 25m ago",
    group: "recently_nudged",
    canNudge: false,
  },
  {
    id: "n6",
    title: "Prepare release notes",
    person: "Rahul",
    reason: "Caught & moving",
    acknowledged: "Caught",
    workStatus: "Under Progress",
    due: "Today 4:00 PM",
    lastMovement: "Progress 15m ago",
    group: "caught_moving",
    canNudge: false,
  },
  {
    id: "n7",
    title: "Draft OKR summary",
    person: "Sarah",
    reason: "No movement for 2 days",
    acknowledged: "Caught",
    workStatus: "Not Started",
    due: "Next week",
    lastMovement: "Caught 2d ago",
    group: "stale",
    canNudge: true,
  },
];

export const recentNudgeFixtures: RecentNudge[] = [
  {
    id: "r1",
    title: "Share access checklist",
    person: "Neha",
    when: "25 min ago",
    state: "Open",
  },
  {
    id: "r2",
    title: "Book launch photographer",
    person: "Sai",
    when: "1 hr ago",
    state: "Acknowledged",
  },
  {
    id: "r3",
    title: "Confirm domain & hosting",
    person: "Me",
    when: "3 hr ago",
    state: "Caught",
  },
];

export const nudgeGroups: { id: NudgeGroup; label: string }[] = [
  { id: "waiting_for_catch", label: "Waiting for Catch" },
  { id: "needs_a_tap", label: "Needs a Tap" },
  { id: "recently_nudged", label: "Recently Nudged" },
  { id: "caught_moving", label: "Caught & Moving" },
  { id: "stale", label: "Stale / Review" },
];
