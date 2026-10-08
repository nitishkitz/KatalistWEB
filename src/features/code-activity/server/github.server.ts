import { createSign } from "node:crypto";
import { base64url } from "./crypto.server";
import type { CodeActivityConfig } from "./config.server";
import { createGitHubReader } from "./github-read.server";
import type { GitHubReader } from "./github-read.server";

/** Provider limits (contract-delta section 7, PROVISIONAL). */
export const GITHUB_LIMITS = {
  deadlineMs: 8_000,
  /** Whole callback sequence (code exchange plus discovery). PROVISIONAL; each request still has deadlineMs. */
  callbackDeadlineMs: 25_000,
  /** Whole connect verification (token mint plus reachability). PROVISIONAL. */
  connectDeadlineMs: 15_000,
  maxInstallations: 10,
  maxRepositories: 300,
  perPage: 100,
} as const;

/** REST version shown in the provider evidence retrieved 7 Oct 2026. UNVERIFIED against a live App. */
export const GITHUB_API_VERSION = "2026-03-10";

/** Read-only permissions requested for every runtime installation token. No write permission, ever. */
export const READ_ONLY_PERMISSIONS = {
  metadata: "read",
  pull_requests: "read",
  checks: "read",
  statuses: "read",
  contents: "read",
} as const;

export type GitHubErrorKind =
  | "timeout"
  | "rate_limited"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "bad_response"
  | "too_many"
  /** The installation's hourly request budget is spent: no request was made. */
  | "budget"
  | "unavailable";

export class GitHubError extends Error {
  readonly kind: GitHubErrorKind;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(kind: GitHubErrorKind, status?: number, retryAfterSeconds?: number) {
    // The message never carries provider text, tokens, or URLs.
    super(`github_${kind}`);
    this.name = "GitHubError";
    this.kind = kind;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface UserRepository {
  installationId: number;
  repositoryId: number;
  fullName: string;
  visibility: "private" | "public";
  updatedAt: string | null;
}

export interface InstallationToken {
  token: string;
  expiresAt: string;
  repositoryIds: number[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

// ---- response validators (pure; exported for tests) -------------------------------------------

export function parseTokenExchange(body: unknown): string {
  if (!isObject(body) || typeof body.access_token !== "string" || body.access_token.length < 10 || body.error) {
    throw new GitHubError("bad_response");
  }
  return body.access_token;
}

export function parseInstallations(body: unknown): number[] {
  if (!isObject(body) || !Array.isArray(body.installations)) throw new GitHubError("bad_response");
  return body.installations.map((i) => {
    if (!isObject(i) || !isPositiveInt(i.id)) throw new GitHubError("bad_response");
    return i.id;
  });
}

export function parseRepositories(body: unknown, installationId: number): UserRepository[] {
  if (!isObject(body) || !Array.isArray(body.repositories)) throw new GitHubError("bad_response");
  return body.repositories.map((r) => {
    if (!isObject(r) || !isPositiveInt(r.id) || typeof r.full_name !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(r.full_name)) {
      throw new GitHubError("bad_response");
    }
    const priv = r.private === true;
    return {
      installationId,
      repositoryId: r.id,
      fullName: r.full_name,
      visibility: priv ? "private" : "public",
      updatedAt: typeof r.pushed_at === "string" ? r.pushed_at : typeof r.updated_at === "string" ? r.updated_at : null,
    } satisfies UserRepository;
  });
}

/** The minted token must be read-only and cover exactly the requested repository. */
export function parseInstallationToken(body: unknown, requestedRepositoryId: number, allowed: readonly string[] = Object.keys(READ_ONLY_PERMISSIONS)): InstallationToken {
  if (!isObject(body) || typeof body.token !== "string" || body.token.length < 10 || typeof body.expires_at !== "string") {
    throw new GitHubError("bad_response");
  }
  const permissions = isObject(body.permissions) ? body.permissions : {};
  for (const [name, level] of Object.entries(permissions)) {
    if (level !== "read") throw new GitHubError("bad_response"); // any write or admin level is refused
    if (!allowed.includes(name)) throw new GitHubError("bad_response"); // so is a permission nobody asked for
  }
  const repositories = Array.isArray(body.repositories) ? body.repositories : null;
  if (body.repository_selection !== "selected" || !repositories) throw new GitHubError("bad_response");
  const ids = repositories.map((r) => (isObject(r) ? r.id : null));
  if (ids.length !== 1 || ids[0] !== requestedRepositoryId) throw new GitHubError("bad_response");
  return { token: body.token, expiresAt: body.expires_at, repositoryIds: [requestedRepositoryId] };
}

export function parseInstallationRepositoryIds(body: unknown): number[] {
  if (!isObject(body) || !Array.isArray(body.repositories)) throw new GitHubError("bad_response");
  return body.repositories.map((r) => {
    if (!isObject(r) || !isPositiveInt(r.id)) throw new GitHubError("bad_response");
    return r.id;
  });
}

// ---- client ------------------------------------------------------------------------------------

export type Caller = (url: string, init: RequestInit & { json?: unknown }) => Promise<unknown>;

export interface GitHubCore {
  authorizeUrl(input: { state: string; challenge: string }): string;
  installUrl(state: string): string;
  exchangeCode(input: { code: string; verifier: string }): Promise<string>;
  collectUserRepositories(userToken: string): Promise<UserRepository[]>;
  /** `deployments: true` adds the read-only Deployments permission, for the deployments pane only. */
  mintInstallationToken(input: { installationId: number; repositoryId: number; deployments?: boolean }): Promise<InstallationToken>;
  installationReachesRepository(installationToken: string, repositoryId: number): Promise<boolean>;
  appJwt(): string;
}

/** Everything the services need from GitHub. Reads live in github-read.server.ts. */
export interface GitHubClient extends GitHubCore, GitHubReader {
  /** A client whose calls share one total time budget, on top of the per-request deadline. */
  withDeadline(totalMs: number): GitHubClient;
  /** A client that asks the meter before EVERY request it makes, and makes none when the meter says no. */
  withMeter(meter: RequestMeter): GitHubClient;
}

/** Admission for provider requests. `take` resolves false when the budget is spent. */
export interface RequestMeter {
  take(): Promise<boolean>;
}

export interface GitHubClientOptions {
  config: CodeActivityConfig;
  fetchImpl?: typeof fetch;
  /** Seconds since the epoch. Injected for tests. */
  nowSeconds?: () => number;
  /** Overall deadline shared by every call made through this client. Aborting it fails the next call as a timeout. */
  signal?: AbortSignal;
  /** Counts every request against the installation's budget before it is made. */
  meter?: RequestMeter;
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const { config, fetchImpl = fetch, nowSeconds = () => Math.floor(Date.now() / 1000), signal: overall, meter } = options;
  async function call(url: string, init: RequestInit & { json?: unknown }): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/vnd.github+json");
    headers.set("X-GitHub-Api-Version", GITHUB_API_VERSION);
    headers.set("User-Agent", "katalist-code-activity");
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(init.json);
    }
    if (overall?.aborted) throw new GitHubError("timeout");
    // Every request is metered, including token minting and each page: a loop cannot slip past the budget.
    if (meter && !(await meter.take())) throw new GitHubError("budget");
    const perRequest = AbortSignal.timeout(GITHUB_LIMITS.deadlineMs);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        body,
        headers,
        redirect: "error",
        signal: overall ? AbortSignal.any([perRequest, overall]) : perRequest,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new GitHubError(name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable");
    }
    if (response.status === 401) throw new GitHubError("unauthorized", 401);
    if (response.status === 404) throw new GitHubError("not_found", 404);
    if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
      const retry = Number(response.headers.get("retry-after"));
      throw new GitHubError("rate_limited", response.status, Number.isFinite(retry) && retry > 0 ? retry : undefined);
    }
    if (response.status === 403) throw new GitHubError("forbidden", 403);
    if (response.status >= 500) throw new GitHubError("unavailable", response.status);
    if (!response.ok) throw new GitHubError("bad_response", response.status);
    try {
      return await response.json();
    } catch {
      throw new GitHubError("bad_response", response.status);
    }
  }

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** RS256 App JWT: iat 60 s in the past, exp at most 10 minutes ahead, iss the client ID. */
  function appJwt(): string {
    const now = nowSeconds();
    const header = base64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
    const payload = base64url(Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: config.clientId })));
    const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(config.privateKeyPem);
    return `${header}.${payload}.${base64url(signature)}`;
  }

  return {
    ...createGitHubReader(call),

    withMeter(next: RequestMeter): GitHubClient {
      return createGitHubClient({ ...options, meter: next });
    },

    withDeadline(totalMs: number): GitHubClient {
      const budget = AbortSignal.timeout(totalMs);
      return createGitHubClient({ ...options, signal: overall ? AbortSignal.any([overall, budget]) : budget });
    },

    authorizeUrl(input: { state: string; challenge: string }): string {
      const url = new URL("https://github.com/login/oauth/authorize");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", config.callbackUrl);
      url.searchParams.set("state", input.state);
      url.searchParams.set("code_challenge", input.challenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },

    installUrl(state: string): string {
      const url = new URL(`https://github.com/apps/${encodeURIComponent(config.appSlug)}/installations/new`);
      url.searchParams.set("state", state);
      return url.toString();
    },

    /** The user token is returned to the caller for this one request only. Never store or log it. */
    async exchangeCode(input: { code: string; verifier: string }): Promise<string> {
      const body = await call("https://github.com/login/oauth/access_token", {
        method: "POST",
        json: {
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code: input.code,
          redirect_uri: config.callbackUrl,
          code_verifier: input.verifier,
        },
      });
      return parseTokenExchange(body);
    },

    /** Repositories reachable by this user inside installations of this App. Bounded; over-limit aborts. */
    async collectUserRepositories(userToken: string): Promise<UserRepository[]> {
      const installs = parseInstallations(
        await call(`https://api.github.com/user/installations?per_page=${GITHUB_LIMITS.perPage}`, { headers: bearer(userToken) }),
      );
      if (installs.length > GITHUB_LIMITS.maxInstallations) throw new GitHubError("too_many");
      const repositories: UserRepository[] = [];
      for (const installationId of installs) {
        for (let page = 1; ; page += 1) {
          const batch = parseRepositories(
            await call(
              `https://api.github.com/user/installations/${installationId}/repositories?per_page=${GITHUB_LIMITS.perPage}&page=${page}`,
              { headers: bearer(userToken) },
            ),
            installationId,
          );
          repositories.push(...batch);
          if (repositories.length > GITHUB_LIMITS.maxRepositories) throw new GitHubError("too_many");
          if (batch.length < GITHUB_LIMITS.perPage) break;
        }
      }
      return repositories;
    },

    /** Mints a read-only token narrowed to one repository. Refuses a broader or writable reply. */
    async mintInstallationToken(input: { installationId: number; repositoryId: number; deployments?: boolean }): Promise<InstallationToken> {
      const permissions = input.deployments ? { ...READ_ONLY_PERMISSIONS, deployments: "read" } : READ_ONLY_PERMISSIONS;
      const body = await call(`https://api.github.com/app/installations/${input.installationId}/access_tokens`, {
        method: "POST",
        headers: bearer(appJwt()),
        json: { repository_ids: [input.repositoryId], permissions },
      });
      return parseInstallationToken(body, input.repositoryId, Object.keys(permissions));
    },

    /** Proves the installation (not just the user) reaches the repository. */
    async installationReachesRepository(installationToken: string, repositoryId: number): Promise<boolean> {
      const body = await call(`https://api.github.com/installation/repositories?per_page=${GITHUB_LIMITS.perPage}`, {
        headers: bearer(installationToken),
      });
      return parseInstallationRepositoryIds(body).includes(repositoryId);
    },

    appJwt,
  };
}
