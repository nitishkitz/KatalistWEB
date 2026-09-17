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
} from "lucide-react";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { cn } from "@/lib/utils";
import { useListMessages } from "@/features/lists/use-list-messages";
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
}: {
  stream: MediaStream | null | undefined;
  name: string;
  muted?: boolean;
  cameraOff?: boolean;
  self?: boolean;
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
          <PersonAvatar name={name} initials={name.slice(0, 2)} size={56} />
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent px-2.5 py-1.5">
        <span className="truncate text-[11px] font-medium text-white">
          {name}
          {self ? " (You)" : ""}
        </span>
        {muted ? <MicOff className="h-3.5 w-3.5 shrink-0 text-white/80" /> : null}
      </div>
    </div>
  );
}

export function ListCallPanel({
  call,
  selfName,
  listId,
}: {
  call: ListCallControls;
  selfName: string;
  listId: string;
}) {
  const [minimized, setMinimized] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const chat = useListMessages(listId);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (chatOpen && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chatOpen, chat.messages.length]);

  if (!call.joined && !call.connecting) return null;

  const count = call.participants.length + 1;
  const cols = count <= 1 ? "grid-cols-1" : count <= 4 ? "grid-cols-2" : "grid-cols-3";
  const localStream = call.sharing && call.screenStream ? call.screenStream : call.localStream;

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

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[13px] font-semibold text-foreground">
            Call · {count} {count === 1 ? "person" : "people"}
            {call.connecting ? " · connecting…" : ""}
          </p>
          <div className="flex items-center gap-1.5">
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

        <div className="flex gap-3">
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
            <div className={cn("grid gap-2", cols)}>
              <VideoTile
                stream={localStream}
                name={call.sharing ? `${selfName} (screen)` : selfName}
                self
                muted={call.muted}
                cameraOff={call.cameraOff && !call.sharing}
              />
              {call.participants.map((p) => (
                <VideoTile key={p.id} stream={p.stream} name={p.name} />
              ))}
            </div>
          </div>

          {/* Chat drawer (same data as the list Chat tab) */}
          {chatOpen ? (
            <div className="flex w-72 shrink-0 flex-col rounded-[10px] border border-[#eef0f6] bg-white">
              <div className="border-b border-[#eef0f6] px-3 py-2 text-[12px] font-semibold text-foreground">
                Chat
              </div>
              <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2" style={{ maxHeight: 220 }}>
                {chat.messages.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No messages yet.</p>
                ) : (
                  chat.messages.map((m) => (
                    <div key={m.id} className="text-[12px]">
                      <span className="font-semibold text-[#000533]">{m.author}: </span>
                      <span className="text-[#3d3f74]">{m.body}</span>
                    </div>
                  ))
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
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
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
            onClick={() => setChatOpen((o) => !o)}
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors",
              chatOpen ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70",
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
    </div>
  );
}
