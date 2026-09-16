import { useEffect, useRef } from "react";
import { Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff } from "lucide-react";
import { PersonAvatar } from "@/components/katalist/PersonAvatar";
import { cn } from "@/lib/utils";
import type { ListCallControls } from "./use-list-call";

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
    if (ref.current && stream) ref.current.srcObject = stream;
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
}: {
  call: ListCallControls;
  selfName: string;
}) {
  if (!call.joined && !call.connecting) return null;

  const tiles = call.participants.length + 1;
  const cols = tiles <= 1 ? "grid-cols-1" : tiles <= 4 ? "grid-cols-2" : "grid-cols-3";

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[13px] font-semibold text-foreground">
            Call · {tiles} {tiles === 1 ? "person" : "people"}
            {call.connecting ? " · connecting…" : ""}
          </p>
        </div>

        <div className={cn("grid gap-2", cols)}>
          <VideoTile stream={call.localStream} name={selfName} self muted={call.muted} cameraOff={call.cameraOff} />
          {call.participants.map((p) => (
            <VideoTile key={p.id} stream={p.stream} name={p.name} />
          ))}
        </div>

        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={call.toggleMute}
            aria-pressed={call.muted}
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
            aria-pressed={call.cameraOff}
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
            aria-pressed={call.sharing}
            className={cn(
              "inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors",
              call.sharing ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70",
            )}
            title={call.sharing ? "Stop sharing" : "Share screen"}
          >
            <MonitorUp className="h-4 w-4" />
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
