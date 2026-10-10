/**
 * A Thing reference points at an existing Thing by its durable ID. It carries no title, avatar, or permission claim:
 * display metadata is always re-read through the viewer's own authorized Thing reads, and a reference grants no access.
 */
export type ThingReference = {
  version: 1;
  thingId: string;
};

export const THING_REFERENCE_VERSION = 1;
/** Upper bound on references in one draft/message, and on clipboard text we are willing to scan. */
export const MAX_THING_REFERENCES = 10;
export const MAX_CLIPBOARD_SCAN_LENGTH = 4_000;
/** Query parameter on the Court route that opens one Thing, e.g. `/?thing=<uuid>`. */
export const THING_PERMALINK_PARAM = "thing";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Demo fixtures use slug IDs (for example `now-more-0`). They are accepted only in an explicit demo build, never in production. */
const DEMO_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
function demoBuild(): boolean {
  return (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_KATALIST_DEMO_MODE === "true";
}

export function isThingId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return UUID_REGEX.test(value) || (demoBuild() && DEMO_ID_REGEX.test(value));
}

/** UUIDs are canonicalised to lower case; demo slugs are case-sensitive and kept as given. */
function normalizeThingId(id: string): string {
  return UUID_REGEX.test(id) ? id.toLowerCase() : id;
}

export function makeThingReference(thingId: string): ThingReference | null {
  return isThingId(thingId) ? { version: THING_REFERENCE_VERSION, thingId: normalizeThingId(thingId) } : null;
}

/** Only references with a supported version and a well-formed ID survive; anything else is dropped. */
export function sanitizeThingReferences(input: unknown): ThingReference[] {
  if (!Array.isArray(input)) return [];
  const out: ThingReference[] = [];
  for (const item of input.slice(0, MAX_THING_REFERENCES * 2)) {
    if (!item || typeof item !== "object") continue;
    const { version, thingId } = item as Partial<ThingReference>;
    if (version !== THING_REFERENCE_VERSION) continue;
    const ref = makeThingReference(thingId as string);
    if (ref) out.push(ref);
  }
  return dedupeThingReferences(out).references.slice(0, MAX_THING_REFERENCES);
}

/** Canonical authenticated permalink: opens the exact Thing on Court after reload. */
export function buildThingPermalink(thingId: string, origin: string): string | null {
  if (!isThingId(thingId)) return null;
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return null;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return null;
  const url = new URL("/", base.origin);
  url.searchParams.set(THING_PERMALINK_PARAM, normalizeThingId(thingId));
  return url.toString();
}

/** Returns the Thing ID only for a link on one of the supported application origins. */
export function parseThingPermalink(text: string, supportedOrigins: readonly string[]): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 2_048 || /\s/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!supportedOrigins.includes(url.origin)) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  const id = url.searchParams.get(THING_PERMALINK_PARAM);
  return isThingId(id) ? normalizeThingId(id) : null;
}

/**
 * Reads pasted text. Accepts the legacy Court stack transfer object as well as supported permalinks. Otherwise the paste is ordinary text and the
 * caller must leave default behaviour alone. Never trusts titles or any other clipboard-supplied claims.
 */
export function parseClipboardThingReferences(text: string, supportedOrigins: readonly string[]): ThingReference[] | null {
  if (!text || text.length > MAX_CLIPBOARD_SCAN_LENGTH) return null;
  // Older stack-card transfers wrote their drag object to text/plain. Treat only that exact shape as a reference;
  // ignore its title/lane for display and resolve metadata through the viewer's authorized Thing read.
  if (text.trim().startsWith("{")) {
    try {
      const payload: unknown = JSON.parse(text);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
      const data = payload as Record<string, unknown>;
      if (Object.keys(data).length !== 3 || typeof data.title !== "string" ||
          !["now", "next", "later"].includes(data.fromLane as string)) return null;
      const ref = makeThingReference(data.thingId as string);
      return ref ? [ref] : null;
    } catch {
      return null;
    }
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > MAX_THING_REFERENCES) return null;
  const refs: ThingReference[] = [];
  for (const line of lines) {
    const id = parseThingPermalink(line, supportedOrigins);
    if (!id) return null;
    const ref = makeThingReference(id);
    if (ref) refs.push(ref);
  }
  return refs.length ? refs : null;
}

export function dedupeThingReferences(
  refs: readonly ThingReference[],
  existing: readonly ThingReference[] = [],
): { references: ThingReference[]; duplicates: number; overflow: number } {
  const seen = new Set(existing.map((r) => r.thingId));
  const references: ThingReference[] = [];
  let duplicates = 0;
  for (const ref of refs) {
    if (seen.has(ref.thingId)) {
      duplicates += 1;
      continue;
    }
    seen.add(ref.thingId);
    references.push(ref);
  }
  return { references, duplicates, overflow: 0 };
}

/** Appends new references after existing ones (order preserved), enforcing dedupe and the per-draft cap. */
export function mergeThingReferences(
  current: readonly ThingReference[],
  incoming: readonly ThingReference[],
): { references: ThingReference[]; added: number; duplicates: number; overflow: number } {
  const { references: fresh, duplicates } = dedupeThingReferences(incoming, current);
  const room = Math.max(0, MAX_THING_REFERENCES - current.length);
  const accepted = fresh.slice(0, room);
  return {
    references: [...current, ...accepted],
    added: accepted.length,
    duplicates,
    overflow: fresh.length - accepted.length,
  };
}

export function supportedThingOrigins(): string[] {
  return typeof window === "undefined" ? [] : [window.location.origin];
}

/** Recover only the old stack transfer occupying the entire draft; ordinary instruction text is untouched. */
export function recoverLegacyThingDraft(value: string, references: readonly ThingReference[]) {
  const incoming = value.trim().startsWith("{") ? parseClipboardThingReferences(value, []) : null;
  if (!incoming) return { value, references: [...references] };
  const merged = mergeThingReferences(references, incoming);
  return merged.overflow ? { value, references: [...references] } : { value: "", references: merged.references };
}
