import type {
  BulkReport, ImportReport, ImportRow, ImportStrategy, QaAccount, QaAccountAccess, QaAccountInput, QaApplication, QaAttempt, QaBuild, QaCase, QaCaseDraft,
  QaCaseFilter, QaEnvironment, QaEvidence, QaHistoryFilter, QaHistoryItem, QaResource, QaRun, QaRunCase, QaRunFilter, QaRunInput, QaSavedView, QaThingLink,
  QaTotals, QaGrants, SecretAction, PlatformKind, ResourceType,
} from "./types";
import type { QaCursor, QaPage } from "./qa-queries";

export type ScopeFilter = { applicationId: string; environmentId: string };
export type NumberCursor = { position: number };

export type ApplicationInput = { id?: string; name: string; platformKind: PlatformKind; description: string; archived?: boolean };
export type EnvironmentInput = { id?: string; name: string; restricted: boolean; archived?: boolean };
export type ResourceInput = { id?: string; applicationId: string; environmentId: string; type: ResourceType; label: string; url: string; details: string; versionNote?: string; archived?: boolean };
export type BuildInput = { applicationId: string; environmentId: string; identifier: string; displayVersion: string; notesUrl: string; installUrl: string; config: Record<string, string> };

export type UploadHandle = { evidenceId: string };

/** Everything the QA UI needs. Two implementations: Supabase (persistent) and an isolated in-memory preview. */
export interface QaApi {
  readonly mode: "live" | "preview";
  // ----- Access
  listApplications(listId: string, signal?: AbortSignal): Promise<QaApplication[]>;
  listEnvironments(listId: string, signal?: AbortSignal): Promise<QaEnvironment[]>;
  listResources(listId: string, scope: ScopeFilter, signal?: AbortSignal): Promise<QaResource[]>;
  listBuilds(listId: string, scope: ScopeFilter | { applicationId?: string; environmentId?: string }, signal?: AbortSignal): Promise<QaBuild[]>;
  listAccounts(listId: string, scope: ScopeFilter, signal?: AbortSignal): Promise<QaAccount[]>;
  listAccountAccess(listId: string, signal?: AbortSignal): Promise<QaAccountAccess[]>;
  getAccountGrants(listId: string, accountId: string, signal?: AbortSignal): Promise<QaGrants>;
  vaultConfigured(signal?: AbortSignal): Promise<boolean>;
  upsertApplication(listId: string, input: ApplicationInput): Promise<QaApplication>;
  upsertEnvironment(listId: string, input: EnvironmentInput): Promise<QaEnvironment>;
  upsertResource(listId: string, input: ResourceInput): Promise<QaResource>;
  registerBuild(listId: string, input: BuildInput): Promise<QaBuild>;
  saveAccount(listId: string, input: QaAccountInput): Promise<{ accountId: string; secretStored: boolean }>;
  archiveAccount(accountId: string, archived: boolean): Promise<void>;
  /** Returns plaintext for one explicit action. Never cache the result. */
  releaseSecret(accountId: string, action: SecretAction): Promise<string>;
  // ----- Library
  listCases(listId: string, filter: QaCaseFilter, cursor: NumberCursor | undefined, pageSize: number | undefined, signal?: AbortSignal): Promise<QaPage<QaCase, NumberCursor>>;
  saveCase(listId: string, draft: QaCaseDraft): Promise<{ caseId: string; version: number; outcome: "created" | "updated" | "unchanged" }>;
  archiveCase(caseId: string, archived: boolean): Promise<void>;
  bulkUpdateCases(caseIds: string[], patch: { priority?: string; module?: string | null; platforms?: string[]; archived?: boolean }): Promise<BulkReport>;
  importCases(listId: string, rows: ImportRow[], strategy: ImportStrategy, atomic: boolean): Promise<ImportReport>;
  listSavedViews(listId: string, signal?: AbortSignal): Promise<QaSavedView[]>;
  saveView(listId: string, view: Pick<QaSavedView, "viewKind" | "name" | "config">): Promise<QaSavedView>;
  deleteView(viewId: string): Promise<void>;
  // ----- Runs
  listRuns(listId: string, cursor: QaCursor | undefined, pageSize: number | undefined, signal?: AbortSignal): Promise<QaPage<QaRun>>;
  getRun(listId: string, runId: string, signal?: AbortSignal): Promise<QaRun | null>;
  listRunCases(listId: string, runId: string, filter: QaRunFilter, cursor: NumberCursor | undefined, pageSize: number | undefined, signal?: AbortSignal): Promise<QaPage<QaRunCase, NumberCursor>>;
  /** The given run cases (latest result each), for defects. At most 200 ids. */
  listRunCasesByIds(listId: string, runCaseIds: string[], signal?: AbortSignal): Promise<QaRunCase[]>;
  getTotals(listId: string, runId: string, signal?: AbortSignal): Promise<QaTotals>;
  createRun(listId: string, input: QaRunInput): Promise<QaRun>;
  createRetestRun(predecessorRunId: string, buildId: string, name: string, idempotencyKey: string): Promise<QaRun>;
  recordAttempt(runCaseId: string, status: QaAttempt["status"], actual: string, idempotencyKey: string): Promise<QaAttempt>;
  completeRun(runId: string, accept: { blocked: boolean; notRun: boolean }): Promise<QaTotals>;
  listAttempts(listId: string, runCaseId: string, signal?: AbortSignal): Promise<QaAttempt[]>;
  // ----- Evidence + Things
  listEvidence(listId: string, attemptIds: string[], signal?: AbortSignal): Promise<QaEvidence[]>;
  uploadEvidence(attemptId: string, file: File, signal?: AbortSignal): Promise<QaEvidence>;
  abortEvidence(evidenceId: string): Promise<void>;
  signEvidence(evidenceIds: string[], signal?: AbortSignal): Promise<Record<string, string>>;
  listThingLinks(listId: string, signal?: AbortSignal): Promise<QaThingLink[]>;
  linkThing(runCaseId: string, attemptId: string | null, thingId: string): Promise<QaThingLink>;
  unlinkThing(linkId: string): Promise<void>;
  // ----- History
  listHistory(listId: string, filter: QaHistoryFilter, cursor: QaCursor | undefined, pageSize: number | undefined, signal?: AbortSignal): Promise<QaPage<QaHistoryItem>>;
}
