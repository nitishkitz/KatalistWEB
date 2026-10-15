import assert from "node:assert/strict";
import { mock, test } from "node:test";

let authorized = false,
  serviceCalls = 0;
class DescriptionImproveError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
mock.module("@tanstack/react-router", {
  namedExports: { createFileRoute: () => (options) => options },
});
mock.module("@/lib/assistant-route.server", {
  namedExports: {
    requireAssistantUser: async () => {
      if (!authorized)
        throw Response.json({ message: "Authentication required." }, { status: 401 });
      return { userId: "verified-owner", client: {} };
    },
    assistantJson: (body, status = 200) =>
      Response.json(body, { status, headers: { "cache-control": "no-store" } }),
  },
});
mock.module("../server/lib/improve-description.ts", {
  namedExports: {
    DescriptionImproveError,
    improveDescription: async (body, options) => {
      serviceCalls++;
      assert.equal(options.userId, "verified-owner");
      if (body.reject)
        throw new DescriptionImproveError(403, "Only the owner can improve this description.");
      return { document: body.document };
    },
  },
});
const { Route } = await import("../src/routes/api/things/improve-description.ts");
const post = (request) => Route.server.handlers.POST({ request });
test("unauthenticated requests never reach description processing", async () => {
  authorized = false;
  serviceCalls = 0;
  const response = await post(
    new Request("https://example.test/api/things/improve-description", {
      method: "POST",
      body: "not even json",
    }),
  );
  assert.equal(response.status, 401);
  assert.equal(serviceCalls, 0);
});
test("malformed JSON and oversized bodies are rejected before service execution", async () => {
  authorized = true;
  serviceCalls = 0;
  for (const [body, status] of [
    ["bad json", 400],
    [JSON.stringify({ text: "x".repeat(65_000) }), 413],
  ]) {
    const response = await post(
      new Request("https://example.test/api/things/improve-description", { method: "POST", body }),
    );
    assert.equal(response.status, status);
  }
  assert.equal(serviceCalls, 0);
});
test("the route returns owner errors and successful suggestions without caching", async () => {
  authorized = true;
  const denied = await post(
    new Request("https://example.test/api/things/improve-description", {
      method: "POST",
      body: JSON.stringify({ reject: true }),
    }),
  );
  assert.equal(denied.status, 403);
  assert.match((await denied.json()).message, /owner/);
  const document = { type: "doc", content: [{ type: "paragraph" }] };
  const response = await post(
    new Request("https://example.test/api/things/improve-description", {
      method: "POST",
      body: JSON.stringify({ document }),
    }),
  );
  assert.deepEqual(await response.json(), { document });
  assert.equal(response.headers.get("cache-control"), "no-store");
});
