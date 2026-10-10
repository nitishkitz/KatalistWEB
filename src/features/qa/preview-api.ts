/**
 * In-memory QA adapter for explicit demo/preview sessions ONLY.
 *
 * It is selected solely when the signed-in session is a demo session (isPreviewSession). It never
 * reads or writes Supabase, never calls /api/qa, and every value here is invented. Data lives in
 * module memory and is lost on reload. Production sessions cannot reach this file's data: a failed
 * live query is an error, never a fall back to these fixtures.
 */
import type { NumberCursor, QaApi } from "./api-types";
import { cleanSteps, filterCases, filterRunCases, requiresActual, totalsFromStatuses, checkCompletion } from "./domain";
import { QaOperationError, type QaCursor, type QaPage } from "./qa-queries";
import type {
  ImportReport, QaAccount, QaApplication, QaAttempt, QaBuild, QaCase, QaCaseStep, QaEnvironment, QaEvidence, QaGrants, QaHistoryItem, QaPriority, QaResource, QaResultStatus,
  QaRun, QaRunCase, QaSavedView, QaThingLink,
} from "./types";

const PREVIEW_SECRET = "Preview-Only-Not-A-Real-Password";

let seq = 1;
const uid = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const now = () => new Date().toISOString();
const fail = (code: ConstructorParameters<typeof QaOperationError>[0], message: string): never => {
  throw new QaOperationError(code, message);
};

type Store = {
  apps: QaApplication[];
  envs: QaEnvironment[];
  resources: QaResource[];
  builds: QaBuild[];
  accounts: Array<QaAccount & { grants: QaGrants }>;
  cases: QaCase[];
  versions: Map<string, QaCase[]>; // case id -> every version, oldest first
  runs: QaRun[];
  runCases: Array<Omit<QaRunCase, "status" | "attemptId" | "actual" | "attemptedAt" | "testerId" | "attemptCount" | "linkCount">>;
  attempts: Array<QaAttempt & { runId: string }>;
  evidence: Array<QaEvidence & { url: string }>;
  links: QaThingLink[];
  views: QaSavedView[];
  nextCase: number;
};

let store: Store | null = null;

function seed(): Store {
  const web: QaApplication = { id: uid(), name: "Web application", platformKind: "web", description: "Customer web app", archived: false, createdAt: now() };
  const android: QaApplication = { id: uid(), name: "Android application", platformKind: "android", description: null, archived: false, createdAt: now() };
  const ios: QaApplication = { id: uid(), name: "iOS application", platformKind: "ios", description: null, archived: false, createdAt: now() };
  const iot: QaApplication = { id: uid(), name: "IoT devices", platformKind: "iot", description: null, archived: false, createdAt: now() };
  const [dev, qa, uat, prod] = ["DEV", "QA", "UAT", "PROD"].map((name) => ({ id: uid(), name, restricted: name === "PROD", archived: false }));
  const b142: QaBuild = { id: uid(), applicationId: web.id, environmentId: qa.id, identifier: "web.142", displayVersion: "Release 2.8", notesUrl: "https://example.test/notes/142", installUrl: null, config: {}, createdAt: "2026-10-01T09:00:00Z" };
  const b143: QaBuild = { id: uid(), applicationId: web.id, environmentId: qa.id, identifier: "web.143", displayVersion: "Release 2.8.1", notesUrl: null, installUrl: null, config: {}, createdAt: "2026-10-05T09:00:00Z" };
  const res = (type: QaResource["type"], label: string, url: string | null, details: string | null): QaResource => ({ id: uid(), applicationId: web.id, environmentId: qa.id, type, label, url, details, versionNote: null, archived: false });
  const grants: QaGrants = { useRoles: ["owner", "collaborator"], manageRoles: [], useProfiles: [], manageProfiles: [] };
  const acct = (label: string, role: string, username: string): QaAccount & { grants: QaGrants } => ({
    id: uid(), applicationId: web.id, environmentId: qa.id, label, testRole: role, username, instructions: null, hasSecret: true, secretUpdatedAt: now(), createdAt: now(), grants,
  });
  const mk = (n: number, title: string, module: string, priority: QaPriority, steps: QaCaseStep[]): QaCase => ({
    id: uid(), number: n, caseKey: `TC-${String(n).padStart(3, "0")}`, version: 1, versionId: uid(), title, preconditions: null, steps, priority, module, platforms: ["web"], changeNote: null, archived: false, updatedAt: now(),
  });
  const cases = [
    mk(1, "Login with valid credentials", "Authentication", "critical", [{ action: "Open the sign-in page", expected: "Sign-in form is shown" }, { action: "Enter a valid phone number and code", expected: "The Court opens" }]),
    mk(2, "View-only member cannot edit a Thing", "Permissions", "high", [
      { action: "Log in as a member with view-only access to the List", expected: "The List opens" },
      { action: "Open an existing Thing", expected: "Thing detail is shown" },
      { action: "Try to edit the title field", expected: "Editing is unavailable" },
      { action: "Observe the behaviour", expected: "Title is unchanged" },
    ]),
    mk(3, "Toss a Thing to a collaborator", "Things", "high", [{ action: "Toss a new Thing to a collaborator", expected: "The Thing is waiting to be caught" }]),
    mk(4, "Catch an assigned Thing", "Things", "medium", [{ action: "Catch a Thing assigned to you", expected: "The Thing is in progress" }]),
    mk(5, "Move a Thing to Sorted", "Things", "medium", [{ action: "Mark a caught Thing as sorted", expected: "The Thing leaves the active list" }]),
    mk(6, "Recover List Chat after reconnect", "Chat", "medium", [{ action: "Go offline then online", expected: "Chat resumes without duplicates" }]),
    mk(7, "Filter Things by Active", "Things", "low", [{ action: "Apply the Active filter", expected: "Only active Things are listed" }]),
    mk(8, "Open Designs from a Thing", "Designs", "low", [{ action: "Open a Thing with a linked design", expected: "The design opens in Designs" }]),
    mk(9, "Verify List member invitation", "Members", "medium", [{ action: "Invite a member by phone number", expected: "A pending invitation is listed" }]),
    mk(10, "Attach evidence to a Thing", "Things", "low", [{ action: "Attach an image to a Thing", expected: "The attachment is shown" }]),
  ];
  const versions = new Map(cases.map((c) => [c.id, [c]]));
  const run: QaRun = {
    id: uid(), name: "Release 2.8 regression", applicationId: web.id, environmentId: qa.id, buildId: b142.id, config: { browser: "Chrome 129" }, status: "active", predecessorRunId: null,
    createdBy: null, createdAt: "2026-10-02T09:00:00Z", completedAt: null, summary: null,
  };
  const runCases = cases.map((c, i) => ({
    id: uid(), runId: run.id, caseId: c.id, caseKey: c.caseKey, number: c.number, version: 1, title: c.title, preconditions: c.preconditions, steps: c.steps, priority: c.priority,
    module: c.module, platforms: c.platforms, position: i + 1, assigneeId: null, retestOfRunCaseId: null,
  }));
  const outcome: Record<number, [QaAttempt["status"], string | null]> = {
    1: ["pass", null], 2: ["fail", "Title is editable for a view-only member."], 3: ["pass", null], 4: ["pass", null], 6: ["blocked", "Staging chat service was down."], 7: ["pass", null], 10: ["pass", null],
  };
  const attempts = runCases.flatMap((rc) => {
    const o = outcome[rc.number];
    return o ? [{ id: uid(), runCaseId: rc.id, runId: run.id, status: o[0], actual: o[1], testerId: null, previousAttemptId: null, createdAt: `2026-10-03T1${rc.number % 10}:00:00Z` } satisfies QaAttempt & { runId: string }] : [];
  });
  return {
    apps: [web, android, ios, iot], envs: [dev, qa, uat, prod],
    resources: [res("application", "QA workspace", "https://qa.example.test", "qa.example.test"), res("build", "web.142", "https://example.test/notes/142", "Release 2.8"), res("api", "QA endpoint", "https://api.qa.example.test", "api.qa.example.test"), res("setup", "Seeded test organisation", null, "Owner, Collaborator, View only")],
    builds: [b143, b142],
    accounts: [acct("QA Owner", "Owner", "qa.owner@example.test"), acct("QA Collaborator", "Collaborator", "qa.collaborator@example.test"), acct("QA Viewer", "View only", "qa.viewer@example.test")],
    cases, versions, runs: [run], runCases, attempts, evidence: [], links: [], views: [], nextCase: 11,
  };
}

const s = () => (store ??= seed());
/** Test hook: restores the pristine fixtures. */
export function resetPreviewQaStore() {
  store = null;
  seq = 1;
}

const latest = (runCaseId: string) => s().attempts.filter((a) => a.runCaseId === runCaseId).sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1))[0];
const project = (rc: Store["runCases"][number]): QaRunCase => {
  const a = latest(rc.id);
  return {
    ...rc, status: (a?.status ?? "not_run") as QaResultStatus, attemptId: a?.id ?? null, actual: a?.actual ?? null, attemptedAt: a?.createdAt ?? null, testerId: a?.testerId ?? null,
    attemptCount: s().attempts.filter((x) => x.runCaseId === rc.id).length, linkCount: s().links.filter((l) => l.runCaseId === rc.id).length,
  };
};
const activeRun = (runId: string) => {
  const run = s().runs.find((r) => r.id === runId);
  if (!run) return fail("not_found", "Run not found.");
  return run;
};

let previewUserId: string | null = null;
export const setPreviewQaUser = (id: string | null) => {
  previewUserId = id;
};

export const previewQaApi: QaApi = {
  mode: "preview",
  async listApplications() { return [...s().apps]; },
  async listEnvironments() { return [...s().envs]; },
  async listResources(_l, scope) { return s().resources.filter((r) => r.applicationId === scope.applicationId && r.environmentId === scope.environmentId && !r.archived); },
  async listBuilds(_l, scope) {
    return s().builds.filter((b) => (!scope.applicationId || b.applicationId === scope.applicationId) && (!scope.environmentId || b.environmentId === scope.environmentId)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  async listAccounts(_l, scope) { return s().accounts.filter((a) => a.applicationId === scope.applicationId && a.environmentId === scope.environmentId).map(({ grants: _g, ...a }) => a); },
  async listAccountAccess() { return s().accounts.map((a) => ({ accountId: a.id, canUse: true, canManage: true })); },
  async getAccountGrants(_l, accountId) { return s().accounts.find((a) => a.id === accountId)?.grants ?? { useRoles: [], manageRoles: [], useProfiles: [], manageProfiles: [] }; },
  async vaultConfigured() { return true; },
  async upsertApplication(_l, input) {
    const existing = s().apps.find((a) => a.id === input.id);
    if (s().apps.some((a) => a.id !== input.id && !a.archived && a.name.toLowerCase() === input.name.trim().toLowerCase())) fail("duplicate_name", "An application with that name already exists.");
    if (existing) {
      Object.assign(existing, { name: input.name.trim(), platformKind: input.platformKind, description: input.description.trim() || null, archived: input.archived ?? false });
      return existing;
    }
    const app: QaApplication = { id: uid(), name: input.name.trim(), platformKind: input.platformKind, description: input.description.trim() || null, archived: false, createdAt: now() };
    s().apps.push(app);
    return app;
  },
  async upsertEnvironment(_l, input) {
    const existing = s().envs.find((e) => e.id === input.id);
    if (s().envs.some((e) => e.id !== input.id && !e.archived && e.name.toLowerCase() === input.name.trim().toLowerCase())) fail("duplicate_name", "An environment with that name already exists.");
    if (existing) {
      Object.assign(existing, { name: input.name.trim(), restricted: input.restricted, archived: input.archived ?? false });
      return existing;
    }
    const env: QaEnvironment = { id: uid(), name: input.name.trim(), restricted: input.restricted, archived: false };
    s().envs.push(env);
    return env;
  },
  async upsertResource(_l, input) {
    if (input.url && !/^https?:\/\/\S+$/i.test(input.url)) fail("invalid_input", "Enter a full http or https link.");
    const existing = s().resources.find((r) => r.id === input.id);
    const next = { type: input.type, label: input.label.trim(), url: input.url.trim() || null, details: input.details.trim() || null, versionNote: input.versionNote ?? null, archived: input.archived ?? false };
    if (existing) return Object.assign(existing, next);
    const row: QaResource = { id: uid(), applicationId: input.applicationId, environmentId: input.environmentId, ...next };
    s().resources.push(row);
    return row;
  },
  async registerBuild(_l, input) {
    const dup = s().builds.find((b) => b.applicationId === input.applicationId && b.environmentId === input.environmentId && b.identifier === input.identifier.trim());
    if (dup) return dup;
    const b: QaBuild = { id: uid(), applicationId: input.applicationId, environmentId: input.environmentId, identifier: input.identifier.trim(), displayVersion: input.displayVersion.trim() || null, notesUrl: input.notesUrl.trim() || null, installUrl: input.installUrl.trim() || null, config: input.config, createdAt: now() };
    s().builds.unshift(b);
    return b;
  },
  async saveAccount(_l, input) {
    if (!input.id && !input.password) fail("password_required", "Enter a password for a new account.");
    const existing = s().accounts.find((a) => a.id === input.id);
    const meta = { applicationId: input.applicationId, environmentId: input.environmentId, label: input.label.trim(), testRole: input.testRole.trim(), username: input.username, instructions: input.instructions.trim() || null };
    if (existing) {
      Object.assign(existing, meta, { grants: input.grants });
      if (input.password) Object.assign(existing, { hasSecret: true, secretUpdatedAt: now() });
      return { accountId: existing.id, secretStored: existing.hasSecret };
    }
    const acc = { id: uid(), ...meta, hasSecret: true, secretUpdatedAt: now(), createdAt: now(), grants: input.grants };
    s().accounts.push(acc);
    return { accountId: acc.id, secretStored: true };
  },
  async archiveAccount(accountId) { s().accounts = s().accounts.filter((a) => a.id !== accountId); },
  async releaseSecret() { return PREVIEW_SECRET; },

  async listCases(_l, filter, cursor, pageSize): Promise<QaPage<QaCase, NumberCursor>> {
    const size = pageSize ?? 50;
    const rows = filterCases(s().cases, filter).sort((a, b) => a.number - b.number).filter((c) => !cursor || c.number > cursor.position);
    const items = rows.slice(0, size);
    return { items, nextCursor: rows.length > size ? { position: items[items.length - 1].number } : undefined };
  },
  async saveCase(_l, draft) {
    if (!draft.title.trim()) fail("invalid_input", "Give the case a title.");
    const steps = cleanSteps(draft.steps);
    const existing = s().cases.find((c) => c.id === draft.id);
    const content = { title: draft.title.trim(), preconditions: draft.preconditions.trim() || null, steps, priority: draft.priority, module: draft.module.trim() || null, platforms: draft.platforms };
    if (!existing) {
      const n = s().nextCase++;
      const c: QaCase = { id: uid(), number: n, caseKey: `TC-${String(n).padStart(3, "0")}`, version: 1, versionId: uid(), ...content, changeNote: draft.changeNote || null, archived: false, updatedAt: now() };
      s().cases.push(c);
      s().versions.set(c.id, [{ ...c }]);
      return { caseId: c.id, version: 1, outcome: "created" as const };
    }
    if (JSON.stringify([existing.title, existing.preconditions, existing.steps, existing.priority, existing.module, existing.platforms]) === JSON.stringify([content.title, content.preconditions, content.steps, content.priority, content.module, content.platforms])) {
      return { caseId: existing.id, version: existing.version, outcome: "unchanged" as const };
    }
    // New immutable version; the live case moves forward, older versions (and any run that snapshotted them) stay as they were.
    const v = { ...existing };
    Object.assign(existing, content, { version: existing.version + 1, versionId: uid(), changeNote: draft.changeNote || null, updatedAt: now() });
    s().versions.get(existing.id)?.push({ ...existing });
    void v;
    return { caseId: existing.id, version: existing.version, outcome: "updated" as const };
  },
  async archiveCase(caseId, archived) { const c = s().cases.find((x) => x.id === caseId); if (c) c.archived = archived; },
  async bulkUpdateCases(caseIds, patch) {
    let updated = 0;
    for (const id of caseIds) {
      const c = s().cases.find((x) => x.id === id);
      if (!c) continue;
      if (patch.archived !== undefined) c.archived = patch.archived;
      if (patch.priority || patch.module !== undefined || patch.platforms) {
        await previewQaApi.saveCase("", {
          id, title: c.title, preconditions: c.preconditions ?? "", steps: c.steps, priority: (patch.priority as QaPriority) ?? c.priority,
          module: patch.module !== undefined ? (patch.module ?? "") : (c.module ?? ""), platforms: (patch.platforms as QaCase["platforms"]) ?? c.platforms, changeNote: "Bulk update",
        });
      }
      updated++;
    }
    return { updated, skipped: caseIds.length - updated };
  },
  async importCases(_l, rows, strategy, atomic): Promise<ImportReport> {
    const errors = rows.flatMap((r, i) => (String(r.title ?? "").trim() ? [] : [{ row: i + 1, message: "Title is required." }]));
    if (errors.length && atomic) return { applied: false, created: 0, updated: 0, skipped: 0, errors };
    let created = 0, updated = 0, skipped = 0;
    for (const [i, r] of rows.entries()) {
      if (errors.some((e) => e.row === i + 1)) continue;
      const match = r.case_key && strategy !== "create" ? s().cases.find((c) => c.caseKey.toLowerCase() === r.case_key?.toLowerCase()) : undefined;
      if (match && strategy === "skip") { skipped++; continue; }
      const out = await previewQaApi.saveCase("", {
        id: match?.id, title: r.title, preconditions: r.preconditions ?? "", steps: r.steps ?? [], priority: (r.priority as QaPriority) || "medium", module: r.module ?? "",
        platforms: (r.platforms ?? []) as QaCase["platforms"], changeNote: "Imported",
      });
      if (out.outcome === "created") created++; else if (out.outcome === "updated") updated++; else skipped++;
    }
    return { applied: true, created, updated, skipped, errors };
  },
  async listSavedViews() { return [...s().views]; },
  async saveView(_l, view) {
    const existing = s().views.find((v) => v.name === view.name && v.viewKind === view.viewKind);
    if (existing) return Object.assign(existing, { config: view.config });
    const v: QaSavedView = { id: uid(), ...view };
    s().views.push(v);
    return v;
  },
  async deleteView(viewId) { s().views = s().views.filter((v) => v.id !== viewId); },

  async listRuns() { return { items: [...s().runs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), nextCursor: undefined }; },
  async getRun(_l, runId) { return s().runs.find((r) => r.id === runId) ?? null; },
  async listRunCases(_l, runId, filter, cursor, pageSize): Promise<QaPage<QaRunCase, NumberCursor>> {
    const size = pageSize ?? 50;
    const all = filterRunCases(s().runCases.filter((r) => r.runId === runId).sort((a, b) => a.position - b.position).map(project), filter).filter((r) => !cursor || r.position > cursor.position);
    const items = all.slice(0, size);
    return { items, nextCursor: all.length > size ? { position: items[items.length - 1].position } : undefined };
  },
  async listRunCasesByIds(_l, ids) { return s().runCases.filter((r) => ids.includes(r.id)).map(project); },
  async getTotals(_l, runId) { return totalsFromStatuses(s().runCases.filter((r) => r.runId === runId).map((r) => project(r).status)); },
  async createRun(_l, input) {
    const dup = s().runs.find((r) => (r as QaRun & { key?: string }).key === input.idempotencyKey);
    if (dup) return dup;
    if (!input.caseIds.length) fail("invalid_input", "Select at least one test case.");
    const build = s().builds.find((b) => b.id === input.buildId);
    if (!build || build.applicationId !== input.applicationId || build.environmentId !== input.environmentId) fail("build_mismatch", "The build does not belong to this application and environment.");
    const run: QaRun & { key?: string } = { id: uid(), name: input.name.trim(), applicationId: input.applicationId, environmentId: input.environmentId, buildId: input.buildId, config: input.config, status: "active", predecessorRunId: null, createdBy: previewUserId, createdAt: now(), completedAt: null, summary: null, key: input.idempotencyKey };
    s().runs.push(run);
    input.caseIds.forEach((id, i) => {
      const c = s().cases.find((x) => x.id === id && !x.archived);
      if (!c) return fail("case_unavailable", "A selected case is missing or archived.");
      s().runCases.push({ id: uid(), runId: run.id, caseId: c.id, caseKey: c.caseKey, number: c.number, version: c.version, title: c.title, preconditions: c.preconditions, steps: c.steps, priority: c.priority, module: c.module, platforms: c.platforms, position: i + 1, assigneeId: input.assignments[id] ?? null, retestOfRunCaseId: null });
    });
    return run;
  },
  async createRetestRun(predecessorRunId, buildId, name, idempotencyKey) {
    const pred = activeRun(predecessorRunId);
    const dup = s().runs.find((r) => (r as QaRun & { key?: string }).key === idempotencyKey);
    if (dup) return dup;
    if (buildId === pred.buildId) fail("same_build", "Choose a different build, or record another attempt in the original run.");
    const failed = s().runCases.filter((r) => r.runId === pred.id && ["fail", "blocked"].includes(project(r).status));
    if (!failed.length) fail("nothing_to_retest", "Nothing to retest: no failed or blocked cases in that run.");
    const run: QaRun & { key?: string } = { ...pred, id: uid(), name: name.trim(), buildId, status: "active", predecessorRunId: pred.id, createdAt: now(), completedAt: null, summary: null, key: idempotencyKey };
    s().runs.push(run);
    failed.forEach((rc, i) => {
      const id = uid();
      s().runCases.push({ ...rc, id, runId: run.id, position: i + 1, retestOfRunCaseId: rc.id });
      for (const l of s().links.filter((x) => x.runCaseId === rc.id)) s().links.push({ ...l, id: uid(), runCaseId: id, attemptId: null, createdAt: now() });
    });
    return run;
  },
  async recordAttempt(runCaseId, status, actual, idempotencyKey) {
    const rc = s().runCases.find((r) => r.id === runCaseId);
    if (!rc) return fail("not_found", "Run case not found.");
    const dup = s().attempts.find((a) => a.runCaseId === runCaseId && (a as QaAttempt & { key?: string }).key === idempotencyKey);
    if (dup) return dup;
    const run = activeRun(rc.runId);
    if (run.status !== "active") fail("run_not_active", `This run is ${run.status}. Start a new run to test again.`);
    if (requiresActual(status) && !actual.trim()) fail("actual_required", "Describe what happened for a failed or blocked result.");
    const attempt = { id: uid(), runCaseId, runId: rc.runId, status, actual: actual.trim() || null, testerId: previewUserId, previousAttemptId: latest(runCaseId)?.id ?? null, createdAt: now(), key: idempotencyKey };
    s().attempts.push(attempt);
    return attempt;
  },
  async completeRun(runId, accept) {
    const run = activeRun(runId);
    if (run.status !== "active") fail("run_not_active", `This run is already ${run.status}.`);
    const totals = totalsFromStatuses(s().runCases.filter((r) => r.runId === runId).map((r) => project(r).status));
    const check = checkCompletion(totals, accept);
    if (!check.ok) fail(check.reason, check.message);
    Object.assign(run, { status: "completed", completedAt: now(), summary: { ...totals, acceptedBlocked: accept.blocked && totals.blocked > 0, acceptedNotRun: accept.notRun && totals.notRun > 0 } });
    return totals;
  },
  async listAttempts(_l, runCaseId) { return s().attempts.filter((a) => a.runCaseId === runCaseId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); },

  async listEvidence(_l, attemptIds) { return s().evidence.filter((e) => attemptIds.includes(e.attemptId)).map(({ url: _u, ...e }) => e); },
  async uploadEvidence(attemptId, file) {
    const row = { id: uid(), attemptId, fileName: file.name, mimeType: file.type, sizeBytes: file.size, status: "ready" as const, createdAt: now(), url: URL.createObjectURL(file) };
    s().evidence.push(row);
    const { url: _u, ...e } = row;
    return e;
  },
  async abortEvidence(evidenceId) { s().evidence = s().evidence.filter((e) => e.id !== evidenceId); },
  async signEvidence(ids) { return Object.fromEntries(s().evidence.filter((e) => ids.includes(e.id)).map((e) => [e.id, e.url])); },
  async listThingLinks() { return [...s().links]; },
  async linkThing(runCaseId, attemptId, thingId) {
    const rc = s().runCases.find((r) => r.id === runCaseId);
    if (!rc) return fail("not_found", "Run case not found.");
    const dup = s().links.find((l) => l.runCaseId === runCaseId && l.thingId === thingId);
    if (dup) return dup;
    const link: QaThingLink = { id: uid(), thingId, caseId: rc.caseId, runCaseId, attemptId, createdAt: now() };
    s().links.push(link);
    return link;
  },
  async unlinkThing(linkId) { s().links = s().links.filter((l) => l.id !== linkId); },

  async listHistory(_l, filter, cursor, pageSize): Promise<QaPage<QaHistoryItem>> {
    const size = pageSize ?? 50;
    const rows = s().attempts
      .map((a): QaHistoryItem => {
        const rc = s().runCases.find((r) => r.id === a.runCaseId) as Store["runCases"][number];
        const run = s().runs.find((r) => r.id === a.runId) as QaRun;
        const app = s().apps.find((x) => x.id === run.applicationId) as QaApplication;
        const build = s().builds.find((b) => b.id === run.buildId) as QaBuild;
        return {
          id: a.id, runId: a.runId, runCaseId: a.runCaseId, status: a.status, actual: a.actual, testerId: a.testerId, createdAt: a.createdAt, previousAttemptId: a.previousAttemptId, caseKey: rc.caseKey,
          caseVersion: rc.version, caseTitle: rc.title, runName: run.name, runStatus: run.status, runConfig: run.config, applicationName: app.name, platformKind: app.platformKind,
          environmentName: s().envs.find((e) => e.id === run.environmentId)?.name ?? "", buildIdentifier: build.identifier, evidenceCount: s().evidence.filter((e) => e.attemptId === a.id).length,
          linkCount: s().links.filter((l) => l.runCaseId === a.runCaseId).length,
        };
      })
      .filter((h) => (filter.status === "all" || h.status === filter.status)
        && (filter.applicationId === "all" || s().runs.find((r) => r.id === h.runId)?.applicationId === filter.applicationId)
        && (filter.environmentId === "all" || s().runs.find((r) => r.id === h.runId)?.environmentId === filter.environmentId)
        && (!filter.caseKey.trim() || h.caseKey.toLowerCase() === filter.caseKey.trim().toLowerCase())
        && (!filter.buildIdentifier.trim() || h.buildIdentifier.toLowerCase().includes(filter.buildIdentifier.trim().toLowerCase())))
      .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1))
      .filter((h) => !cursor || h.createdAt < cursor.createdAt || (h.createdAt === cursor.createdAt && h.id < cursor.id));
    const items = rows.slice(0, size);
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > size && last ? ({ createdAt: last.createdAt, id: last.id } satisfies QaCursor) : undefined };
  },
};
