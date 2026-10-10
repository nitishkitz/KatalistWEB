import { supabase } from "@/integrations/supabase/client";
import { callUngeneratedRpc } from "@/integrations/supabase/rpcs";
import { authedFetch } from "@/lib/authed-fetch";
import { withReadDeadline } from "@/lib/read-request";
import type { ApplicationInput, BuildInput, EnvironmentInput, NumberCursor, QaApi, ResourceInput, ScopeFilter } from "./api-types";
import { QA_EXPORT_CHUNK, QA_SCOPE_LIMIT, QaOperationError, buildQaCursorFilter, clampQaPageSize, nextQaCursor, safeSearchTerm, toQaError, toQaHttpError, type QaCursor, type QaPage } from "./qa-queries";
import {
  mapAccount, mapApplication, mapAttempt, mapBuild, mapCase, mapEnvironment, mapEvidence, mapHistory, mapResource, mapRun, mapRunCase, mapSavedView,
  mapThingLink, mapTotals, type Row,
} from "./records";
import type { QaAccountInput, QaCaseDraft, QaGrants, QaListRole, SecretAction } from "./types";

// The generated Supabase types do not know the QA tables or views and must not be hand-edited.
// This is the single, narrow escape hatch for reads on them (same approach as Designs).
type QueryResult = { data: unknown; error: { message: string; hint?: string | null; code?: string | null; details?: string | null } | null };
type UntypedBuilder = PromiseLike<QueryResult> & {
  select(columns: string): UntypedBuilder;
  eq(column: string, value: string | boolean | number): UntypedBuilder;
  in(column: string, values: readonly string[]): UntypedBuilder;
  gt(column: string, value: number): UntypedBuilder;
  is(column: string, value: null): UntypedBuilder;
  not(column: string, op: string, value: null): UntypedBuilder;
  or(filter: string): UntypedBuilder;
  contains(column: string, value: readonly string[]): UntypedBuilder;
  order(column: string, opts: { ascending: boolean }): UntypedBuilder;
  limit(count: number): UntypedBuilder;
  abortSignal(signal: AbortSignal): UntypedBuilder;
};
const table = (name: string) => (supabase as unknown as { from(table: string): UntypedBuilder }).from(name);

async function read(querySignal: AbortSignal | undefined, build: (signal: AbortSignal) => PromiseLike<QueryResult>): Promise<Row[]> {
  const { data, error } = await withReadDeadline(querySignal, async (signal) => build(signal));
  if (error) throw toQaError(error);
  return (data ?? []) as Row[];
}

async function rpc<T>(name: string, args: object): Promise<T> {
  const { data, error } = await callUngeneratedRpc(name, args);
  if (error) throw toQaError(error as { message: string; hint?: string; code?: string });
  return data as T;
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await authedFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new QaOperationError("offline", "The request could not be sent. Check your connection and try again.");
  }
  const json = (await res.json().catch(() => null)) as (T & { message?: string; data?: { code?: string } }) | null;
  if (!res.ok) throw toQaHttpError(res.status, json);
  return json as T;
}

const roleList = (rows: Row[], kind: "role", capability: string): QaListRole[] =>
  rows.filter((r) => r.grantee_kind === kind && r.capability === capability).map((r) => r.grantee_role as QaListRole);
const profileList = (rows: Row[], capability: string): string[] =>
  rows.filter((r) => r.grantee_kind === "profile" && r.capability === capability).map((r) => String(r.grantee_profile_id));

const CASE_COLUMNS = "id, number, case_key, current_version, version_id, title, preconditions, steps, priority, module, platforms, change_note, archived_at, updated_at";
const RUN_CASE_COLUMNS =
  "id, run_id, case_id, case_key, number, version, title, preconditions, steps, priority, module, platforms, position, assignee_profile_id, retest_of_run_case_id, status, attempt_id, actual, attempted_at, tester_profile_id, attempt_count, link_count";
const HISTORY_COLUMNS =
  "id, run_id, run_case_id, status, actual, tester_profile_id, created_at, previous_attempt_id, case_key, case_version, case_title, run_name, run_status, run_config, application_id, environment_id, application_name, platform_kind, environment_name, build_identifier, evidence_count, link_count";

async function sha256Hex(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

export const supabaseQaApi: QaApi = {
  mode: "live",

  async listApplications(listId, signal) {
    return (await read(signal, (s) => table("qa_applications").select("*").eq("list_id", listId).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(QA_SCOPE_LIMIT).abortSignal(s))).map(mapApplication);
  },
  async listEnvironments(listId, signal) {
    return (await read(signal, (s) => table("qa_environments").select("*").eq("list_id", listId).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(QA_SCOPE_LIMIT).abortSignal(s))).map(mapEnvironment);
  },
  async listResources(listId, scope, signal) {
    return (
      await read(signal, (s) =>
        table("qa_resources").select("*").eq("list_id", listId).eq("application_id", scope.applicationId).eq("environment_id", scope.environmentId).is("archived_at", null)
          .order("created_at", { ascending: true }).limit(QA_SCOPE_LIMIT).abortSignal(s),
      )
    ).map(mapResource);
  },
  async listBuilds(listId, scope, signal) {
    return (
      await read(signal, (s) => {
        let q = table("qa_builds").select("*").eq("list_id", listId);
        if (scope.applicationId) q = q.eq("application_id", scope.applicationId);
        if (scope.environmentId) q = q.eq("environment_id", scope.environmentId);
        return q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(QA_SCOPE_LIMIT).abortSignal(s);
      })
    ).map(mapBuild);
  },
  async listAccounts(listId, scope, signal) {
    return (
      await read(signal, (s) =>
        table("qa_accounts").select("*").eq("list_id", listId).eq("application_id", scope.applicationId).eq("environment_id", scope.environmentId).is("archived_at", null)
          .order("created_at", { ascending: true }).limit(QA_SCOPE_LIMIT).abortSignal(s),
      )
    ).map(mapAccount);
  },
  async listAccountAccess(listId, signal) {
    const call = callUngeneratedRpc("qa_list_account_access", { p_list_id: listId });
    const { data, error } = await (signal ? call.abortSignal(signal) : call);
    if (error) throw toQaError(error as { message: string });
    return ((data ?? []) as Row[]).map((r) => ({ accountId: String(r.account_id), canUse: r.can_use === true, canManage: r.can_manage === true }));
  },
  async getAccountGrants(listId, accountId, signal): Promise<QaGrants> {
    const rows = await read(signal, (s) => table("qa_account_grants").select("grantee_kind, grantee_role, grantee_profile_id, capability").eq("list_id", listId).eq("account_id", accountId).limit(QA_SCOPE_LIMIT).abortSignal(s));
    return { useRoles: roleList(rows, "role", "use"), manageRoles: roleList(rows, "role", "manage"), useProfiles: profileList(rows, "use"), manageProfiles: profileList(rows, "manage") };
  },
  async vaultConfigured(signal) {
    const res = await authedFetch("/api/qa/credentials/status", { cache: "no-store", signal });
    if (!res.ok) return false;
    return Boolean(((await res.json().catch(() => null)) as { vaultConfigured?: boolean } | null)?.vaultConfigured);
  },
  async upsertApplication(listId, input: ApplicationInput) {
    return mapApplication(await rpc<Row>("qa_upsert_application", { p_list_id: listId, p_id: input.id ?? null, p_name: input.name, p_platform_kind: input.platformKind, p_description: input.description, p_archived: input.archived ?? false }));
  },
  async upsertEnvironment(listId, input: EnvironmentInput) {
    return mapEnvironment(await rpc<Row>("qa_upsert_environment", { p_list_id: listId, p_id: input.id ?? null, p_name: input.name, p_restricted: input.restricted, p_archived: input.archived ?? false }));
  },
  async upsertResource(listId, input: ResourceInput) {
    return mapResource(
      await rpc<Row>("qa_upsert_resource", {
        p_list_id: listId, p_id: input.id ?? null, p_application_id: input.applicationId, p_environment_id: input.environmentId, p_type: input.type, p_label: input.label,
        p_url: input.url, p_details: input.details, p_owner_profile_id: null, p_version_note: input.versionNote ?? null, p_archived: input.archived ?? false,
      }),
    );
  },
  async registerBuild(listId, input: BuildInput) {
    return mapBuild(
      await rpc<Row>("qa_register_build", {
        p_list_id: listId, p_application_id: input.applicationId, p_environment_id: input.environmentId, p_identifier: input.identifier, p_display_version: input.displayVersion,
        p_notes_url: input.notesUrl, p_install_url: input.installUrl, p_config: input.config,
      }),
    );
  },
  async saveAccount(listId, input: QaAccountInput) {
    const res = await post<{ account: { id: string }; secretStored: boolean }>("/api/qa/credentials/save", {
      listId, accountId: input.id ?? null, applicationId: input.applicationId, environmentId: input.environmentId, label: input.label, testRole: input.testRole,
      username: input.username, instructions: input.instructions, password: input.password,
      useRoles: input.grants.useRoles, manageRoles: input.grants.manageRoles, useProfiles: input.grants.useProfiles, manageProfiles: input.grants.manageProfiles,
    });
    return { accountId: res.account.id, secretStored: res.secretStored };
  },
  async archiveAccount(accountId, archived) {
    await post("/api/qa/credentials/archive", { accountId, archived });
  },
  async releaseSecret(accountId, action: SecretAction) {
    return (await post<{ secret: string }>("/api/qa/credentials/secret", { accountId, action })).secret;
  },

  async listCases(listId, filter, cursor, pageSize, signal): Promise<QaPage<ReturnType<typeof mapCase>, NumberCursor>> {
    const size = clampQaPageSize(pageSize);
    const rows = await read(signal, (s) => {
      let q = table("qa_case_current").select(CASE_COLUMNS).eq("list_id", listId);
      q = filter.archived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
      if (filter.priority !== "all") q = q.eq("priority", filter.priority);
      if (filter.module !== "all") q = q.eq("module", filter.module);
      if (filter.platform !== "all") q = q.contains("platforms", [filter.platform]);
      const term = safeSearchTerm(filter.search);
      if (term) q = q.or(`title.ilike.%${term}%,case_key.ilike.%${term}%,module.ilike.%${term}%`);
      if (cursor) q = q.gt("number", cursor.position);
      return q.order("number", { ascending: true }).limit(size).abortSignal(s);
    });
    const items = rows.map(mapCase);
    return { items, nextCursor: rows.length < size ? undefined : { position: items[items.length - 1].number } };
  },
  async saveCase(listId, draft: QaCaseDraft) {
    const r = await rpc<{ case_id: string; version: number; outcome: "created" | "updated" | "unchanged" }>("qa_save_case", {
      p_list_id: listId, p_case_id: draft.id ?? null, p_title: draft.title, p_preconditions: draft.preconditions,
      p_steps: draft.steps.filter((s) => s.action.trim() || s.expected.trim()), p_priority: draft.priority, p_module: draft.module, p_platforms: draft.platforms, p_change_note: draft.changeNote,
    });
    return { caseId: r.case_id, version: r.version, outcome: r.outcome };
  },
  async archiveCase(caseId, archived) {
    await rpc("qa_archive_case", { p_case_id: caseId, p_archived: archived });
  },
  async bulkUpdateCases(caseIds, patch) {
    return rpc("qa_bulk_update_cases", { p_case_ids: caseIds, p_patch: patch });
  },
  async importCases(listId, rows, strategy, atomic) {
    const r = await rpc<{ applied: boolean; created: number; updated: number; skipped: number; errors: Array<{ row: number; message: string }> }>("qa_import_cases", { p_list_id: listId, p_rows: rows, p_strategy: strategy, p_atomic: atomic });
    return r;
  },
  async listSavedViews(listId, signal) {
    return (await read(signal, (s) => table("qa_saved_views").select("*").eq("list_id", listId).order("name", { ascending: true }).limit(100).abortSignal(s))).map(mapSavedView);
  },
  async saveView(listId, view) {
    return mapSavedView(await rpc<Row>("qa_save_view", { p_list_id: listId, p_view_kind: view.viewKind, p_name: view.name, p_config: view.config }));
  },
  async deleteView(viewId) {
    await rpc("qa_delete_view", { p_view_id: viewId });
  },

  async listRuns(listId, cursor, pageSize, signal) {
    const size = clampQaPageSize(pageSize);
    const rows = await read(signal, (s) => {
      let q = table("qa_runs").select("*").eq("list_id", listId);
      if (cursor) q = q.or(buildQaCursorFilter(cursor));
      return q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(size).abortSignal(s);
    });
    return { items: rows.map(mapRun), nextCursor: nextQaCursor(rows as Array<{ created_at: string; id: string }>, size) };
  },
  async getRun(listId, runId, signal) {
    const rows = await read(signal, (s) => table("qa_runs").select("*").eq("list_id", listId).eq("id", runId).limit(1).abortSignal(s));
    return rows[0] ? mapRun(rows[0]) : null;
  },
  async listRunCases(listId, runId, filter, cursor, pageSize, signal) {
    const size = clampQaPageSize(pageSize);
    const rows = await read(signal, (s) => {
      let q = table("qa_run_case_status").select(RUN_CASE_COLUMNS).eq("list_id", listId).eq("run_id", runId);
      if (filter.result === "not_run") q = q.is("status", null);
      else if (filter.result !== "all") q = q.eq("status", filter.result);
      if (filter.assignee !== "all") q = q.eq("assignee_profile_id", filter.assignee);
      const term = safeSearchTerm(filter.search);
      if (term) q = q.or(`title.ilike.%${term}%,case_key.ilike.%${term}%,module.ilike.%${term}%`);
      if (cursor) q = q.gt("position", cursor.position);
      return q.order("position", { ascending: true }).limit(size).abortSignal(s);
    });
    const items = rows.map(mapRunCase);
    return { items, nextCursor: rows.length < size ? undefined : { position: items[items.length - 1].position } };
  },
  async listRunCasesByIds(listId, runCaseIds, signal) {
    if (!runCaseIds.length) return [];
    return (await read(signal, (s) => table("qa_run_case_status").select(RUN_CASE_COLUMNS).eq("list_id", listId).in("id", runCaseIds.slice(0, QA_SCOPE_LIMIT)).limit(QA_SCOPE_LIMIT).abortSignal(s))).map(mapRunCase);
  },
  async getTotals(_listId, runId, signal) {
    const call = callUngeneratedRpc("qa_run_totals", { p_run_id: runId });
    const { data, error } = await (signal ? call.abortSignal(signal) : call);
    if (error) throw toQaError(error as { message: string });
    return mapTotals(((data ?? []) as Row[])[0] ?? {});
  },
  async createRun(listId, input) {
    return mapRun(
      await rpc<Row>("qa_create_run", {
        p_list_id: listId, p_name: input.name, p_application_id: input.applicationId, p_environment_id: input.environmentId, p_build_id: input.buildId, p_config: input.config,
        p_case_ids: input.caseIds, p_assignments: input.assignments, p_idempotency_key: input.idempotencyKey,
      }),
    );
  },
  async createRetestRun(predecessorRunId, buildId, name, idempotencyKey) {
    return mapRun(await rpc<Row>("qa_create_retest_run", { p_predecessor_run_id: predecessorRunId, p_build_id: buildId, p_name: name, p_idempotency_key: idempotencyKey }));
  },
  async recordAttempt(runCaseId, status, actual, idempotencyKey) {
    return mapAttempt(await rpc<Row>("qa_record_attempt", { p_run_case_id: runCaseId, p_status: status, p_actual: actual, p_idempotency_key: idempotencyKey }));
  },
  async completeRun(runId, accept) {
    const r = await rpc<Row>("qa_complete_run", { p_run_id: runId, p_accept_blocked: accept.blocked, p_accept_not_run: accept.notRun });
    return mapTotals(r);
  },
  async listAttempts(listId, runCaseId, signal) {
    return (await read(signal, (s) => table("qa_attempts").select("*").eq("list_id", listId).eq("run_case_id", runCaseId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(100).abortSignal(s))).map(mapAttempt);
  },

  async listEvidence(listId, attemptIds, signal) {
    if (!attemptIds.length) return [];
    return (await read(signal, (s) => table("qa_attempt_evidence").select("id, attempt_id, file_name, mime_type, size_bytes, status, created_at").eq("list_id", listId).in("attempt_id", attemptIds).order("created_at", { ascending: true }).limit(500).abortSignal(s))).map(mapEvidence);
  },
  async uploadEvidence(attemptId, file, signal) {
    const begin = await post<{ evidenceId: string; bucket: string; path: string; token: string }>(
      "/api/qa/evidence/begin",
      { attemptId, fileName: file.name, mimeType: file.type, sizeBytes: file.size, checksum: await sha256Hex(file) },
      signal,
    );
    try {
      if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
      const { error } = await supabase.storage.from(begin.bucket).uploadToSignedUrl(begin.path, begin.token, file, { contentType: file.type });
      if (error) throw new QaOperationError("storage_unavailable", "The file could not be uploaded. Try again.");
      if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
      await post("/api/qa/evidence/finalize", { evidenceId: begin.evidenceId });
    } catch (error) {
      // Best effort: remove the pending row and any partial object so nothing is orphaned.
      await post("/api/qa/evidence/abort", { evidenceId: begin.evidenceId }).catch(() => undefined);
      throw error;
    }
    return { id: begin.evidenceId, attemptId, fileName: file.name, mimeType: file.type, sizeBytes: file.size, status: "ready", createdAt: new Date().toISOString() };
  },
  async abortEvidence(evidenceId) {
    await post("/api/qa/evidence/abort", { evidenceId });
  },
  async signEvidence(evidenceIds, signal) {
    if (!evidenceIds.length) return {};
    return (await post<{ urls: Record<string, string> }>("/api/qa/evidence/sign", { evidenceIds }, signal)).urls;
  },
  async listThingLinks(listId, signal) {
    return (await read(signal, (s) => table("qa_thing_links").select("id, thing_id, case_id, run_case_id, attempt_id, created_at").eq("list_id", listId).order("created_at", { ascending: false }).limit(1000).abortSignal(s))).map(mapThingLink);
  },
  async linkThing(runCaseId, attemptId, thingId) {
    return mapThingLink(await rpc<Row>("qa_link_thing", { p_run_case_id: runCaseId, p_attempt_id: attemptId, p_thing_id: thingId }));
  },
  async unlinkThing(linkId) {
    await rpc("qa_unlink_thing", { p_link_id: linkId });
  },

  async listHistory(listId, filter, cursor, pageSize, signal) {
    const size = clampQaPageSize(pageSize);
    const rows = await read(signal, (s) => {
      let q = table("qa_history").select(HISTORY_COLUMNS).eq("list_id", listId);
      if (filter.status !== "all") q = q.eq("status", filter.status);
      if (filter.applicationId !== "all") q = q.eq("application_id", filter.applicationId);
      if (filter.environmentId !== "all") q = q.eq("environment_id", filter.environmentId);
      const key = filter.caseKey.trim();
      if (key) q = q.eq("case_key", key.toUpperCase());
      const build = safeSearchTerm(filter.buildIdentifier);
      if (build) q = q.or(`build_identifier.ilike.%${build}%`);
      if (cursor) q = q.or(buildQaCursorFilter(cursor));
      return q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(size).abortSignal(s);
    });
    return { items: rows.map(mapHistory), nextCursor: nextQaCursor(rows as Array<{ created_at: string; id: string }>, size) };
  },
};

/** Walks every page so exports never cover only what happens to be loaded. */
export async function collectAll<T, C>(fetchPage: (cursor: C | undefined) => Promise<QaPage<T, C>>, max: number): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let cursor: C | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    if (!page.nextCursor) return { items, truncated: false };
    if (items.length >= max) return { items: items.slice(0, max), truncated: true };
    cursor = page.nextCursor;
  }
}
export { QA_EXPORT_CHUNK };
export type { ScopeFilter, QaCursor };
