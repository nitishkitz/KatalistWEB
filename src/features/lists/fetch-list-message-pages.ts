import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getProfileIdentities } from "@/features/people/directory";
import { HISTORY_PAGE_SIZE, historyCursorFilter, historyPage, type HistoryCursor, type HistoryPage } from "@/lib/history-pages";
import { withReadDeadline } from "@/lib/read-request";
import type { ListChatMessage, ChatAttachment } from "./use-list-messages";

const CHAT_BUCKET = "list-chat";
const SIGNED_URL_TTL_SECONDS = 3600;

type RawAttachment = { key?: string; name?: string; mime?: string | null; size?: number | null };
type RawMessage = {
  id: string;
  body: string;
  created_at: string;
  author_profile_id: string;
  kind: string | null;
  attachment: RawAttachment | null;
  pinned_at: string | null;
  mentioned_profile_ids: string[] | null;
};

async function mapMessages(qc: QueryClient, rows: RawMessage[]): Promise<ListChatMessage[]> {
  const identities = await getProfileIdentities(qc);
  return Promise.all(rows.map(async (row) => {
    const person = identities.find((p) => p.id === row.author_profile_id);
    let attachment: ChatAttachment | null = null;
    if (row.attachment?.key) {
      const { data: signed } = await supabase.storage.from(CHAT_BUCKET).createSignedUrl(row.attachment.key, SIGNED_URL_TTL_SECONDS);
      attachment = {
        key: row.attachment.key,
        name: row.attachment.name ?? "file",
        mime: row.attachment.mime ?? null,
        size: row.attachment.size ?? null,
        url: signed?.signedUrl,
      };
    }
    return {
      id: row.id,
      body: row.body,
      author: person?.display_name ?? "Member",
      authorId: row.author_profile_id,
      avatarUrl: person?.avatar_url ?? null,
      at: row.created_at,
      kind: row.kind === "system" ? "system" : "message",
      attachment,
      pinnedAt: row.pinned_at,
      mentionedProfileIds: row.mentioned_profile_ids ?? [],
      delivery: "sent",
    } satisfies ListChatMessage;
  }));
}

export async function fetchListMessagesPage(
  qc: QueryClient,
  listId: string,
  cursor: HistoryCursor | null,
  signal: AbortSignal,
): Promise<HistoryPage<ListChatMessage>> {
  const { data, error } = await withReadDeadline(signal, async (combined) => {
    let request = supabase.from("list_messages")
      .select("id, body, created_at, author_profile_id, kind, attachment, pinned_at, mentioned_profile_ids")
      .eq("list_id", listId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HISTORY_PAGE_SIZE + 1);
    if (cursor) request = request.or(historyCursorFilter(cursor));
    return request.abortSignal(combined);
  });
  if (error) throw error;
  return historyPage(await mapMessages(qc, (data ?? []) as RawMessage[]));
}

/** Searches every authorized message, including pages the client has not loaded. */
export async function searchListMessagesPage(
  qc: QueryClient,
  listId: string,
  rawSearch: string,
  cursor: HistoryCursor | null,
  signal?: AbortSignal,
): Promise<HistoryPage<ListChatMessage>> {
  const search = rawSearch.trim();
  if (search.length < 2) return { rows: [], nextCursor: null };
  if (search.length > 80) throw new Error("Search must be 80 characters or less.");
  // Escape LIKE metacharacters; the resulting pattern is still parameterized
  // by PostgREST, and RLS remains the authority boundary.
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const { data, error } = await withReadDeadline(signal, async (combined) => {
    let request = supabase.from("list_messages")
      .select("id, body, created_at, author_profile_id, kind, attachment, pinned_at, mentioned_profile_ids")
      .eq("list_id", listId)
      .is("deleted_at", null)
      .ilike("body", pattern)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HISTORY_PAGE_SIZE + 1);
    if (cursor) request = request.or(historyCursorFilter(cursor));
    return request.abortSignal(combined);
  });
  if (error) throw error;
  return historyPage(await mapMessages(qc, (data ?? []) as RawMessage[]));
}

/** File history is independent of the chat timeline's currently loaded page. */
export async function fetchListAttachmentPage(
  qc: QueryClient,
  listId: string,
  cursor: HistoryCursor | null,
  signal: AbortSignal,
): Promise<HistoryPage<ListChatMessage>> {
  const { data, error } = await withReadDeadline(signal, async (combined) => {
    let request = supabase.from("list_messages")
      .select("id, body, created_at, author_profile_id, kind, attachment, pinned_at, mentioned_profile_ids")
      .eq("list_id", listId)
      .is("deleted_at", null)
      .not("attachment", "is", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HISTORY_PAGE_SIZE + 1);
    if (cursor) request = request.or(historyCursorFilter(cursor));
    return request.abortSignal(combined);
  });
  if (error) throw error;
  return historyPage(await mapMessages(qc, (data ?? []) as RawMessage[]));
}

export async function fetchListSystemPage(
  qc: QueryClient,
  listId: string,
  cursor: HistoryCursor | null,
  signal: AbortSignal,
): Promise<HistoryPage<ListChatMessage>> {
  const { data, error } = await withReadDeadline(signal, async (combined) => {
    let request = supabase.from("list_messages")
      .select("id, body, created_at, author_profile_id, kind, attachment, pinned_at, mentioned_profile_ids")
      .eq("list_id", listId)
      .eq("kind", "system")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HISTORY_PAGE_SIZE + 1);
    if (cursor) request = request.or(historyCursorFilter(cursor));
    return request.abortSignal(combined);
  });
  if (error) throw error;
  return historyPage(await mapMessages(qc, (data ?? []) as RawMessage[]));
}

export async function fetchPinnedListMessagesPage(
  qc: QueryClient,
  listId: string,
  cursor: HistoryCursor | null,
  signal: AbortSignal,
): Promise<HistoryPage<ListChatMessage>> {
  const { data, error } = await withReadDeadline(signal, async (combined) => {
    let request = supabase.from("list_messages")
      .select("id, body, created_at, author_profile_id, kind, attachment, pinned_at, mentioned_profile_ids")
      .eq("list_id", listId)
      .is("deleted_at", null)
      .not("pinned_at", "is", null)
      .order("pinned_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HISTORY_PAGE_SIZE + 1);
    if (cursor) request = request.or(historyCursorFilter(cursor, "pinned_at"));
    return request.abortSignal(combined);
  });
  if (error) throw error;
  const mapped = await mapMessages(qc, (data ?? []) as RawMessage[]);
  const rows = mapped.slice(0, HISTORY_PAGE_SIZE);
  const last = rows.at(-1);
  return {
    rows,
    nextCursor: mapped.length > HISTORY_PAGE_SIZE && last?.pinnedAt ? { at: last.pinnedAt, id: last.id } : null,
  };
}
