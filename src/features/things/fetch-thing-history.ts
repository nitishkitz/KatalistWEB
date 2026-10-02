import { supabase } from "@/integrations/supabase/client";
import { HISTORY_PAGE_SIZE, historyCursorFilter, historyPage, type HistoryCursor, type HistoryPage } from "@/lib/history-pages";
import { withReadDeadline } from "@/lib/read-request";
import { resolveActorPeople } from "@/features/people/resolve-actors";
import type { ThingActivity, ThingComment } from "./use-thing-comments";
import type { ThingFile } from "@/domain/thing";
import { signThingAttachmentPaths } from "./attachments";

function parseCommentBody(rawBody: string): { body: string; attachments?: ThingFile[] } {
  const match = rawBody.match(/\n?<!--attachments:(.*?)-->/s);
  if (!match) return { body: rawBody };
  try {
    const attachments: unknown = JSON.parse(match[1]);
    return {
      body: rawBody.replace(match[0], "").trim(),
      attachments: Array.isArray(attachments) ? (attachments as ThingFile[]).map((file) =>
        file.url?.startsWith("blob:") && !file.storageKey
          ? { ...file, url: undefined, urlError: "This older attachment was saved with a temporary link. Reattach the file to preview it." }
          : file,
      ) : undefined,
    };
  } catch {
    return { body: rawBody };
  }
}

export async function fetchThingCommentsPage(
  thingId: string,
  cursor: HistoryCursor | null,
  signal: AbortSignal,
  fallbackName: string,
): Promise<HistoryPage<ThingComment>> {
  const { data, error } = await withReadDeadline(signal, async (combined) => {
    let request = supabase.from("thing_comments")
      .select("id, body, created_at, author_actor_id")
      .eq("thing_id", thingId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HISTORY_PAGE_SIZE + 1);
    if (cursor) request = request.or(historyCursorFilter(cursor));
    return request.abortSignal(combined);
  });
  if (error) throw error;
  const rows = data ?? [];
  const actorIds = [...new Set(rows.map((row) => row.author_actor_id).filter(Boolean))];
  const people = await resolveActorPeople(actorIds);
  const parsedRows = rows.map((row) => ({ row, parsed: parseCommentBody(row.body) }));
  const storageKeys = parsedRows.flatMap(({ parsed }) => parsed.attachments?.map((file) => file.storageKey).filter((key): key is string => Boolean(key)) ?? []);
  const signed = storageKeys.length ? await signThingAttachmentPaths(storageKeys) : new Map();
  return historyPage(parsedRows.map(({ row, parsed }) => {
    const person = row.author_actor_id ? people.get(row.author_actor_id) : null;
    return {
      id: row.id,
      body: parsed.body,
      author: person?.name || fallbackName,
      avatarUrl: person?.avatarUrl ?? null,
      at: row.created_at,
      authorActorId: row.author_actor_id,
      attachments: parsed.attachments?.map((file) => {
        if (!file.storageKey) return file;
        const result = signed.get(file.storageKey);
        return { ...file, url: result?.url, urlError: result?.error };
      }),
    };
  }));
}

export async function fetchThingActivityPage(
  thingId: string,
  cursor: HistoryCursor | null,
  signal: AbortSignal,
): Promise<HistoryPage<ThingActivity>> {
  const { data, error } = await withReadDeadline(signal, async (combined) => {
    let request = supabase.from("thing_activity")
      .select("id, event, created_at")
      .eq("thing_id", thingId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HISTORY_PAGE_SIZE + 1);
    if (cursor) request = request.or(historyCursorFilter(cursor));
    return request.abortSignal(combined);
  });
  if (error) throw error;
  return historyPage((data ?? []).map((row) => ({ id: row.id, event: row.event, at: row.created_at })));
}
