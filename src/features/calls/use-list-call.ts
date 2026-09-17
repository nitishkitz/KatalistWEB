import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CallRoom, type CallParticipant } from "./call-room";

export type CallReaction = { id: string; from: string; emoji: string };

export type ListCallControls = {
  joined: boolean;
  connecting: boolean;
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  participants: CallParticipant[];
  muted: boolean;
  cameraOff: boolean;
  sharing: boolean;
  reactions: CallReaction[];
  join: () => Promise<boolean>;
  leave: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => Promise<void>;
  sendReaction: (emoji: string) => void;
};

/** Full-mesh audio/video call for a List, scoped to the current members. */
export function useListCall(listId: string, selfId: string, selfName: string): ListCallControls {
  const roomRef = useRef<CallRoom | null>(null);
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [reactions, setReactions] = useState<CallReaction[]>([]);

  const leave = useCallback(() => {
    roomRef.current?.leave();
    roomRef.current = null;
    setJoined(false);
    setConnecting(false);
    setLocalStream(null);
    setScreenStream(null);
    setParticipants([]);
    setMuted(false);
    setCameraOff(false);
    setSharing(false);
    setReactions([]);
  }, []);

  const join = useCallback(async (): Promise<boolean> => {
    if (roomRef.current || connecting) return false;
    if (!selfId) {
      toast.error("Sign in to start a call.");
      return false;
    }
    setConnecting(true);
    const room = new CallRoom({
      listId,
      selfId,
      selfName,
      onState: (s) => setParticipants(s.participants),
      onReaction: (r) => {
        const item = { id: crypto.randomUUID(), from: r.from, emoji: r.emoji };
        setReactions((prev) => [...prev, item]);
        setTimeout(() => setReactions((prev) => prev.filter((x) => x.id !== item.id)), 4000);
      },
    });
    roomRef.current = room;
    try {
      const stream = await room.join({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: true,
      });
      setLocalStream(stream);
      setJoined(true);
      return true;
    } catch (err) {
      roomRef.current = null;
      toast.error(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera and microphone permission is required to join the call."
          : "Could not start the call on this device.",
      );
      return false;
    } finally {
      setConnecting(false);
    }
  }, [connecting, listId, selfId, selfName]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      roomRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const toggleCamera = useCallback(() => {
    setCameraOff((c) => {
      const next = !c;
      roomRef.current?.setCameraOff(next);
      return next;
    });
  }, []);

  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    try {
      if (sharing) {
        await room.stopScreenShare();
        setScreenStream(null);
        setSharing(false);
      } else {
        const s = await room.startScreenShare();
        setScreenStream(s);
        setSharing(true);
        // If the user stops sharing via the browser's native control.
        s.getVideoTracks()[0]?.addEventListener("ended", () => {
          setScreenStream(null);
          setSharing(false);
        });
      }
    } catch {
      setScreenStream(null);
      setSharing(false);
    }
  }, [sharing]);

  const sendReaction = useCallback((emoji: string) => {
    roomRef.current?.sendReaction(emoji);
    // Optimistic local echo.
    const item = { id: crypto.randomUUID(), from: "You", emoji };
    setReactions((prev) => [...prev, item]);
    setTimeout(() => setReactions((prev) => prev.filter((x) => x.id !== item.id)), 4000);
  }, []);

  // Clean up media/peers if the component unmounts mid-call.
  useEffect(() => {
    return () => {
      roomRef.current?.leave();
      roomRef.current = null;
    };
  }, []);

  return {
    joined,
    connecting,
    localStream,
    screenStream,
    participants,
    muted,
    cameraOff,
    sharing,
    reactions,
    join,
    leave,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    sendReaction,
  };
}
