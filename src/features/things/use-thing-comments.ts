import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { addCommentLocal, getActivity, getComments } from "./local-state";
import { useLocalVersion } from "./use-local-version";
import { rpcComment } from "./rpc";
import { currentDemoPerson } from "@/features/demo/identities";
import type { ThingFile } from "@/domain/thing";

import { resolveActorPeople } from "@/features/people/resolve-actors";

export type ThingComment = {
  id: string;
  body: string;
  author: string;
  at: string;
  avatarUrl?: string | null;
  authorActorId?: string | null;
  sending?: boolean;
  attachments?: ThingFile[];
};
export type ThingActivity = { id: string; event: string; at: string };

export type PostCommentInput = string | { body: string; attachments?: ThingFile[] };

function parseCommentBody(rawBody: string): { body: string; attachments?: ThingFile[] } {
  const match = rawBody.match(/\n?<!--attachments:(.*?)-->/s);
  if (!match) return { body: rawBody };
  try {
    const attachments = JSON.parse(match[1]);
    const cleanBody = rawBody.replace(match[0], "").trim();
    return { body: cleanBody, attachments: Array.isArray(attachments) ? attachments : undefined };
  } catch {
    return { body: rawBody };
  }
}

export function useThingComments(thingId: string | null) {
  const { session } = useSession();
  const preview = isPreviewSession(session);
  const qc = useQueryClient();
  useLocalVersion();

  const commentsQuery = useQuery({
    queryKey: ["thing-comments", thingId],
    enabled: Boolean(thingId) && !preview,
    queryFn: async (): Promise<ThingComment[]> => {
      const { data, error } = await supabase
        .from("thing_comments")
        .select("id, body, created_at, author_actor_id")
        .eq("thing_id", thingId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = data ?? [];
      const actorIds = [...new Set(rows.map((c) => c.author_actor_id).filter(Boolean))];
      const people = await resolveActorPeople(actorIds);
      const currentUserName =
        (session?.user?.user_metadata?.display_name as string | undefined) ||
        (session?.user?.user_metadata?.name as string | undefined);

      return rows.map((c) => {
        const person = c.author_actor_id ? people.get(c.author_actor_id) : null;
        const parsed = parseCommentBody(c.body);
        return {
          id: c.id,
          body: parsed.body,
          author: person?.name || currentUserName || "Member",
          avatarUrl: person?.avatarUrl ?? null,
          at: c.created_at,
          authorActorId: c.author_actor_id,
          attachments: parsed.attachments,
        };
      });
    },
  });

  const activityQuery = useQuery({
    queryKey: ["thing-activity", thingId],
    enabled: Boolean(thingId) && !preview,
    queryFn: async (): Promise<ThingActivity[]> => {
      const { data, error } = await supabase
        .from("thing_activity")
        .select("id, event, created_at")
        .eq("thing_id", thingId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((e) => ({ id: e.id, event: e.event, at: e.created_at }));
    },
  });

  const post = useMutation({
    mutationFn: async (input: PostCommentInput) => {
      if (!thingId) throw new Error("No Thing selected.");
      const bodyText = typeof input === "string" ? input : input.body;
      const attachments = typeof input === "object" ? input.attachments : undefined;
      if (preview) {
        addCommentLocal(thingId, bodyText, currentDemoPerson().name, attachments);
        return;
      }
      await rpcComment(thingId, bodyText, attachments);
    },
    onMutate: async (input: PostCommentInput) => {
      await qc.cancelQueries({ queryKey: ["thing-comments", thingId] });
      const previousComments = qc.getQueryData<ThingComment[]>(["thing-comments", thingId]);

      const currentUserName =
        (session?.user?.user_metadata?.display_name as string | undefined) ||
        (session?.user?.user_metadata?.name as string | undefined) ||
        "Me";

      const bodyText = typeof input === "string" ? input : input.body;
      const attachments = typeof input === "object" ? input.attachments : undefined;

      const optimisticComment: ThingComment = {
        id: `optimistic-${Date.now()}`,
        body: bodyText,
        author: currentUserName,
        avatarUrl: (session?.user?.user_metadata?.avatar_url as string | undefined) ?? null,
        at: new Date().toISOString(),
        authorActorId: null,
        sending: true,
        attachments,
      };

      if (!preview) {
        qc.setQueryData<ThingComment[]>(["thing-comments", thingId], (old = []) => [
          optimisticComment,
          ...old,
        ]);
      } else if (thingId) {
        addCommentLocal(thingId, bodyText, currentDemoPerson().name, attachments);
      }

      return { previousComments };
    },
    onError: (_err, _input, context) => {
      if (context?.previousComments) {
        qc.setQueryData(["thing-comments", thingId], context.previousComments);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["thing-comments", thingId] });
      void qc.invalidateQueries({ queryKey: ["thing-activity", thingId] });
      void qc.invalidateQueries({ queryKey: ["court"] });
    },
  });

  if (preview && thingId) {
    return {
      comments: getComments(thingId).map((c) => ({
        id: c.id,
        body: c.body,
        author: c.author,
        at: c.at,
        avatarUrl: null,
        authorActorId: null,
        attachments: c.attachments,
      })),
      activity: getActivity(thingId).map((e) => ({ id: e.id, event: e.event, at: e.at })),
      post,
    };
  }

  return {
    comments: commentsQuery.data ?? [],
    activity: activityQuery.data ?? [],
    post,
  };
}
