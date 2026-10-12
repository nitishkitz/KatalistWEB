// LIVE probe for Coey text turns. Needs a real session: COEY_BASE_URL and COEY_ACCESS_TOKEN (a Supabase access
// token for an approved test account). Read-only: it only asks questions. Prints timings, route and answer
// length, never the token. Usage: COEY_BASE_URL=https://host COEY_ACCESS_TOKEN=... node scripts/coey-live-probe.mjs [--bypass SECRET]
const base = process.env.COEY_BASE_URL, token = process.env.COEY_ACCESS_TOKEN;
if (!base || !token) { console.error("Set COEY_BASE_URL and COEY_ACCESS_TOKEN."); process.exit(2); }
const bypass = process.env.COEY_VERCEL_BYPASS;
const prompts = ["whats up today", "hi", "What needs my attention?", "Who needs a nudge?", "What is overdue?", "What changed this week?",
  "wats up", "good morning", "anything urgent for me", "what should I focus on first", "which of my things is most at risk", "summarize my work",
  "what is late", "who is overloaded", "what did Ajju change yesterday", "how many things are active", "whats due today", "any follow ups needed"];
const out = [];
for (const question of prompts) {
  const t0 = performance.now(); const at = {}; let route = null, len = 0, notice = null, error = null, rows = 0;
  const res = await fetch(`${base}/api/assistant/stream`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}) }, body: JSON.stringify({ question, context: "work", history: [] }) });
  if (!res.ok || !res.body) { out.push({ question, status: res.status }); continue; }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = frame.split("\n").find((l) => l.startsWith("data: ")); if (!data) continue;
      const e = JSON.parse(data.slice(6)); const t = Math.round(performance.now() - t0);
      at[e.type] ??= t; if (e.type === "status") at[`status:${e.stage}`] ??= t;
      if (e.type === "answer") { len = e.answer.answer_markdown.length; notice = e.answer.notice ?? null; rows = (e.answer.groups ?? []).reduce((n, g) => n + g.total, 0); }
      if (e.type === "completed") route = e.timings?.route ?? null, at.server = e.timings;
      if (e.type === "error") error = e.code;
    }
  }
  out.push({ question, route, firstEventMs: at.accepted, firstStatusMs: at["status:reading_facts"] ?? null, firstTextMs: at.text_delta ?? at.answer, answerMs: at.answer, totalMs: at.completed ?? null, answerChars: len, rows, notice, error, server: at.server });
}
console.log(JSON.stringify(out, null, 2));
