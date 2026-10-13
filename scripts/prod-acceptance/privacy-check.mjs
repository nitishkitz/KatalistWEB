import { signIn, rest } from "./api-lib.mjs";
const C = await signIn("C"), A = await signIn("A");
const cp = (await rest(C, "profiles?select=id,phone_e164,email")).body;
const ci = (await rest(C, "public_identities?select=display_name")).body;
const ai = (await rest(A, "public_identities?select=display_name")).body;
const ap = (await rest(A, "profiles?select=id")).body;
console.log(JSON.stringify({
  C_profiles_rows: cp.length, C_only_self: cp.every((r) => r.id === C.id),
  C_visible_names: ci.map((r) => r.display_name),
  A_profiles_rows: ap.length, A_visible_names: ai.map((r) => r.display_name).sort(),
}, null, 2));
