import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useProfileDirectory } from "@/features/people/directory";
import { findCallProfile, isGenericName, useSelfCallIdentity } from "./call-identity";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  PhoneOff,
  Minimize2,
  Maximize2,
  MessageSquare,
  Send,
  ThumbsUp,
  Heart,
  PartyPopper,
  Hand,
  Phone,
  FileText,
  Maximize,
  Minimize,
  Link2,
  Check,
  UserPlus,
  Users,
  Camera,
  PenTool,
  Upload,
  X,
  ChevronLeft,
  ChevronRight,
  Download,
} from "lucide-react";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { detectFileType } from "@/lib/file-utils";
import { describeUploadError } from "@/lib/upload-errors";
import { PdfCanvas } from "@/features/things/PdfCanvas";
import { useListMessages } from "@/features/lists/use-list-messages";
import { useSessionDraft } from "@/features/drafts/use-session-draft";
import { useReferenceDraft } from "@/features/thing-references/use-reference-draft";
import { ThingReferenceDraftTray } from "@/features/thing-references/ThingReferenceDraftTray";
import { ThingReferenceList } from "@/features/thing-references/ThingReferencesSection";
import { getDraftRevision } from "@/features/drafts/session-drafts";
import { useBlockWhile } from "@/components/katalist/use-interaction-blocker";
import { AnnotateCanvas, type AnnotateCanvasHandle } from "./AnnotateCanvas";
import type { ListCallControls } from "./use-list-call";

const MAX_DOC_BYTES = 50 * 1024 * 1024;

const CHAT_BUCKET = "list-chat";
const SIGNED_URL_TTL_SECONDS = 3600;

const REACTIONS = [
  { key: "like", Icon: ThumbsUp, tint: "text-[#2874f4]" },
  { key: "love", Icon: Heart, tint: "text-[#fc404d]" },
  { key: "clap", Icon: Hand, tint: "text-[#d99f10]" },
  { key: "celebrate", Icon: PartyPopper, tint: "text-[#975ee2]" },
] as const;

const REACTION_ICON: Record<string, (typeof REACTIONS)[number]["Icon"]> = {
  like: ThumbsUp,
  love: Heart,
  clap: Hand,
  celebrate: PartyPopper,
};

const VideoTile = forwardRef<
  HTMLVideoElement,
  {
    stream: MediaStream | null | undefined;
    name: string;
    avatarUrl?: string | null;
    muted?: boolean;
    cameraOff?: boolean;
    self?: boolean;
    /** Shrinks the fallback avatar/name — used for the presentation-mode thumbnail rail. */
    compact?: boolean;
    raisedHand?: boolean;
  }
>(function VideoTile({ stream, name, avatarUrl, muted, cameraOff, self, compact, raisedHand }, forwardedRef) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    // iOS Safari does not always honor autoPlay for a freshly attached
    // MediaStream; kick playback explicitly (rejection is harmless).
    void el.play?.().catch(() => {});
  }, [stream]);
  const hasVideo = Boolean(stream && stream.getVideoTracks().some((t) => t.enabled)) && !cameraOff;
  return (
    <div className="relative aspect-video overflow-hidden rounded-[10px] bg-[#0b0c29]">
      <video
        ref={(el) => {
          ref.current = el;
          if (typeof forwardedRef === "function") forwardedRef(el);
          else if (forwardedRef) forwardedRef.current = el;
        }}
        autoPlay
        playsInline
        muted={self || muted}
        className={cn("h-full w-full object-cover", hasVideo ? "opacity-100" : "opacity-0")}
      />
      {!hasVideo ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <PersonAvatar name={name} src={avatarUrl} size={compact ? 28 : 56} />
        </div>
      ) : null}
      {raisedHand ? (
        <span className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#fdb412] text-white shadow">
          <Hand className="h-3 w-3" />
        </span>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent px-2.5 py-1.5">
        <span className="truncate text-[12px] font-medium text-white">
          {name}
          {self ? " (You)" : ""}
        </span>
        {muted ? <MicOff className="h-3.5 w-3.5 shrink-0 text-white/80" /> : null}
      </div>
    </div>
  );
});

/** One row in the "In this call (N)" dock — mirrors the Figma participants list. */
function ParticipantRow({
  name,
  avatarUrl,
  roleLabel,
  muted,
  raisedHand,
}: {
  name: string;
  avatarUrl?: string | null;
  roleLabel?: string;
  muted?: boolean;
  raisedHand?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 px-1 py-1.5">
      <PersonAvatar name={name} src={avatarUrl} size={30} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium text-[#000128]">{name}</p>
        {roleLabel ? <p className="text-[12px] text-black/60">{roleLabel}</p> : null}
      </div>
      {raisedHand ? <Hand className="h-3.5 w-3.5 shrink-0 text-[#fdb412]" /> : null}
      {muted ? (
        <MicOff className="h-3.5 w-3.5 shrink-0 text-[#8487a7]" />
      ) : (
        <Mic className="h-3.5 w-3.5 shrink-0 text-[#8487a7]" />
      )}
    </div>
  );
}

export function ListCallPanel({
  call,
  selfName,
  listId,
  title,
  onInvite,
}: {
  call: ListCallControls;
  selfName: string;
  listId: string;
  /** List/conversation name shown in the call's title bar. */
  title?: string;
  /** Opens the shared invite picker (parent owns announce/ring wiring). */
  onInvite?: () => void;
}) {
  const directory = useProfileDirectory();
  const selfIdentity = useSelfCallIdentity(selfName);
  const selfAvatarUrl = selfIdentity.avatarUrl;
  // Presence carries a display name and avatar, but the profile directory is
  // the source of truth (uploaded avatar, current name) -- prefer it, and fall
  // back to what the peer announced.
  const participants = useMemo(
    () =>
      call.participants.map((p) => {
        const profile = findCallProfile(directory, p.profileId);
        const directoryName = profile?.display_name;
        const name = directoryName && !isGenericName(directoryName) ? directoryName : p.name;
        return { ...p, name, avatarUrl: profile?.avatar_url ?? p.avatarUrl ?? null };
      }),
    [call.participants, directory],
  );
  const [minimized, setMinimized] = useState(false);
  const [dock, setDock] = useState<"none" | "chat" | "participants">("participants");
  const qc = useQueryClient();
  const chatDraft = useSessionDraft("list-chat", listId, "");
  const draft = chatDraft.value;
  const setDraft = chatDraft.write;
  const referenceDraft = useReferenceDraft("list-chat-references", listId);
  const chat = useListMessages(listId);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const olderAnchorRef = useRef<{ top: number; height: number } | null>(null);
  const previousLastIdRef = useRef<string | null>(null);
  const restoredChatScrollRef = useRef(false);
  const renderedChatListRef = useRef(listId);
  const [newChatMessages, setNewChatMessages] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const presenterVideoRef = useRef<HTMLVideoElement | null>(null);
  const annotateRef = useRef<AnnotateCanvasHandle | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savingShot, setSavingShot] = useState(false);
  const [docNumPages, setDocNumPages] = useState(1);
  const docFileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const stagedChatAttachment = chatDraft.attachments?.[0] as { key: string; name: string; mime: string | null; size: number | null } | undefined;
  useBlockWhile(dock === "chat" && (Boolean(draft.trim()) || Boolean(stagedChatAttachment)), "list-chat-draft");

  useLayoutEffect(() => {
    if (dock !== "chat" || !scrollRef.current) return;
    const el = scrollRef.current;
    if (renderedChatListRef.current !== listId) {
      renderedChatListRef.current = listId;
      restoredChatScrollRef.current = false;
      previousLastIdRef.current = null;
      olderAnchorRef.current = null;
      nearBottomRef.current = true;
      setNewChatMessages(false);
    }
    if (olderAnchorRef.current) {
      el.scrollTop = olderAnchorRef.current.top + el.scrollHeight - olderAnchorRef.current.height;
      olderAnchorRef.current = null;
      return;
    }
    if (!restoredChatScrollRef.current && !chat.isLoading) {
      el.scrollTop = el.scrollHeight;
      nearBottomRef.current = true;
      restoredChatScrollRef.current = true;
    }
    const lastId = chat.messages.at(-1)?.id ?? null;
    const changed = previousLastIdRef.current !== lastId;
    previousLastIdRef.current = lastId;
    if (!changed) return;
    if (nearBottomRef.current) el.scrollTop = el.scrollHeight;
    else setNewChatMessages(true);
  }, [dock, chat.messages, chat.isLoading, qc, listId]);

  useEffect(() => {
    if (dock !== "chat") {
      restoredChatScrollRef.current = false;
      previousLastIdRef.current = null;
    }
  }, [dock]);

  const loadOlderChat = async () => {
    const el = scrollRef.current;
    if (el) olderAnchorRef.current = { top: el.scrollTop, height: el.scrollHeight };
    try { await chat.loadOlder(); } catch { olderAnchorRef.current = null; }
  };

  // Call-duration timer (starts once connected).
  useEffect(() => {
    if (!call.joined) {
      setElapsed(0);
      setStartedAt(null);
      return;
    }
    const started = new Date();
    setStartedAt(started);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started.getTime()) / 1000)), 1000);
    return () => clearInterval(id);
  }, [call.joined]);

  // Track fullscreen state (also updates if the user presses Esc).
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const formatDuration = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (!document.fullscreenElement) void el.requestFullscreen?.().catch(() => {});
    else void document.exitFullscreen?.().catch(() => {});
  };

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable
    }
  };

  // Pasted whiteboard images upload to the same private bucket as chat
  // attachments, then broadcast only the resulting signed URL (see
  // AnnotateCanvas's paste handler) — the Realtime channel never carries
  // raw image bytes.
  const handleUploadImage = async (file: File): Promise<string | null> => {
    try {
      const attachment = await chat.uploadAttachment(file);
      const { data, error } = await supabase.storage
        .from(CHAT_BUCKET)
        .createSignedUrl(attachment.key, SIGNED_URL_TTL_SECONDS);
      if (error || !data?.signedUrl) throw error ?? new Error("No signed URL");
      return data.signedUrl;
    } catch {
      return null;
    }
  };

  // Upload a document (PDF/image/DOCX/XLSX) to present to everyone. Same
  // upload-then-broadcast-a-URL shape as paste-to-whiteboard — nothing but
  // the URL/name/kind ever goes over the Realtime channel; each viewer
  // renders the document locally (PdfCanvas, an <img>, or the Office Online
  // embed viewer, same three renderers PDFViewer.tsx already uses).
  const handleUploadDoc = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_DOC_BYTES) {
      toast.error("Files must be 50 MB or smaller.");
      return;
    }
    const detected = detectFileType(file.name, file.type);
    const kind = detected === "png" || detected === "jpg" ? "image" : detected;
    if (kind !== "pdf" && kind !== "docx" && kind !== "excel" && kind !== "image") {
      toast.error("Only PDF, Word, Excel, and image files can be presented.");
      return;
    }
    setUploadingDoc(true);
    try {
      const attachment = await chat.uploadAttachment(file);
      const { data, error } = await supabase.storage
        .from(CHAT_BUCKET)
        .createSignedUrl(attachment.key, SIGNED_URL_TTL_SECONDS);
      if (error || !data?.signedUrl) throw error ?? new Error("No signed URL");
      call.openDoc({ url: data.signedUrl, name: file.name, kind });
    } catch (err) {
      console.error("[call] document share failed", err);
      toast.error(describeUploadError(err, "Couldn't share that document."));
    } finally {
      setUploadingDoc(false);
      if (docFileInputRef.current) docFileInputRef.current.value = "";
    }
  };

  // Composites the presenter's live video frame with the whiteboard overlay
  // into one image and sends it through the list's normal chat-attachment
  // pipeline — no separate storage or schema needed.
  const handleSaveScreenshot = async () => {
    const video = presenterVideoRef.current;
    const canvas = annotateRef.current?.getCanvas();
    const hasVideo = Boolean(video && video.videoWidth > 0);
    if (!hasVideo && !canvas) {
      toast.error("Nothing to capture yet.");
      return;
    }
    setSavingShot(true);
    try {
      const out = document.createElement("canvas");
      // Whiteboard-only mode has no presenter video to composite — just
      // save the board itself, sized to the canvas's own pixels.
      out.width = hasVideo ? video!.videoWidth : canvas!.width;
      out.height = hasVideo ? video!.videoHeight : canvas!.height;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      if (hasVideo) ctx.drawImage(video!, 0, 0, out.width, out.height);
      if (canvas) ctx.drawImage(canvas, 0, 0, out.width, out.height);
      const blob: Blob | null = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not encode screenshot");
      const file = new File([blob], `whiteboard-${Date.now()}.png`, { type: "image/png" });
      const attachment = await chat.uploadAttachment(file);
      await chat.send.mutateAsync({ body: "", attachment });
      toast.success("Saved to chat.");
    } catch {
      toast.error("Couldn't save the screenshot.");
    } finally {
      setSavingShot(false);
    }
  };

  // H06: "error" and "ended" previously rendered nothing at all -- a failed
  // join (permission denial, device unavailable, generic failure) showed
  // only a toast, and the whole panel vanished with no retry, no
  // instructions, and no way to try audio-only. `leave()` transitions
  // both of these states to "idle" (see its own lifecycle reducer above),
  // which is what actually dismisses this panel -- there is no separate
  // close prop to wire.
  if (call.lifecycle === "error") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs animate-in fade-in duration-150">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center katalist-elevation-dialog">
          <p className="text-[14px] font-semibold text-[#000533]">Couldn't join the call</p>
          <p className="mt-2 text-[13px] text-[#6a769c]">{call.lastError}</p>
          {call.lastErrorKind === "denied" && (
            <p className="mt-1 text-[12px] text-[#8487a7]">
              Allow camera/microphone access in your browser's site settings, then try again.
            </p>
          )}
          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void call.join()}
              className="h-10 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              Retry
            </button>
            {(call.lastErrorKind === "denied" || call.lastErrorKind === "device") && (
              <button
                type="button"
                onClick={() => void call.join({ audioOnly: true })}
                className="h-10 rounded-lg border border-border text-[13px] font-medium text-foreground hover:bg-muted"
              >
                Join with audio only
              </button>
            )}
            <button type="button" onClick={() => call.leave()} className="h-9 text-[12px] text-muted-foreground hover:text-foreground">
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (call.lifecycle === "ended") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs animate-in fade-in duration-150">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center katalist-elevation-dialog">
          <p className="text-[14px] font-semibold text-[#000533]">Call ended</p>
          <button
            type="button"
            onClick={() => call.leave()}
            className="mt-5 h-10 w-full rounded-lg border border-border text-[13px] font-medium text-foreground hover:bg-muted"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (!call.joined && !call.connecting) return null;

  const count = participants.length + 1;
  const cols = count <= 1 ? "grid-cols-1" : count <= 4 ? "grid-cols-2" : "grid-cols-3";
  const localStream = call.sharing && call.screenStream ? call.screenStream : call.localStream;

  // Presentation mode: someone (self or a remote peer) is sharing their
  // screen, OR someone has opened the standalone whiteboard, OR someone has
  // opened a shared document — only one occupies the call's large tile at a
  // time, in that precedence order. Whichever it is, feature that large
  // with the annotate overlay, and shrink everyone else into a thumbnail
  // rail (Figma's expanded call window).
  const presenting = call.screenSharerId ?? (call.whiteboardOpenerId ? "whiteboard" : null) ?? (call.docOpenerId ? "doc" : null);
  const presenterTile = presenting
    ? presenting === "whiteboard"
      ? { kind: "whiteboard" as const, stream: undefined, name: "Whiteboard", self: false, muted: false, cameraOff: true, raisedHand: false }
      : presenting === "doc"
        ? { kind: "doc" as const, stream: undefined, name: call.docName ?? "Document", self: false, muted: false, cameraOff: true, raisedHand: false }
        : presenting === "self"
          ? {
              kind: "video" as const,
              stream: localStream,
              name: selfName,
              avatarUrl: selfAvatarUrl,
              self: true,
              muted: call.muted,
              cameraOff: false,
              raisedHand: call.handRaised,
            }
          : (() => {
              const p = participants.find((x) => x.id === presenting);
              return p
                ? {
                    kind: "video" as const,
                    stream: p.stream,
                    name: p.name,
                    avatarUrl: p.avatarUrl,
                    self: false,
                    muted: p.muted,
                    cameraOff: p.cameraOff,
                    raisedHand: p.raisedHand,
                  }
                : null;
            })()
    : null;
  const thumbnailTiles = presenting
    ? [
        ...(presenting !== "self"
          ? [
              {
                id: "self",
                stream: localStream,
                name: selfName,
                avatarUrl: selfAvatarUrl,
                self: true,
                muted: call.muted,
                cameraOff: call.cameraOff,
                raisedHand: call.handRaised,
              },
            ]
          : []),
        ...participants
          .filter((p) => p.id !== presenting)
          .map((p) => ({
            id: p.id,
            stream: p.stream,
            name: p.name,
            avatarUrl: p.avatarUrl,
            self: false,
            muted: p.muted,
            cameraOff: p.cameraOff,
            raisedHand: p.raisedHand,
          })),
      ]
    : [];

  // Minimized: compact floating pill.
  if (minimized) {
    return (
      <div
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-border bg-white px-3 py-2"
        style={{ boxShadow: "0 12px 30px rgba(15,23,42,0.25)" }}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#12a15f] text-white">
          <Mic className="h-4 w-4" />
        </span>
        <span className="text-[12px] font-medium text-foreground">In call · {count}</span>
        <button
          type="button"
          onClick={call.toggleMute}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            call.muted ? "bg-[#fc404d] text-white" : "bg-muted text-foreground",
          )}
          title={call.muted ? "Unmute" : "Mute"}
          aria-label={call.muted ? "Unmute" : "Mute"}
        >
          {call.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Expand"
          aria-label="Expand call"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={call.leave}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-[#fc404d] px-3 text-[12px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Leave call"
          aria-label="Leave call"
        >
          <PhoneOff className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // Centered call window over a dimmed backdrop (Figma parity) — not a
  // click-to-dismiss backdrop, since a stray click shouldn't hide an active
  // call; use Minimize for that instead.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs animate-in fade-in duration-150">
    <div
      ref={rootRef}
      className={cn(
        "flex max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white transition-[width] duration-200 animate-in zoom-in-98",
        presenterTile ? "w-[min(96vw,1040px)]" : "w-[min(96vw,780px)]",
      )}
      style={{ boxShadow: "0 24px 60px -12px rgba(15,23,42,0.35)" }}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between gap-3 border-b border-[#eef0f6] bg-[#f6f6fa]/80 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold text-[#000533]">{title ?? "Call"}</p>
          <p className="flex items-center gap-1.5 text-[12px] text-[#6a769c]">
            {count} {count === 1 ? "in call" : "in call"}
            {call.connecting ? (
              <span>· connecting…</span>
            ) : call.lifecycle === "reconnecting" ? (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#f59e0b]" />
                Reconnecting…
              </span>
            ) : call.joined ? (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[#12a15f]" />
                {startedAt
                  ? `Started ${startedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                  : formatDuration(elapsed)}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {onInvite ? (
            <button
              type="button"
              onClick={onInvite}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#975ee2] px-3 text-[12px] font-semibold text-white hover:brightness-95"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Invite
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void copyInviteLink()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={copied ? "Link copied" : "Copy invite link"}
            aria-label={copied ? "Link copied" : "Copy invite link"}
          >
            {copied ? <Check className="h-4 w-4 text-[#12a15f]" /> : <Link2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Minimize"
            aria-label="Minimize call"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex gap-3 p-3">
        {/* Tiles + reactions */}
        <div className="relative min-w-0 flex-1">
          {/* Floating reactions */}
          <div className="pointer-events-none absolute right-2 top-2 z-10 flex flex-col items-end gap-1">
            {call.reactions.slice(-4).map((r) => {
              const Icon = REACTION_ICON[r.emoji] ?? ThumbsUp;
              return (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[12px] text-white animate-in fade-in slide-in-from-bottom-2"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {r.from}
                </span>
              );
            })}
          </div>
          {/* Raised-hand queue — a lightweight speaking order, soonest-first.
              Only shown in grid view: in presentation mode each tile already
              carries its own raised-hand badge, and this corner is taken by
              the "Live" indicator. */}
          {!presenterTile && call.raisedHandQueue.length > 0 ? (
            <div className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[12px] text-white">
              <Hand className="h-3.5 w-3.5 text-[#fdb412]" />
              {call.raisedHandQueue.map((p) => p.name).join(", ")}
            </div>
          ) : null}
          {presenterTile ? (
            <div className="flex flex-col gap-2">
              {/* isolate: contains the video's own stacking/compositing layer
                  so z-10 overlays below are reliably painted (and clickable)
                  above it, instead of depending on browser-specific video
                  compositing behavior. */}
              <div className="relative isolate">
                {presenterTile.kind === "whiteboard" ? (
                  <div className="flex aspect-video items-center justify-center rounded-[10px] border border-dashed border-[#c5cae0] bg-white">
                    <p className="text-[12.5px] font-medium text-[#8487a7]">Whiteboard</p>
                  </div>
                ) : presenterTile.kind === "doc" ? (
                  <div className="relative aspect-video overflow-hidden rounded-[10px] border border-[#eef0f6] bg-white">
                    {call.docKind === "pdf" && call.docUrl ? (
                      <div className="h-full overflow-auto p-2">
                        <PdfCanvas
                          url={call.docUrl}
                          page={call.docPage}
                          onNumPages={setDocNumPages}
                          className="mx-auto"
                        />
                      </div>
                    ) : call.docKind === "image" && call.docUrl ? (
                      <img src={call.docUrl} alt={call.docName ?? "Shared document"} className="h-full w-full object-contain" />
                    ) : call.docUrl ? (
                      // H04: call.docUrl is always a private signed URL
                      // (createSignedUrl against the private chat bucket,
                      // see handleUploadDoc above) -- sending it to
                      // Office Online would leak it to a third party. Each
                      // participant already has their own authorized
                      // access to it, so they can open/download it
                      // directly instead of it being embedded from an
                      // external service.
                      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
                        <FileText className="h-10 w-10 text-[#8487a7]" />
                        <p className="max-w-[260px] truncate text-[13px] font-medium text-[#000533]">
                          {call.docName ?? "Shared document"}
                        </p>
                        <p className="text-[12px] text-[#8487a7]">
                          Inline preview isn't available for this file type.
                        </p>
                        <a
                          href={call.docUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#eaeffa] bg-white px-3 py-1.5 text-[12px] font-medium text-[#3d3f74] hover:bg-muted"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Open document
                        </a>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <VideoTile
                    ref={presenterVideoRef}
                    stream={presenterTile.stream}
                    name={presenterTile.name}
                    avatarUrl={"avatarUrl" in presenterTile ? presenterTile.avatarUrl : null}
                    self={presenterTile.self}
                    muted={presenterTile.muted}
                    cameraOff={presenterTile.cameraOff}
                    raisedHand={presenterTile.raisedHand}
                  />
                )}
                <AnnotateCanvas
                  ref={annotateRef}
                  drawOps={call.drawOps}
                  onSend={call.sendDraw}
                  onUploadImage={handleUploadImage}
                  page={presenterTile.kind === "doc" ? call.docPage : undefined}
                />
                <div className="pointer-events-none absolute left-2 top-2 z-10 inline-flex max-w-[70%] items-center gap-1.5 truncate rounded-full bg-black/60 px-2.5 py-1 text-[12px] font-medium text-white">
                  {presenterTile.kind === "whiteboard" ? (
                    "Whiteboard"
                  ) : presenterTile.kind === "doc" ? (
                    <span className="truncate">{call.docName}</span>
                  ) : (
                    <>
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#fc404d]" />
                      {formatDuration(elapsed)} · Live
                    </>
                  )}
                </div>
                {presenterTile.kind === "doc" && call.docKind === "pdf" && docNumPages > 1 ? (
                  <div className="pointer-events-auto absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 px-1.5 py-1 text-[12px] text-white">
                    <button
                      type="button"
                      onClick={() => call.setDocPage(call.docPage - 1)}
                      disabled={call.docPage <= 1}
                      title="Previous page"
                      aria-label="Previous page"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/20 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span>
                      {call.docPage} / {docNumPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => call.setDocPage(call.docPage + 1)}
                      disabled={call.docPage >= docNumPages}
                      title="Next page"
                      aria-label="Next page"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/20 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
                {presenterTile.kind === "doc" ? (
                  <button
                    type="button"
                    onClick={() => call.closeDoc()}
                    title="Close document"
                    aria-label="Close document"
                    className="pointer-events-auto absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSaveScreenshot()}
                    disabled={savingShot}
                    title="Save whiteboard to chat"
                    aria-label="Save whiteboard to chat"
                    className="pointer-events-auto absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/75 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Camera className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {thumbnailTiles.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto">
                  {thumbnailTiles.map((t) => (
                    <div key={t.id} className="w-24 shrink-0">
                      <VideoTile
                        stream={t.stream}
                        name={t.name}
                        avatarUrl={t.avatarUrl}
                        self={t.self}
                        muted={t.muted}
                        cameraOff={t.cameraOff}
                        raisedHand={t.raisedHand}
                        compact
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className={cn("grid gap-2", cols)}>
              <VideoTile
                stream={localStream}
                name={call.sharing ? `${selfName} (screen)` : selfName}
                avatarUrl={selfAvatarUrl}
                self
                muted={call.muted}
                cameraOff={call.cameraOff && !call.sharing}
                raisedHand={call.handRaised}
              />
              {participants.map((p) => (
                <VideoTile
                  key={p.id}
                  stream={p.stream}
                  name={p.name}
                  avatarUrl={p.avatarUrl}
                  muted={p.muted}
                  cameraOff={p.cameraOff}
                  raisedHand={p.raisedHand}
                />
              ))}
            </div>
          )}
        </div>

        {/* Docked side panel: Participants or Chat (mutually exclusive to keep the window compact). */}
        {dock === "participants" ? (
          <div className="flex w-56 shrink-0 flex-col rounded-[10px] border border-[#eef0f6] bg-white">
            <div className="border-b border-[#eef0f6] px-3 py-2 text-[12px] font-semibold text-foreground">
              In this call ({count})
            </div>
            <div className="flex-1 space-y-0.5 overflow-y-auto px-2 py-1.5" style={{ maxHeight: 220 }}>
              <ParticipantRow name={selfName} avatarUrl={selfAvatarUrl} roleLabel="You" muted={call.muted} raisedHand={call.handRaised} />
              {participants.map((p) => (
                <ParticipantRow key={p.id} name={p.name} avatarUrl={p.avatarUrl} muted={p.muted} raisedHand={p.raisedHand} />
              ))}
            </div>
          </div>
        ) : dock === "chat" ? (
          <div className="flex w-72 shrink-0 flex-col rounded-[10px] border border-[#eef0f6] bg-white">
            <div className="border-b border-[#eef0f6] px-3 py-2 text-[12px] font-semibold text-foreground">
              Chat
            </div>
            <div ref={scrollRef} onScroll={(e) => {
              const el = e.currentTarget;
              const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
              nearBottomRef.current = fromBottom < 80;
              if (nearBottomRef.current) setNewChatMessages(false);
            }} className="flex-1 space-y-2 overflow-y-auto px-3 py-2" style={{ maxHeight: 220 }}>
              {chat.hasMore || chat.olderError ? <button type="button" disabled={chat.isLoadingOlder} onClick={() => void loadOlderChat()} className="w-full rounded-md border border-border px-2 py-1 text-xs text-primary disabled:opacity-50">{chat.isLoadingOlder ? "Loading older…" : chat.olderError ? "Couldn't load older. Retry" : "Load older messages"}</button> : null}
              {chat.messages.length === 0 ? (
                <p role={chat.error ? "alert" : undefined} className={chat.error ? "text-[12px] text-destructive" : "text-[12px] text-muted-foreground"}>{chat.error ? "Couldn't load messages. Reopen the conversation to retry." : "No messages yet."}</p>
              ) : (
                chat.messages.map((m) =>
                  m.kind === "system" ? (
                    <div key={m.id} className="flex items-center justify-center gap-1 py-0.5 text-center text-[12px] text-[#6a769c]">
                      <Phone className="h-2.5 w-2.5 text-[#12a15f]" />
                      <span className="font-medium text-[#000533]">{m.author}</span> {m.body}
                      {m.delivery === "failed" ? <button type="button" onClick={() => void chat.retry(m.id).catch(() => {})} className="text-red-600 underline">Retry</button> : null}
                    </div>
                  ) : (
                    <div key={m.id} className="flex items-start gap-2">
                      <PersonAvatar name={m.author} initials={m.author.slice(0, 2).toUpperCase()} src={m.avatarUrl} size={24} />
                      <div className="min-w-0 flex-1 text-[12px]">
                        <span className="font-semibold text-[#000533]">{m.author}</span>
                        {m.body ? <span className="text-[#3d3f74]"> {m.body}</span> : null}
                        {m.thingReferences?.length ? <ThingReferenceList references={m.thingReferences} className="mt-1 grid gap-2" /> : null}
                        {m.attachment ? (
                          m.attachment.mime?.startsWith("image/") && m.attachment.url ? (
                            <a href={m.attachment.url} target="_blank" rel="noreferrer" className="mt-1 block w-fit">
                              <img src={m.attachment.url} alt={m.attachment.name} className="max-h-24 max-w-full rounded-md border border-[#eef0f6] object-cover" />
                            </a>
                          ) : (
                            <a href={m.attachment.url} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1.5 rounded-md border border-[#eef0f6] bg-[#f9f9fe] px-2 py-1 text-[12px] text-[#000533] hover:border-[#975ee2]">
                              <FileText className="h-3 w-3 shrink-0 text-[#6a769c]" />
                              <span className="truncate">{m.attachment.name}</span>
                            </a>
                          )
                        ) : null}
                        {m.delivery === "pending" ? <p className="text-[12px] text-muted-foreground">Sending…</p> : null}
                        {m.delivery === "failed" ? <div className="flex gap-2 text-[12px] text-destructive"><span>Couldn't send.</span><button type="button" onClick={() => void chat.retry(m.id).catch(() => {})} className="underline">Retry</button><button type="button" onClick={() => chat.removeFailed(m.id)} className="underline">Remove</button></div> : null}
                      </div>
                    </div>
                  ),
                )
              )}
            </div>
            {newChatMessages ? <button type="button" onClick={() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; nearBottomRef.current = true; setNewChatMessages(false); }} className="mx-2 my-1 rounded-md bg-primary px-2 py-1 text-[12px] text-primary-foreground">New messages</button> : null}
            {stagedChatAttachment ? (
              <div className="mx-2 flex items-center gap-2 rounded-md border border-[#eef0f6] px-2 py-1 text-[12px]">
                <FileText className="h-3 w-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{stagedChatAttachment.name} ready to send</span>
                <button type="button" onClick={() => chatDraft.write(draft, [])} className="text-destructive underline">Remove</button>
              </div>
            ) : null}
            <ThingReferenceDraftTray references={referenceDraft.references} onRemove={referenceDraft.remove} className="mx-2 grid gap-2" />
            <form
              className="flex items-center gap-1.5 border-t border-[#eef0f6] p-2"
              onSubmit={(e) => {
                e.preventDefault();
                const text = draft.trim();
                const stagedReferences = referenceDraft.references;
                if ((!text && !stagedChatAttachment && stagedReferences.length === 0) || chat.send.isPending) return;
                chatDraft.clear();
                referenceDraft.clear();
                const draftRevision = getDraftRevision(qc, "list-chat", listId);
                void chat.send.mutateAsync({ body: text, attachment: stagedChatAttachment ?? null, thingReferences: stagedReferences, draftRevision }).catch(() => {});
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onPaste={referenceDraft.onPaste}
                placeholder="Message the list…"
                className="min-w-0 flex-1 rounded-lg border border-border px-2.5 py-1.5 text-[12px] outline-none focus:border-primary"
              />
              <button
                type="submit"
                title="Send message"
                aria-label="Send message"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>
        ) : null}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-2 px-3 pb-3">
        <button
          type="button"
          onClick={call.toggleMute}
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            call.muted ? "bg-[#fc404d] text-white" : "bg-muted text-foreground hover:bg-muted/70",
          )}
          title={call.muted ? "Unmute" : "Mute"}
          aria-label={call.muted ? "Unmute" : "Mute"}
        >
          {call.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={call.toggleCamera}
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            call.cameraOff ? "bg-[#fc404d] text-white" : "bg-muted text-foreground hover:bg-muted/70",
          )}
          title={call.cameraOff ? "Turn camera on" : "Turn camera off"}
          aria-label={call.cameraOff ? "Turn camera on" : "Turn camera off"}
        >
          {call.cameraOff ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => void call.toggleScreenShare()}
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            call.sharing ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70",
          )}
          title={call.sharing ? "Stop sharing" : "Share screen"}
          aria-label={call.sharing ? "Stop sharing" : "Share screen"}
        >
          <MonitorUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={call.toggleWhiteboard}
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            call.whiteboardOpenerId ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70",
          )}
          title={call.whiteboardOpenerId ? "Close whiteboard" : "Open whiteboard — no screen share needed"}
          aria-label={call.whiteboardOpenerId ? "Close whiteboard" : "Open whiteboard"}
        >
          <PenTool className="h-4 w-4" />
        </button>
        <input
          ref={docFileInputRef}
          type="file"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
          className="hidden"
          onChange={(e) => void handleUploadDoc(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => docFileInputRef.current?.click()}
          disabled={uploadingDoc}
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            call.docOpenerId ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70",
            uploadingDoc && "opacity-60",
          )}
          title="Present a document (PDF, Word, Excel, or image)"
          aria-label="Present a document"
        >
          <Upload className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={call.toggleHand}
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            call.handRaised ? "bg-[#fdb412] text-white" : "bg-muted text-foreground hover:bg-muted/70",
          )}
          title={call.handRaised ? "Lower hand" : "Raise hand"}
          aria-label={call.handRaised ? "Lower hand" : "Raise hand"}
        >
          <Hand className="h-4 w-4" />
        </button>

        {/* Reactions */}
        <div className="mx-1 flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-1">
          {REACTIONS.map(({ key, Icon, tint }) => (
            <button
              key={key}
              type="button"
              onClick={() => call.sendReaction(key)}
              className={cn("inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", tint)}
              title={`React: ${key}`}
              aria-label={`React: ${key}`}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setDock((d) => (d === "participants" ? "none" : "participants"))}
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            dock === "participants" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70",
          )}
          title="Participants"
          aria-label="Participants"
        >
          <Users className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => setDock((d) => (d === "chat" ? "none" : "chat"))}
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            dock === "chat" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70",
          )}
          title="Chat"
          aria-label="Chat"
        >
          <MessageSquare className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={call.leave}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#fc404d] px-4 text-[13px] font-semibold text-white hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Leave call"
        >
          <PhoneOff className="h-4 w-4" />
          Leave
        </button>
      </div>
    </div>
    </div>
  );
}
