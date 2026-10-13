import { signIn, rpc, rest } from "./api-lib.mjs";
const A = await signIn("A"), B = await signIn("B"), C = await signIn("C");
const out = [];
const log = (name, ok, detail = "") => out.push({ check: name, ok, ...(detail ? { detail } : {}) });
const anchor = (iso) => ({ at: iso, date: iso.slice(0, 10), precision: "date", source: "typed", accepted: true, phrase: "test" });
const create = async (u, key, items) => (await rpc(u, "coey_create_things", { p_idempotency_key: key, p_items: items })).body;
const run = Date.now().toString(36);

// Access isolation.
const aThings = (await rest(A, "things?select=id,title")).body;
const cSees = (await rest(C, "things?select=id")).body;
log("C (unrelated) sees none of A's Things", Array.isArray(cSees) && cSees.length === 0, `A has ${aThings.length}`);
const bSees = (await rest(B, "things?select=title")).body.map((t) => t.title);
log("B sees only the Thing sent to B", bSees.length === 1 && /price list/i.test(bSees[0]), JSON.stringify(bSees));
const privateRow = (await rest(B, "things?select=id&title=ilike.*asdfgh*")).body;
log("B cannot read A's private capture", Array.isArray(privateRow) && privateRow.length === 0);
const cProfiles = (await rest(C, "profiles?select=id")).body;
log("C reads only its own profile", Array.isArray(cProfiles) && cProfiles.length === 1 && cProfiles[0].id === C.id);
const forged = await rest(C, "call_rings", { method: "POST", body: JSON.stringify({ list_id: aThings[0]?.id, caller_profile_id: A.id, recipient_profile_id: B.id, caller_name: "x", list_name: "x", list_kind: "dm" }) });
log("Rings cannot be forged through the API", forged.status >= 400, `HTTP ${forged.status}`);
const unconnected = await create(C, `acc-${run}-c1`, [{ title: "x", text_raw: "x", mode: "work", holder_profile_id: A.id }]);
log("Unconnected delegation refused by the server", typeof unconnected === "object" && /connect/i.test(JSON.stringify(unconnected)), JSON.stringify(unconnected).slice(0, 90));

// Ownership: wrong person → Keep it for me → Catch → Sort.
const own = (await create(A, `acc-${run}-own`, [{ title: "Ownership check", text_raw: "Bharat ownership check", mode: "work", holder_profile_id: B.id, rule_id: "C3+L8" }])).things[0].thing_id;
log("B can say wrong person", (await rpc(B, "coey_wrong_person", { p_thing_id: own })).status === 200);
log("B no longer sees it in their court as holder", (await rest(B, `thing_schedules?select=holder_profile_id&thing_id=eq.${own}`)).body.every((s) => s.holder_profile_id !== B.id));
log("A keeps it", (await rpc(A, "coey_resolve_holder", { p_thing_id: own, p_holder_profile_id: A.id })).status === 200);
const caught = await rpc(A, "catch_thing", { p_thing_id: own, p_personal_pace: "next" });
log("A can Catch after Keep it for me", caught.status === 200, caught.status === 200 ? "" : JSON.stringify(caught.body).slice(0, 120));
log("A can Sort", (await rpc(A, "sort_thing", { p_thing_id: own })).status === 200);

// Catch → promise → serve back → answer → Sort by the right people.
const t2 = (await create(A, `acc-${run}-t2`, [{ title: "Promise check", text_raw: "Bharat promise check", mode: "work", holder_profile_id: B.id }])).things[0].thing_id;
log("Sender cannot promise for the holder", (await rpc(A, "coey_promise", { p_thing_id: t2, p_promise_at: new Date(Date.now() + 2 * 864e5).toISOString() })).status >= 400);
log("Holder catches", (await rpc(B, "catch_thing", { p_thing_id: t2, p_personal_pace: "next" })).status === 200);
log("Holder promises", (await rpc(B, "coey_promise", { p_thing_id: t2, p_promise_at: new Date(Date.now() + 2 * 864e5).toISOString() })).status === 200);
log("Holder serves back a question", (await rpc(B, "coey_serve_back", { p_thing_id: t2, p_question: "Which dealer?" })).status === 200);
log("Sender answers (back to holder)", (await rpc(A, "coey_unblock", { p_thing_id: t2 })).status === 200);
log("Holder sorts", (await rpc(B, "sort_thing", { p_thing_id: t2 })).status === 200);

// Recurrence: concurrent sorts create exactly one next occurrence.
const rec = (await create(A, `acc-${run}-rec`, [{ title: "Weekly invoice", text_raw: "Bharat every Monday send invoice", mode: "work", holder_profile_id: B.id,
  recurrence: { freq: "weekly", weekdays: ["mon"], monthDay: null, phrase: "every Monday" }, action_time: anchor(new Date(Date.now() + 6 * 864e5).toISOString()) }])).things[0].thing_id;
await rpc(B, "catch_thing", { p_thing_id: rec, p_personal_pace: "next" });
await Promise.all([rpc(B, "sort_thing", { p_thing_id: rec }), rpc(B, "sort_thing", { p_thing_id: rec })]);
const nextOcc = (await rest(A, `thing_schedules?select=thing_id&occurrence_of=eq.${rec}`)).body;
log("Recurring sort advances exactly once", Array.isArray(nextOcc) && nextOcc.length === 1, `next=${nextOcc.length}`);

// Idempotent capture: same key twice → one Thing.
const k = `acc-${run}-idem`;
const first = await create(A, k, [{ title: "Idempotent", text_raw: "Idempotent", mode: "work" }]);
const second = await create(A, k, [{ title: "Idempotent", text_raw: "Idempotent", mode: "work" }]);
log("Repeated save with one key creates one Thing", first.things[0].thing_id === second.things[0].thing_id && second.replayed === true);

console.log(JSON.stringify({ users: { A: A.id, B: B.id, C: C.id }, out }, null, 2));
