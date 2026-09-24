import assert from "node:assert/strict";
import { test, mock } from "node:test";

let networkAttempts = 0;
mock.module("@/hooks/useSession", { namedExports: {
  DEMO_PERSONAS: [{ key: "priya", name: "Priya", email: "priya@example.test", avatarUrl: "/avatars/priya.jpg" }],
  useSession: () => ({}),
  getStoredDemoSession: () => ({ user: { id: "demo-priya", app_metadata: { provider: "demo" } } }),
} });
mock.module("@/integrations/supabase/client", { namedExports: { supabase: {
  from: () => { networkAttempts++; throw new Error("preview must not query live profiles"); },
  rpc: () => { networkAttempts++; throw new Error("preview must not query live RPCs"); },
} } });
mock.module("@/lib/authed-fetch", { namedExports: { authedFetch: () => {
  networkAttempts++;
  throw new Error("preview must not query the server directory");
} } });

const { fetchProfileIdentities, fetchProfileIdentitiesByIds } = await import("@/features/people/directory");

test("T06 preview directory resolves sample identities without live network requests", async () => {
  const rows = await fetchProfileIdentities();
  assert.deepEqual(rows.map((row) => row.id), ["p-priya"]);
  const scoped = await fetchProfileIdentitiesByIds(["p-priya"]);
  assert.deepEqual(scoped.map((row) => row.id), ["p-priya"]);
  assert.equal(networkAttempts, 0);
});
