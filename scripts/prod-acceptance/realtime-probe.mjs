import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { signIn, rpc } from "./api-lib.mjs";
const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const A = await signIn("A"), B = await signIn("B");
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${B.token}` } } });
sb.realtime.setAuth(B.token);
const events = [];
let status = [];
const ch = sb.channel(`call-rings:${B.id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "call_rings", filter: `recipient_profile_id=eq.${B.id}` }, (p) => events.push({ caller: p.new.caller_profile_id === A.id, recipient: p.new.recipient_profile_id === B.id }))
  .subscribe((s, err) => status.push(s + (err ? `:${err.message}` : "")));
await new Promise((r) => setTimeout(r, 5000));
const dm = (await rpc(A, "get_or_create_dm", { p_other_profile_id: B.id, p_context: "work" })).body;
await rpc(A, "ring_call", { p_list_id: Array.isArray(dm) ? dm[0].id : dm.id, p_recipients: [B.id], p_call_type: "audio" });
await new Promise((r) => setTimeout(r, 6000));
console.log(JSON.stringify({ status, events }));
await sb.removeAllChannels();
process.exit(0);
