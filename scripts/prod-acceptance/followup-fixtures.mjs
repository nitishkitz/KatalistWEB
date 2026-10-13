import { signIn, rpc } from "./api-lib.mjs";
import { writeFileSync } from "node:fs";
const A = await signIn("A"), B = await signIn("B"), C = await signIn("C");
const run = Date.now().toString(36);
const make = async (title, holder, sender = A) => (await rpc(sender, "coey_create_things", { p_idempotency_key: `fu-${run}-${title.replace(/\W+/g, "")}`, p_items: [{ title, text_raw: title, mode: "work", holder_profile_id: holder.id, pace: "normal" }] })).body.things[0].thing_id;
const ids = {
  eligible: await make("KTest follow-up eligible", B),
  promised: await make("KTest follow-up promised", B),
  snoozed: await make("KTest follow-up snoozed", B),
  blocked: await make("KTest follow-up blocked", B),
  onLeave: await make("KTest follow-up on leave", C, B),
};
await rpc(B, "catch_thing", { p_thing_id: ids.promised, p_personal_pace: "next" });
console.log("promise", (await rpc(B, "coey_promise", { p_thing_id: ids.promised, p_promise_at: new Date(Date.now() + 5 * 864e5).toISOString() })).status);
console.log("snooze", (await rpc(B, "snooze_thing", { p_thing_id: ids.snoozed, p_until: new Date(Date.now() + 6 * 3600e3).toISOString() })).status);
console.log("blocker", (await rpc(B, "coey_flag_blocker", { p_thing_id: ids.blocked, p_kind: "third_party", p_note: "transporter" })).status);
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
console.log("leave", (await rpc(C, "set_my_calendar", { p_calendar: { leave: [{ start: today, end: today }] } })).status);
writeFileSync(process.argv[2], JSON.stringify(ids));
console.log(JSON.stringify(ids));
