import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CallRoom, type CallParticipant, type DrawOp } from "./call-room";

export type CallReaction = { id: string; from: string; emoji: string };

/** Reduces one incoming/outgoing DrawOp onto the shared whiteboard history. */
function applyDrawOp(prev: DrawOp[], op: DrawOp): DrawOp[] {
  if (op.kind === "clear") return [];
  if (op.kind === "undo") return prev.filter((o) => o.kind === "clear" || o.kind === "undo" || o.id !== op.id);
  return [...prev, op];
}

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
  /** Ordered annotate-layer ops (own + everyone else's) — replay in order to
   *  redraw the shared whiteboard. Reset whenever a "clear" op arrives. */
  drawOps: DrawOp[];
  /** Who is currently presenting: "self", a remote participant id, or null. */
  screenSharerId: string | null;
  /** Who opened the standalone whiteboard (no screen share needed): "self",
   *  a remote participant id, or null. Independent of screenSharerId. */
  whiteboardOpenerId: string | null;
  toggleWhiteboard: () => void;
  /** Who is presenting a shared document (PDF/image/DOCX/XLSX): "self", a
   *  remote participant id, or null. Independent of screenSharerId and
   *  whiteboardOpenerId — only one of the three occupies the call's large
   *  tile at a time (see ListCallPanel's presenting precedence). */
  docOpenerId: string | null;
  docUrl: string | null;
  docName: string | null;
  docKind: "pdf" | "docx" | "excel" | "image" | null;
  docPage: number;
  openDoc: (doc: { url: string; name: string; kind: "pdf" | "docx" | "excel" | "image" }) => void;
  closeDoc: () => void;
  setDocPage: (page: number) => void;
  /** Everyone with a hand raised, soonest-first. Purely informational. */
  raisedHandQueue: { id: string; name: string }[];
  /** True when *you* have your hand raised. */
  handRaised: boolean;
  join: () => Promise<boolean>;
  leave: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => Promise<void>;
  sendReaction: (emoji: string) => void;
  sendDraw: (op: DrawOp) => void;
  toggleHand: () => void;
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
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [selfDoc, setSelfDoc] = useState<{
    url: string;
    name: string;
    kind: "pdf" | "docx" | "excel" | "image";
  } | null>(null);
  // Broadcast-only, not tied to whoever opened the doc — anyone can turn
  // pages (see CallRoom.sendDocPage's comment for why this can't live in
  // presence like docUrl/docKind do).
  const [docPage, setDocPageState] = useState(1);
  const [reactions, setReactions] = useState<CallReaction[]>([]);
  const [drawOps, setDrawOps] = useState<DrawOp[]>([]);
  const [raisedHandQueue, setRaisedHandQueue] = useState<{ id: string; name: string }[]>([]);
  const [handRaised, setHandRaised] = useState(false);

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
    setWhiteboardOpen(false);
    setSelfDoc(null);
    setDocPageState(1);
    setReactions([]);
    setDrawOps([]);
    setRaisedHandQueue([]);
    setHandRaised(false);
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
      onState: (s) => {
        setParticipants(s.participants);
        setRaisedHandQueue(s.raisedHandQueue);
      },
      onReaction: (r) => {
        const item = { id: crypto.randomUUID(), from: r.from, emoji: r.emoji };
        setReactions((prev) => [...prev, item]);
        setTimeout(() => setReactions((prev) => prev.filter((x) => x.id !== item.id)), 4000);
      },
      onDraw: (op) => {
        setDrawOps((prev) => applyDrawOp(prev, op));
      },
      onDocPage: (page) => setDocPageState(page),
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

  /** Open/close the standalone whiteboard — no screen share needed. Anyone
   *  can toggle it, same symmetric model as raise-hand/take-control. */
  const toggleWhiteboard = useCallback(() => {
    setWhiteboardOpen((open) => {
      const next = !open;
      if (next) roomRef.current?.openWhiteboard();
      else roomRef.current?.closeWhiteboard();
      return next;
    });
  }, []);

  /** Present a shared document — no pixels leave this browser; every peer
   *  renders the same URL locally (see ListCallPanel). */
  const openDoc = useCallback((doc: { url: string; name: string; kind: "pdf" | "docx" | "excel" | "image" }) => {
    roomRef.current?.openDoc(doc);
    setSelfDoc(doc);
    setDocPageState(1);
    roomRef.current?.sendDocPage(1); // sync everyone already on the call to page 1 of the new doc
  }, []);

  const closeDoc = useCallback(() => {
    roomRef.current?.closeDoc();
    setSelfDoc(null);
    setDocPageState(1);
  }, []);

  /** Anyone can turn pages, not just whoever opened the doc — broadcasts
   *  the change and applies it locally (the room never echoes back to the
   *  sender), same optimistic-echo pattern as sendDraw/sendReaction. */
  const setDocPage = useCallback((page: number) => {
    const p = Math.max(1, page);
    roomRef.current?.sendDocPage(p);
    setDocPageState(p);
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    roomRef.current?.sendReaction(emoji);
    // Optimistic local echo.
    const item = { id: crypto.randomUUID(), from: "You", emoji };
    setReactions((prev) => [...prev, item]);
    setTimeout(() => setReactions((prev) => prev.filter((x) => x.id !== item.id)), 4000);
  }, []);

  const sendDraw = useCallback((op: DrawOp) => {
    roomRef.current?.sendDraw(op);
    // Optimistic local echo — the room never re-broadcasts to the sender.
    setDrawOps((prev) => applyDrawOp(prev, op));
  }, []);

  const toggleHand = useCallback(() => {
    setHandRaised((raised) => {
      const next = !raised;
      if (next) roomRef.current?.raiseHand();
      else roomRef.current?.lowerHand();
      return next;
    });
  }, []);

  // Clean up media/peers if the component unmounts mid-call.
  useEffect(() => {
    return () => {
      roomRef.current?.leave();
      roomRef.current = null;
    };
  }, []);

  const screenSharerId = useMemo(() => {
    if (sharing) return "self";
    return participants.find((p) => p.sharing)?.id ?? null;
  }, [sharing, participants]);

  const whiteboardOpenerId = useMemo(() => {
    if (whiteboardOpen) return "self";
    return participants.find((p) => p.whiteboardOpen)?.id ?? null;
  }, [whiteboardOpen, participants]);

  const remoteDoc = useMemo(() => participants.find((p) => p.docUrl) ?? null, [participants]);
  const docOpenerId = selfDoc ? "self" : remoteDoc?.id ?? null;
  const docUrl = selfDoc?.url ?? remoteDoc?.docUrl ?? null;
  const docName = selfDoc?.name ?? remoteDoc?.docName ?? null;
  const docKind = selfDoc?.kind ?? remoteDoc?.docKind ?? null;

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
    drawOps,
    screenSharerId,
    whiteboardOpenerId,
    toggleWhiteboard,
    docOpenerId,
    docUrl,
    docName,
    docKind,
    docPage,
    openDoc,
    closeDoc,
    setDocPage,
    raisedHandQueue,
    handRaised,
    join,
    leave,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    sendReaction,
    sendDraw,
    toggleHand,
  };
}
