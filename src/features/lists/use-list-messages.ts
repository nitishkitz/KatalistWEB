import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { addListMessage, getListMessages } from "@/features/things/local-state";
import { useLocalVersion } from "@/features/things/use-local-version";
import { fetchProfileIdentities, matchProfile } from "@/features/people/directory";
import { isPersonallyShreddedList, usePersonalShred } from "@/features/things/personal-shred";

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
};

type RawAttachment = { key?: string; name?: string; mime?: string | null; size?: number | null };

async function fetchMessages(listId: string): Promise<ListChatMessage[]> {
  const { data, error } = await supabase
    .from("list_messages")
    .select("id, body, created_at, author_profile_id, kind, attachment")
    .eq("list_id", listId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const identities = await fetchProfileIdentities();
  const rows = (data ?? []) as Array<{
    id: string;
    body: string;
    created_at: string;
    author_profile_id: string;
    kind: string | null;
    attachment: RawAttachment | null;
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
    queryFn: () => fetchMessages(listId),
    enabled: Boolean(listId) && !preview && !hidden,
    staleTime: 10_000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["list-messages", listId] });
    void qc.invalidateQueries({ queryKey: ["lists"] });
  };

  const send = useMutation({
    mutationFn: async (input: string | { body: string; attachment?: ChatAttachment | null }) => {
      const body = typeof input === "string" ? input : input.body;
      const attachment = typeof input === "string" ? null : input.attachment ?? null;
      if (hidden) throw new Error("That List isn’t available.");
      if (preview) {
        addListMessage(listId, body);
        return;
      }
      if (!user?.id) throw new Error("Sign in to chat.");
      const { error } = await supabase.from("list_messages").insert({
        list_id: listId,
        body,
        author_profile_id: user.id,
        kind: "message",
        attachment: attachment ? { key: attachment.key, name: attachment.name, mime: attachment.mime, size: attachment.size } : null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  /** Post a system entry (e.g. "started a call") that renders inline with a timestamp. */
  const sendSystem = useMutation({
    mutationFn: async (body: string) => {
      if (hidden || preview || !user?.id) return;
      const { error } = await supabase.from("list_messages").insert({
        list_id: listId,
        body,
        author_profile_id: user.id,
        kind: "system",
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
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
          }))
        : (query.data ?? []);

  return { messages, send, sendSystem, uploadAttachment, isLoading: !preview && !hidden && query.isLoading };
}

export { matchProfile };
