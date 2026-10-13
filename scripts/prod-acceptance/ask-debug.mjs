import { signIn } from "./api-lib.mjs";
const A = await signIn("A");
async function turn(question, history = [], previous_query = null) {
  const r = await fetch("https://katalist-web.vercel.app/api/assistant/stream", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${A.token}` }, body: JSON.stringify({ question, context: "work", history, reuse: false, previous_query }) });
  const text = await r.text();
  const answer = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5))).find((e) => e.type === "answer");
  return answer;
}
const a1 = await turn("what's pending with Bharat?");
console.log(JSON.stringify({ md: a1?.answer?.answer_markdown, intent: a1?.answer?.intent, q: a1?.answer?.structured_query, groups: a1?.answer?.groups?.map((g) => g.thing_ids.length),
  facts: a1?.facts?.things?.map((t) => ({ title: t.title, status: t.status, assignee: t.assignee_name, owner_is_me: t.owner_actor_id })).slice(0, 8) }, null, 1));
const h = [{ role: "user", content: "show Bharat's overdue Things" }, { role: "assistant", content: "Nothing with Bharat KTest is past its date." }];
const a2 = await turn("and Avani?", h, { about_person: "Bharat KTest", exclude_self: false, state: "pending", window: "overdue" });
console.log(JSON.stringify({ md: a2?.answer?.answer_markdown, intent: a2?.answer?.intent, q: a2?.answer?.structured_query }, null, 1));
