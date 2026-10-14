// Ask as an agent: tools stay inside the viewer's data, actions are only proposed,
// and answers are checked (grounded numbers, no blame, no "done" before confirm).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Workspace } from "../server/lib/coey/agent/workspace.ts";
import { AgentTools } from "../server/lib/coey/agent/tools.ts";
import { runAgent, ungroundedNumbers, claimsDone, blames } from "../server/lib/coey/agent/agent.ts";
import { zonedInstant } from "../src/domain/coey/calendar.ts";

const IST = "Asia/Kolkata";
const NOW = zonedInstant("2026-10-13", 11 * 60, IST);
const iso = (d, m = 600) => new Date(zonedInstant(d, m, IST)).toISOString();
const ME = "a-me", AVANI = "a-avani", RAVI1 = "a-ravi1", RAVI2 = "a-ravi2";
const thing = (id, owner, holder, over = {}) => ({
  id, title: id, notes: null, mode: "work", list_id: null, list: null, status: "not_started", acknowledgement: "waiting_for_catch",
  due_at: null, created_at: iso("2026-10-12"), updated_at: iso("2026-10-12"), sorted_at: null, caught_at: null,
  owner_actor_id: owner, owner: { [ME]: "You", [AVANI]: "Avani Rao", [RAVI1]: "Ravi Kumar", [RAVI2]: "Ravi Teja" }[owner],
  holder_actor_id: holder, holder: { [ME]: "You", [AVANI]: "Avani Rao", [RAVI1]: "Ravi Kumar", [RAVI2]: "Ravi Teja" }[holder],
  sent_by_me: owner === ME && holder !== ME, in_my_court: holder === ME, open: true, lane: holder === ME ? "next" : null,
  concern: owner === ME && holder !== ME ? "not_caught" : null, promise_at: null, snoozed_until: null, bucket_ids: [], can_nudge_now: owner === ME && holder !== ME, files: [], ...over,
});
function workspace() {
  const ws = new Workspace(null, "me", NOW);
  ws.load = async () => {};
  Object.assign(ws, {
    timezone: IST, viewerName: "Deva Rao", myActorId: ME,
    people: [
      { actor_id: ME, profile_id: "me", name: "Deva Rao", connected: false, me: true },
      { actor_id: AVANI, profile_id: "avani", name: "Avani Rao", connected: true, me: false },
      { actor_id: RAVI1, profile_id: "r1", name: "Ravi Kumar", connected: true, me: false },
      { actor_id: RAVI2, profile_id: "r2", name: "Ravi Teja", connected: true, me: false },
    ],
    lists: [], buckets: [],
    things: [
      thing("from-avani-1", AVANI, ME), thing("from-avani-2", AVANI, ME, { acknowledgement: "caught", status: "under_progress" }),
      thing("to-avani", ME, AVANI, { concern: "stale" }), thing("to-ravi", ME, RAVI1), thing("to-ravi-fresh", ME, RAVI1, { can_nudge_now: false }),
      thing("mine", ME, ME, { files: [{ name: "site photo.jpg", kind: "image" }, { name: "quote.pdf", kind: "pdf" }] }), thing("done", ME, ME, { status: "sorted", open: false, in_my_court: false, lane: null, sorted_at: iso("2026-10-13") }),
    ],
  });
  return ws;
}
const run = (tools, name, args) => tools.run(name, args).then((o) => o);

test("find_things: “pending with Avani” returns both directions; a shared first name asks which", async () => {
  const tools = new AgentTools(workspace(), "work");
  const r = (await run(tools, "find_things", { person: "avani" })).result;
  assert.equal(r.total, 3);
  assert.deepEqual(r.person_breakdown, { open_with_them_sent_by_you: 1, open_with_them_from_others: 0, open_in_your_court_sent_by_them: 2 });
  const ravi = (await run(tools, "find_things", { person: "Ravi" })).result;
  assert.deepEqual(ravi.candidates, ["Ravi Kumar", "Ravi Teja"]);
  assert.equal((await run(tools, "find_things", { person: "Zubin" })).result.person_not_found, "Zubin");
  const past = (await run(tools, "find_things", { relation: "i_sent", state: "past_follow_up" })).result;
  assert.deepEqual(past.things.map((t) => t.id), ["to-avani"]);
  assert.equal(past.things[0].follow_up, "past its usual follow-up time", "internal states are given in words");
  const sorted = (await run(tools, "find_things", { state: "sorted", date_field: "sorted", from: "2026-10-12", to: "2026-10-18" })).result;
  assert.equal(sorted.total, 1);
});

test("people_lists_buckets: names only, never another person's workload (Q4)", async () => {
  const r = (await run(new AgentTools(workspace(), "work"), "people_lists_buckets", {})).result;
  assert.deepEqual(r.connected_people, ["Avani Rao", "Ravi Kumar", "Ravi Teja"]);
  assert.doesNotMatch(JSON.stringify(r.connected_people), /\d/);
});

test("propose_action: only what the person may do; batch requests become one confirm card; nothing is performed", async () => {
  const tools = new AgentTools(workspace(), "work");
  assert.equal((await run(tools, "propose_action", { type: "nudge", thing_id: "from-avani-1" })).result.proposed, false, "cannot nudge a Thing in your own court");
  assert.equal((await run(tools, "propose_action", { type: "set_pace", thing_id: "from-avani-1", args: { pace: "chill" } })).result.proposed, false, "the holder cannot lower the sender's pace (§8.4)");
  assert.match((await run(tools, "propose_action", { type: "nudge", thing_id: "to-ravi-fresh" })).result.reason ?? "", /too soon/, "never offers a nudge the server would refuse");
  const nudge = await run(tools, "propose_action", { type: "nudge", thing_id: "to-avani" });
  assert.deepEqual([nudge.action.type, nudge.action.params.actorId, nudge.action.requires_confirmation], ["prepare_nudge", AVANI, true]);
  const batch = await run(tools, "propose_action", { type: "catch", thing_ids: ["from-avani-1", "mine", "from-avani-2"] });
  assert.equal(batch.result.proposed, 2);
  const card = tools.actions.find((a) => a.type === "catch_thing");
  assert.deepEqual([card.target_ids.sort(), card.label], [["from-avani-1", "mine"], "Catch 2 Things"]);
  const promise = await run(tools, "propose_action", { type: "promise", thing_id: "from-avani-1", args: { at: "2026-10-20T18:00" } });
  assert.equal(promise.action.type, "promise_date");
  assert.equal(promise.action.params.until, iso("2026-10-20", 18 * 60));
});

test("answer checks: numbers must come from tools, no blame, no “done” before the person confirms", () => {
  assert.deepEqual(ungroundedNumbers("You have 3 Things, 2 from Avani (Oct 5–11).", "q", '{"total":3,"groups":[{"count":2}]} 2026-10-05 2026-10-11'), []);
  assert.deepEqual(ungroundedNumbers("You have 7 Things.", "q", '{"total":3}'), ["7"]);
  assert.equal(blames("Ravi hasn't touched the dispatch.", ["Ravi Kumar"]), true);
  assert.equal(blames("The dispatch is still in Ravi's court.", ["Ravi Kumar"]), false);
  assert.equal(claimsDone("Done — I moved it to Next."), true);
  assert.equal(claimsDone("Tap Catch 2 Things to confirm."), false);
});

function sarvam(replies) {
  const sent = [];
  const fetchImpl = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    const reply = replies.shift();
    return new Response(JSON.stringify({ choices: [{ message: reply }] }), { status: 200 });
  };
  return { fetchImpl, sent };
}
const call = (name, args) => ({ content: null, tool_calls: [{ id: `c-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

test("the agent loop: tool → answer from the result, with the rows it named", async () => {
  const { fetchImpl, sent } = sarvam([call("find_things", { person: "avani" }), { content: "**3 Things** with Avani: \"from-avani-1\" is waiting for you to catch." }]);
  const statuses = [];
  const a = await runAgent({ question: "whats pending with avani", history: [], mode: "work" }, { client: null, userId: "me", apiKey: "k", model: "m", fetchImpl, workspace: workspace() }, (s) => statuses.push(s), new AbortController().signal);
  assert.equal(a.intent, "agent_answer");
  assert.match(a.answer_markdown, /3 Things/);
  const rows = a.presentation.blocks.find((b) => b.type === "thing_list").groups.flatMap((g) => g.records.map((r) => r.id));
  assert.deepEqual(rows.sort(), ["from-avani-1", "from-avani-2", "to-avani"], "rows are the whole search the answer is about, from the server");
  assert.equal(a.presentation.summary.heading, "3 Things with Avani: \"from-avani-1\" is waiting for you to catch");
  assert.deepEqual(statuses, ["Looking through your Things"]);
  assert.equal(sent[1].messages.at(-1).role, "tool", "the tool result goes back to the model");
  assert.ok(sent.every((b) => Array.isArray(b.tools)), "tools are always declared");
});

test("an answer that keeps inventing numbers is not shown; the older path answers instead", async () => {
  const { fetchImpl } = sarvam([call("find_things", {}), { content: "You have 42 Things." }, { content: "You have 42 Things." }]);
  const a = await runAgent({ question: "how many", history: [], mode: "work" }, { client: null, userId: "me", apiKey: "k", model: "m", fetchImpl, workspace: workspace() }, () => {}, new AbortController().signal);
  assert.equal(a, null);
});

test("a blaming draft is rewritten once before it is shown", async () => {
  const { fetchImpl, sent } = sarvam([call("find_things", { relation: "i_sent" }), { content: "Avani hasn't caught \"to-avani\"." }, { content: "\"to-avani\" is still in Avani's court." }]);
  const a = await runAgent({ question: "what's stuck", history: [], mode: "work" }, { client: null, userId: "me", apiKey: "k", model: "m", fetchImpl, workspace: workspace() }, () => {}, new AbortController().signal);
  assert.match(a.answer_markdown, /^"to-avani" is still in Avani's court\.\n\nShowing: Sent by you\.$/, "the shown filters ride along for follow-ups");
  assert.match(sent.at(-1).messages.at(-1).content, /subject of a failure/);
});

test("the confirm engine runs the agent's new actions only after preview + confirm, rechecking each target", async () => {
  const { parseActionRequest, previewAssistantAction, confirmAssistantAction } = await import("../server/lib/assistant-actions.ts");
  const T = "11111111-1111-1111-1111-111111111111", MEA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const row = { id: T, title: "Pay the bill", context: "work", work_status: "not_started", acknowledgement: "waiting_for_catch", due_at: null, current_assignee_actor_id: MEA };
  const client = (rows) => {
    const calls = [];
    return {
      calls,
      from(table) {
        const q = {};
        for (const m of ["select", "in", "eq", "is"]) q[m] = () => q;
        q.limit = async () => ({ data: rows });
        q.maybeSingle = async () => ({ data: table === "actors" ? { id: MEA } : null });
        q.insert = async (value) => { calls.push(["insert", table, value]); return { error: null }; };
        return q;
      },
      rpc: async (name, args) => { calls.push([name, args]); return { data: {}, error: null }; },
    };
  };
  const later = new Date(Date.now() + 86_400_000).toISOString();
  for (const [type, params, expected] of [
    ["catch_thing", {}, ["catch_thing", "set_work_status"]],
    ["promise_date", { until: later }, ["catch_thing", "coey_promise"]],
    ["snooze_thing", { until: later }, ["snooze_thing"]],
    ["add_comment", { comment: "Paid today" }, ["insert"]],
  ]) {
    const req = parseActionRequest({ type, targetIds: [T], params });
    const preview = await previewAssistantAction(client([row]), "u1", req);
    assert.ok(preview.token, `${type} previews with a token`);
    const c = client([row]);
    const out = await confirmAssistantAction(c, "u1", { token: preview.token, idempotencyKey: `k-${type}-123` });
    assert.equal(out.results[0].state, "applied", type);
    assert.deepEqual(c.calls.map((x) => x[0]), expected, type);
  }
  const notMine = await previewAssistantAction(client([{ ...row, current_assignee_actor_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }]), "u1", parseActionRequest({ type: "sort_thing", targetIds: [T] }));
  assert.equal(notMine.token, null, "a Thing in someone else's court cannot be sorted");
  assert.throws(() => parseActionRequest({ type: "snooze_thing", targetIds: [T], params: { until: "2001-01-01T00:00:00Z" } }), /passed/);
});

test("production regression: invented Things or people are caught before the answer is shown", async () => {
  const { unknownTitles, unknownPeople } = await import("../server/lib/coey/agent/agent.ts");
  assert.deepEqual(unknownTitles('The oldest are "Review Q3 marketing data" and "Verify B send the price list".', ["Verify B send the price list"], ""), ["Review Q3 marketing data"]);
  assert.deepEqual(unknownPeople("sent to Priya, and one with Bharat KTest from Monday", ["Bharat KTest", "Avani KTest"]), ["Priya"]);
  const { fetchImpl } = sarvam([call("find_things", { relation: "i_sent" }), { content: 'Nudge "Confirm venue for team offsite" with Priya.' }, { content: 'Nudge "Confirm venue for team offsite" with Priya.' }]);
  const a = await runAgent({ question: "who needs a nudge", history: [], mode: "work" }, { client: null, userId: "me", apiKey: "k", model: "m", fetchImpl, workspace: workspace() }, () => {}, new AbortController().signal);
  assert.equal(a, null, "never shown; the older path answers");
});

test("an answer about nudges comes with each row's real Nudge availability", async () => {
  const { fetchImpl } = sarvam([call("find_things", { relation: "i_sent", state: "past_follow_up" }), call("show_answer", { heading: "1 Thing is past follow-up", description: "It is with Avani.", results: ["r1"], group_by: "none" })]);
  const a = await runAgent({ question: "who needs a nudge", history: [], mode: "work" }, { client: null, userId: "me", apiKey: "k", model: "m", fetchImpl, workspace: workspace() }, () => {}, new AbortController().signal);
  const [group] = a.presentation.blocks.find((b) => b.type === "thing_list").groups;
  assert.equal(a.presentation.summary.heading, "1 Thing is past follow-up");
  assert.deepEqual(group.records.map((r) => [r.id, r.actions[0].kind, r.actions[0].status]), [["to-avani", "nudge", "available"]]);
});

test("production regression: “how many things have images” counts attached images, not the word “images”", async () => {
  const { fileKind } = await import("../server/lib/coey/agent/workspace.ts");
  assert.deepEqual(["a.PNG", "scan.pdf", "sheet.xlsx", "clip.mov", "notes.docx", "x.bin"].map((n) => fileKind(n)), ["image", "pdf", "spreadsheet", "video", "document", "other"]);
  assert.equal(fileKind("upload", "image/jpeg"), "image");
  const tools = new AgentTools(workspace(), "work");
  const r = (await run(tools, "find_things", { has_files: "image", state: "any" })).result;
  assert.equal(r.total, 1);
  assert.deepEqual(r.things[0].files, ["site photo.jpg (image)", "quote.pdf (pdf)"]);
});

test("presentation: server-decided states and actions; snoozed and sorted Things stay visible; ids are unique", async () => {
  const { buildPresentation, recordActions } = await import("../server/lib/coey/agent/present.ts");
  const { validPresentation } = await import("../src/domain/coey/presentation.ts");
  const ws = workspace();
  ws.things.push(
    thing("snoozed", AVANI, ME, { lane: "hidden", snoozed_until: iso("2026-10-13", 17 * 60) }),
    thing("fresh-sent", ME, RAVI1, { can_nudge_now: false }),
    thing("nudged", ME, RAVI2, { can_nudge_now: false, my_last_nudge_at: new Date(NOW - 30 * 60_000).toISOString() }),
  );
  const p = buildPresentation(ws, { ids: ["from-avani-1", "from-avani-2", "snoozed", "fresh-sent", "nudged", "done", "from-avani-1"], groupBy: "lane", heading: "Your Things", mode: "work" });
  assert.ok(validPresentation(p));
  const groups = p.blocks.find((b) => b.type === "thing_list").groups;
  assert.deepEqual(groups.map((g) => [g.title, g.total]), [["Next", 2], ["Waiting with others", 2], ["Snoozed", 1], ["Sorted", 1]]);
  assert.deepEqual(p.blocks.find((b) => b.type === "counts").items, [{ label: "in your court", count: 2 }, { label: "with others", count: 2 }, { label: "snoozed", count: 1 }]);
  const byId = Object.fromEntries(groups.flatMap((g) => g.records).map((r) => [r.id, r]));
  assert.deepEqual(byId["from-avani-1"].actions[0], { kind: "catch", status: "available" });
  assert.deepEqual(byId["from-avani-2"].actions[0], { kind: "mark_sorted", status: "available" });
  assert.deepEqual(byId.snoozed.actions[0], { kind: "bring_back", status: "available" }, "snoozed: Bring back, not Catch");
  assert.equal(byId.snoozed.snoozed_until, iso("2026-10-13", 17 * 60));
  assert.equal(byId["fresh-sent"].actions[0].status, "unavailable");
  assert.match(byId["fresh-sent"].actions[0].reason, /^Too soon to nudge — it was sent or changed only a few hours ago\.$/, "the reason is the timing rule, not just “not caught”");
  assert.match(byId.nudged.actions[0].reason, /^Nudged recently/);
  assert.equal(byId.done.lifecycle, "sorted");
  assert.deepEqual(byId.done.actions.map((a) => a.kind), ["open"]);
  assert.equal(p.completeness.matched_total, 6, "duplicates removed");
  assert.equal(validPresentation({ ...p, blocks: [{ type: "thing_list", groups: [{ key: "a", title: "A", total: 2, records: [byId.done, byId.done] }] }] }), false, "duplicate ids are rejected");
  assert.equal(recordActions(thing("x", AVANI, RAVI1, { sent_by_me: false, in_my_court: false }), ws).map((a) => a.kind).join(), "open", "someone else's pair: open only");
});

test("a long first sentence becomes a short heading without losing the text", async () => {
  const { splitAnswer } = await import("../server/lib/coey/agent/agent.ts");
  const long = "There are 2 Things you sent to Bharat KTest that are past their usual follow-up time, but neither can be nudged yet because they were sent today.";
  const out = splitAnswer(long, null);
  assert.equal(out.heading, "There are 2 Things you sent to Bharat KTest that are past their usual follow-up time");
  assert.equal(out.description, long);
  assert.deepEqual(splitAnswer("Nothing overdue. You are clear.", null), { heading: "Nothing overdue", description: "You are clear." });
});


test("a received Thing can be proposed for personal Later without a promise or changing urgency", async () => {
  const tools = new AgentTools(workspace(), "work");
  const moved = await run(tools, "propose_action", {type:"move_lane",thing_id:"from-avani-1",args:{lane:"later"}});
  assert.equal(moved.result.proposed,true);
  assert.equal(moved.action.type,"set_court_lane");
  assert.deepEqual(moved.action.params,{lane:"later"});
  assert.equal((await run(tools,"propose_action",{type:"move_lane",thing_id:"to-avani",args:{lane:"later"}})).result.proposed,false);
});
