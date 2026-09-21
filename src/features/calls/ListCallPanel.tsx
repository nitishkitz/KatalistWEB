import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { cn } from "@/lib/utils";
import { useListMessages } from "@/features/lists/use-list-messages";
import { AnnotateCanvas } from "./AnnotateCanvas";
import type { ListCallControls } from "./use-list-call";

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

function VideoTile({
  stream,
  name,
  muted,
  cameraOff,
  self,
  compact,
}: {
  stream: MediaStream | null | undefined;
  name: string;
  muted?: boolean;
  cameraOff?: boolean;
  self?: boolean;
  /** Shrinks the fallback avatar/name — used for the presentation-mode thumbnail rail. */
  compact?: boolean;
}) {
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
        ref={ref}
        autoPlay
        playsInline
        muted={self || muted}
        className={cn("h-full w-full object-cover", hasVideo ? "opacity-100" : "opacity-0")}
      />
      {!hasVideo ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <PersonAvatar name={name} initials={name.slice(0, 2)} size={compact ? 28 : 56} />
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent px-2.5 py-1.5">
        <span className={cn("truncate font-medium text-white", compact ? "text-[9.5px]" : "text-[11px]")}>
          {name}
          {self ? " (You)" : ""}
        </span>
        {muted ? <MicOff className="h-3.5 w-3.5 shrink-0 text-white/80" /> : null}
      </div>
    </div>
  );
}

/** One row in the "In this call (N)" dock — mirrors the Figma participants list. */
function ParticipantRow({
  name,
  roleLabel,
  muted,
}: {
  name: string;
  roleLabel?: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 px-1 py-1.5">
      <PersonAvatar name={name} initials={name.slice(0, 2).toUpperCase()} size={30} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium text-[#000128]">{name}</p>
        {roleLabel ? <p className="text-[10.5px] text-black/60">{roleLabel}</p> : null}
      </div>
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
  const [minimized, setMinimized] = useState(false);
  const [dock, setDock] = useState<"none" | "chat" | "participants">("participants");
  const [draft, setDraft] = useState("");
  const chat = useListMessages(listId);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (dock === "chat" && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [dock, chat.messages.length]);

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

  if (!call.joined && !call.connecting) return null;

  const count = call.participants.length + 1;
  const cols = count <= 1 ? "grid-cols-1" : count <= 4 ? "grid-cols-2" : "grid-cols-3";
  const localStream = call.sharing && call.screenStream ? call.screenStream : call.localStream;

  // Presentation mode: someone (self or a remote peer) is sharing their
  // screen. Feature that stream large with the annotate overlay, and shrink
  // everyone else into a thumbnail rail (Figma's expanded call window).
  const presenting = call.screenSharerId;
  const presenterTile = presenting
    ? presenting === "self"
      ? { stream: localStream, name: selfName, self: true, muted: call.muted, cameraOff: false }
      : (() => {
          const p = call.participants.find((x) => x.id === presenting);
          return p ? { stream: p.stream, name: p.name, self: false, muted: p.muted, cameraOff: p.cameraOff } : null;
        })()
    : null;
  const thumbnailTiles = presenting
    ? [
        ...(presenting !== "self"
          ? [{ id: "self", stream: localStream, name: selfName, self: true, muted: call.muted, cameraOff: call.cameraOff }]
          : []),
        ...call.participants
          .filter((p) => p.id !== presenting)
          .map((p) => ({ id: p.id, stream: p.stream, name: p.name, self: false, muted: p.muted, cameraOff: p.cameraOff })),
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
            "inline-flex h-8 w-8 items-center justify-center rounded-full",
            call.muted ? "bg-[#fc404d] text-white" : "bg-muted text-foreground",
          )}
          title={call.muted ? "Unmute" : "Mute"}
        >
          {call.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground"
          title="Expand"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={call.leave}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-[#fc404d] px-3 text-[12px] font-semibold text-white"
        >
          <PhoneOff className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // Floating call window (bottom-right), rather than a page-covering modal —
  // keeps the rest of the app usable while a call is in progress, matching the
  // existing minimize-to-pill behavior, while adopting the Figma window chrome
  // (title bar, Invite, participants dock).
  return (
    <div
      ref={rootRef}
      className={cn(
        "fixed bottom-4 right-4 z-50 flex flex-col overflow-hidden rounded-2xl border border-black/10 bg-white transition-[width] duration-200",
        presenterTile ? "w-[min(96vw,1040px)]" : "w-[min(96vw,780px)]",
      )}
      style={{ boxShadow: "0 24px 60px -12px rgba(15,23,42,0.35)" }}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between gap-3 border-b border-[#eef0f6] bg-[#f6f6fa]/80 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold text-[#000533]">{title ?? "Call"}</p>
          <p className="flex items-center gap-1.5 text-[11px] text-[#6a769c]">
            {count} {count === 1 ? "in call" : "in call"}
            {call.connecting ? (
              <span>· connecting…</span>
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
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            title={copied ? "Link copied" : "Copy invite link"}
          >
            {copied ? <Check className="h-4 w-4 text-[#12a15f]" /> : <Link2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            title="Minimize"
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
                  className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] text-white animate-in fade-in slide-in-from-bottom-2"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {r.from}
                </span>
              );
            })}
          </div>
          {presenterTile ? (
            <div className="flex flex-col gap-2">
              <div className="relative">
                <VideoTile
                  stream={presenterTile.stream}
                  name={presenterTile.name}
                  self={presenterTile.self}
                  muted={presenterTile.muted}
                  cameraOff={presenterTile.cameraOff}
                />
                <AnnotateCanvas drawOps={call.drawOps} onSend={call.sendDraw} />
                <div className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#fc404d]" />
                  {formatDuration(elapsed)} · Live
                </div>
              </div>
              {thumbnailTiles.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto">
                  {thumbnailTiles.map((t) => (
                    <div key={t.id} className="w-24 shrink-0">
                      <VideoTile
                        stream={t.stream}
                        name={t.name}
                        self={t.self}
                        muted={t.muted}
                        cameraOff={t.cameraOff}
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
                self
                muted={call.muted}
                cameraOff={call.cameraOff && !call.sharing}
              />
              {call.participants.map((p) => (
                <VideoTile key={p.id} stream={p.stream} name={p.name} muted={p.muted} cameraOff={p.cameraOff} />
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
              <ParticipantRow name={selfName} roleLabel="You" muted={call.muted} />
              {call.participants.map((p) => (
                <ParticipantRow key={p.id} name={p.name} muted={p.muted} />
              ))}
            </div>
          </div>
        ) : dock === "chat" ? (
          <div className="flex w-72 shrink-0 flex-col rounded-[10px] border border-[#eef0f6] bg-white">
            <div className="border-b border-[#eef0f6] px-3 py-2 text-[12px] font-semibold text-foreground">
              Chat
            </div>
            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2" style={{ maxHeight: 220 }}>
              {chat.messages.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">No messages yet.</p>
              ) : (
                chat.messages.map((m) =>
                  m.kind === "system" ? (
                    <div key={m.id} className="flex items-center justify-center gap-1 py-0.5 text-center text-[10.5px] text-[#6a769c]">
                      <Phone className="h-2.5 w-2.5 text-[#12a15f]" />
                      <span className="font-medium text-[#000533]">{m.author}</span> {m.body}
                    </div>
                  ) : (
                    <div key={m.id} className="flex items-start gap-2">
                      <PersonAvatar name={m.author} initials={m.author.slice(0, 2).toUpperCase()} src={m.avatarUrl} size={24} />
                      <div className="min-w-0 flex-1 text-[12px]">
                        <span className="font-semibold text-[#000533]">{m.author}</span>
                        {m.body ? <span className="text-[#3d3f74]"> {m.body}</span> : null}
                        {m.attachment ? (
                          m.attachment.mime?.startsWith("image/") && m.attachment.url ? (
                            <a href={m.attachment.url} target="_blank" rel="noreferrer" className="mt-1 block w-fit">
                              <img src={m.attachment.url} alt={m.attachment.name} className="max-h-24 max-w-full rounded-md border border-[#eef0f6] object-cover" />
                            </a>
                          ) : (
                            <a href={m.attachment.url} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1.5 rounded-md border border-[#eef0f6] bg-[#f9f9fe] px-2 py-1 text-[11px] text-[#000533] hover:border-[#975ee2]">
                              <FileText className="h-3 w-3 shrink-0 text-[#6a769c]" />
                              <span className="truncate">{m.attachment.name}</span>
                            </a>
                          )
                        ) : null}
                      </div>
                    </div>
                  ),
                )
              )}
            </div>
            <form
              className="flex items-center gap-1.5 border-t border-[#eef0f6] p-2"
              onSubmit={(e) => {
                e.preventDefault();
                const text = draft.trim();
                if (!text) return;
                chat.send.mutate(text);
                setDraft("");
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Message the list…"
                className="min-w-0 flex-1 rounded-lg border border-border px-2.5 py-1.5 text-[12px] outline-none focus:border-primary"
              />
              <button
                type="submit"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"
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
            "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors",
            call.muted ? "bg-[#fc404d] text-white" : "bg-muted text-foreground hover:bg-muted/70",
          )}
          title={call.muted ? "Unmute" : "Mute"}
        >
          {call.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={call.toggleCamera}
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors",
            call.cameraOff ? "bg-[#fc404d] text-white" : "bg-muted text-foreground hover:bg-muted/70",
          )}
          title={call.cameraOff ? "Turn camera on" : "Turn camera off"}
        >
          {call.cameraOff ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => void call.toggleScreenShare()}
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors",
            call.sharing ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70",
          )}
          title={call.sharing ? "Stop sharing" : "Share screen"}
        >
          <MonitorUp className="h-4 w-4" />
        </button>

        {/* Reactions */}
        <div className="mx-1 flex items-center gap-1 rounded-full bg-muted/60 px-1.5 py-1">
          {REACTIONS.map(({ key, Icon, tint }) => (
            <button
              key={key}
              type="button"
              onClick={() => call.sendReaction(key)}
              className={cn("inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-white", tint)}
              title={`React: ${key}`}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setDock((d) => (d === "participants" ? "none" : "participants"))}
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors",
            dock === "participants" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70",
          )}
          title="Participants"
        >
          <Users className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => setDock((d) => (d === "chat" ? "none" : "chat"))}
          className={cn(
            "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors",
            dock === "chat" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70",
          )}
          title="Chat"
        >
          <MessageSquare className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={call.leave}
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#fc404d] px-4 text-[13px] font-semibold text-white hover:brightness-95"
          title="Leave call"
        >
          <PhoneOff className="h-4 w-4" />
          Leave
        </button>
      </div>
    </div>
  );
}
