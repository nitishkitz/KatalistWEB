import { boundPatch, deriveCheckState } from "@/features/code-activity/format";
import type {
  ActivityChange,
  ActivityFeedData,
  AssigneeCandidate,
  ChangeFile,
  CheckRun,
  ListRole,
  PatchState,
} from "@/features/code-activity/types";

/**
 * Labeled sample data for the isolated Code Activity preview.
 * Every name, repository, and number here is invented. No real service is contacted.
 * Source URLs use the reserved ".invalid" host so they can never resolve.
 */
export const PREVIEW_LABEL = "Preview · sample data";
export const SAMPLE_REPOSITORY = "example-org/website";
export const SAMPLE_HOST = "https://github.invalid";

export interface PreviewPerson {
  actorId: string;
  name: string;
  role: ListRole;
}

/** Invented List members. The owner is listed separately from members, as in the real data model. */
export const PREVIEW_PEOPLE: readonly PreviewPerson[] = [
  { actorId: "sample-owner", name: "Alex R.", role: "owner" },
  { actorId: "sample-collab-1", name: "Sam B.", role: "collaborator" },
  { actorId: "sample-collab-2", name: "Jo K.", role: "collaborator" },
  { actorId: "sample-viewer", name: "Pat L.", role: "view_only" },
];

/** The person the preview acts as, by chosen role. */
export function previewViewer(role: ListRole): PreviewPerson {
  return PREVIEW_PEOPLE.find((p) => p.role === role) ?? PREVIEW_PEOPLE[0];
}

/**
 * Assignee candidates are the Owner and current Collaborators only.
 * View Only members are never offered (feature-specific restriction).
 */
export function previewCandidates(role: ListRole): AssigneeCandidate[] {
  const viewer = previewViewer(role);
  return PREVIEW_PEOPLE.filter((p): p is PreviewPerson & { role: "owner" | "collaborator" } => p.role !== "view_only").map((p) => ({
    actorId: p.actorId,
    name: p.name,
    role: p.role,
    isSelf: p.actorId === viewer.actorId,
  }));
}

const iso = (now: number, minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

function countPatch(patch: string | null): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of (patch ?? "").split("\n")) {
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

function textFile(path: string, status: ChangeFile["status"], patch: string): ChangeFile {
  const bounded = boundPatch(patch);
  const counts = countPatch(patch);
  return {
    path,
    status,
    additions: counts.additions,
    deletions: counts.deletions,
    patchState: bounded.state as PatchState,
    patch: bounded.text,
  };
}

const NAV_PATCH = [
  "@@ -48,8 +48,10 @@ export function Navigation() {",
  "   const links = useNavLinks()",
  " ",
  "-  const isOpen = open",
  "-  return (",
  "+  const isMobile = useBreakpoint('md')",
  "+  const isOpen = open && !isMobile",
  "+  // TODO: <img src=x onerror=\"alert('not executed')\"> is shown as text",
  "+",
  "   return (",
  '     <nav className="relative">',
  "       <button",
].join("\n");

const BREAKPOINT_PATCH = [
  "@@ -0,0 +1,6 @@",
  "+import { useEffect, useState } from 'react'",
  "+",
  "+export function useBreakpoint(name: 'md' | 'lg') {",
  "+  const [match, setMatch] = useState(false)",
  "+  return match",
  "+}",
].join("\n");

const LONG_GENERATED_PATCH = (() => {
  const lines = ["@@ -1,2 +1,2600 @@"];
  for (let i = 0; i < 2600; i += 1) lines.push(`+export const route${i} = { id: ${i}, path: '/generated/${i}' }`);
  return lines.join("\n");
})();

const MERGED_PATCH = [
  "@@ -12,7 +12,7 @@ export function Page() {",
  "   return (",
  "-    <div className=\"w-[420px]\">",
  "+    <div className=\"w-full max-w-[420px]\">",
  "       <Content />",
  "     </div>",
].join("\n");

const run = (
  id: string,
  name: string,
  status: CheckRun["status"],
  conclusion: CheckRun["conclusion"],
  durationLabel: string | null,
): CheckRun => ({ id, name, status, conclusion, durationLabel, url: `${SAMPLE_HOST}/${SAMPLE_REPOSITORY}/runs/${id}` });

const SHA_128 = "2f4c8e7a91b3d5c07e6f4a2b8c1d3e5f7a9b0c2d";
const SHA_127 = "9a6b3d1c4e5f6071829304a5b6c7d8e9f0a1b2c3";
const SHA_PUSH = "7c1d9e3f5a7b9c1d3e5f7a9b1c3d5e7f9a1b3c5d";
const SHA_126 = "4e9c2b0a1d3f5e7c9b1a3d5f7e9c1b3a5d7f9e1c";
const SHA_125 = "5b8a1c3e5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c";
const SHA_124_NEW = "9ac01de3b5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5";
const SHA_124_OLD = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

/**
 * The default sample feed. Covers every state the design names: each pull request state,
 * each check state, a push with no pull request, an unknown author, a bot, unknown sizes,
 * stale checks, partial files, and an explicit history gap.
 */
export function buildPreviewChanges(now: number): ActivityChange[] {
  const checks128 = [
    run("128-build", "build", "completed", "failure", "1m 12s"),
    run("128-e2e", "e2e-smoke", "in_progress", null, null),
    run("128-lint", "lint", "completed", "success", "38s"),
    run("128-types", "typecheck", "completed", "success", "52s"),
  ];
  const files128: ChangeFile[] = [
    textFile("src/navigation.tsx", "modified", NAV_PATCH),
    textFile("src/utils/breakpoints.ts", "added", BREAKPOINT_PATCH),
    { path: "src/assets/menu-icon.png", status: "added", additions: null, deletions: null, patchState: "binary", patch: null },
    textFile("src/generated/routes.gen.ts", "modified", LONG_GENERATED_PATCH),
  ];
  const checks127 = [run("127-lint", "lint", "completed", "success", "31s"), run("127-build", "build", "completed", "success", "1m 02s")];
  const checksPush = [run("push-e2e", "e2e-smoke", "in_progress", null, null)];
  const checks124 = [run("124-lint", "lint", "completed", "success", "30s")];

  // Provider totals count line changes only, so a binary file (unknown counts) contributes nothing.
  const sum = (files: ChangeFile[], key: "additions" | "deletions") => files.reduce((n, f) => n + (f[key] ?? 0), 0);

  return [
    {
      id: "pr-128",
      kind: "pull_request",
      title: "#128 Responsive navigation",
      number: 128,
      prState: "open",
      author: { name: "Sam B.", kind: "user" },
      headBranch: "feat/navigation",
      baseBranch: "main",
      headSha: SHA_128,
      updatedAt: iso(now, 118),
      additions: sum(files128, "additions"),
      deletions: sum(files128, "deletions"),
      changedFiles: files128.length,
      sourceUrl: `${SAMPLE_HOST}/${SAMPLE_REPOSITORY}/pull/128`,
      commitUrl: `${SAMPLE_HOST}/${SAMPLE_REPOSITORY}/commit/${SHA_128}`,
      description:
        "Adds a collapsing menu below the md breakpoint and hides the desktop links on narrow screens.\n\nFixes the overlap reported on small phones. <script>alert('not executed')</script>",
      checkState: deriveCheckState(checks128),
      checksRevision: SHA_128,
      checksStale: false,
      checks: checks128,
      checksPartial: false,
      files: files128,
      filesPartial: false,
      gap: null,
    },
    {
      id: "pr-127",
      kind: "pull_request",
      title: "#127 Fix mobile overflow",
      number: 127,
      prState: "merged",
      author: { name: "Jo K.", kind: "user" },
      headBranch: "fix/mobile-overflow",
      baseBranch: "main",
      headSha: SHA_127,
      updatedAt: iso(now, 300),
      additions: 1,
      deletions: 1,
      changedFiles: 1,
      sourceUrl: `${SAMPLE_HOST}/${SAMPLE_REPOSITORY}/pull/127`,
      commitUrl: `${SAMPLE_HOST}/${SAMPLE_REPOSITORY}/commit/${SHA_127}`,
      description: "Stops the page body from scrolling sideways on narrow screens.",
      checkState: deriveCheckState(checks127),
      checksRevision: SHA_127,
      checksStale: false,
      checks: checks127,
      checksPartial: false,
      files: [textFile("src/pages/Home.tsx", "modified", MERGED_PATCH)],
      filesPartial: false,
      gap: null,
    },
    {
      id: "push-main-7c1d9e3",
      kind: "push",
      title: "Push to main · 2 commits",
      number: null,
      prState: null,
      author: { name: "Unknown author", kind: "unknown" },
      headBranch: "main",
      baseBranch: null,
      headSha: SHA_PUSH,
      updatedAt: iso(now, 360),
      additions: null,
      deletions: null,
      changedFiles: null,
      sourceUrl: null,
      commitUrl: `${SAMPLE_HOST}/${SAMPLE_REPOSITORY}/commit/${SHA_PUSH}`,
      description: null,
      checkState: deriveCheckState(checksPush),
      checksRevision: SHA_PUSH,
      checksStale: false,
      checks: checksPush,
      checksPartial: false,
      files: [
        {
          path: "src/legacy/cache.ts",
          status: "modified",
          additions: null,
          deletions: null,
          patchState: "unavailable",
          patch: null,
        },
      ],
      filesPartial: false,
      gap: null,
    },
    {
      id: "gap-oct-03-05",
      kind: "gap",
      title: "Some history could not be rebuilt",
      number: null,
      prState: null,
      author: { name: "Katalist", kind: "bot" },
      headBranch: null,
      baseBranch: null,
      headSha: null,
      updatedAt: iso(now, 1_700),
      additions: null,
      deletions: null,
      changedFiles: null,
      sourceUrl: null,
      commitUrl: null,
      description: null,
      checkState: "none",
      checksRevision: null,
      checksStale: false,
      checks: [],
      checksPartial: false,
      files: [],
      filesPartial: false,
      gap: { from: iso(now, 4_400), to: iso(now, 1_700), reason: "missed_unrecoverable" },
    },
    {
      id: "pr-126",
      kind: "pull_request",
      title: "#126 Update page metadata",
      number: 126,
      prState: "draft",
      author: { name: "dependabot (bot)", kind: "bot" },
      headBranch: "chore/metadata",
      baseBranch: "main",
      headSha: SHA_126,
      updatedAt: iso(now, 1_500),
      additions: 4,
      deletions: 2,
      changedFiles: 1,
      sourceUrl: `${SAMPLE_HOST}/${SAMPLE_REPOSITORY}/pull/126`,
      commitUrl: `${SAMPLE_HOST}/${SAMPLE_REPOSITORY}/commit/${SHA_126}`,
      description: null,
      checkState: "none",
      checksRevision: null,
      checksStale: false,
      checks: [],
      checksPartial: false,
      files: [textFile("src/seo.ts", "modified", "@@ -1,3 +1,5 @@\n-export const title = 'Home'\n+export const title = 'Website'\n+export const description = 'Home'")],
      filesPartial: false,
      gap: null,
    },
    {
      id: "pr-125",
      kind: "pull_request",
      title: "#125 Refresh hero copy",
      number: 125,
      prState: "closed",
      author: { name: "Sam B.", kind: "user" },
      headBranch: "feat/hero-copy",
      baseBranch: "main",
      headSha: SHA_125,
      updatedAt: iso(now, 1_560),
      additions: null,
      deletions: null,
      changedFiles: null,
      sourceUrl: `${SAMPLE_HOST}/${SAMPLE_REPOSITORY}/pull/125`,
      commitUrl: `${SAMPLE_HOST}/${SAMPLE_REPOSITORY}/commit/${SHA_125}`,
      description: "Closed without merging.",
      checkState: deriveCheckState([], false),
      checksRevision: null,
      checksStale: false,
      checks: [],
      checksPartial: false,
      files: [],
      filesPartial: false,
      gap: null,
    },
    {
      id: "pr-124",
      kind: "pull_request",
      title: "#124 Rework footer layout",
      number: 124,
      prState: "open",
      author: { name: "Jo K.", kind: "user" },
      headBranch: "feat/footer",
      baseBranch: "main",
      headSha: SHA_124_NEW,
      updatedAt: iso(now, 2_900),
      additions: 310,
      deletions: 120,
      changedFiles: 412,
      sourceUrl: `${SAMPLE_HOST}/${SAMPLE_REPOSITORY}/pull/124`,
      commitUrl: `${SAMPLE_HOST}/${SAMPLE_REPOSITORY}/commit/${SHA_124_NEW}`,
      description: "A large layout change. Newer commits have not reported checks yet.",
      checkState: deriveCheckState(checks124),
      checksRevision: SHA_124_OLD,
      checksStale: true,
      checks: checks124,
      checksPartial: false,
      files: [textFile("src/footer.tsx", "modified", MERGED_PATCH)],
      filesPartial: true,
      gap: null,
    },
  ];
}

export function buildPreviewFeed(now: number, variant: "normal" | "empty" = "normal"): ActivityFeedData {
  return {
    repositoryFullName: SAMPLE_REPOSITORY,
    freshness: { lastSyncedAt: iso(now, 14), syncStatus: "ok" },
    changes: variant === "empty" ? [] : buildPreviewChanges(now),
  };
}

/** Repositories offered in the preview connection step. Invented; the real list will come only from the server. */
export const PREVIEW_REPOSITORIES: ReadonlyArray<{
  id: string;
  fullName: string;
  visibility: "private" | "public";
  updatedLabel: string;
}> = [
  { id: "sample-repo-1", fullName: SAMPLE_REPOSITORY, visibility: "private", updatedLabel: "updated 2 hours ago" },
  { id: "sample-repo-2", fullName: "example-org/docs", visibility: "public", updatedLabel: "updated 3 days ago" },
  { id: "sample-repo-3", fullName: "example-org/api", visibility: "private", updatedLabel: "updated 1 week ago" },
];
