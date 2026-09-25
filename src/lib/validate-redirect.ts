/**
 * Validates a post-auth redirect destination carried through a URL search
 * param. Only an internal, same-app path is ever accepted -- an external or
 * protocol-relative value (e.g. `//evil.example`, `https://evil.example`)
 * falls back to the default rather than being followed.
 */
export function sanitizeRedirectTarget(target: unknown, fallback = "/"): string {
  if (typeof target !== "string") return fallback;
  if (target.length === 0) return fallback;
  if (!target.startsWith("/")) return fallback;
  if (target.startsWith("//")) return fallback;
  if (target.includes("://")) return fallback;
  return target;
}
