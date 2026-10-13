// Real production API as the verification accounts. Signs in through the deployed
// static-code login path; never prints codes or tokens.
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
export const SUPA = "https://katalist-web.vercel.app/supabase"; // same proxy the app uses
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const BASE = "https://katalist-web.vercel.app";
export const PHONES = { A: "+919000000101", B: "+919000000102", C: "+919000000103" };

export async function signIn(k) {
  const cfg = await (await fetch(`${BASE}/api/auth/login-config`)).json();
  const r = await fetch(`${BASE}/api/auth/phone-login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: PHONES[k], otp: cfg.staticCode }) });
  const { token_hash } = await r.json();
  const v = await fetch(`${SUPA}/auth/v1/verify`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ type: "magiclink", token_hash }) });
  const s = await v.json();
  if (!s.access_token) throw new Error(`sign-in failed for ${k}`);
  return { k, token: s.access_token, id: s.user.id };
}
export async function rpc(u, fn, args = {}) {
  const r = await fetch(`${SUPA}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: KEY, authorization: `Bearer ${u.token}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}
export async function rest(u, path, init = {}) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, authorization: `Bearer ${u.token}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers || {}) } });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}
