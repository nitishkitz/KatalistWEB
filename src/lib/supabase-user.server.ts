const MAX_TOKEN_BYTES = 8192;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type VerifiedUser = { id: string };

export type GetUserFn = (token: string) => Promise<VerifiedUser | null>;

export async function requireSupabaseUser(
  request: Request,
  getUser: GetUserFn,
): Promise<VerifiedUser> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/.exec(header.trim());
  if (!match) throw new HttpError(401, "Sign in to continue.");
  const token = match[1];
  if (token.length > MAX_TOKEN_BYTES) throw new HttpError(401, "Sign in to continue.");
  const user = await getUser(token);
  if (!user?.id) throw new HttpError(401, "Sign in to continue.");
  return { id: user.id };
}

export function jsonNoStore(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function defaultGetUser(token: string): Promise<VerifiedUser | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user?.id) return null;
  return { id: data.user.id };
}
