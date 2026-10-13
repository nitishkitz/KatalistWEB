import { signIn, rpc, rest, SUPA } from "./api-lib.mjs";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const A = await signIn("A");
const key = `staging/${A.id}/${crypto.randomUUID()}/ktest-probe.txt`;
const up = await fetch(`${SUPA}/storage/v1/object/thing-attachments/${key}`, { method: "POST", headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${A.token}`, "content-type": "text/plain" }, body: "KTest storage probe" });
console.log("upload", up.status, (await up.text()).slice(0, 220));
const buckets = await fetch(`${SUPA}/storage/v1/bucket`, { headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${A.token}` } });
console.log("buckets", buckets.status, (await buckets.text()).slice(0, 200));
