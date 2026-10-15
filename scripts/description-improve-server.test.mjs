import test from "node:test";
import assert from "node:assert/strict";
import { improveDescription, DescriptionImproveError } from "../server/lib/improve-description.ts";
const document = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "bad prose" }] }],
};
function client(owner = true) {
  return {
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return {
            data: table === "things" ? { owner_actor_id: "actor" } : owner ? { id: "actor" } : null,
            error: null,
          };
        },
      };
    },
  };
}
test("ownership checked before provider and no provider call for URL only", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw Error("unexpected");
  };
  await assert.rejects(
    improveDescription(
      { thingId: "thing", document },
      { userId: "user", client: client(false), fetchImpl, apiKey: "test" },
    ),
    (e) => e instanceof DescriptionImproveError && e.status === 403,
  );
  await assert.rejects(
    improveDescription(
      {
        thingId: "thing",
        document: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "https://example.com" }] },
          ],
        },
      },
      { userId: "user", client: client(), fetchImpl, apiKey: "test" },
    ),
    (e) => e.status === 422,
  );
  assert.equal(calls, 0);
});
test("bounded JSON provider contract produces document and no tools", async () => {
  const result = await improveDescription(
    { thingId: "thing", document },
    {
      userId: "success",
      client: client(),
      apiKey: "test",
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        assert.ok(body.max_tokens <= 8192, "must also fit sarvam-105b-conversations output limit");
        assert.equal(body.tools, undefined);
        assert.ok(body.messages[0].content.includes("untrusted"));
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({ replacements: [{ id: 0, text: "Better prose" }] }),
              },
            },
          ],
        });
      },
    },
  );
  assert.equal(result.document.content[0].content[0].text, "Better prose");
});
test("rejects malformed selection before calling provider", async () => {
  await assert.rejects(
    improveDescription(
      { thingId: "thing", document, selection: { from: 0, to: 999 } },
      {
        userId: "invalid",
        client: client(),
        apiKey: "test",
        fetchImpl: () => {
          throw Error("unexpected");
        },
      },
    ),
    (e) => e.status === 400,
  );
});
test("malformed provider output and oversized responses are rejected safely", async () => {
  for (const content of [
    "not json",
    JSON.stringify({ replacements: [{ id: 999, text: "oops" }] }),
    "x".repeat(250_000),
  ]) {
    await assert.rejects(
      improveDescription(
        { thingId: "thing", document },
        {
          userId: `malformed-${content.length}`,
          client: client(),
          apiKey: "test",
          fetchImpl: async () => Response.json({ choices: [{ message: { content } }] }),
        },
      ),
      (e) => e.status === 502,
    );
  }
});
test("per-user quota stops additional provider calls", async () => {
  let calls = 0;
  const options = {
    userId: "limited-user",
    client: client(),
    apiKey: "test",
    fetchImpl: async () => {
      calls++;
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({ replacements: [{ id: 0, text: "Better prose" }] }),
            },
          },
        ],
      });
    },
  };
  for (let i = 0; i < 8; i++) await improveDescription({ thingId: "thing", document }, options);
  await assert.rejects(
    improveDescription({ thingId: "thing", document }, options),
    (e) => e.status === 429,
  );
  assert.equal(calls, 8);
});
test("provider deadline returns a friendly timeout", async () => {
  await assert.rejects(
    improveDescription(
      { thingId: "thing", document },
      {
        userId: "timeout-user",
        client: client(),
        apiKey: "test",
        timeoutMs: 1,
        fetchImpl: async (_url, { signal }) => {
          await new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            setTimeout(resolve, 30);
          });
          throw Error("unexpected");
        },
      },
    ),
    (e) => e.status === 504,
  );
});
