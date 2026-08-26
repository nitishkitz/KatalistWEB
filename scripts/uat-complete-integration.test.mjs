import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("complete UAT keeps Team, rich Magic Box, Court stacks, and safe existing-user auth", async () => {
  const [teamRoute, court, appShell, floatingMagicBox, magicBox, auth] = await Promise.all([
    read("src/routes/team.tsx"),
    read("src/features/court/CourtDesktop.tsx"),
    read("src/components/layout/AppShell.tsx"),
    read("src/features/court/FloatingMagicBox.tsx"),
    read("src/features/court/MagicBox.tsx"),
    read("src/lib/auth/uat-auth.server.ts"),
  ]);

  assert.match(teamRoute, /createFileRoute\("\/team"\)/);
  assert.match(court, /CourtLaneStack/);
  assert.match(appShell, /FloatingMagicBox/);
  assert.match(floatingMagicBox, /<MagicBox/);
  assert.match(magicBox, /MagicBoxComposer/);
  assert.match(auth, /generateLink/);
  assert.match(auth, /verifyOtp/);
  assert.doesNotMatch(auth, /updateUserById\([\s\S]*password/);
});
