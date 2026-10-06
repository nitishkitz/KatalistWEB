import { isIP } from "node:net";

export type LinkPreview = {
  url: string;
  host: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

/** True for loopback, private, link-local, CGNAT, multicast, reserved and unspecified addresses. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 168 || (b === 0 && address.startsWith("192.0.0.")))) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1]!, 16);
      const lo = parseInt(mappedHex[2]!, 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
    if ((first & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
    if ((first & 0xff00) === 0xff00) return true; // multicast
    return false;
  }
  return true; // not an IP literal we understand: refuse
}

/** Validates the user-supplied URL's shape before any network I/O. Returns the parsed URL or null. */
export function parsePreviewTarget(raw: string): URL | null {
  if (!raw || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (port !== 80 && port !== 443) return null;
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return null;
  }
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare) && isPrivateAddress(bare)) return null;
  return url;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower]!;
    if (lower.startsWith("#x")) return safeCodePoint(parseInt(lower.slice(2), 16), match);
    if (lower.startsWith("#")) return safeCodePoint(parseInt(lower.slice(1), 10), match);
    return match;
  });
}

function safeCodePoint(code: number, fallback: string): string {
  if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

/** Plain text only: strip tags and control characters, collapse whitespace, bound the length. */
export function sanitizeText(input: string | null | undefined, max: number): string | null {
  if (!input) return null;
  const text = decodeEntities(input)
    .replace(/<[^>]*>/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function metaContent(html: string, keys: string[]): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const key of keys) {
    for (const tag of tags) {
      const name = tag.match(/\b(?:property|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      if (!name || (name[1] ?? name[2] ?? "").toLowerCase() !== key) continue;
      const content = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const value = content?.[1] ?? content?.[2];
      if (value) return value;
    }
  }
  return null;
}

function safeImageUrl(candidate: string | null, base: URL): string | null {
  if (!candidate) return null;
  try {
    const resolved = new URL(decodeEntities(candidate), base);
    if (resolved.protocol !== "https:" && resolved.protocol !== "http:") return null;
    if (resolved.username || resolved.password) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

/** Extract sanitized preview metadata from the head of an HTML document. */
export function parseLinkPreview(html: string, finalUrl: URL): LinkPreview {
  const head = html.slice(0, 200_000);
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null;
  return {
    url: finalUrl.toString(),
    host: finalUrl.hostname.replace(/^www\./, ""),
    title: sanitizeText(metaContent(head, ["og:title", "twitter:title"]) ?? titleTag, 160),
    description: sanitizeText(
      metaContent(head, ["og:description", "twitter:description", "description"]),
      280,
    ),
    image: safeImageUrl(metaContent(head, ["og:image", "og:image:url", "twitter:image"]), finalUrl),
    siteName: sanitizeText(metaContent(head, ["og:site_name"]), 80),
  };
}
