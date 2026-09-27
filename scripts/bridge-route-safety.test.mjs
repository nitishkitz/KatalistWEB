import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * H08: confirms two things the SQL-level test (bridge-authorization-sql.test.mjs)
 * can't -- that no raw Bridge session token or private payload is ever
 * logged, and that the H08 idempotency token is actually threaded from
 * the client through to the RPC call, not just present in the SQL layer.
 */
const commentRoute = readFileSync(new URL("../src/routes/api/public/bridge/comment.ts", import.meta.url), "utf8");
const actRoute = readFileSync(new URL("../src/routes/api/public/bridge/act.ts", import.meta.url), "utf8");
const thingRoute = readFileSync(new URL("../src/routes/api/public/bridge/thing.ts", import.meta.url), "utf8");
const redeemRoute = readFileSync(new URL("../src/routes/api/public/bridge/redeem.ts", import.meta.url), "utf8");
const sessionServer = readFileSync(new URL("../src/lib/bridge-session.server.ts", import.meta.url), "utf8");
const bridgePage = readFileSync(new URL("../src/routes/bridge.$token.tsx", import.meta.url), "utf8");

const ROUTE_FILES = { commentRoute, actRoute, thingRoute, redeemRoute, sessionServer };

test("no route ever logs the raw session token, redeem token, or request body -- only a generic scope name and the error's own message", () => {
  for (const [name, src] of Object.entries(ROUTE_FILES)) {
    // Every console.* call in these files must not reference the raw
    // session/token/body variable directly as an argument.
    const consoleCalls = src.match(/console\.\w+\([^)]*\)/g) ?? [];
    for (const call of consoleCalls) {
      assert.doesNotMatch(call, /\bsession\b/, `${name}: ${call}`);
      assert.doesNotMatch(call, /\btoken\b/i, `${name}: ${call}`);
      assert.doesNotMatch(call, /\bbody\b/, `${name}: ${call}`);
    }
  }
});

test("no SERVICE_ROLE key material appears anywhere in the Bridge route/session files", () => {
  for (const [name, src] of Object.entries(ROUTE_FILES)) {
    assert.doesNotMatch(src, /SERVICE_ROLE/i, name);
  }
});

test("every Bridge route returns a generic error via bridgeError(), never a raw thrown error/message to the guest", () => {
  for (const [name, src] of [["actRoute", actRoute], ["commentRoute", commentRoute], ["thingRoute", thingRoute], ["redeemRoute", redeemRoute]]) {
    assert.match(src, /bridgeError\(/, name);
    assert.doesNotMatch(src, /return json\(\{\s*error:\s*error\.message/, `${name} must not forward a raw DB error message to the client`);
  }
});

test("the client generates one idempotency token per compose action, reuses it on retry, and clears it on edit or success", () => {
  assert.match(bridgePage, /const \[pendingCommentToken, setPendingCommentToken\] = useState<string \| null>\(null\)/);
  assert.match(bridgePage, /const clientToken = pendingCommentToken \?\? crypto\.randomUUID\(\)/);
  assert.match(bridgePage, /setPendingCommentToken\(clientToken\)/);
  assert.match(bridgePage, /body: JSON\.stringify\(\{ body: comment\.trim\(\), clientToken \}\)/);
  assert.match(bridgePage, /setPendingCommentToken\(null\)/g);
});

test("the comment route validates the client token is a real UUID before forwarding it, and passes it as p_client_token", () => {
  assert.match(commentRoute, /\/\^\[0-9a-f\]\{8\}-/i);
  assert.match(commentRoute, /p_client_token/);
  assert.match(commentRoute, /rpc\('bridge_comment', \{/);
});
