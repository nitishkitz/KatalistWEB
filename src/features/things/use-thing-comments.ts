import { useMutation, useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import { domainErrorMessage } from "@/lib/domain-error";
import { addCommentLocal, getActivity, getComments } from "./local-state";
import { useLocalVersion } from "./use-local-version";
import { rpcComment } from "./rpc";
import { currentDemoPerson } from "@/features/demo/identities";
import { getIdentityEpoch, isEpochCurrent } from "@/features/realtime/identity-cache-policy";
import { getDraft, setDraft, getDraftRevision } from "@/features/drafts/session-drafts";
import type { ThingFile } from "@/domain/thing";
import { flattenHistory, type HistoryCursor, type HistoryPage } from "@/lib/history-pages";
import { classifyAsyncError } from "@/lib/query-policy";
import { fetchThingActivityPage, fetchThingCommentsPage } from "./fetch-thing-history";

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
// T02: draftRevision is the caller's own session-drafts.ts revision
// reading for this Thing's draft, captured at the moment it cleared the
// live input for submission (see ThingDetailContent's submitComment) --
// NOT re-read fresh in onError, which would just compare the post-submit
// revision against itself. Lets onError tell "nothing has touched this
// draft since I submitted" apart from "the draft is empty right now" --
// the latter is also true when the user typed something new and then
// deliberately cleared it back to empty, which must NOT be treated as
// "unchanged" and overwritten by a stale failed-submit restore.
export type PostCommentInput = { thingId: string; body: string; mentionIds?: string[]; attachments?: ThingFile[]; draftRevision?: number; epoch?: number };

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

  const commentsQuery = useInfiniteQuery<HistoryPage<ThingComment>, Error, InfiniteData<HistoryPage<ThingComment>, HistoryCursor | null>, (string | null)[], HistoryCursor | null>({
    queryKey: ["thing-comments", thingId, "pages"],
    enabled: Boolean(thingId) && !preview,
    initialPageParam: null as HistoryCursor | null,
    getNextPageParam: (page) => page.nextCursor,
    queryFn: ({ pageParam, signal }) => fetchThingCommentsPage(
      thingId!, pageParam, signal,
      (session?.user?.user_metadata?.display_name as string | undefined) ||
      (session?.user?.user_metadata?.name as string | undefined) || "Member",
    ),
  });

  const activityQuery = useInfiniteQuery<HistoryPage<ThingActivity>, Error, InfiniteData<HistoryPage<ThingActivity>, HistoryCursor | null>, (string | null)[], HistoryCursor | null>({
    queryKey: ["thing-activity", thingId, "pages"],
    enabled: Boolean(thingId) && !preview && loadActivity,
    initialPageParam: null as HistoryCursor | null,
    getNextPageParam: (page) => page.nextCursor,
    queryFn: ({ pageParam, signal }) => fetchThingActivityPage(thingId!, pageParam, signal),
  });
  const commentsAccessLost = commentsQuery.error != null && ["unauthenticated", "forbidden", "not-found"].includes(classifyAsyncError(commentsQuery.error));
  const activityAccessLost = activityQuery.error != null && ["unauthenticated", "forbidden", "not-found"].includes(classifyAsyncError(activityQuery.error));

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
      if (input.epoch !== undefined && !isEpochCurrent(qc, input.epoch)) throw new Error("This comment session has ended.");
      if (preview) {
        addCommentLocal(targetThingId, bodyText, currentDemoPerson().name, attachments);
        return;
      }
      await rpcComment(targetThingId, bodyText, attachments, input.mentionIds);
    },
    onMutate: async (input: PostCommentInput) => {
      const { thingId: targetThingId, body: bodyText, attachments, draftRevision } = input;
      // Captured here (effectively at mutate()-dispatch time -- onMutate
      // runs before mutationFn, with nothing awaited yet) and threaded
      // through context so onError/onSettled use this SAME captured
      // value, not a freshly-read "current" epoch that would just
      // compare against itself.
      const epoch = input.epoch ?? getIdentityEpoch(qc).epoch;
      const pageKey = ["thing-comments", targetThingId, "pages"];
      await qc.cancelQueries({ queryKey: pageKey });
      if (!isEpochCurrent(qc, epoch)) return { epoch, thingId: targetThingId };

      const currentUserName =
        (session?.user?.user_metadata?.display_name as string | undefined) ||
        (session?.user?.user_metadata?.name as string | undefined) ||
        "Me";

      const optimisticId = crypto.randomUUID();
      const optimisticComment: ThingComment = {
        id: optimisticId,
        body: bodyText,
        author: currentUserName,
        avatarUrl: (session?.user?.user_metadata?.avatar_url as string | undefined) ?? null,
        at: new Date().toISOString(),
        authorActorId: null,
        sending: true,
        attachments,
      };

      // Preview sessions write the comment once, in mutationFn.
      if (!preview) {
        qc.setQueryData<InfiniteData<HistoryPage<ThingComment>, HistoryCursor | null>>(pageKey, (old) => {
          if (!old?.pages.length) return { pages: [{ rows: [optimisticComment], nextCursor: null }], pageParams: [null] };
          return { ...old, pages: [{ ...old.pages[0], rows: [optimisticComment, ...old.pages[0].rows] }, ...old.pages.slice(1)] };
        });
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
      return {
        optimisticId,
        epoch,
        thingId: targetThingId,
        submittedText: bodyText,
        submittedAttachments: attachments,
        draftRevision,
      };
    },
    onError: (err, _input, context) => {
      // Follow-up review of R-01: this used to write the rollback back
      // into the outer `thingId` closure's query key instead of
      // context.thingId (the Thing this mutation was actually submitted
      // for) -- a switch to a different Thing before this settled could
      // roll A's optimistic comment back into B's cache.
      if (context?.optimisticId && context.epoch !== undefined && isEpochCurrent(qc, context.epoch)) {
        qc.setQueryData<InfiniteData<HistoryPage<ThingComment>, HistoryCursor | null>>(
          ["thing-comments", context.thingId, "pages"],
          (old) => old && { ...old, pages: old.pages.map((page) => ({ ...page, rows: page.rows.filter((row) => row.id !== context.optimisticId) })) },
        );
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
        // T02: compares the draft's CURRENT revision against the one
        // captured at submit time, not "is the draft empty right now" --
        // emptiness alone can't tell "never touched since submit" apart
        // from "typed something new, then deliberately cleared it back to
        // empty". Only the former is safe to overwrite with this stale
        // failed-submit restore; the latter is a real decision this must
        // not undo. Falls back to the old emptiness check only if no
        // revision was captured (an older/other caller of this mutation).
        const untouchedSinceSubmit =
          context.draftRevision !== undefined
            ? getDraftRevision(qc, "thing-comment", context.thingId) === context.draftRevision
            : (() => {
                const current = getDraft<string>(qc, "thing-comment", context.thingId);
                return !current?.value && !current?.attachments?.length;
              })();
        if (untouchedSinceSubmit) {
          setDraft(qc, "thing-comment", context.thingId, {
            value: context.submittedText ?? "",
            attachments: context.submittedAttachments,
          });
        }
      }
      if (context?.epoch !== undefined && isEpochCurrent(qc, context.epoch)) toast.error(domainErrorMessage(err));
    },
    onSuccess: (_data, _input, context) => {
      if (context?.epoch !== undefined && isEpochCurrent(qc, context.epoch)) toast.success("Comment sent.");
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
      commentsHasMore: false,
      commentsIsLoading: false,
      commentsLoadingOlder: false,
      commentsOlderError: false,
      loadOlderComments: async () => {},
      activityHasMore: false,
      activityLoadingOlder: false,
      activityOlderError: false,
      loadOlderActivity: async () => {},
      commentsError: null,
      activityError: null,
      post,
    };
  }

  return {
    comments: commentsAccessLost ? [] : flattenHistory(commentsQuery.data?.pages).reverse(),
    activity: activityAccessLost ? [] : flattenHistory(activityQuery.data?.pages).reverse(),
    commentsHasMore: commentsQuery.hasNextPage,
    commentsIsLoading: commentsQuery.isLoading,
    commentsLoadingOlder: commentsQuery.isFetchingNextPage,
    commentsOlderError: commentsQuery.isFetchNextPageError,
    loadOlderComments: () => commentsQuery.fetchNextPage(),
    activityHasMore: activityQuery.hasNextPage,
    activityLoadingOlder: activityQuery.isFetchingNextPage,
    activityOlderError: activityQuery.isFetchNextPageError,
    loadOlderActivity: () => activityQuery.fetchNextPage(),
    commentsError: commentsQuery.error,
    activityError: activityQuery.error,
    post,
  };
}
