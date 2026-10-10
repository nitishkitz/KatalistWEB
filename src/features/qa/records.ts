/** Database row shapes and their mapping to domain types. */
import { PLATFORM_KINDS, type PlatformKind, type QaAccount, type QaApplication, type QaAttempt, type QaBuild, type QaCase, type QaCaseStep, type QaEnvironment, type QaEvidence, type QaHistoryItem, type QaPriority, type QaResource, type QaResultStatus, type QaRun, type QaRunCase, type QaSavedView, type QaThingLink, type QaTotals } from "./types";

export type Row = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : "");
const sn = (v: unknown) => (typeof v === "string" ? v : null);
const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const b = (v: unknown) => v === true;

const steps = (v: unknown): QaCaseStep[] =>
  Array.isArray(v) ? v.map((x) => ({ action: s((x as Row)?.action), expected: s((x as Row)?.expected) })) : [];
const platforms = (v: unknown): PlatformKind[] => (Array.isArray(v) ? v.filter((p): p is PlatformKind => (PLATFORM_KINDS as readonly string[]).includes(p as string)) : []);
const stringMap = (v: unknown): Record<string, string> =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Row).filter(([, x]) => typeof x === "string") as Array<[string, string]>) : {};

export const mapApplication = (r: Row): QaApplication => ({
  id: s(r.id), name: s(r.name), platformKind: (PLATFORM_KINDS as readonly string[]).includes(s(r.platform_kind)) ? (r.platform_kind as PlatformKind) : "other",
  description: sn(r.description), archived: r.archived_at != null, createdAt: s(r.created_at),
});
export const mapEnvironment = (r: Row): QaEnvironment => ({ id: s(r.id), name: s(r.name), restricted: b(r.restricted), archived: r.archived_at != null });
export const mapResource = (r: Row): QaResource => ({
  id: s(r.id), applicationId: s(r.application_id), environmentId: s(r.environment_id), type: s(r.type) as QaResource["type"], label: s(r.label),
  url: sn(r.url), details: sn(r.details), versionNote: sn(r.version_note), archived: r.archived_at != null,
});
export const mapBuild = (r: Row): QaBuild => ({
  id: s(r.id), applicationId: s(r.application_id), environmentId: s(r.environment_id), identifier: s(r.identifier), displayVersion: sn(r.display_version),
  notesUrl: sn(r.notes_url), installUrl: sn(r.install_url), config: stringMap(r.config), createdAt: s(r.created_at),
});
export const mapAccount = (r: Row): QaAccount => ({
  id: s(r.id), applicationId: s(r.application_id), environmentId: s(r.environment_id), label: s(r.label), testRole: s(r.test_role), username: s(r.username),
  instructions: sn(r.instructions), hasSecret: b(r.has_secret), secretUpdatedAt: sn(r.secret_updated_at), createdAt: s(r.created_at),
});
export const mapCase = (r: Row): QaCase => ({
  id: s(r.id), number: n(r.number), caseKey: s(r.case_key), version: n(r.current_version), versionId: s(r.version_id), title: s(r.title),
  preconditions: sn(r.preconditions), steps: steps(r.steps), priority: s(r.priority) as QaPriority, module: sn(r.module), platforms: platforms(r.platforms),
  changeNote: sn(r.change_note), archived: r.archived_at != null, updatedAt: s(r.updated_at),
});
export const mapTotals = (r: Row): QaTotals => ({ total: n(r.total), pass: n(r.pass), fail: n(r.fail), blocked: n(r.blocked), notApplicable: n(r.not_applicable), notRun: n(r.not_run) });
export const mapRun = (r: Row): QaRun => {
  const sum = r.completion_summary as Row | null;
  return {
    id: s(r.id), name: s(r.name), applicationId: s(r.application_id), environmentId: s(r.environment_id), buildId: s(r.build_id), config: stringMap(r.config),
    status: s(r.status) as QaRun["status"], predecessorRunId: sn(r.predecessor_run_id), createdBy: sn(r.created_by), createdAt: s(r.created_at), completedAt: sn(r.completed_at),
    summary: sum ? { ...mapTotals(sum), acceptedBlocked: b(sum.accepted_blocked), acceptedNotRun: b(sum.accepted_not_run) } : null,
  };
};
export const mapRunCase = (r: Row): QaRunCase => ({
  id: s(r.id), runId: s(r.run_id), caseId: s(r.case_id), caseKey: s(r.case_key), number: n(r.number), version: n(r.version), title: s(r.title),
  preconditions: sn(r.preconditions), steps: steps(r.steps), priority: s(r.priority) as QaPriority, module: sn(r.module), platforms: platforms(r.platforms),
  position: n(r.position), assigneeId: sn(r.assignee_profile_id), retestOfRunCaseId: sn(r.retest_of_run_case_id),
  status: (r.status ? s(r.status) : "not_run") as QaResultStatus, attemptId: sn(r.attempt_id), actual: sn(r.actual), attemptedAt: sn(r.attempted_at), testerId: sn(r.tester_profile_id),
  attemptCount: n(r.attempt_count), linkCount: n(r.link_count),
});
export const mapAttempt = (r: Row): QaAttempt => ({
  id: s(r.id), runCaseId: s(r.run_case_id), status: s(r.status) as QaAttempt["status"], actual: sn(r.actual), testerId: sn(r.tester_profile_id),
  previousAttemptId: sn(r.previous_attempt_id), createdAt: s(r.created_at),
});
export const mapHistory = (r: Row): QaHistoryItem => ({
  id: s(r.id), runId: s(r.run_id), runCaseId: s(r.run_case_id), status: s(r.status) as QaHistoryItem["status"], actual: sn(r.actual), testerId: sn(r.tester_profile_id),
  createdAt: s(r.created_at), previousAttemptId: sn(r.previous_attempt_id), caseKey: s(r.case_key), caseVersion: n(r.case_version), caseTitle: s(r.case_title),
  runName: s(r.run_name), runStatus: s(r.run_status) as QaHistoryItem["runStatus"], runConfig: stringMap(r.run_config), applicationName: s(r.application_name),
  platformKind: s(r.platform_kind) as PlatformKind, environmentName: s(r.environment_name), buildIdentifier: s(r.build_identifier), evidenceCount: n(r.evidence_count), linkCount: n(r.link_count),
});
export const mapEvidence = (r: Row): QaEvidence => ({
  id: s(r.id), attemptId: s(r.attempt_id), fileName: s(r.file_name), mimeType: s(r.mime_type), sizeBytes: n(r.size_bytes), status: r.status === "ready" ? "ready" : "pending", createdAt: s(r.created_at),
});
export const mapThingLink = (r: Row): QaThingLink => ({
  id: s(r.id), thingId: s(r.thing_id), caseId: s(r.case_id), runCaseId: s(r.run_case_id), attemptId: sn(r.attempt_id), createdAt: s(r.created_at),
});
export const mapSavedView = (r: Row): QaSavedView => ({ id: s(r.id), viewKind: s(r.view_kind) as QaSavedView["viewKind"], name: s(r.name), config: (r.config ?? {}) as QaSavedView["config"] });
