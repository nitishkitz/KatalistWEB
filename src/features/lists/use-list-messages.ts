import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { acquireListChatChannel, broadcastListChatChange } from "@/features/lists/list-chat-channel-registry";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { addListMessage, getListMessages, pinListMessageLocal } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { getProfileIdentities, matchProfile } from "@/features/people/directory";
import { isPersonallyShreddedList, usePersonalShred } from "@/features/things/personal-shred";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";

const CHAT_BUCKET = "list-chat";
const SIGNED_URL_TTL_SECONDS = 3600;

export type ChatAttachment = {
  key: string;
  name: string;
  mime: string | null;
  size: number | null;
  /** Fresh signed URL, minted at fetch time (not persisted). */
  url?: string;
};

export type ListChatMessage = {
  id: string;
  body: string;
  author: string;
  authorId: string | null;
  avatarUrl: string | null;
  at: string;
  kind: "message" | "system";
  attachment: ChatAttachment | null;
  pinnedAt: string | null;
  mentionedProfileIds: string[];
};

type RawAttachment = { key?: string; name?: string; mime?: string | null; size?: number | null };

async function fetchMessages(qc: QueryClient, listId: string): Promise<ListChatMessage[]> {
  const { data, error } = await supabase
    .from("list_messages")
    .select("id, body, created_at, author_profile_id, kind, attachment, pinned_at, mentioned_profile_ids")
    .eq("list_id", listId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const identities = await getProfileIdentities(qc);
  const rows = (data ?? []) as Array<{
    id: string;
    body: string;
    created_at: string;
    author_profile_id: string;
    kind: string | null;
    attachment: RawAttachment | null;
    pinned_at: string | null;
    mentioned_profile_ids: string[] | null;
  }>;

  return Promise.all(
    rows.map(async (row) => {
      const person = identities.find((p) => p.id === row.author_profile_id);
      let attachment: ChatAttachment | null = null;
      if (row.attachment?.key) {
        const { data: signed } = await supabase.storage
          .from(CHAT_BUCKET)
          .createSignedUrl(row.attachment.key, SIGNED_URL_TTL_SECONDS);
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
      } satisfies ListChatMessage;
    }),
  );
}

export function useListMessages(listId: string) {
  const { session, user } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();
  const shred = usePersonalShred();
  const hidden = isPersonallyShreddedList(listId, shred);
  useLocalVersion();

  const query = useQuery({
    queryKey: ["list-messages", listId],
    queryFn: () => fetchMessages(qc, listId),
    enabled: Boolean(listId) && !preview && !hidden,
    staleTime: 10_000,
  });

  const invalidate = (epoch: number) => {
    if (!isEpochCurrent(qc, epoch)) return;
    void qc.invalidateQueries({ queryKey: ["list-messages", listId] });
    void qc.invalidateQueries({ queryKey: ["lists"] });
  };

  // Live chat: a per-list broadcast channel guarantees every viewer refetches
  // the moment a message is posted (postgres_changes can be filtered out by RLS
  // at the realtime layer, so broadcast is the reliable path here).
  //
  // Acquired through the P8 ref-counted registry (list-chat-channel-registry.ts)
  // instead of creating its own channel directly -- multiple mounted
  // consumers of this hook for the SAME listId (a chat dock and a full
  // List-detail view both open at once, say) now share one underlying
  // channel, detached only once the last consumer releases it. Broadcast
  // payloads here are refresh hints only (this handler ignores the
  // payload entirely and just triggers a real, RLS-checked refetch) --
  // never treated as a trusted cache record or as proof of access.
  useEffect(() => {
    if (!listId || preview || hidden) return;
    const release = acquireListChatChannel(listId, () => {
      void qc.invalidateQueries({ queryKey: ["list-messages", listId] });
    });
    return release;
  }, [listId, preview, hidden, qc]);

  const broadcastChange = () => {
    if (!listId) return;
    broadcastListChatChange(listId);
  };

  const send = useMutation({
    mutationFn: async (
      input: string | { body: string; attachment?: ChatAttachment | null; mentionedProfileIds?: string[] },
    ) => {
      const epoch = getIdentityEpoch(qc).epoch;
      const body = typeof input === "string" ? input : input.body;
      const attachment = typeof input === "string" ? null : input.attachment ?? null;
      const mentionedProfileIds = typeof input === "string" ? [] : input.mentionedProfileIds ?? [];
      if (hidden) throw new Error("That List isn’t available.");
      if (preview) {
        addListMessage(listId, body);
        return epoch;
      }
      if (!user?.id) throw new Error("Sign in to chat.");
      const { error } = await supabase.from("list_messages").insert({
        list_id: listId,
        body,
        author_profile_id: user.id,
        kind: "message",
        attachment: attachment ? { key: attachment.key, name: attachment.name, mime: attachment.mime, size: attachment.size } : null,
        mentioned_profile_ids: mentionedProfileIds,
      });
      if (error) throw error;

      // Best-effort push to the other members so they are notified even when the
      // app is closed. Never blocks the send.
      try {
        const { data: sess } = await supabase.auth.getSession();
        const at = sess.session?.access_token;
        if (at) {
          void fetch("/api/hub/notify-message", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${at}` },
            body: JSON.stringify({
              listId,
              preview: body || (attachment ? "📎 attachment" : ""),
              mentionedProfileIds,
            }),
          });
        }
      } catch {
        // push is best-effort
      }
      return epoch;
    },
    onSuccess: (epoch) => {
      invalidate(epoch);
      if (isEpochCurrent(qc, epoch)) broadcastChange();
    },
  });

  /** Post a system entry (e.g. "started a call") that renders inline with a timestamp. */
  const sendSystem = useMutation({
    mutationFn: async (body: string) => {
      const epoch = getIdentityEpoch(qc).epoch;
      if (hidden || preview || !user?.id) return epoch;
      const { error } = await supabase.from("list_messages").insert({
        list_id: listId,
        body,
        author_profile_id: user.id,
        kind: "system",
      });
      if (error) throw error;
      return epoch;
    },
    onSuccess: (epoch) => {
      invalidate(epoch);
      if (isEpochCurrent(qc, epoch)) broadcastChange();
    },
  });

  /** Pin/unpin a message so it stays visible above the scroll. Works on any
   *  message, not just your own — owner/collaborator only, enforced by the
   *  pin_list_message RPC (list_messages' own UPDATE policy is author-only,
   *  which would block pinning someone else's message). */
  const pin = useMutation({
    mutationFn: async ({ messageId, pinned }: { messageId: string; pinned: boolean }) => {
      const epoch = getIdentityEpoch(qc).epoch;
      if (hidden) throw new Error("That List isn’t available.");
      if (preview) {
        pinListMessageLocal(listId, messageId, pinned);
        return epoch;
      }
      const { error } = await supabase.rpc("pin_list_message", { p_message_id: messageId, p_pinned: pinned });
      if (error) throw error;
      return epoch;
    },
    onSuccess: (epoch) => {
      invalidate(epoch);
      if (isEpochCurrent(qc, epoch)) broadcastChange();
    },
  });

  /** Upload a file to the private chat bucket and return its descriptor. */
  const uploadAttachment = async (file: File): Promise<ChatAttachment> => {
    if (!user?.id) throw new Error("Sign in to attach files.");
    const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(0, 80) || "file";
    const key = `${listId}/${user.id}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabase.storage.from(CHAT_BUCKET).upload(key, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (error) throw error;
    return { key, name: file.name, mime: file.type || null, size: file.size };
  };

  const messages: ListChatMessage[] =
    hidden
      ? []
      : preview
        ? getListMessages(listId).map((m) => ({
            id: m.id,
            body: m.body,
            author: m.author,
            authorId: null,
            avatarUrl: null,
            at: m.at,
            kind: "message" as const,
            attachment: null,
            pinnedAt: m.pinnedAt,
            mentionedProfileIds: [],
          }))
        : (query.data ?? []);

  const pinnedMessages = messages.filter((m) => m.pinnedAt);

  return {
    messages,
    pinnedMessages,
    send,
    sendSystem,
    pin,
    uploadAttachment,
    isLoading: !preview && !hidden && query.isLoading,
  };
}

export { matchProfile };
