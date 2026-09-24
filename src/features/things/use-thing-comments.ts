import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { domainErrorMessage } from "@/lib/domain-error";
import { addCommentLocal, getActivity, getComments } from "./local-state";
import { useLocalVersion } from "./use-local-version";
import { rpcComment } from "./rpc";
import { currentDemoPerson } from "@/features/demo/identities";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { getDraft, setDraft } from "@/features/drafts/session-drafts";
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

// R-01 follow-up: previously `string | { body, attachments }`, with the
// TARGET Thing read from the hook's own outer `thingId` closure inside
// mutationFn/onError/onSettled -- but useMutation rebinds those closures
// via setOptions() on every render (same hazard R-01 already fixed for
// onError's own body), so a render that switches to a different Thing
// between dispatch and settlement could roll back or invalidate the
// caches of, or even (mutationFn) actually SEND the comment to, the wrong
// Thing. The target Thing is now a required, explicit part of the
// mutation's own input, captured by the caller at dispatch time (the same
// moment it already captures its own `submittedThingId`), not re-derived
// from whatever the latest render happens to show.
export type PostCommentInput = { thingId: string; body: string; attachments?: ThingFile[] };

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

/**
 * `loadActivity` defers the (usually unopened) Activity tab's own fetch
 * until that tab is actually selected -- ThingDetailContent renders Comments
 * by default, so fetching thing_activity on every Thing-detail open would
 * be paying for a request most opens never look at. Comments themselves
 * still always load: the unread badge/divider need `comments.length`/dates
 * regardless of which tab is showing. Defaults to `true` so any other
 * caller keeps its existing eager-load behavior.
 */
export function useThingComments(thingId: string | null, loadActivity = true) {
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
    enabled: Boolean(thingId) && !preview && loadActivity,
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
      // Uses the EXPLICIT input.thingId, not the outer `thingId` closure --
      // mutationFn is rebound via setOptions() on every render just like
      // onError/onSettled below, so a render that switches Thing between
      // this call's dispatch and its (async) execution must not redirect
      // it into sending the comment to a different Thing than the one the
      // user actually submitted it for.
      const { thingId: targetThingId, body: bodyText, attachments } = input;
      if (!targetThingId) throw new Error("No Thing selected.");
      if (preview) {
        addCommentLocal(targetThingId, bodyText, currentDemoPerson().name, attachments);
        return;
      }
      await rpcComment(targetThingId, bodyText, attachments);
    },
    onMutate: async (input: PostCommentInput) => {
      const { thingId: targetThingId, body: bodyText, attachments } = input;
      // Captured here (effectively at mutate()-dispatch time -- onMutate
      // runs before mutationFn, with nothing awaited yet) and threaded
      // through context so onError/onSettled use this SAME captured
      // value, not a freshly-read "current" epoch that would just
      // compare against itself.
      const epoch = getIdentityEpoch(qc).epoch;
      await qc.cancelQueries({ queryKey: ["thing-comments", targetThingId] });
      if (!isEpochCurrent(qc, epoch)) return { epoch, thingId: targetThingId };
      const previousComments = qc.getQueryData<ThingComment[]>(["thing-comments", targetThingId]);

      const currentUserName =
        (session?.user?.user_metadata?.display_name as string | undefined) ||
        (session?.user?.user_metadata?.name as string | undefined) ||
        "Me";

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
        qc.setQueryData<ThingComment[]>(["thing-comments", targetThingId], (old = []) => [
          optimisticComment,
          ...old,
        ]);
      } else if (targetThingId) {
        addCommentLocal(targetThingId, bodyText, currentDemoPerson().name, attachments);
      }

      // R-01: captured here (context, not the outer `thingId` closure) so
      // a later re-render that changes the outer `thingId` variable before
      // this specific mutation settles cannot redirect its own onError to
      // the WRONG Thing -- useMutation shares one MutationObserver across
      // renders and rebinds its callback closures via setOptions() on
      // every render, so a bare closure over `thingId` would read
      // whatever the LATEST render's value is, not the one active when
      // this call was actually dispatched (confirmed directly: reproduced
      // the wrong-Thing attribution with a bare closure, then fixed it by
      // reading from context instead).
      return { previousComments, epoch, thingId: targetThingId, submittedText: bodyText, submittedAttachments: attachments };
    },
    onError: (err, _input, context) => {
      // Follow-up review of R-01: this used to write the rollback back
      // into the outer `thingId` closure's query key instead of
      // context.thingId (the Thing this mutation was actually submitted
      // for) -- a switch to a different Thing before this settled could
      // roll A's optimistic comment back into B's cache.
      if (context?.previousComments && context.epoch !== undefined && isEpochCurrent(qc, context.epoch)) {
        qc.setQueryData(["thing-comments", context.thingId], context.previousComments);
      }
      // R-01: this hook-level onError (not a per-call `.mutate(vars,
      // {onError})` callback) is what actually survives ThingDetailContent
      // unmounting before the request settles -- confirmed directly: a
      // per-call mutate() callback does NOT fire after the observing
      // component unmounts, while this hook-level one does. Restoring the
      // draft here, not in ThingDetailContent, is what makes "closed
      // detail, then the failed send arrives" actually recoverable.
      if (
        context?.thingId &&
        context.epoch !== undefined &&
        isEpochCurrent(qc, context.epoch) &&
        (context.submittedText || context.submittedAttachments?.length)
      ) {
        const current = getDraft<string>(qc, "thing-comment", context.thingId);
        const untouchedSinceSubmit = !current?.value && !current?.attachments?.length;
        if (untouchedSinceSubmit) {
          setDraft(qc, "thing-comment", context.thingId, {
            value: context.submittedText ?? "",
            attachments: context.submittedAttachments,
          });
        }
      }
      toast.error(domainErrorMessage(err));
    },
    onSuccess: () => {
      toast.success("Comment sent.");
    },
    onSettled: (_data, _error, _input, context) => {
      // Same follow-up as onError above: invalidate the Thing this
      // mutation actually settled FOR (context.thingId), not whatever the
      // outer `thingId` closure currently reads.
      if (context?.epoch === undefined || !isEpochCurrent(qc, context.epoch)) return;
      void qc.invalidateQueries({ queryKey: ["thing-comments", context.thingId] });
      void qc.invalidateQueries({ queryKey: ["thing-activity", context.thingId] });
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
        sending: undefined,
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
