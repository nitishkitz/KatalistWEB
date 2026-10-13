// Production: the user's reported Ask questions, as a verification account. Read-only.
import { signIn, rpc, BASE } from "./api-lib.mjs";
const u = await signIn(process.argv[2] ?? "B");
const qs = ["what things are pending from my side waiting to catch", "whats this weeks progress", "who need the nudge", "who need the nudge the most", "whats my age", "whats pending with avani"];
for (const question of qs) {
  const res = await fetch(`${BASE}/api/assistant/stream`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${u.token}` }, body: JSON.stringify({ question, context: "work", history: [] }) });
  const text = await res.text();
  const answer = text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6))).find((e) => e.type === "answer")?.answer;
  console.log(JSON.stringify(question), "→", answer ? `[${answer.intent}] ${answer.answer_markdown.replace(/\n+/g, " ")}` : `(no answer, HTTP ${res.status})`);
}
const ids = await rpc(u, "list_visible_identities");
console.log("Reassign source (you + connected):", ids.body.filter((r) => r.profile_id === u.id || r.connected).map((r) => r.display_name).join(", "));
