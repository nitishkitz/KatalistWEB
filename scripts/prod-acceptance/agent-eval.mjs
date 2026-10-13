import { createClient } from "@supabase/supabase-js";
import { signIn, SUPA } from "./api-lib.mjs";
import { runAgent } from "../../server/lib/coey/agent/agent.ts";
const u = await signIn(process.argv[2] ?? "B");
const client = createClient(SUPA, process.env.VITE_SUPABASE_PUBLISHABLE_KEY, { global: { headers: { Authorization: `Bearer ${u.token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
const convos = [
  ["whats pending with avani", "and which of those are oldest?", "nudge her about the first one"],
  ["mere court mein kya pending hai aaj ka?"],
  ["did I get more done this week than last week"],
  ["what did Avani send me most recently and when is it due"],
  ["snooze the dealer meeting till tomorrow"],
  ["which list has the most open things"],
  ["what is the capital of France"],
  ["catch everything Avani sent me today"],
];
for (const turns of convos) {
  const history = [];
  for (const question of turns) {
    const t0 = Date.now(); const st = [];
    const a = await runAgent({ question, history, mode: "work" }, { client, userId: u.id, apiKey: process.env.SARVAM_API_KEY, model: process.env.SARVAM_MODEL, debug: (w, d) => d.issues?.length && console.log("   [" + w + "]", d.issues.join(" ")) }, (s) => st.push(s), new AbortController().signal).catch((e) => ({ answer_markdown: "ERROR " + e.message }));
    console.log(`\nQ: ${question}  (${Date.now() - t0} ms; ${st.join(" → ")})\nA: ${a ? a.answer_markdown.replace(/\n+/g, " ⏎ ") : "(null → fallback)"}${a?.actions?.length ? `\n   actions: ${a.actions.map((x) => x.label).join(" | ")}` : ""}`);
    history.push({ role: "user", content: question }, { role: "assistant", content: a?.answer_markdown ?? "" });
  }
}
