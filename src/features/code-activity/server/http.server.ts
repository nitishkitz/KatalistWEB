import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "./config.server";
import { createGitHubClient } from "./github.server";
import type { Deps, RpcClient, ServiceResult } from "./service.server";

const BASE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

/** Turns a service result into a Response. Authenticated replies are never cacheable. */
export function toResponse(result: ServiceResult): Response {
  const headers = new Headers(BASE_HEADERS);
  for (const cookie of result.cookies ?? []) headers.append("Set-Cookie", cookie);
  if (result.redirect) {
    headers.set("Location", result.redirect);
    return new Response(null, { status: result.status, headers });
  }
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(result.body ?? {}), { status: result.status, headers });
}

export interface AuthedUser {
  userId: string;
  /** User-scoped client: auth.uid() and the owner checks inside the database functions apply. */
  user: RpcClient;
}

/** Request-based Bearer verification matching server/lib/require-user.ts. Returns null when not signed in. */
export async function authenticate(request: Request): Promise<AuthedUser | null> {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const client = createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  return { userId: data.user.id, user: client as unknown as RpcClient };
}

/** Per-request dependencies. Configuration is read lazily; the GitHub client exists only when configured. */
export async function buildDeps(): Promise<Deps> {
  const config = loadConfig();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return {
    config,
    github: config.configured ? createGitHubClient({ config: config.config }) : null,
    admin: () => supabaseAdmin as unknown as RpcClient,
  };
}

export const unauthorized = (): Response =>
  toResponse({ status: 401, body: { error: "unauthorized", message: "Authentication required." } });

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Adds the optional model configuration to the usual dependencies. Null disables Coey only. */
export async function buildAiDeps(): Promise<import("./ai.server").AiDeps> {
  const { loadAiConfig } = await import("./ai.server");
  return { ...(await buildDeps()), ai: loadAiConfig() };
}
