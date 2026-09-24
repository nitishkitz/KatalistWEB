import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useBlockWhile } from "@/components/katalist/use-interaction-blocker";
import { CallRoom, type CallParticipant, type DrawOp } from "./call-room";

export type CallReaction = { id: string; from: string; emoji: string };

/**
 * Explicit call lifecycle, derived from real join()/leave() outcomes and
 * live per-peer RTCPeerConnection.connectionState (CallRoom already reports
 * each participant's raw `connection` state; this rolls that up to one
 * room-level signal instead of leaving every consumer to reimplement it):
 *  - idle: never joined (or cleanly left without having connected)
 *  - joining: join() in flight
 *  - connected: joined, and no peer is currently disconnected/failed
 *  - reconnecting: joined, but at least one peer's connection dropped --
 *    CallRoom already calls pc.restartIce()/rebuilds failed peers on its
 *    own, this just surfaces that it's happening
 *  - ended: leave() was called while previously connected/reconnecting
 *    (distinct from idle so the UI can show a "call ended" beat instead of
 *    silently vanishing); cleared by the next join()
 *  - error: join() itself failed (permission denied or device/network
 *    failure) -- see lastError for the message already shown via toast
 */
export type CallLifecycleState = "idle" | "joining" | "connected" | "reconnecting" | "ended" | "error";

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
  /** Explicit lifecycle state -- see CallLifecycleState for what each value means. */
  lifecycle: CallLifecycleState;
  /** Message from the most recent join() failure, if lifecycle is "error". */
  lastError: string | null;
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
  // H-05 (audit): join() is async -- its own getUserMedia/signaling wait
  // (join A pending -> leave A -> join B) means A's catch/finally can
  // resolve AFTER B already owns roomRef/state. A's unconditional
  // `roomRef.current = null` / `setConnecting(false)` would then clear B's
  // ref and flip B's still-legitimately-connecting state to false. Every
  // join() call captures the generation current when IT started; leave()
  // and join() both advance it, so a superseded call's continuation can
  // tell it's no longer the owner and skip touching shared ref/state
  // (while still disposing whatever room/media IT itself acquired).
  const joinGenerationRef = useRef(0);
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
  const [lifecycle, setLifecycle] = useState<CallLifecycleState>("idle");
  const [lastError, setLastError] = useState<string | null>(null);

  const leave = useCallback(() => {
    joinGenerationRef.current += 1; // supersede any join() still in flight
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
    setLifecycle((prev) => (prev === "connected" || prev === "reconnecting" ? "ended" : "idle"));
  }, []);

  const join = useCallback(async (): Promise<boolean> => {
    if (roomRef.current || connecting) return false;
    if (!selfId) {
      toast.error("Sign in to start a call.");
      return false;
    }
    const myGeneration = ++joinGenerationRef.current;
    setConnecting(true);
    setLifecycle("joining");
    setLastError(null);
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
      // H-05: a leave() (or a second join()) could have run while the
      // above await was pending -- roomRef/state now belong to whatever
      // superseded this call. This join succeeded on ITS OWN room object,
      // which is exactly what leave() cannot have already cleaned up (it
      // only ever touches roomRef.current, and roomRef.current is no
      // longer this room) -- so this generation must dispose it itself
      // instead of publishing it as if it were still the active call.
      if (joinGenerationRef.current !== myGeneration) {
        room.leave();
        return false;
      }
      setLocalStream(stream);
      setJoined(true);
      setLifecycle("connected");
      return true;
    } catch (err) {
      if (joinGenerationRef.current !== myGeneration) return false; // superseded -- a newer join/leave already owns roomRef/state
      roomRef.current = null;
      const message =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera and microphone permission is required to join the call."
          : "Could not start the call on this device.";
      toast.error(message);
      setLifecycle("error");
      setLastError(message);
      return false;
    } finally {
      if (joinGenerationRef.current === myGeneration) setConnecting(false);
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

  // H02: block Morning Brief (and anything else gated by D03's
  // InteractionBlockerProvider) from auto-opening over an active call.
  useBlockWhile(joined, "active-call");

  // H02: roll every peer's raw RTCPeerConnection.connectionState (already
  // reported per-participant by CallRoom) up into one room-level signal.
  // CallRoom itself already calls pc.restartIce()/rebuilds a "failed" peer
  // on its own -- this only surfaces that recovery is in progress instead of
  // the call silently looking connected while a peer is actually dropped.
  useEffect(() => {
    if (!joined) return;
    const anyDisconnected = participants.some((p) => p.connection === "disconnected" || p.connection === "failed");
    setLifecycle((prev) => {
      if (anyDisconnected) return prev === "connected" ? "reconnecting" : prev;
      return prev === "reconnecting" ? "connected" : prev;
    });
  }, [participants, joined]);

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
    lifecycle,
    lastError,
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
