// Production: an agent-proposed nudge goes through preview → confirm (verification accounts only).
import { signIn, BASE } from "./api-lib.mjs";
const u = await signIn("A");
const post = (path, body) => fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${u.token}` }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const res = await fetch(`${BASE}/api/assistant/stream`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${u.token}` }, body: JSON.stringify({ question: "nudge bharat about the oldest thing I sent him", context: "work", history: [] }) });
const answer = (await res.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6))).find((e) => e.type === "answer")?.answer;
console.log("answer:", answer?.answer_markdown.replace(/\n+/g, " "));
const action = answer?.actions?.find((a) => a.type === "prepare_nudge");
if (!action) { console.log("no nudge proposed"); process.exit(1); }
console.log("proposed:", action.label);
const preview = await post("/api/assistant/action/preview", { type: action.type, targetIds: action.target_ids, params: action.params });
console.log("preview:", preview.status, preview.body?.action?.label, preview.body?.targets?.map((t) => `${t.title}: ${t.state}${t.message ? ` (${t.message})` : ""}`).join("; "));
if (preview.body?.token) {
  const done = await post("/api/assistant/action/confirm", { token: preview.body.token, idempotencyKey: `agent-${Date.now()}` });
  console.log("confirm:", done.status, done.body?.results?.map((t) => `${t.title}: ${t.state}${t.message ? ` (${t.message})` : ""}`).join("; "));
}
