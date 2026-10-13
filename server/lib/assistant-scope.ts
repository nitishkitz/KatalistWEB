import type { SupabaseClient } from "@supabase/supabase-js";

type ContextKind = "work" | "home";
export type ScopeType = "list" | "bucket";

export type ScopeCandidate = {
  type: ScopeType;
  id: string;
  label: string;
  context: ContextKind;
  detail?: string;
};

export type NamedScope = ScopeCandidate & { archived: boolean; createdAt?: string };

export type ScopeResolution =
  | { kind: "none" }
  | { kind: "resolved"; scope: ScopeCandidate }
  | { kind: "ambiguous"; candidates: ScopeCandidate[] }
  | { kind: "other_context"; candidates: ScopeCandidate[] }
  | { kind: "archived"; candidates: ScopeCandidate[] }
  | { kind: "missing"; name: string; type: ScopeType };

const MAX_SCOPES = 500;
const CUE_WORDS = new Set(["in", "inside", "within", "about", "for", "on", "from", "of", "at"]);
const TYPE_WORDS: Record<string, ScopeType> = { list: "list", lists: "list", bucket: "bucket", buckets: "bucket" };

export function normalizeScopeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1)
    for (let j = 1; j <= b.length; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // Adjacent transposition ("paymnets") counts as one typo.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

function fuzzyLimit(length: number): number {
  if (length < 5) return 0;
  return length < 9 ? 1 : 2;
}

type Match = { scope: NamedScope; tier: 1 | 2 | 3; tokens: number; hint?: ScopeType };

/**
 * Pure name matcher. Tiers: 3 exact phrase, 2 prefix of a longer name, 1 safe fuzzy.
 * The longest phrase in the best tier wins. Single short words need a preposition
 * or a "list"/"bucket" keyword so everyday words never select a scope by accident.
 */
export function matchScopes(question: string, scopes: NamedScope[]): Match[] {
  const tokens = normalizeScopeText(question).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const matches: Match[] = [];
  for (const scope of scopes) {
    const name = normalizeScopeText(scope.label);
    const nameTokens = name.split(" ").filter(Boolean);
    if (name.length < 3) continue;
    let best: Match | null = null;
    const consider = (tier: 1 | 2 | 3, start: number, length: number) => {
      const before = tokens[start - 1];
      const after = tokens[start + length];
      const hint = TYPE_WORDS[after ?? ""] ?? TYPE_WORDS[before ?? ""];
      const cued =
        Boolean(hint) ||
        CUE_WORDS.has(before ?? "") ||
        (before === "the" && CUE_WORDS.has(tokens[start - 2] ?? ""));
      const phrase = tokens.slice(start, start + length).join(" ");
      if (tier === 3 && !cued && length < 2 && phrase.length < 6) return;
      if (tier === 1 && !cued && length < 2) return;
      const candidate: Match = { scope, tier, tokens: length, ...(hint ? { hint } : {}) };
      if (!best || tier > best.tier || (tier === best.tier && length > best.tokens)) best = candidate;
    };
    for (let start = 0; start < tokens.length; start += 1) {
      // Exact and fuzzy: same token count as the name.
      const window = tokens.slice(start, start + nameTokens.length).join(" ");
      if (window === name) consider(3, start, nameTokens.length);
      else if (window.split(" ").length === nameTokens.length) {
        const limit = fuzzyLimit(name.length);
        if (limit > 0 && editDistance(window, name, limit) <= limit) consider(1, start, nameTokens.length);
      }
      // Prefix: "Website" selects "Website Launch" only after a cue word.
      if (nameTokens.length > 1) {
        for (let length = 1; length < nameTokens.length; length += 1) {
          const phrase = tokens.slice(start, start + length).join(" ");
          if (phrase.length >= 4 && name.startsWith(`${phrase} `)) {
            const before = tokens[start - 1];
            const after = tokens[start + length];
            const cued =
              CUE_WORDS.has(before ?? "") ||
              (before === "the" && CUE_WORDS.has(tokens[start - 2] ?? "")) ||
              Boolean(TYPE_WORDS[after ?? ""]);
            if (cued) consider(2, start, length);
          }
        }
      }
    }
    if (best) matches.push(best);
  }
  return matches;
}

function toCandidate(scope: NamedScope): ScopeCandidate {
  return {
    type: scope.type,
    id: scope.id,
    label: scope.label,
    context: scope.context,
    ...(scope.detail ? { detail: scope.detail } : {}),
  };
}

const NON_NAMES = new Set(["this", "that", "my", "our", "current", "same", "each", "every", "any", "a", "an", "which", "what", "other", "another", "whole", "entire", "all", "these", "those"]);

/** Detects "in the X list/bucket" phrasing so an unknown name is reported instead of silently using the current scope. */
export function extractRequestedScope(question: string): { name: string; type: ScopeType } | null {
  const found = /\b(?:in|inside|within|about|for|on|from|of)\s+(?:the\s+)?([\p{L}\p{N}][\p{L}\p{N}' -]{1,60}?)\s+(list|bucket)\b/iu.exec(question);
  if (!found) return null;
  const name = found[1].trim();
  const first = normalizeScopeText(name).split(" ")[0] ?? "";
  if (!first || NON_NAMES.has(first) || normalizeScopeText(name).split(" ").length > 4) return null;
  return { name: name.slice(0, 60), type: found[2].toLowerCase() as ScopeType };
}

/** Pure decision logic so ambiguity rules can be tested without a database. */
export function decideScope(
  question: string,
  scopes: NamedScope[],
  context: ContextKind,
): ScopeResolution {
  const matches = matchScopes(question, scopes);
  if (!matches.length) {
    const requested = extractRequestedScope(question);
    return requested ? { kind: "missing", ...requested } : { kind: "none" };
  }
  const top = Math.max(...matches.map((match) => match.tier * 100 + match.tokens));
  const best = matches.filter((match) => match.tier * 100 + match.tokens === top);
  const inContext = best.filter((match) => match.scope.context === context && !match.scope.archived);
  if (!inContext.length) {
    const archived = best.filter((match) => match.scope.context === context && match.scope.archived);
    if (archived.length) return { kind: "archived", candidates: archived.map((m) => toCandidate(m.scope)) };
    return { kind: "other_context", candidates: best.map((m) => toCandidate(m.scope)) };
  }
  const hinted = inContext.find((match) => match.hint);
  const typed = hinted?.hint ? inContext.filter((match) => match.scope.type === hinted.hint) : [];
  const pool = typed.length ? typed : inContext;
  // A "list"/"bucket" keyword that matches nothing is not enough to guess the other type.
  if (hinted?.hint && !typed.length) return { kind: "ambiguous", candidates: pool.map((m) => toCandidate(m.scope)) };
  if (pool.length === 1 && pool[0].tier === 3) return { kind: "resolved", scope: toCandidate(pool[0].scope) };
  if (pool.length === 1 && pool[0].tier === 2) return { kind: "resolved", scope: toCandidate(pool[0].scope) };
  // Fuzzy single matches are confirmed with the user rather than trusted.
  return { kind: "ambiguous", candidates: pool.map((m) => toCandidate(m.scope)).slice(0, 6) };
}

function describeCreated(createdAt?: string): string | undefined {
  if (!createdAt) return undefined;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return `Created ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

async function loadNamedScopes(client: SupabaseClient): Promise<NamedScope[]> {
  const [lists, buckets] = await Promise.all([
    // DMs and groups are conversations named after people, not Lists: "pending with Sudheer"
    // must never be read as "inside the Sudheer DM".
    client.from("lists").select("id,name,context,archived_at,created_at").not("kind", "in", "(dm,group)").limit(MAX_SCOPES),
    client.from("buckets").select("id,name,context,archived_at,created_at").limit(MAX_SCOPES),
  ]);
  if (lists.error) throw lists.error;
  if (buckets.error) throw buckets.error;
  const map = (type: ScopeType, rows: Array<Record<string, unknown>> | null): NamedScope[] =>
    (rows ?? [])
      .filter((row) => typeof row.id === "string" && typeof row.name === "string")
      .map((row) => ({
        type,
        id: row.id as string,
        label: (row.name as string).slice(0, 120),
        context: (row.context === "home" ? "home" : "work") as ContextKind,
        archived: Boolean(row.archived_at),
        createdAt: typeof row.created_at === "string" ? row.created_at : undefined,
      }));
  const all = [...map("list", lists.data), ...map("bucket", buckets.data)];
  // Only identical names in the same context need a disambiguating detail.
  const counts = new Map<string, number>();
  for (const scope of all) {
    const key = `${scope.context}:${normalizeScopeText(scope.label)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return all.map((scope) => ({
    ...scope,
    detail:
      (counts.get(`${scope.context}:${normalizeScopeText(scope.label)}`) ?? 0) > 1
        ? describeCreated(scope.createdAt)
        : undefined,
  }));
}

/**
 * Resolve a List or Bucket mentioned by name in the question. Uses only the
 * caller's authenticated client, so rows hidden by RLS can never be matched.
 */
export async function resolveAssistantScope(
  client: SupabaseClient,
  question: string,
  currentContext: ContextKind,
): Promise<ScopeResolution> {
  const scopes = await loadNamedScopes(client);
  return decideScope(question, scopes, currentContext);
}

/** Re-verify a scope the user picked from a selection card. Returns null when it is gone, archived, hidden by RLS, or in the other context. */
export async function verifyScopeChoice(
  client: SupabaseClient,
  choice: { type: ScopeType; id: string },
  context: ContextKind,
): Promise<ScopeCandidate | null> {
  const { data, error } = await client
    .from(choice.type === "list" ? "lists" : "buckets")
    .select("id,name,context")
    .eq("id", choice.id)
    .is("archived_at", null)
    .maybeSingle();
  if (error || !data || data.context !== context) return null;
  return { type: choice.type, id: data.id, label: data.name, context };
}
