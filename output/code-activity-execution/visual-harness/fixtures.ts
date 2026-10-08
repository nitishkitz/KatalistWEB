/** MOCKED data shaped like the real read endpoints. Authors, commits and diffs are invented for layout checks only. */
const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const sha = (c: string) => c.repeat(40);

const people = { nitish: "nitishkitz", ajju: "Ajju", narayana: "Narayana", sai: "Sai Kumar" };
const COMMITS = [
  { sha: "71be5b6" + "a".repeat(33), subject: "fix: preserve auth styling during autofill", authorName: "Nitish", authorLogin: people.nitish, min: 12 },
  { sha: "c849a10" + "b".repeat(33), subject: "improve list header spacing", authorName: "Ajju", authorLogin: people.ajju, min: 35 },
  { sha: "3f2d9c1" + "c".repeat(33), subject: "feat: add branch selector and filters", authorName: "Narayana", authorLogin: people.narayana, min: 120 },
  { sha: "9d4e2ff" + "d".repeat(33), subject: "refactor: move api client to services", authorName: "Nitish", authorLogin: people.nitish, min: 240 },
  { sha: "7c3b901" + "e".repeat(33), subject: "chore: update dependencies", authorName: "Sai Kumar", authorLogin: "sai-kumar", min: 1500 },
];
const STATS: Record<string, { a: number; d: number; f: number; checks: [number, number, number] }> = {
  [COMMITS[0].sha]: { a: 18, d: 0, f: 2, checks: [2, 0, 0] },
  [COMMITS[1].sha]: { a: 12, d: 3, f: 4, checks: [1, 0, 0] },
  [COMMITS[2].sha]: { a: 164, d: 39, f: 6, checks: [2, 0, 0] },
  [COMMITS[3].sha]: { a: 92, d: 11, f: 8, checks: [1, 0, 0] },
  [COMMITS[4].sha]: { a: 210, d: 56, f: 12, checks: [3, 0, 0] },
};
const run = (id: number, name: string) => ({ id: String(id), name, status: "completed", conclusion: "success", durationLabel: "1m 12s", url: "https://github.com/acme/web/runs/1" });
const PATCH_CSS = "@@ -20,3 +20,9 @@ .auth-input {\n }\n \n .auth-input:focus {\n   border-color: var(--kg-primary);\n }\n+input:-webkit-autofill {\n+  -webkit-text-fill-color: var(--kg-text-primary);\n+  -webkit-box-shadow: 0 0 0 1000px var(--kg-bg) inset;\n+  transition: background-color 9999s ease-in-out 0s;\n+}";
const PATCH_TEST = "@@ -1,3 +1,9 @@\n import test from \"node:test\";\n+test(\"autofill keeps the themed field\", () => {\n+  assert.ok(true);\n+});";

const saved = (n: number, title: string, state: string, min: number, who: string) => ({
  id: `20000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`,
  kind: "pull_request", title, number: n, prState: state, author: { name: who, kind: "user" }, headBranch: `feature/pr-${n}`, baseBranch: "main", headSha: sha(String(n % 10)),
  updatedAt: ago(min), additions: 40 + n, deletions: 5, changedFiles: 3, sourceUrl: `https://github.com/acme/web/pull/${n}`, commitUrl: null, description: null,
  checkState: "passed", checksRevision: sha(String(n % 10)), checksStale: false, checks: [], checksPartial: false, files: [], filesPartial: false, gap: null,
});

export function answer(url: URL, init: RequestInit): { status: number; body: unknown } {
  const p = url.pathname;
  const mode = new URLSearchParams(location.search).get("state");
  if (mode === "error" && p.endsWith("/commits")) return { status: 502, body: { error: "source_unavailable" } };
  if (p.endsWith("/feed")) return { status: 200, body: { repositoryFullName: "nitishkitz/KatalistWEB", freshness: { lastSyncedAt: ago(2), syncStatus: "ok" }, changes: mode === "empty" ? [] : [saved(12, "feat: workspace layout", "open", 50, "Ajju"), saved(11, "fix: sync badge", "merged", 600, "Narayana")], nextCursor: null, connectionStatus: "active" } };
  if (p.endsWith("/branches")) return { status: 200, body: { defaultBranch: "main", branches: [{ name: "main", sha: sha("1") }, { name: "katalist-plan/batch-a-baseline", sha: sha("2") }, { name: "feature/code-activity", sha: sha("3") }, { name: "develop", sha: sha("4") }], nextCursor: null, complete: true } };
  if (p.endsWith("/compare")) return { status: 200, body: { head: { name: "katalist-plan/batch-a-baseline", sha: sha("2") }, base: { name: "main", sha: sha("1") }, status: "diverged", ahead: 3, behind: 1, checkedAt: ago(0) } };
  if (p.endsWith("/commits")) return { status: 200, body: { items: mode === "empty" ? [] : COMMITS.map((c) => ({ sha: c.sha, subject: c.subject, authorName: c.authorName, authorLogin: c.authorLogin, avatarUrl: null, committedAt: ago(c.min), url: `https://github.com/acme/web/commit/${c.sha}` })), nextCursor: null, windowComplete: true } };
  if (p.endsWith("/deployments")) return { status: 200, body: mode === "permission" ? { permission: "needed", items: [], nextCursor: null, windowComplete: true } : { permission: "ok", items: [{ id: 1, sha: COMMITS[0].sha, ref: "main", environment: "production", createdAt: ago(20), creator: "nitishkitz", description: "Release", state: "success", links: { log: null, target: "https://example.com" } }], nextCursor: null, windowComplete: true } };
  if (p.endsWith("/change-stats")) {
    const ids = (url.searchParams.get("items") ?? "").split(",");
    return { status: 200, body: { results: ids.map((id) => { const s = STATS[id.replace("commit:", "")]; return s ? { id, status: "ok", revision: id.replace("commit:", ""), additions: s.a, deletions: s.d, files: s.f, filesComplete: true, checkState: "passed", checks: { passed: s.checks[0], failing: 0, pending: 0, total: s.checks[0] } } : { id, status: "unavailable", revision: null, additions: null, deletions: null, files: null, filesComplete: false, checkState: null, checks: null }; }) } };
  }
  if (p.endsWith("/commit-detail")) {
    const sh = url.searchParams.get("sha") ?? "";
    const c = COMMITS.find((x) => x.sha === sh) ?? COMMITS[0];
    return { status: 200, body: { detail: { kind: "commit", id: `commit:${c.sha}`, title: c.subject, body: "Keeps the themed field colors when the browser autofills credentials.", author: { name: c.authorName, login: c.authorLogin, avatarUrl: null }, occurredAt: ago(c.min), sha: c.sha, branch: "katalist-plan/batch-a-baseline", base: "main", url: `https://github.com/acme/web/commit/${c.sha}`, stats: { additions: STATS[c.sha].a, deletions: STATS[c.sha].d, files: 2 }, statsComplete: true,
      files: [{ path: "src/features/auth/gate/auth-gate.css", status: "modified", additions: 12, deletions: 0, patchState: "available", patch: PATCH_CSS }, { path: "scripts/auth-gate-no-timeline.test.mjs", status: "modified", additions: 6, deletions: 0, patchState: "available", patch: PATCH_TEST }],
      filesPartial: false, filesUnavailableReason: null, checks: [run(1, "build"), run(2, "test")], checkState: "passed", checksRevision: c.sha, checksPartial: false, deployment: null } } };
  }
  if (p.endsWith("/changes/detail")) return { status: 404, body: { error: "not_found" } };
  return { status: 404, body: { error: "not_found", method: init.method ?? "GET" } };
}
