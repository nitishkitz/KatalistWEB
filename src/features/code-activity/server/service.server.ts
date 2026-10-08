import type { ConfigResult } from "./config.server";
import {
  PROOF_COOKIE_SECONDS,
  START_COOKIE_SECONDS,
  TOKEN_PATTERN,
  challengeFor,
  clearNonceCookie,
  deriveVerifier,
  nonceCookie,
  randomToken,
  readNonceCookie,
  sha256Bytea,
} from "./crypto.server";
import { createMeter } from "./budget.server";
import { GITHUB_LIMITS, GitHubError } from "./github.server";
import type { GitHubClient } from "./github.server";

/**
 * Connection orchestration for G05/G06. Pure of HTTP: routes translate a `ServiceResult` into a Response.
 * Every database call goes through an RPC; the user-scoped client enforces the owner checks, and the
 * admin (service role) client only calls the server-only functions drafted in G03. Nothing here stores
 * or logs a token, nonce, or provider payload.
 */

export interface RpcResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}
export interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

export interface Deps {
  config: ConfigResult;
  github: GitHubClient | null;
  admin: () => RpcClient;
  random?: () => string;
  /** Overrides for tests. Defaults come from GITHUB_LIMITS. */
  callbackDeadlineMs?: number;
  connectDeadlineMs?: number;
  refreshDeadlineMs?: number;
  detailDeadlineMs?: number;
  workspaceDeadlineMs?: number;
}

export type ErrorCode = "not_allowed" | "not_configured" | "disabled" | "rate_limited" | "source_unavailable" | "timed_out" | "invalid_request" | "already_connected" | "busy" | "source_changed" | "conflict" | "consent_withdrawn";

export interface ServiceResult {
  status: number;
  body?: Record<string, unknown>;
  /** Set-Cookie header values. */
  cookies?: string[];
  /** Relative in-app redirect. Never built from request input other than a validated List id. */
  redirect?: string;
}

const STATUS: Record<ErrorCode, number> = {
  not_allowed: 403,
  disabled: 403,
  not_configured: 503,
  rate_limited: 429,
  source_unavailable: 502,
  timed_out: 504,
  invalid_request: 400,
  already_connected: 409,
  busy: 409,
  source_changed: 409,
  conflict: 409,
  consent_withdrawn: 403,
};
const MESSAGE: Record<ErrorCode, string> = {
  not_allowed: "This action is not available.",
  disabled: "This action is not available.",
  not_configured: "GitHub connection is not configured yet.",
  rate_limited: "Too many attempts. Try again later.",
  source_unavailable: "GitHub is not available right now.",
  timed_out: "GitHub did not respond in time.",
  invalid_request: "The request could not be processed.",
  already_connected: "A repository is already connected to this List.",
  busy: "A refresh is already running.",
  source_changed: "This change was updated since you reviewed it.",
  conflict: "That request conflicts with an earlier one.",
  consent_withdrawn: "Coey is turned off for this List.",
};

export function failure(code: ErrorCode, extra: Partial<ServiceResult> = {}): ServiceResult {
  // `disabled` and `not_allowed` share one body so a caller cannot tell them apart.
  const shown = code === "disabled" ? "not_allowed" : code;
  return { status: STATUS[code], body: { error: shown, message: MESSAGE[shown] }, ...extra };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Maps a database error to a neutral code. A missing function means the G03 schema is not applied. */
export function mapRpcError(error: { code?: string; message: string }): ErrorCode {
  const code = error.code ?? "";
  if (code === "42501") return "not_allowed";
  if (code === "23505") return "already_connected";
  if (code === "54000") return "rate_limited";
  if (code === "55006") return "busy";
  // 42883 undefined_function, PGRST202 function not found in the schema cache, 42P01 undefined_table
  if (code === "42883" || code === "PGRST202" || code === "42P01") return "not_configured";
  return "source_unavailable";
}

export function mapGitHubError(error: unknown): ErrorCode {
  if (!(error instanceof GitHubError)) return "source_unavailable";
  if (error.kind === "timeout") return "timed_out";
  if (error.kind === "rate_limited" || error.kind === "budget") return "rate_limited";
  return "source_unavailable";
}

const redirectTo = (listId: string, outcome: string, cookies?: string[]): ServiceResult => ({
  status: 302,
  redirect: `/lists/${listId}?codeActivity=${outcome}`,
  cookies,
});

// ---- E1 capabilities ---------------------------------------------------------------------------

/**
 * `{ enabled }` for everyone; a member of an enabled List also learns `configured` and the two AI booleans:
 * `available` (operator flag on AND a model key configured) and `consent` (the owner's per-List setting).
 * Consent audit details are never included.
 */
export async function capabilities(input: { user: RpcClient; listId: string; config: ConfigResult; aiConfigured?: boolean }): Promise<ServiceResult> {
  if (!isUuid(input.listId)) return { status: 200, body: { enabled: false } };
  const { data, error } = await input.user.rpc("code_activity_is_enabled", { p_list_id: input.listId });
  if (error || data !== true) return { status: 200, body: { enabled: false } };
  const ai = await input.user.rpc("code_activity_ai_status", { p_list_id: input.listId });
  const row = !ai.error && Array.isArray(ai.data) ? (ai.data[0] as { o_available?: boolean; o_consent?: boolean } | undefined) : undefined;
  return {
    status: 200,
    body: {
      enabled: true,
      configured: input.config.configured,
      ai: { available: row?.o_available === true && input.aiConfigured === true, consent: row?.o_consent === true },
    },
  };
}

// ---- E2 start ----------------------------------------------------------------------------------

export async function startAuthorization(
  deps: Deps,
  input: { user: RpcClient; listId: string; flow: string },
): Promise<ServiceResult> {
  if (!deps.config.configured || !deps.github) return failure("not_configured");
  if (!isUuid(input.listId) || (input.flow !== "oauth" && input.flow !== "install")) return failure("invalid_request");
  const state = (deps.random ?? randomToken)();
  const nonce = (deps.random ?? randomToken)();
  const { error } = await input.user.rpc("code_activity_start_authorization", {
    p_list_id: input.listId,
    p_flow: input.flow,
    p_state_hash: sha256Bytea(state),
    p_nonce_hash: sha256Bytea(nonce),
  });
  if (error) return failure(mapRpcError(error));
  const url =
    input.flow === "install"
      ? deps.github.installUrl(state)
      : deps.github.authorizeUrl({ state, challenge: challengeFor(deriveVerifier(deps.config.config.stateSecret, state, nonce)) });
  return { status: 200, body: { url, flow: input.flow }, cookies: [nonceCookie(nonce, START_COOKIE_SECONDS)] };
}

// ---- E3 callback -------------------------------------------------------------------------------

export interface CallbackQuery {
  code?: string | null;
  state?: string | null;
  error?: string | null;
}

/**
 * Browser navigation without a Bearer header. Identity comes from the single-use state plus the browser
 * nonce cookie. Any malformed, missing, expired, replayed or mismatched input redirects nowhere useful:
 * without a validated state there is no List to return to, so the response is a neutral 400.
 */
export async function handleCallback(deps: Deps, input: { query: CallbackQuery; cookieHeader: string | null }): Promise<ServiceResult> {
  if (!deps.config.configured || !deps.github) return failure("not_configured");
  const { state, code } = input.query;
  const nonce = readNonceCookie(input.cookieHeader);
  if (!state || !TOKEN_PATTERN.test(state) || !nonce) return failure("invalid_request", { cookies: [clearNonceCookie()] });

  const consumed = await deps.admin().rpc("code_activity_server_consume_auth_state", {
    p_state_hash: sha256Bytea(state),
    p_nonce_hash: sha256Bytea(nonce),
  });
  const row = Array.isArray(consumed.data) ? (consumed.data[0] as { o_flow?: string; o_list_id?: string; o_profile_id?: string } | undefined) : undefined;
  if (consumed.error || !row || !isUuid(row.o_list_id) || !isUuid(row.o_profile_id)) {
    return failure("invalid_request", { cookies: [clearNonceCookie()] });
  }
  const listId = row.o_list_id;
  const profileId = row.o_profile_id;

  // From here the List is known and trusted (bound in the state), so failures return to it.
  if (row.o_flow === "install") return redirectTo(listId, "continue", [nonceCookie(nonce, PROOF_COOKIE_SECONDS)]);
  if (input.query.error) return redirectTo(listId, "denied", [clearNonceCookie()]);
  if (!code || code.length > 512) return redirectTo(listId, "error", [clearNonceCookie()]);

  try {
    const verifier = deriveVerifier(deps.config.config.stateSecret, state, nonce);
    // One total budget covers the code exchange and the whole sequential discovery.
    const github = deps.github.withDeadline(deps.callbackDeadlineMs ?? GITHUB_LIMITS.callbackDeadlineMs);
    let userToken: string | null = await github.exchangeCode({ code, verifier });
    const repositories = await github.collectUserRepositories(userToken);
    userToken = null; // the user token is discarded here; it was never stored or logged
    void userToken;
    const items = repositories.map((r) => ({
      installation_id: r.installationId,
      repository_id: r.repositoryId,
      full_name: r.fullName,
      visibility: r.visibility,
      updated_at: r.updatedAt,
    }));
    const written = await deps.admin().rpc("code_activity_server_write_selection_proofs", {
      p_list_id: listId,
      p_profile_id: profileId,
      p_nonce_hash: sha256Bytea(nonce),
      p_items: items,
    });
    if (written.error) return redirectTo(listId, "error", [clearNonceCookie()]);
    return redirectTo(listId, "select", [nonceCookie(nonce, PROOF_COOKIE_SECONDS)]);
  } catch (error) {
    const outcome = error instanceof GitHubError ? (error.kind === "too_many" ? "too_many" : error.kind === "timeout" ? "timed_out" : "error") : "error";
    return redirectTo(listId, outcome, [clearNonceCookie()]);
  }
}

// ---- E16 repository selection ------------------------------------------------------------------

export async function listRepositories(input: {
  user: RpcClient;
  listId: string;
  cookieHeader: string | null;
  after?: string | null;
  limit?: number;
}): Promise<ServiceResult> {
  const nonce = readNonceCookie(input.cookieHeader);
  if (!isUuid(input.listId)) return failure("invalid_request");
  if (!nonce) return { status: 200, body: { items: [], nextCursor: null } };
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50) || 50, 1), 50);
  const { data, error } = await input.user.rpc("code_activity_list_selection_proofs", {
    p_list_id: input.listId,
    p_nonce_hash: sha256Bytea(nonce),
    p_after: input.after ?? null,
    p_limit: limit,
  });
  if (error) return failure(mapRpcError(error));
  const rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  const items = rows.map((r) => ({
    proofId: r.proof_id,
    fullName: r.repository_full_name,
    visibility: r.visibility,
    updatedAt: r.repository_updated_at ?? null,
  }));
  const last = rows.length === limit ? (rows[rows.length - 1].repository_full_name as string) : null;
  return { status: 200, body: { items, nextCursor: last } };
}

// ---- E4 connect --------------------------------------------------------------------------------

export async function connect(
  deps: Deps,
  input: { userId: string; user: RpcClient; listId: string; proofId: string; acknowledged: unknown; cookieHeader: string | null },
): Promise<ServiceResult> {
  if (!deps.config.configured || !deps.github) return failure("not_configured");
  if (!isUuid(input.listId) || !isUuid(input.proofId) || input.acknowledged !== true) return failure("invalid_request");
  const nonce = readNonceCookie(input.cookieHeader);
  if (!nonce) return failure("not_allowed");
  const nonceHash = sha256Bytea(nonce);
  const args = { p_proof_id: input.proofId, p_list_id: input.listId, p_profile_id: input.userId, p_nonce_hash: nonceHash };

  // 1. The server reads the proof's installation and repository (bound to this verified user, List and browser).
  const proof = await deps.admin().rpc("code_activity_server_get_proof", args);
  const row = Array.isArray(proof.data) ? (proof.data[0] as { o_installation_id?: number | string; o_repository_id?: number | string } | undefined) : undefined;
  if (proof.error) return failure(mapRpcError(proof.error));
  if (!row) return failure("not_allowed");
  const installationId = Number(row.o_installation_id);
  const repositoryId = Number(row.o_repository_id);
  if (!Number.isSafeInteger(installationId) || !Number.isSafeInteger(repositoryId)) return failure("source_unavailable");

  // 2. Prove the installation (not only the user) reaches the repository, with a token narrowed to it.
  try {
    const github = deps.github.withDeadline(deps.connectDeadlineMs ?? GITHUB_LIMITS.connectDeadlineMs).withMeter(createMeter(deps.admin, installationId, true));
    const token = await github.mintInstallationToken({ installationId, repositoryId });
    if (!(await github.installationReachesRepository(token.token, repositoryId))) return failure("not_allowed");
  } catch (error) {
    return failure(mapGitHubError(error));
  }

  // 3. Record the verification (server-only), then connect on the user-scoped client.
  const marked = await deps.admin().rpc("code_activity_server_mark_proof_verified", args);
  if (marked.error) return failure(mapRpcError(marked.error));
  if (marked.data !== true) return failure("not_allowed");
  const connected = await input.user.rpc("code_activity_connect", {
    p_list_id: input.listId,
    p_proof_id: input.proofId,
    p_nonce_hash: nonceHash,
    p_sharing_acknowledged: true,
  });
  if (connected.error) return failure(mapRpcError(connected.error));
  return { status: 200, body: { connected: true }, cookies: [clearNonceCookie()] };
}

// ---- E5 disconnect and E17 status --------------------------------------------------------------

export async function disconnect(input: { user: RpcClient; listId: string; confirm: unknown }): Promise<ServiceResult> {
  if (!isUuid(input.listId) || input.confirm !== true) return failure("invalid_request");
  const { error } = await input.user.rpc("code_activity_disconnect", { p_list_id: input.listId, p_confirm: true });
  if (error) return failure(mapRpcError(error));
  return { status: 200, body: { disconnected: true }, cookies: [clearNonceCookie()] };
}

export async function connectionStatus(input: { user: RpcClient; listId: string }): Promise<ServiceResult> {
  if (!isUuid(input.listId)) return failure("invalid_request");
  const { data, error } = await input.user.rpc("code_activity_connection_status", { p_list_id: input.listId });
  if (error) return failure(mapRpcError(error));
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) return { status: 200, body: { status: "none" } };
  return {
    status: 200,
    body: {
      status: row.status,
      repositoryFullName: row.repository_full_name ?? null,
      lastSyncedAt: row.last_synced_at ?? null,
      syncStatus: row.sync_status ?? null,
      // True when access is uncertain and the owner must disconnect and connect again; no activity is shown meanwhile.
      needsReverification: row.needs_reverification === true,
    },
  };
}
