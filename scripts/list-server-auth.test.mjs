import assert from "node:assert/strict";
import { test } from "node:test";
import { createListInvitation, acceptListInvitation } from "@/features/lists/server/list-invitations";
import { uploadListCover } from "@/features/lists/server/list-covers";

process.env.LIST_COLLABORATION_ENABLED = "true";

test("List collaboration server routes return 401 before parsing unauthenticated input", async () => {
  const requests = [
    createListInvitation(new Request("https://uat.test/api/lists/a/invitations", { method: "POST" }), "a"),
    acceptListInvitation(new Request("https://uat.test/api/list-invitations/accept", { method: "POST" })),
    uploadListCover(new Request("https://uat.test/api/lists/a/cover", { method: "POST" }), "a"),
  ];
  const responses = await Promise.all(requests);
  assert.deepEqual(responses.map((response) => response.status), [401, 401, 401]);
});
