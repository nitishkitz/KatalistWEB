import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { partitionCourt } from "@/domain/thing";
import {
  personalShredFromRows,
  excludePersonallyShreddedThings,
  excludePersonallyShreddedLists,
} from "@/features/things/personal-shred";
import { canDemoActorViewThing } from "@/features/demo/visibility";
import { parseToss, tossBlockedByPerson } from "@/features/court/parse-toss";
import { setDemoActorForTests, demoDirectory } from "@/features/demo/identities";
import {
  accessibleDemoThings,
  createListLocal,
  getLists,
  getMergedThings,
  getShredded,
  getThing,
  patchThing,
  personById,
  resetDemoLocalStateForTests,
  restoreLocal,
  shredLocal,
  tossLocalThing,
} from "@/features/things/local-state";

afterEach(() => {
  resetDemoLocalStateForTests();
  setDemoActorForTests(null);
});

test("personal shred helper hides only the actor's objects and restore returns them", () => {
  const shred = personalShredFromRows([
    { object_id: "t1", object_type: "thing" },
    { object_id: "l1", object_type: "list" },
    { object_id: "b1", object_type: "bucket" },
  ]);
  assert.equal(shred.thingIds.has("t1"), true);
  assert.equal(shred.listIds.has("l1"), true);
  assert.equal(shred.thingIds.has("t2"), false);
  assert.deepEqual(
    excludePersonallyShreddedThings([{ id: "t1" }, { id: "t2" }], shred).map((t) => t.id),
    ["t2"],
  );
  assert.deepEqual(
    excludePersonallyShreddedLists([{ id: "l1" }, { id: "l2" }], shred).map((l) => l.id),
    ["l2"],
  );

  setDemoActorForTests("p-priya");
  const x = tossLocalThing({ title: "Shared X", context: "work", listId: "l2", assigneeId: "p-arjun" });
  setDemoActorForTests("p-mike");
  shredLocal(x.id, "thing");
  assert.equal(getThing(x.id), undefined);
  assert.ok(getShredded().some((s) => s.id === x.id));
  const mikeCourt = partitionCourt(accessibleDemoThings("work"), "p-mike");
  assert.equal(mikeCourt.mine.some((t) => t.id === x.id), false);
  assert.equal(mikeCourt.theirs.some((t) => t.id === x.id), false);

  setDemoActorForTests("p-priya");
  assert.ok(getThing(x.id));
  assert.equal(getThing(x.id).id, x.id);
  assert.equal(getThing(x.id).workStatus, "not_started");

  setDemoActorForTests("p-arjun");
  assert.ok(getThing(x.id));

  setDemoActorForTests("p-mike");
  restoreLocal(x.id, "thing");
  assert.ok(getThing(x.id));
  assert.equal(getShredded().some((s) => s.id === x.id), false);
});

test("Creator-only does not grant visibility; Owner, Assignee, and List member still see the Thing", () => {
  setDemoActorForTests("p-priya");
  const standalone = tossLocalThing({ title: "Creator provenance", context: "work", assigneeId: "p-arjun" });
  assert.equal(standalone.creator.id, "p-priya");
  assert.equal(standalone.owner.id, "p-priya");
  assert.ok(getThing(standalone.id));
  assert.equal(canDemoActorViewThing(standalone, "p-priya", getLists()), true);
  assert.equal(canDemoActorViewThing(standalone, "p-arjun", getLists()), true);

  patchThing(standalone.id, { owner: personById("p-arjun") });
  const after = getMergedThings("p-priya").find((t) => t.id === standalone.id);
  assert.ok(after);
  assert.equal(after.creator.id, "p-priya");
  assert.equal(after.owner.id, "p-arjun");
  assert.equal(after.assignee.id, "p-arjun");
  assert.equal(canDemoActorViewThing(after, "p-priya", getLists()), false);
  assert.equal(getThing(standalone.id), undefined);

  setDemoActorForTests("p-arjun");
  assert.ok(getThing(standalone.id));
  assert.equal(canDemoActorViewThing(getThing(standalone.id), "p-arjun", getLists()), true);

  setDemoActorForTests("p-sarah");
  assert.equal(getThing(standalone.id), undefined);

  setDemoActorForTests("p-priya");
  const listed = tossLocalThing({ title: "On Mobile Launch", context: "work", listId: "l2", assigneeId: "p-arjun" });
  setDemoActorForTests("p-mike");
  assert.ok(getThing(listed.id));
  assert.equal(canDemoActorViewThing(getThing(listed.id), "p-mike", getLists()), true);

  const visSrc = readFileSync(new URL("../src/features/demo/visibility.ts", import.meta.url), "utf8");
  assert.equal(visSrc.includes("thing.creator.id === actorId"), false);
  assert.match(visSrc, /Creator is provenance only/);
});

test("Magic Box: unresolved person blocks Toss; ambiguous date allows Toss with no Due", () => {
  const people = demoDirectory();
  const blocked = parseToss("Deck for @unknownperson", people);
  assert.equal(tossBlockedByPerson(blocked.chips), true);
  assert.ok(blocked.chips.some((c) => c.kind === "unresolved" && c.value === "person"));

  const ambiguous = parseToss("Finish the deck 3/5", people);
  assert.equal(tossBlockedByPerson(ambiguous.chips), false);
  assert.ok(ambiguous.chips.some((c) => c.label === "Check date" && c.value === "ambiguous"));
  assert.equal(ambiguous.dueAt, undefined);
  assert.equal(ambiguous.dueHasTime, undefined);

  const box = readFileSync(new URL("../src/features/court/MagicBox.tsx", import.meta.url), "utf8");
  assert.match(box, /tossBlockedByPerson/);
  assert.equal(box.includes('throw new Error("Check date")'), false);
  assert.match(box, /Pick a person/);
});

test("Duplicate List names cannot cross-contaminate Things; identity is UUID only", () => {
  setDemoActorForTests("p-priya");
  const dup = createListLocal("Android Release", "work");
  assert.notEqual(dup.id, "l1");
  const onOriginal = tossLocalThing({ title: "On original", context: "work", listId: "l1" });
  const onDup = tossLocalThing({ title: "On duplicate", context: "work", listId: dup.id });
  assert.equal(onOriginal.listId, "l1");
  assert.equal(onDup.listId, dup.id);
  const originalThings = getMergedThings().filter((t) => t.listId === "l1");
  const dupThings = getMergedThings().filter((t) => t.listId === dup.id);
  assert.ok(originalThings.some((t) => t.id === onOriginal.id));
  assert.equal(originalThings.some((t) => t.id === onDup.id), false);
  assert.ok(dupThings.some((t) => t.id === onDup.id));
  assert.equal(dupThings.some((t) => t.id === onOriginal.id), false);

  const page = readFileSync(new URL("../src/routes/lists.$listId.tsx", import.meta.url), "utf8");
  assert.equal(page.includes("t.listName ==="), false);
  assert.equal(page.includes("list?.name"), false);
  const hook = readFileSync(new URL("../src/features/lists/use-list-things.ts", import.meta.url), "utf8");
  assert.match(hook, /t\.listId === listId/);
  assert.equal(hook.includes("listName ==="), false);
});

test("Live personal shred is one reusable lens applied to Court, Lists, Doorman, and Realtime", () => {
  const court = readFileSync(new URL("../src/features/court/use-court.ts", import.meta.url), "utf8");
  const lists = readFileSync(new URL("../src/features/lists/use-lists.ts", import.meta.url), "utf8");
  const listThings = readFileSync(new URL("../src/features/lists/use-list-things.ts", import.meta.url), "utf8");
  const doorman = readFileSync(new URL("../src/features/doorman/use-doorman.ts", import.meta.url), "utf8");
  const buckets = readFileSync(new URL("../src/features/buckets/use-bucket-items.ts", import.meta.url), "utf8");
  const realtime = readFileSync(new URL("../src/features/realtime/use-realtime.ts", import.meta.url), "utf8");
  const trophy = readFileSync(new URL("../src/features/me/use-trophy.ts", import.meta.url), "utf8");
  const sheet = readFileSync(new URL("../src/features/things/ThingDetailSheet.tsx", import.meta.url), "utf8");
  assert.match(court, /excludePersonallyShreddedThings/);
  assert.match(court, /usePersonalShred/);
  assert.match(lists, /excludePersonallyShreddedLists/);
  assert.match(listThings, /excludePersonallyShreddedThings/);
  assert.match(doorman, /fetchPersonalShred/);
  assert.match(buckets, /excludePersonallyShreddedThings/);
  assert.match(realtime, /profile_object_state/);
  assert.match(realtime, /invalidatePersonalSurfaces/);
  assert.match(trophy, /invalidatePersonalSurfaces/);
  assert.match(sheet, /invalidatePersonalSurfaces/);
});

test("Bridge SQL returns owner_importance; guest UI is Catch-first and read-only Importance", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20260820140000_bridge_get_thing_owner_importance.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.bridge_get_thing\(text\)/);
  assert.match(sql, /owner_importance public\.importance/);
  assert.match(sql, /t\.owner_importance/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.bridge_get_thing\(text\) TO service_role/);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.bridge_get_thing\(text\) FROM PUBLIC, anon, authenticated/);
  assert.equal(sql.includes("GRANT EXECUTE ON FUNCTION public.bridge_get_thing(text) TO authenticated"), false);
  assert.equal(/assignee_personal_pace/.test(sql), false);
  assert.equal(/p_email/.test(sql), false);

  const types = readFileSync(new URL("../src/integrations/supabase/types.ts", import.meta.url), "utf8");
  const fn = types.slice(types.indexOf("bridge_get_thing:"));
  assert.match(fn.slice(0, 800), /owner_importance/);

  const ui = readFileSync(new URL("../src/routes/bridge.$token.tsx", import.meta.url), "utf8");
  assert.match(ui, /owner_importance/);
  assert.match(ui, /Owner Importance/);
  assert.match(ui, /caught && !terminal/);
  assert.equal(ui.includes("Personal Pace"), true);
  assert.equal(ui.includes("set_owner_importance"), false);
  assert.equal(ui.includes("set_personal_pace"), false);
  const statusButtons = ui.indexOf('(["not_started", "under_progress", "sorted"]');
  const catchGate = ui.indexOf("caught && !terminal");
  assert.ok(catchGate > 0 && statusButtons > catchGate);
});

test("Assign outside Katalist uses create_external_actor → reassign_thing → issue_bridge_grant on the same Thing", () => {
  const rpc = readFileSync(new URL("../src/features/things/rpc.ts", import.meta.url), "utf8");
  const fn = rpc.slice(rpc.indexOf("rpcAssignOutsideKatalist"));
  const body = fn.slice(0, fn.indexOf("export async function rpcCreateList"));
  assert.match(body, /needs a live session/);
  const createAt = body.indexOf('supabase.rpc("create_external_actor"');
  const reassignAt = body.indexOf('supabase.rpc("reassign_thing"');
  const grantAt = body.indexOf('supabase.rpc("issue_bridge_grant"');
  assert.ok(createAt > 0 && reassignAt > createAt && grantAt > reassignAt);
  assert.match(body, /p_thing_id: input\.thingId/);
  assert.match(body, /\/bridge\/\$\{grant\.token\}/);
  assert.equal(body.includes("add_list_member"), false);

  const sheet = readFileSync(new URL("../src/features/things/ThingDetailSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /Assign outside Katalist/);
  assert.match(sheet, /caps\?\.isOwner && !terminal/);
  assert.match(sheet, /rpcAssignOutsideKatalist/);
  assert.match(sheet, /Copy link/);
  assert.equal(sheet.includes("toast.success(\"Bridge opened") && sheet.includes("setBridgePath(result.path)"), true);
});
