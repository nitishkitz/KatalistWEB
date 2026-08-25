import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_COURT_FILTERS,
  applyCourtView,
  cardDensityForLane,
  courtAssignees,
  courtPeople,
  filterCourtThings,
  formatCourtDue,
  sortCourtThings,
  toggleLaneFocus,
  toggleTheirsFocus,
} from "@/features/court/court-view-model";

const person = (id, name) => ({ id, name, initials: name.slice(0, 2).toUpperCase() });

function thing(overrides = {}) {
  return {
    id: "thing-1",
    title: "Review launch copy",
    creator: person("creator", "Priya"),
    owner: person("owner", "Rahul"),
    assignedBy: person("assigner", "Maya"),
    assignee: person("assignee", "Arjun"),
    acknowledgement: "caught",
    workStatus: "not_started",
    ownerImportance: "next",
    personalPace: "next",
    dueAt: "2026-08-20T12:00:00.000Z",
    dueHasTime: true,
    context: "work",
    listId: "list-1",
    listName: "Website Launch",
    starred: false,
    cancelledAt: null,
    sortedAt: null,
    caughtAt: "2026-08-18T12:00:00.000Z",
    updatedAt: "2026-08-19T12:00:00.000Z",
    ...overrides,
  };
}

test("search matches title, owner, assignee, and list without changing the source", () => {
  const source = [thing()];
  for (const query of ["launch copy", "rahul", "arjun", "website launch"]) {
    assert.deepEqual(filterCourtThings(source, DEFAULT_COURT_FILTERS, query), source);
  }
  assert.deepEqual(filterCourtThings(source, DEFAULT_COURT_FILTERS, "missing"), []);
  assert.equal(source.length, 1);
});

test("quick and detailed filters compose", () => {
  const now = new Date("2026-08-20T09:00:00.000Z");
  const source = [
    thing({ id: "overdue", dueAt: "2026-08-19T09:00:00.000Z", starred: true }),
    thing({
      id: "overdue-today",
      dueAt: "2026-08-20T08:00:00.000Z",
      dueHasTime: true,
      starred: true,
    }),
    thing({
      id: "today-no-time",
      dueAt: "2026-08-20T08:00:00.000Z",
      dueHasTime: false,
      starred: true,
    }),
    thing({ id: "waiting", acknowledgement: "waiting_for_catch", workStatus: "under_progress" }),
    thing({ id: "no-due", dueAt: null }),
  ];

  assert.deepEqual(
    filterCourtThings(
      source,
      { ...DEFAULT_COURT_FILTERS, due: "overdue", starredOnly: true },
      "",
      now,
    ).map((item) => item.id),
    ["overdue", "overdue-today"],
  );
  assert.deepEqual(
    filterCourtThings(
      source,
      {
        ...DEFAULT_COURT_FILTERS,
        quick: "waiting",
        acknowledgement: "waiting_for_catch",
        workStatus: "under_progress",
      },
      "",
      now,
    ).map((item) => item.id),
    ["waiting"],
  );
  assert.deepEqual(
    filterCourtThings(source, { ...DEFAULT_COURT_FILTERS, due: "no_due" }, "", now).map(
      (item) => item.id,
    ),
    ["no-due"],
  );
  assert.deepEqual(
    filterCourtThings(source, { ...DEFAULT_COURT_FILTERS, due: "this_week" }, "", now).map(
      (item) => item.id,
    ),
    ["overdue-today", "today-no-time", "waiting"],
  );
});

test("assignee avatar filter composes across every Court lane", () => {
  const arjun = person("arjun", "Arjun");
  const priya = person("priya", "Priya");
  const lanes = {
    now: [thing({ id: "now-arjun", assignee: arjun })],
    next: [thing({ id: "next-priya", assignee: priya })],
    later: [thing({ id: "later-arjun", assignee: arjun })],
    theirs: [thing({ id: "their-priya", assignee: priya })],
  };
  assert.deepEqual(courtAssignees(lanes).map((candidate) => candidate.id), ["arjun", "priya"]);
  const view = applyCourtView(
    lanes,
    { ...DEFAULT_COURT_FILTERS, assigneeId: "arjun" },
    "",
    "due",
  );
  assert.deepEqual(view.now.map((item) => item.id), ["now-arjun"]);
  assert.deepEqual(view.next, []);
  assert.deepEqual(view.later.map((item) => item.id), ["later-arjun"]);
  assert.deepEqual(view.theirs, []);
});

test("involved-person filter includes creator, Owner, assigner, and assignee across lanes", () => {
  const maya = person("maya", "Maya");
  const lanes = {
    now: [thing({ id: "created", creator: maya })],
    next: [thing({ id: "owned", owner: maya })],
    later: [thing({ id: "assigned", assignedBy: maya })],
    theirs: [thing({ id: "assignee", assignee: maya })],
  };
  assert.equal(courtPeople(lanes).some((candidate) => candidate.id === "maya"), true);
  const view = applyCourtView(lanes, { ...DEFAULT_COURT_FILTERS, personId: "maya" }, "", "due");
  assert.deepEqual([view.now[0].id, view.next[0].id, view.later[0].id, view.theirs[0].id], ["created", "owned", "assigned", "assignee"]);
});

test("sorting is stable and offers only due or recently updated", () => {
  const source = [
    thing({ id: "none", dueAt: null, updatedAt: "2026-08-20T10:00:00.000Z" }),
    thing({ id: "later", dueAt: "2026-08-22T10:00:00.000Z", ownerImportance: "later" }),
    thing({ id: "soon", dueAt: "2026-08-21T10:00:00.000Z", ownerImportance: "now" }),
  ];

  assert.deepEqual(
    sortCourtThings(source, "due").map((item) => item.id),
    ["soon", "later", "none"],
  );
  assert.deepEqual(sortCourtThings(source, "updated").map((item) => item.id), ["none", "later", "soon"]);
  assert.deepEqual(
    source.map((item) => item.id),
    ["none", "later", "soon"],
  );
});

test("applying a Court view returns filtered counts and sorted lane items", () => {
  const lanes = {
    now: [
      thing({ id: "now-a", ownerImportance: "later" }),
      thing({ id: "now-b", ownerImportance: "now" }),
    ],
    next: [thing({ id: "next-a", title: "Unrelated" })],
    later: [],
    theirs: [thing({ id: "their-a", title: "Review external copy" })],
  };
  const view = applyCourtView(lanes, DEFAULT_COURT_FILTERS, "review", "due");

  assert.deepEqual(
    view.now.map((item) => item.id),
    ["now-a", "now-b"],
  );
  assert.deepEqual(view.next, []);
  assert.deepEqual(
    view.theirs.map((item) => item.id),
    ["their-a"],
  );
  assert.deepEqual(view.counts, { now: 2, next: 0, later: 0, theirs: 1 });
});

test("lane and THEIRS selections toggle closed when selected twice", () => {
  assert.equal(toggleLaneFocus(null, "now"), "now");
  assert.equal(toggleLaneFocus("now", "now"), null);
  assert.equal(toggleLaneFocus("now", "later"), "later");
  assert.equal(toggleTheirsFocus(null, "moving"), "moving");
  assert.equal(toggleTheirsFocus("moving", "moving"), null);
});

test("card density follows overview, focused, and peek lane states", () => {
  assert.equal(cardDensityForLane(null, "now"), "overview");
  assert.equal(cardDensityForLane("now", "now"), "focused");
  assert.equal(cardDensityForLane("now", "next"), "peek");
});

test("due labels include exact time only when the Thing has one", () => {
  const now = new Date(2026, 7, 20, 9, 0, 0);
  assert.deepEqual(
    formatCourtDue(
      thing({ dueAt: new Date(2026, 7, 20, 17, 30, 0).toISOString(), dueHasTime: true }),
      now,
    ),
    { label: "Today, 5:30 PM", urgent: true },
  );
  assert.deepEqual(
    formatCourtDue(
      thing({ dueAt: new Date(2026, 7, 21, 9, 0, 0).toISOString(), dueHasTime: false }),
      now,
    ),
    { label: "Tomorrow", urgent: true },
  );
  assert.equal(formatCourtDue(thing({ dueAt: null }), now), null);
});
