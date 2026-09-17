import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CallRoom, type CallParticipant } from "./call-room";

export type ListCallControls = {
  joined: boolean;
  connecting: boolean;
  localStream: MediaStream | null;
  participants: CallParticipant[];
  muted: boolean;
  cameraOff: boolean;
  sharing: boolean;
  join: () => Promise<boolean>;
  leave: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => Promise<void>;
};

/** Full-mesh audio/video call for a List, scoped to the current members. */
export function useListCall(listId: string, selfId: string, selfName: string): ListCallControls {
  const roomRef = useRef<CallRoom | null>(null);
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharing, setSharing] = useState(false);

  const leave = useCallback(() => {
    roomRef.current?.leave();
    roomRef.current = null;
    setJoined(false);
    setConnecting(false);
    setLocalStream(null);
    setParticipants([]);
    setMuted(false);
    setCameraOff(false);
    setSharing(false);
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
    });
    roomRef.current = room;
    try {
      const stream = await room.join({ audio: true, video: true });
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
        setSharing(false);
      } else {
        await room.startScreenShare();
        setSharing(true);
      }
    } catch {
      setSharing(false);
    }
  }, [sharing]);

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
    participants,
    muted,
    cameraOff,
    sharing,
    join,
    leave,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
  };
}
