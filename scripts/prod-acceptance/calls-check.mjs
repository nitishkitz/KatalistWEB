import { signIn, rpc, rest } from "./api-lib.mjs";
const A = await signIn("A"), B = await signIn("B"), C = await signIn("C");
const out = [];
const log = (name, ok, detail = "") => out.push({ check: name, ok, ...(detail !== "" ? { detail } : {}) });
async function connect(x, y) {
  const r = await rpc(x, "send_contact_request", { p_addressee_profile_id: y.id });
  if (r.body?.status === "pending" && r.body.addressee_profile_id === y.id) await rpc(y, "respond_contact_request", { p_request_id: r.body.id, p_accept: true });
  else if (r.body?.status === "pending") await rpc(x, "respond_contact_request", { p_request_id: r.body.id, p_accept: true });
}
await connect(C, A); await connect(C, B);
const group = (await rpc(A, "create_group", { p_name: "KTest call group", p_member_ids: [B.id, C.id], p_context: "work" })).body;
const gid = Array.isArray(group) ? group[0].id : group.id;
const rung = (await rpc(A, "ring_call", { p_list_id: gid, p_recipients: [B.id, C.id], p_call_type: "audio" })).body;
log("A rings B and C in the group", Array.isArray(rung) && rung.length === 2);
const bRings = (await rest(B, "call_rings?select=caller_profile_id,recipient_profile_id")).body;
log("B sees one ring, from A, addressed to B", bRings.length >= 1 && bRings.every((r) => r.recipient_profile_id === B.id && r.caller_profile_id === A.id));
const spoof = await rest(B, "call_signals", { method: "POST", body: JSON.stringify({ list_id: gid, from_profile: C.id, from_session: "s", to_profile: A.id, kind: "sdp", payload: {} }) });
log("B cannot send a signal as C", spoof.status >= 400, `HTTP ${spoof.status}`);
const honest = await rest(B, "call_signals", { method: "POST", body: JSON.stringify({ list_id: gid, from_session: "s", to_profile: A.id, kind: "sdp", payload: {} }) });
log("B can signal A as itself", honest.status === 201, `HTTP ${honest.status}`);
const aSignals = (await rest(A, "call_signals?select=from_profile&kind=eq.sdp")).body;
log("A sees the signal stamped as B", aSignals.length >= 1 && aSignals.every((s) => s.from_profile === B.id));
const cPeek = (await rest(C, "call_signals?select=id&kind=eq.sdp")).body;
log("C cannot read signals meant for A", Array.isArray(cPeek) && cPeek.length === 0);

await rpc(C, "block_contact", { p_other_profile_id: A.id });
const after = (await rpc(A, "ring_call", { p_list_id: gid, p_recipients: [B.id, C.id] })).body;
log("After C blocks A: A's ring reaches B only", Array.isArray(after) && after.length === 1 && after[0] === B.id, JSON.stringify(after));
const toC = await rest(A, "call_signals", { method: "POST", body: JSON.stringify({ list_id: gid, from_session: "s", to_profile: C.id, kind: "sdp", payload: {} }) });
log("A cannot signal C after the block", toC.status >= 400, `HTTP ${toC.status}`);
const asB = await rest(A, "call_signals", { method: "POST", body: JSON.stringify({ list_id: gid, from_profile: B.id, from_session: "s", to_profile: C.id, kind: "sdp", payload: {} }) });
log("A cannot reach C by claiming to be B", asB.status >= 400, `HTTP ${asB.status}`);
const cRingsFromA = (await rest(C, `call_rings?select=id&caller_profile_id=eq.${A.id}`)).body;
log("C has no pending rings from A", Array.isArray(cRingsFromA) && cRingsFromA.length === 0);
const bye = (await rest(A, "call_signals?select=from_profile,kind&kind=eq.bye")).body;
log("A was told to hang up any call with C", bye.some((s) => s.from_profile === C.id));
const bStill = await rest(B, "call_signals", { method: "POST", body: JSON.stringify({ list_id: gid, from_session: "s", to_profile: C.id, kind: "sdp", payload: {} }) });
log("B (not blocked) can still reach C", bStill.status === 201, `HTTP ${bStill.status}`);
// Tidy: unblock and keep C connected to nobody new.
await rpc(C, "unblock_contact", { p_other_profile_id: A.id });
console.log(JSON.stringify(out.map((x) => `${x.ok ? "PASS" : "FAIL"} ${x.check}${x.detail ? ` (${x.detail})` : ""}`), null, 1));
