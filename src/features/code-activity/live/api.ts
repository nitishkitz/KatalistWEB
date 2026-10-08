import { authedFetch } from "@/lib/authed-fetch";
import { parseActivityChange, parseActivityFeed } from "../types";
import type { ActivityChange, ActivityFeedData, AssigneeCandidate } from "../types";
import { parseCapabilities, parseConnection, parseRepositories } from "./parse";
import type { Capabilities, ConnectionView, ProofRepository } from "./parse";

/** Live API client for the connection flow. Network access lives only in this folder. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string };

export async function call<T>(url: string, init: RequestInit, parse: (raw: unknown) => T | null): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await authedFetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, status: 0, code: "source_unavailable" };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const code = typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : "source_unavailable";
    return { ok: false, status: response.status, code };
  }
  const parsed = parse(body);
  return parsed === null ? { ok: false, status: response.status, code: "source_unavailable" } : { ok: true, data: parsed };
}

export interface FeedPage {
  data: ActivityFeedData;
  nextCursor: string | null;
  connectionStatus: string;
}

function parseFeedPage(raw: unknown): FeedPage | null {
  const parsed = parseActivityFeed(raw);
  if (!parsed.ok) return null;
  const extra = raw as { nextCursor?: unknown; connectionStatus?: unknown };
  return {
    data: parsed.value,
    nextCursor: typeof extra.nextCursor === "string" ? extra.nextCursor : null,
    connectionStatus: typeof extra.connectionStatus === "string" ? extra.connectionStatus : "active",
  };
}

function parseDetail(raw: unknown): ActivityChange | null {
  const change = typeof raw === "object" && raw !== null ? (raw as { change?: unknown }).change : null;
  const parsed = parseActivityChange(change);
  return parsed.ok ? parsed.value : null;
}

function parseCandidates(raw: unknown): AssigneeCandidate[] | null {
  const list = typeof raw === "object" && raw !== null ? (raw as { candidates?: unknown }).candidates : null;
  if (!Array.isArray(list)) return null;
  const out: AssigneeCandidate[] = [];
  for (const c of list) {
    if (typeof c !== "object" || c === null) return null;
    const o = c as Record<string, unknown>;
    if (typeof o.actorId !== "string" || typeof o.name !== "string" || (o.role !== "owner" && o.role !== "collaborator")) return null;
    out.push({ actorId: o.actorId, name: o.name, role: o.role, isSelf: o.isSelf === true });
  }
  return out;
}

const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const q = (listId: string) => `listId=${encodeURIComponent(listId)}`;
const parseUrl = (raw: unknown): string | null => {
  const url = typeof raw === "object" && raw !== null ? (raw as { url?: unknown }).url : null;
  if (typeof url !== "string") return null;
  try {
    const host = new URL(url).hostname;
    return host === "github.com" ? url : null; // only ever navigate to github.com
  } catch {
    return null;
  }
};
const parseOk = (key: string) => (raw: unknown) =>
  typeof raw === "object" && raw !== null && (raw as Record<string, unknown>)[key] === true ? true : null;

export const codeActivityApi = {
  capabilities: (listId: string, signal?: AbortSignal): Promise<ApiResult<Capabilities>> =>
    call(`/api/code-activity/capabilities?${q(listId)}`, { signal }, parseCapabilities),
  connection: (listId: string, signal?: AbortSignal): Promise<ApiResult<ConnectionView>> =>
    call(`/api/code-activity/connection?${q(listId)}`, { signal }, parseConnection),
  start: (listId: string, flow: "oauth" | "install"): Promise<ApiResult<string>> =>
    call(`/api/code-activity/github/authorize/start`, { method: "POST", ...json({ listId, flow }) }, parseUrl),
  repositories: (
    listId: string,
    signal?: AbortSignal,
    cursor?: string | null,
  ): Promise<ApiResult<{ items: ProofRepository[]; nextCursor: string | null }>> =>
    call(`/api/code-activity/github/repositories?${q(listId)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal }, parseRepositories),
  feed: (listId: string, cursor?: string | null, signal?: AbortSignal): Promise<ApiResult<FeedPage>> =>
    call(`/api/code-activity/feed?${q(listId)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal }, parseFeedPage),
  refresh: (listId: string): Promise<ApiResult<true>> =>
    call(`/api/code-activity/refresh`, { method: "POST", ...json({ listId }) }, (raw) => (typeof raw === "object" && raw !== null && "syncStatus" in raw ? true : null)),
  detail: (listId: string, changeId: string, signal?: AbortSignal): Promise<ApiResult<ActivityChange>> =>
    call(`/api/code-activity/changes/detail?${q(listId)}&changeId=${encodeURIComponent(changeId)}`, { signal }, parseDetail),
  candidates: (listId: string, signal?: AbortSignal): Promise<ApiResult<AssigneeCandidate[]>> =>
    call(`/api/code-activity/assignee-candidates?${q(listId)}`, { signal }, parseCandidates),
  confirm: (body: Record<string, unknown>): Promise<ApiResult<{ thingId: string | null; replayed: boolean }>> =>
    call(`/api/code-activity/drafts/confirm`, { method: "POST", ...json(body) }, (raw) => {
      const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
      return o && (typeof o.thingId === "string" || o.thingId === null) ? { thingId: o.thingId as string | null, replayed: o.replayed === true } : null;
    }),
  draft: (listId: string, changeId: string, note: string, signal?: AbortSignal): Promise<ApiResult<{ title: string; description: string }>> =>
    call(`/api/code-activity/changes/draft`, { method: "POST", signal, ...json({ listId, changeId, note }) }, (raw) => {
      const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
      return o && typeof o.title === "string" && typeof o.description === "string" ? { title: o.title, description: o.description } : null;
    }),
  summary: (listId: string, changeId: string, signal?: AbortSignal): Promise<ApiResult<{ text: string; partial: boolean }>> =>
    call(`/api/code-activity/changes/summary`, { method: "POST", signal, ...json({ listId, changeId }) }, (raw) => {
      const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
      return o && typeof o.summary === "string" ? { text: o.summary, partial: o.partial === true } : null;
    }),
  setConsent: (listId: string, enabled: boolean): Promise<ApiResult<boolean>> =>
    call(`/api/code-activity/consent`, { method: "PUT", ...json({ listId, enabled }) }, (raw) => {
      const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
      return o && typeof o.consent === "boolean" ? o.consent : null;
    }),
  connect: (listId: string, proofId: string): Promise<ApiResult<true>> =>
    call(`/api/code-activity/connection`, { method: "POST", ...json({ listId, proofId, sharingAcknowledged: true }) }, parseOk("connected")),
  disconnect: (listId: string): Promise<ApiResult<true>> =>
    call(`/api/code-activity/connection`, { method: "DELETE", ...json({ listId, confirm: true }) }, parseOk("disconnected")),
};
