import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("..", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");

test("Bucket Notes render before independent bucket-item loading states", async () => {
  const source = await readSource("src/routes/buckets.$bucketId.tsx");
  const notesBranch = source.indexOf('{detailTab === "notes" ? (');
  const loadingBranch = source.indexOf('itemsSurface === "loading" ? (');
  assert.notEqual(notesBranch, -1, "notes branch should be present");
  assert.notEqual(loadingBranch, -1, "items loading branch should be present");
  assert.ok(notesBranch < loadingBranch, "Notes must not be gated by bucket-item loading/error/empty state");
  assert.match(source, /placeholder="Search Things or Lists"/);
  assert.match(source, /aria-label="Search Things or Lists"/);
});

test("List route resets route-keyed selection in an effect, not during render", async () => {
  const source = await readSource("src/routes/lists.$listId.tsx");
  assert.match(source, /useEffect\(\(\) => \{\s*setSelectedState\(\(current\)/);
  assert.doesNotMatch(source, /if \(selectedState\.listId !== listId\) \{\s*setSelectedState/);
});

test("Bucket note deletion uses the semantic AlertDialog instead of browser confirm", async () => {
  const source = await readSource("src/features/buckets/BucketNotesWorkspace.tsx");
  assert.match(source, /AlertDialogAction/);
  assert.match(source, /Delete this note\?/);
  assert.doesNotMatch(source, /window\.confirm\(/);
});
