import type * as React from "react";
import { format } from "date-fns";
import { AtSign, Loader2, Lock, Paperclip, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { useAvatarUrl } from "@/features/people/directory";
import type { ThingFile } from "@/features/things/PDFViewer";
import type { WorkStatus } from "@/domain/thing";

function initialsForName(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return initials || "?";
}

export type CommentEntry = {
  id: string;
  author: string;
  body: string;
  at: string;
  avatarUrl?: string | null;
  sending?: boolean;
  attachments?: ThingFile[];
};

export type ActivityEntry = {
  id: string;
  event: string;
  at: string;
};

function CommentRow({
  author,
  body,
  at,
  avatarUrl: explicitAvatar,
  sending,
  attachments,
  onFileSelect,
}: {
  author: string;
  body: string;
  at: string;
  avatarUrl?: string | null;
  sending?: boolean;
  attachments?: ThingFile[];
  onFileSelect?: (file: ThingFile) => void;
}) {
  const avatarUrl = useAvatarUrl(author, null, explicitAvatar);

  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-xl border border-border/70 bg-white px-3 py-2.5 transition-opacity",
        sending && "opacity-75 bg-muted/15",
      )}
    >
      <PersonAvatar name={author} initials={initialsForName(author)} src={avatarUrl} size={24} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="truncate text-[12px] font-semibold text-foreground">{author}</p>
          <time className="shrink-0 text-[12px] text-muted-foreground flex items-center gap-1">
            {sending ? (
              <>
                <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
                <span>Sending…</span>
              </>
            ) : (
              format(new Date(at), "MMM d · h:mm a")
            )}
          </time>
        </div>
        {body ? <p className="mt-0.5 text-[12px] leading-relaxed text-foreground">{body}</p> : null}
        {attachments && attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((att) => {
              const isImg = att.type === "image" || att.type === "png" || att.type === "jpg";
              const isVid = att.type === "video";
              return (
                <button
                  key={att.id}
                  type="button"
                  onClick={() => onFileSelect?.(att)}
                  className="group/att flex items-center gap-2 rounded-lg border border-border/80 bg-slate-50/70 hover:bg-white hover:border-slate-300 p-1.5 text-left transition-all cursor-pointer"
                >
                  {isImg && att.url ? (
                    <img src={att.url} alt={att.name} className="h-8 w-8 rounded-md object-cover border border-slate-200" />
                  ) : isVid ? (
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-purple-50 text-purple-600 border border-purple-200">
                      <Play className="h-3.5 w-3.5 fill-current" />
                    </div>
                  ) : (
                    <span
                      className={cn(
                        "flex h-7 px-1.5 items-center justify-center rounded text-[12px] font-bold uppercase",
                        att.type === "pdf"
                          ? "bg-red-50 text-red-600 border border-red-200"
                          : att.type === "excel"
                            ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                            : att.type === "docx"
                              ? "bg-blue-50 text-blue-600 border border-blue-200"
                              : "bg-slate-100 text-slate-600 border border-slate-200",
                      )}
                    >
                      {att.type}
                    </span>
                  )}
                  <div className="min-w-0 pr-1">
                    <p className="text-[12px] font-semibold text-slate-900 group-hover/att:text-primary truncate max-w-[130px]">
                      {att.name}
                    </p>
                    {att.sizeLabel && (
                      <p className="text-[12px] text-muted-foreground font-medium">
                        {att.sizeLabel}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * T09 item 5: the Comments/Activity tabbed section, pulled out of both
 * ThingDetailContent variant render trees. ThingDetailContent still owns
 * the comment/attachment draft state, thread.post mutation, and every
 * rpc* call the default variant's "more actions" overflow can trigger --
 * this component only renders the tab bar, comment/activity lists, and
 * composer, and calls the `on*` callback props it is given.
 *
 * `moreActionsButton`/`moreActionsPanel` are default-only slots: the
 * default panel's "..." overflow (Catch/Nudge/Sort/Cancel/Shred, Edit Due
 * Date, Assign outside Katalist) has no court-variant equivalent at all
 * (court exposes those as its own dedicated Catch/Sort buttons and never
 * shows Nudge/Cancel/Shred/AssignOutside), so -- like ThingAttachments --
 * it is intentionally not forced into a symmetrical two-variant shape.
 * ThingDetailContent still builds that panel's JSX and owns every mutation
 * inside it; this component just renders it in the right slot.
 */
export type ThingDiscussionProps = {
  variant: "default" | "court";
  tab: "comments" | "activity";
  onTabChange: (tab: "comments" | "activity") => void;
  comments: CommentEntry[];
  commentsHasMore: boolean;
  commentsOlderError: boolean;
  commentsLoadingOlder: boolean;
  onLoadOlderComments: () => void;
  commentsError: boolean;
  unreadCommentCount: number;
  events: ActivityEntry[];
  activityHasMore: boolean;
  activityOlderError: boolean;
  activityLoadingOlder: boolean;
  onLoadOlderActivity: () => void;
  activityError: boolean;
  commentAttachments: ThingFile[];
  onRemoveCommentAttachment: (id: string) => void;
  comment: string;
  onCommentChange: (value: string) => void;
  onSubmitComment: () => void;
  postIsPending: boolean;
  onOpenCommentFileDialog: () => void;
  commentFileInput: React.ReactNode;
  onFileSelect?: (file: ThingFile) => void;
  /** default-only */
  canComment?: boolean;
  workStatus?: WorkStatus;
  hasMoreActions?: boolean;
  moreActionsButton?: React.ReactNode;
  moreActionsPanel?: React.ReactNode;
};

export function ThingDiscussion({
  variant,
  tab,
  onTabChange,
  comments,
  commentsHasMore,
  commentsOlderError,
  commentsLoadingOlder,
  onLoadOlderComments,
  commentsError,
  unreadCommentCount,
  events,
  activityHasMore,
  activityOlderError,
  activityLoadingOlder,
  onLoadOlderActivity,
  activityError,
  commentAttachments,
  onRemoveCommentAttachment,
  comment,
  onCommentChange,
  onSubmitComment,
  postIsPending,
  onOpenCommentFileDialog,
  commentFileInput,
  onFileSelect,
  canComment,
  workStatus,
  moreActionsButton,
  moreActionsPanel,
}: ThingDiscussionProps): React.ReactNode {
  if (variant === "court") {
    return (
      <div className="pt-3">
        <div className="flex items-center gap-6 border-b border-border/60 pb-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onTabChange("comments")}
              className={cn(
                "text-[12px] font-medium transition-colors flex items-center gap-1.5 cursor-pointer pb-2 -mb-2",
                tab === "comments"
                  ? "text-[#975ee2] border-b-2 border-[#975ee2]"
                  : "text-[#2b2e55] hover:text-[#000533]",
              )}
            >
              <span>Comments</span>
              <span
                className={cn(
                  "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[12px] font-medium",
                  tab === "comments" ? "bg-[#f0eafe] text-[#975ee2]" : "bg-[#eef0f6] text-[#2b2e55]",
                )}
              >
                {comments.length}{commentsHasMore ? "+" : ""}
              </span>
            </button>
            {unreadCommentCount > 0 && (
              <span className="text-[12px] font-medium text-[#975ee2] pb-2 -mb-2">
                {unreadCommentCount} new
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onTabChange("activity")}
            className={cn(
              "text-[12px] font-medium transition-colors cursor-pointer pb-2 -mb-2",
              tab === "activity"
                ? "text-[#975ee2] border-b-2 border-[#975ee2]"
                : "text-[#2b2e55] hover:text-[#000533]",
            )}
          >
            Activity
          </button>
        </div>

        {tab === "comments" ? (
          <div className="pt-3 space-y-3">
            {commentsHasMore || commentsOlderError ? (
              <button type="button" disabled={commentsLoadingOlder} onClick={onLoadOlderComments} className="w-full rounded-lg border border-border px-3 py-2 text-xs text-primary disabled:opacity-50">
                {commentsLoadingOlder ? "Loading older comments…" : commentsOlderError ? "Couldn't load older comments. Retry" : "Load older comments"}
              </button>
            ) : null}
            {commentsError && comments.length === 0 ? <p role="alert" className="text-xs text-destructive">Couldn't load comments. Retry by reopening this Thing.</p> : null}
            {comments.length === 0 ? (
              <p className="text-[12px] text-muted-foreground py-3 italic text-center">
                No comments yet.
              </p>
            ) : (
              <div className="space-y-3">
                {comments.map((entry, idx) => {
                  const unread = unreadCommentCount;
                  const isFirstNew = unread > 0 && idx === Math.max(0, comments.length - unread);
                  return (
                    <div key={entry.id} className="space-y-3">
                      {isFirstNew && (
                        <div className="relative my-3 flex items-center justify-center">
                          <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-blue-500" />
                          </div>
                          <span className="relative bg-white px-3 text-[12px] font-semibold text-blue-600">
                            New comments
                          </span>
                        </div>
                      )}
                      <CommentRow
                        author={entry.author}
                        avatarUrl={entry.avatarUrl}
                        body={entry.body}
                        at={entry.at}
                        sending={entry.sending}
                        attachments={entry.attachments}
                        onFileSelect={onFileSelect}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Comment attachments preview */}
            {commentAttachments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 animate-in fade-in slide-in-from-bottom-1">
                {commentAttachments.map((att) => (
                  <div
                    key={att.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-800"
                  >
                    {att.type === "image" && att.url ? (
                      <img src={att.url} alt={att.name} className="h-4 w-4 rounded object-cover" />
                    ) : (
                      <span
                        className={cn(
                          "flex h-[18px] px-1 items-center justify-center rounded text-[12px] font-bold uppercase",
                          att.type === "pdf"
                            ? "bg-red-50 text-red-600 border border-red-200"
                            : att.type === "excel"
                              ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                              : att.type === "docx"
                                ? "bg-blue-50 text-blue-600 border border-blue-200"
                                : att.type === "video"
                                  ? "bg-purple-50 text-purple-600 border border-purple-200"
                                  : "bg-slate-100 text-slate-600",
                        )}
                      >
                        {att.type}
                      </span>
                    )}
                    <span className="max-w-[130px] truncate">{att.name}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveCommentAttachment(att.id)}
                      className="ml-0.5 flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Remove ${att.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Reply input box */}
            {commentFileInput}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSubmitComment();
              }}
              className="flex items-center gap-2 rounded-[9px] border border-[#e9ecf4] bg-[#fdfdfe] px-3 py-2 mt-4"
            >
              <button
                type="button"
                onClick={onOpenCommentFileDialog}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                title="Attach file (photo, video, doc, excel, etc.)"
                aria-label="Attach file"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <input
                value={comment}
                onChange={(e) => onCommentChange(e.target.value)}
                placeholder="Reply to this Thing..."
                disabled={postIsPending}
                className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground outline-none py-1"
              />
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground transition-colors p-1 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                aria-label="Mention someone"
                title="Mention someone"
              >
                <AtSign className="h-4 w-4" />
              </button>
              <button
                type="submit"
                disabled={(!comment.trim() && commentAttachments.length === 0) || postIsPending}
                className="rounded-[6px] bg-[#975ee2] hover:brightness-95 text-white font-medium text-[12px] px-3.5 py-1.5 transition disabled:opacity-50 cursor-pointer"
              >
                Send
              </button>
            </form>
          </div>
        ) : (
          <ul className="space-y-2 pt-3">
            {activityHasMore || activityOlderError ? (
              <li><button type="button" disabled={activityLoadingOlder} onClick={onLoadOlderActivity} className="w-full rounded-lg border border-border px-3 py-2 text-xs text-primary disabled:opacity-50">
                {activityLoadingOlder ? "Loading older activity…" : activityOlderError ? "Couldn't load older activity. Retry" : "Load older activity"}
              </button></li>
            ) : null}
            {activityError && events.length === 0 ? <li role="alert" className="text-xs text-destructive">Couldn't load activity. Retry by reopening this Thing.</li> : null}
            {events.map((event) => (
              <li key={event.id} className="text-[12px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  {event.event.replaceAll("_", " ")}
                </span>
                <span className="ml-2">{format(new Date(event.at), "MMM d · h:mm a")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="border-t border-border/70 bg-white px-5 py-4">
      <div className="flex items-center gap-5">
        {!canComment ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : null}
        {(["comments", "activity"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            className={cn(
              "border-b-2 px-1 pb-2 text-[12px] font-medium capitalize outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground",
            )}
          >
            {id}
            {id === "comments" && comments.length > 0 ? (
              <span className="ml-1 text-[12px] text-primary">{comments.length}{commentsHasMore ? "+" : ""}</span>
            ) : null}
          </button>
        ))}
        {moreActionsButton}
      </div>
      {moreActionsPanel}
      <section className="pt-4">
        {tab === "comments" ? (
          <div className="space-y-2">
            {commentsHasMore || commentsOlderError ? (
              <button type="button" disabled={commentsLoadingOlder} onClick={onLoadOlderComments} className="w-full rounded-md border border-border px-2 py-1 text-xs text-primary disabled:opacity-50">
                {commentsLoadingOlder ? "Loading older comments…" : commentsOlderError ? "Couldn't load older comments. Retry" : "Load older comments"}
              </button>
            ) : null}
            {commentsError && comments.length === 0 ? <p role="alert" className="text-xs text-destructive">Couldn't load comments. Retry by reopening this Thing.</p> : null}
            {comments.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">No comments yet.</p>
            ) : (
              comments.map((c) => (
                <CommentRow
                  key={c.id}
                  author={c.author}
                  avatarUrl={c.avatarUrl}
                  body={c.body}
                  at={c.at}
                  sending={c.sending}
                  attachments={c.attachments}
                  onFileSelect={onFileSelect}
                />
              ))
            )}
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                onSubmitComment();
              }}
            >
              {commentAttachments.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {commentAttachments.map((att) => (
                    <span key={att.id} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[12px]">
                      <span className="truncate max-w-[100px]">{att.name}</span>
                      <button
                        type="button"
                        onClick={() => onRemoveCommentAttachment(att.id)}
                        className="flex h-6 w-6 items-center justify-center rounded outline-none hover:bg-slate-200/70 focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Remove ${att.name}`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onOpenCommentFileDialog}
                  className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title="Attach file"
                  aria-label="Attach file"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                </button>
                <input
                  value={comment}
                  disabled={!canComment || postIsPending}
                  onChange={(e) => onCommentChange(e.target.value)}
                  placeholder={postIsPending ? "Sending…" : "Write a comment…"}
                  className="h-7 flex-1 rounded-md border border-border bg-white px-2 text-[12px] outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!canComment || (!comment.trim() && commentAttachments.length === 0) || postIsPending}
                  className="inline-flex items-center gap-1 h-7 rounded-md bg-primary px-2.5 text-[12px] text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                >
                {postIsPending ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Sending…</span>
                  </>
                ) : (
                  <span>Post</span>
                )}
              </button>
              </div>
            </form>
            {workStatus === "sorted" ? (
              <p className="text-[12px] text-muted-foreground">
                Comments stay open. They don’t reopen Sorted.
              </p>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-2">
            {activityHasMore || activityOlderError ? (
              <li><button type="button" disabled={activityLoadingOlder} onClick={onLoadOlderActivity} className="w-full rounded-md border border-border px-2 py-1 text-xs text-primary disabled:opacity-50">
                {activityLoadingOlder ? "Loading older activity…" : activityOlderError ? "Couldn't load older activity. Retry" : "Load older activity"}
              </button></li>
            ) : null}
            {activityError && events.length === 0 ? <li role="alert" className="text-xs text-destructive">Couldn't load activity. Retry by reopening this Thing.</li> : null}
            {events.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">Movement will appear here.</p>
            ) : (
              events.map((ev) => (
                <li key={ev.id} className="text-[12px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {ev.event.replaceAll("_", " ")}
                  </span>
                  <span className="ml-2">{format(new Date(ev.at), "MMM d · h:mm a")}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
