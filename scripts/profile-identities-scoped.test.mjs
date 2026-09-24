import assert from "node:assert/strict";
import { test, mock } from "node:test";

const requests = [];
mock.module("@/integrations/supabase/client", {
  namedExports: { supabase: {
    from: (table) => {
      assert.equal(table, "public_identities");
      return { select: () => ({
        in: (_column, ids) => {
          requests.push(ids);
          return Promise.resolve({ data: ids.map((id) => ({ id, display_name: `Member ${id}`, avatar_url: null })), error: null });
        },
      }) };
    },
  } },
});
mock.module("@/hooks/useSession", { namedExports: { DEMO_PERSONAS: [], useSession: () => ({}) } });
mock.module("@/lib/session-mode", { namedExports: { isPreviewSession: () => false } });

const { fetchProfileIdentitiesByIds } = await import("@/features/people/directory");

test("participant identity lookup requests only supplied IDs in bounded chunks", async () => {
  requests.length = 0;
  const ids = Array.from({ length: 201 }, (_, index) => `id-${index}`);
  const result = await fetchProfileIdentitiesByIds([...ids, ids[0]]);
  assert.equal(result.length, 201);
  assert.deepEqual(requests.map((batch) => batch.length), [100, 100, 1]);
  assert.deepEqual(requests.flat(), ids);
  assert.ok(result.every((profile) => profile.email === null));
});
