import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/features/notifications/NotificationPanel.tsx", import.meta.url),
  "utf8",
);

test("morning brief notification requests the shared review surface", () => {
  assert.match(
    source,
    /const reviewCourt = async[\s\S]*?requestCatchupOpen\(\);[\s\S]*?navigate\(\{ to: "\/" \}\)/,
  );
});
