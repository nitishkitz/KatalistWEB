// Server-only helpers for the Bridge trusted boundary.
// The raw magic-link token and the Bridge session token are never logged,
// never returned to the browser body, and never leave this server module
// except as an HttpOnly cookie value.

export const BRIDGE_COOKIE = 'katalist_bridge';

export function readBridgeCookie(request: Request): string | null {
  const raw = request.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name === BRIDGE_COOKIE) {
      return decodeURIComponent(part.slice(idx + 1).trim()) || null;
    }
  }
  return null;
}

export function bridgeCookieHeader(token: string, expiresAt: string): string {
  const maxAge = Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
  );
  return [
    `${BRIDGE_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

export function clearBridgeCookie(): string {
  return `${BRIDGE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init?.headers ?? {}),
    },
  });
}

/** Never surface raw Postgres internals or tokens to an unauthenticated caller. */
export function bridgeError(message?: string, status = 401): Response {
  return json({ error: message ?? 'This link is no longer active.' }, { status });
}

/**
 * Detailed Bridge failures stay on the server. Never include the raw message
 * in a response body — public Bridge endpoints return fixed, safe strings.
 */
export function logBridgeFailure(scope: string, error: unknown): void {
  const detail =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error);
  console.error(`[bridge:${scope}] ${detail}`);
}
