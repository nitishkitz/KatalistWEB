/** Domain contracts for the manual QA workspace. Camel-cased; mapped from database rows in records.ts. */

export type QaListRole = "owner" | "collaborator" | "view_only";

export const PLATFORM_KINDS = ["web", "android", "ios", "iot", "api", "desktop", "other"] as const;
export type PlatformKind = (typeof PLATFORM_KINDS)[number];
export const PLATFORM_LABEL: Record<PlatformKind, string> = {
  web: "Web application",
  android: "Android application",
  ios: "iOS application",
  iot: "IoT devices",
  api: "API",
  desktop: "Desktop application",
  other: "Other",
};

export type QaApplication = {
  id: string;
  name: string;
  platformKind: PlatformKind;
  description: string | null;
  archived: boolean;
  createdAt: string;
};

export type QaEnvironment = { id: string; name: string; restricted: boolean; archived: boolean };

export const RESOURCE_TYPES = ["application", "build", "api", "setup", "docs", "device", "other"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export type QaResource = {
  id: string;
  applicationId: string;
  environmentId: string;
  type: ResourceType;
  label: string;
  url: string | null;
  details: string | null;
  versionNote: string | null;
  archived: boolean;
};

export type QaBuild = {
  id: string;
  applicationId: string;
  environmentId: string;
  identifier: string;
  displayVersion: string | null;
  notesUrl: string | null;
  installUrl: string | null;
  /** Device/OS/firmware details recorded with the build, for example model, os, firmware. */
  config: Record<string, string>;
  createdAt: string;
};

/** Account metadata only. There is no secret field on this type by design. */
export type QaAccount = {
  id: string;
  applicationId: string;
  environmentId: string;
  label: string;
  testRole: string;
  username: string;
  instructions: string | null;
  hasSecret: boolean;
  secretUpdatedAt: string | null;
  createdAt: string;
};

export type QaAccountAccess = { accountId: string; canUse: boolean; canManage: boolean };

export type QaGrants = {
  useRoles: QaListRole[];
  manageRoles: QaListRole[];
  useProfiles: string[];
  manageProfiles: string[];
};

export type QaAccountInput = {
  id?: string;
  applicationId: string;
  environmentId: string;
  label: string;
  testRole: string;
  username: string;
  instructions: string;
  /** Blank on edit keeps the stored password. Never prefilled. */
  password: string;
  grants: QaGrants;
};

export type SecretAction = "reveal" | "copy";

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type QaPriority = (typeof PRIORITIES)[number];

export type QaCaseStep = { action: string; expected: string };

export type QaCase = {
  id: string;
  number: number;
  caseKey: string;
  version: number;
  versionId: string;
  title: string;
  preconditions: string | null;
  steps: QaCaseStep[];
  priority: QaPriority;
  module: string | null;
  platforms: PlatformKind[];
  changeNote: string | null;
  archived: boolean;
  updatedAt: string;
};

export type QaCaseDraft = {
  id?: string;
  title: string;
  preconditions: string;
  steps: QaCaseStep[];
  priority: QaPriority;
  module: string;
  platforms: PlatformKind[];
  changeNote: string;
};

export type QaCaseFilter = {
  search: string;
  priority: QaPriority | "all";
  module: string | "all";
  platform: PlatformKind | "all";
  archived: boolean;
};
export const DEFAULT_CASE_FILTER: QaCaseFilter = { search: "", priority: "all", module: "all", platform: "all", archived: false };

export type QaAttemptStatus = "pass" | "fail" | "blocked" | "not_applicable";
export type QaResultStatus = QaAttemptStatus | "not_run";
export const RESULT_STATUSES: readonly QaResultStatus[] = ["not_run", "pass", "fail", "blocked", "not_applicable"];

export type QaRunStatus = "active" | "completed" | "archived";
export type QaTotals = { total: number; pass: number; fail: number; blocked: number; notApplicable: number; notRun: number };

export type QaRun = {
  id: string;
  name: string;
  applicationId: string;
  environmentId: string;
  buildId: string;
  config: Record<string, string>;
  status: QaRunStatus;
  predecessorRunId: string | null;
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
  summary: (QaTotals & { acceptedBlocked: boolean; acceptedNotRun: boolean }) | null;
};

export type QaRunCase = {
  id: string;
  runId: string;
  caseId: string;
  caseKey: string;
  number: number;
  version: number;
  title: string;
  preconditions: string | null;
  steps: QaCaseStep[];
  priority: QaPriority;
  module: string | null;
  platforms: PlatformKind[];
  position: number;
  assigneeId: string | null;
  retestOfRunCaseId: string | null;
  status: QaResultStatus;
  attemptId: string | null;
  actual: string | null;
  attemptedAt: string | null;
  testerId: string | null;
  attemptCount: number;
  linkCount: number;
};

export type QaRunFilter = { search: string; result: QaResultStatus | "all"; assignee: string | "all" };
export const DEFAULT_RUN_FILTER: QaRunFilter = { search: "", result: "all", assignee: "all" };

export type QaAttempt = {
  id: string;
  runCaseId: string;
  status: QaAttemptStatus;
  actual: string | null;
  testerId: string | null;
  previousAttemptId: string | null;
  createdAt: string;
};

export type QaRunInput = {
  name: string;
  applicationId: string;
  environmentId: string;
  buildId: string;
  config: Record<string, string>;
  caseIds: string[];
  assignments: Record<string, string>;
  idempotencyKey: string;
};

export type QaHistoryItem = {
  id: string;
  runId: string;
  runCaseId: string;
  status: QaAttemptStatus;
  actual: string | null;
  testerId: string | null;
  createdAt: string;
  previousAttemptId: string | null;
  caseKey: string;
  caseVersion: number;
  caseTitle: string;
  runName: string;
  runStatus: QaRunStatus;
  runConfig: Record<string, string>;
  applicationName: string;
  platformKind: PlatformKind;
  environmentName: string;
  buildIdentifier: string;
  evidenceCount: number;
  linkCount: number;
};

export type QaHistoryFilter = { status: QaAttemptStatus | "all"; applicationId: string | "all"; environmentId: string | "all"; buildIdentifier: string; caseKey: string };
export const DEFAULT_HISTORY_FILTER: QaHistoryFilter = { status: "all", applicationId: "all", environmentId: "all", buildIdentifier: "", caseKey: "" };

export type QaEvidence = {
  id: string;
  attemptId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: "pending" | "ready";
  createdAt: string;
};

export type QaThingLink = { id: string; thingId: string; caseId: string; runCaseId: string; attemptId: string | null; createdAt: string };

export type QaSavedView = {
  id: string;
  viewKind: "library" | "runs" | "history";
  name: string;
  config: { columns?: string[]; filter?: Partial<QaCaseFilter>; order?: string };
};

export type ImportStrategy = "skip" | "update" | "create";
export type ImportRow = {
  case_key?: string;
  title: string;
  preconditions?: string;
  steps?: QaCaseStep[];
  priority?: string;
  module?: string;
  platforms?: string[];
  change_note?: string;
};
export type ImportReport = { applied: boolean; created: number; updated: number; skipped: number; errors: Array<{ row: number; message: string }> };
export type BulkReport = { updated: number; skipped: number };

/** A Thing as the List already knows it; QA never invents Thing state. */
export type QaThingSummary = {
  id: string;
  title: string;
  workStatus: string;
  acknowledgement: string;
  ownerName: string;
  assigneeName: string;
};

export type QaMember = { profileId: string; name: string; initials: string; avatarUrl?: string | null };
