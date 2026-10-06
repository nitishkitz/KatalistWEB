/**
 * Full-mesh WebRTC audio/video call room for a List, signalled over Supabase
 * Realtime (presence for the roster, broadcast for SDP/ICE). One
 * RTCPeerConnection per remote peer; media flows browser-to-browser.
 *
 * Negotiation uses the "perfect negotiation" pattern: on glare the polite peer
 * (lexicographically smaller id) rolls back and accepts, so pairs converge.
 *
 * Limitations (DIY full-mesh, by design):
 *  - Practical for small groups (~4-6). Beyond that an SFU is needed.
 *  - STUN only by default. Strict/symmetric NATs need a TURN server — set
 *    VITE_STUN_URLS / VITE_TURN_URL to make cross-network calls reliable.
 *  - No server-side recording.
 */
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type CallParticipant = {
  id: string;
  name: string;
  /** Auth user id behind this participant (the call id carries a per-device suffix). */
  profileId?: string | null;
  avatarUrl?: string | null;
  stream?: MediaStream;
  connection?: RTCPeerConnectionState;
  muted?: boolean;
  cameraOff?: boolean;
  /** True while this peer is presenting their screen (drives "presentation mode"). */
  sharing?: boolean;
  /** True while this peer has opened the standalone whiteboard (no screen
   *  share needed — everyone on the call can draw on it, same as during a
   *  screen share, just without a shared screen underneath it). */
  whiteboardOpen?: boolean;
  /** Set while this peer is presenting a shared document (PDF/image/
   *  DOCX/XLSX) — everyone renders it locally from this URL and draws on
   *  it with the same annotation layer used over a screen share. */
  docUrl?: string | null;
  docName?: string | null;
  docKind?: "pdf" | "docx" | "excel" | "image" | null;
  /** True while this peer has their hand raised. */
  raisedHand?: boolean;
};

export type CallRoomState = {
  participants: CallParticipant[];
  /** Everyone with a hand raised, soonest-first — a lightweight speaking
   *  queue for calls with no host to call on people. */
  raisedHandQueue: { id: string; name: string }[];
};

/** A single annotate-layer draw operation, broadcast to every peer. Coordinates
 *  are normalized (0..1) so they render correctly regardless of each viewer's
 *  window size. Ephemeral — never persisted, cleared when the call ends.
 *  "image" carries a storage URL (not raw bytes) — pasted images are uploaded
 *  first so the broadcast payload stays small regardless of image size. */
export type DrawOp =
  | {
      kind: "stroke";
      id: string;
      tool: "pen" | "eraser";
      color: string;
      width: number;
      points: { x: number; y: number }[];
      /** Which page of a shared document this was drawn on — unset when
       *  drawn over a screen share or the standalone whiteboard, where
       *  there's no paging concept. Only rendered while that page is the
       *  one currently displayed (see AnnotateCanvas), so a scribble drawn
       *  on page 2 doesn't reappear stuck on whatever page a viewer is on. */
      page?: number;
    }
  | {
      kind: "shape";
      id: string;
      tool: "rect" | "ellipse" | "arrow";
      color: string;
      width: number;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      page?: number;
    }
  | { kind: "image"; id: string; url: string; x: number; y: number; width: number; height: number; page?: number }
  | { kind: "clear" }
  /** Remove one specific stroke/shape/image by id — a quick "undo" action,
   *  distinct from the pixel-level eraser tool (which only erases the part
   *  you drag over) and from "clear" (which wipes everything). Carries an
   *  id (rather than always meaning "the last item") so undo can target the
   *  last item on the *current page* of a shared document, not whatever
   *  happens to be last in the global history regardless of page. */
  | { kind: "undo"; id: string };

type PeerSlot = {
  pc: RTCPeerConnection;
  makingOffer: boolean;
  ignoreOffer: boolean;
  name: string;
  profileId: string | null;
  avatarUrl: string | null;
  sessionId: string | null;
  /** ICE candidates that arrived before the remote description was applied. */
  pendingIce: RTCIceCandidateInit[];
  /** Identifies this side's RTCPeerConnection in every SDP/ICE message. */
  localConn: string;
  /** The remote RTCPeerConnection this slot is paired with, once known. */
  remoteConn: string | null;
  /** When the peer vanished from presence; dropped only if it stays gone. */
  missingSince: number | null;
  stream: MediaStream;
  muted: boolean;
  cameraOff: boolean;
  sharing: boolean;
  whiteboardOpen: boolean;
  docUrl: string | null;
  docName: string | null;
  docKind: "pdf" | "docx" | "excel" | "image" | null;
  raisedHand: boolean;
  raisedSince: number;
};

function envStr(key: string): string | undefined {
  const env = (import.meta.env ?? {}) as Record<string, unknown>;
  const v = env[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * ICE servers from env (static-credential / Metered-style — no secrets in code).
 * Set in Vercel and redeploy:
 *   VITE_TURN_URL         one or more TURN URLs, comma-separated (Metered gives
 *                         several, e.g. "turn:host:80,turn:host:80?transport=tcp,turns:host:443?transport=tcp")
 *   VITE_TURN_USERNAME    TURN username
 *   VITE_TURN_CREDENTIAL  TURN credential
 *   VITE_STUN_URLS        optional, comma-separated (defaults to Google STUN)
 */
function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [];
  const stun = envStr("VITE_STUN_URLS")?.split(",").map((s) => s.trim()).filter(Boolean);
  servers.push({ urls: stun && stun.length ? stun : ["stun:stun.l.google.com:19302"] });

  const turnRaw = envStr("VITE_TURN_URL");
  if (turnRaw) {
    const urls = turnRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (urls.length) {
      servers.push({
        urls,
        username: envStr("VITE_TURN_USERNAME"),
        credential: envStr("VITE_TURN_CREDENTIAL"),
      });
    }
  }
  return servers;
}

/** Set VITE_FORCE_TURN=1 to force relay-only ICE (useful to verify TURN works). */
function forceRelay(): boolean {
  const v = envStr("VITE_FORCE_TURN");
  return v === "1" || v === "true";
}

/**
 * Resolve ICE servers. If Metered is configured (VITE_METERED_DOMAIN +
 * VITE_METERED_API_KEY), fetch STUN+TURN credentials from its API at call time;
 * otherwise fall back to the static env config (VITE_TURN_*) / Google STUN.
 */
async function loadIceServers(): Promise<RTCIceServer[]> {
  const domain = envStr("VITE_METERED_DOMAIN");
  const apiKey = envStr("VITE_METERED_API_KEY");
  if (domain && apiKey) {
    try {
      const res = await fetch(
        `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`,
      );
      if (res.ok) {
        const list = (await res.json()) as RTCIceServer[];
        if (Array.isArray(list) && list.length) return list;
      }
    } catch {
      // fall through to static/STUN
    }
  }
  return iceServers();
}

/**
 * Supabase presence can briefly omit a peer while it applies that peer's
 * metadata update (the leave of the old meta lands before the join of the
 * new one). Tearing the connection down on that blip rebuilt it on one side
 * only and left the pair stuck. Real leaves are announced with a "bye"
 * broadcast, so only an unannounced disappearance waits this long.
 */
const PRESENCE_GRACE_MS = 6000;

export class CallRoom {
  private readonly listId: string;
  private readonly selfId: string;
  private readonly selfName: string;
  private readonly selfAvatarUrl: string | null;
  private readonly sessionId = crypto.randomUUID();
  private readonly onState: (state: CallRoomState) => void;
  private channel: RealtimeChannel | null = null;
  private readonly peers = new Map<string, PeerSlot>();
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingState = new Map<string, Partial<PeerState>>();
  /** Per-peer chain so each peer's SDP/ICE messages are applied strictly in order. */
  private readonly signalQueues = new Map<string, Promise<void>>();
  private localStream: MediaStream | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private screenStream: MediaStream | null = null;
  private resolvedIce: RTCIceServer[] | null = null;
  private closed = false;
  // Own mute/camera state, re-broadcast via presence metadata so remote peers
  // can show an accurate mic/camera indicator (there is no other reliable way
  // to observe a remote track's `enabled` flag over WebRTC).
  private selfMuted = false;
  private selfCameraOff = false;
  private selfSharing = false;
  private selfWhiteboardOpen = false;
  // Shared document (PDF/image/DOCX/XLSX) — same idea as selfWhiteboardOpen,
  // but carries the doc's URL/name/kind/page instead of a plain boolean.
  private selfDocUrl: string | null = null;
  private selfDocName: string | null = null;
  private selfDocKind: "pdf" | "docx" | "excel" | "image" | null = null;
  // Raised hand: same ephemeral presence-broadcast shape as the flags
  // above, but purely informational — it never gates any capability.
  private selfRaisedHand = false;
  private selfRaisedSince = 0;

  private readonly onReaction?: (p: { from: string; emoji: string }) => void;
  private readonly onDraw?: (op: DrawOp) => void;
  private readonly onDocPage?: (page: number) => void;
  private readonly onSignalingError?: (status: "CHANNEL_ERROR" | "TIMED_OUT") => void;

  constructor(opts: {
    listId: string;
    selfId: string;
    selfName: string;
    selfAvatarUrl?: string | null;
    onState: (state: CallRoomState) => void;
    onReaction?: (p: { from: string; emoji: string }) => void;
    onDraw?: (op: DrawOp) => void;
    onDocPage?: (page: number) => void;
    onSignalingError?: (status: "CHANNEL_ERROR" | "TIMED_OUT") => void;
  }) {
    this.listId = opts.listId;
    this.selfId = opts.selfId;
    this.selfName = opts.selfName;
    this.selfAvatarUrl = opts.selfAvatarUrl ?? null;
    this.onState = opts.onState;
    this.onReaction = opts.onReaction;
    this.onDraw = opts.onDraw;
    this.onDocPage = opts.onDocPage;
    this.onSignalingError = opts.onSignalingError;
  }

  /** Acquire local media and join the room. */
  async join(constraints: MediaStreamConstraints = { audio: true, video: true }): Promise<MediaStream> {
    // H02: getUserMedia can resolve well after leave() already ran (the
    // browser's own permission prompt can sit open for as long as the
    // user takes to respond, and the caller can navigate away / call
    // leave() in that window). `this.closed` is set synchronously by
    // leave(); re-checking it after EVERY await below is what stops an
    // already-left room from acquiring a camera/mic it can never release
    // (leave() can only stop tracks it already knows about) or standing
    // up a realtime channel for a room the caller believes is gone.
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (this.closed) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("Call room was left before the camera/microphone was ready.");
    }
    this.localStream = stream;
    this.cameraTrack = stream.getVideoTracks()[0] ?? null;

    const resolvedIce = await loadIceServers();
    if (this.closed) {
      stream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
      this.cameraTrack = null;
      throw new Error("Call room was left before joining completed.");
    }
    this.resolvedIce = resolvedIce;

    const channel = supabase.channel(`call:${this.listId}`, {
      config: { presence: { key: this.selfId }, broadcast: { self: false } },
    });
    this.channel = channel;

    channel
      .on("broadcast", { event: "sdp" }, ({ payload }) => this.enqueue(payload as SdpMsg, () => this.onSdp(payload as SdpMsg)))
      .on("broadcast", { event: "ice" }, ({ payload }) => this.enqueue(payload as IceMsg, () => this.onIce(payload as IceMsg)))
      // R-05: removeChannel() in leave() is not synchronous -- an event
      // already queued by Realtime before unsubscribe completes can still
      // reach these handlers after `this.closed` is set. Guard each one
      // rather than relying solely on the hook's own generation check.
      .on("broadcast", { event: "reaction" }, ({ payload }) => {
        if (this.closed) return;
        this.onReaction?.(payload as { from: string; emoji: string });
      })
      .on("broadcast", { event: "draw" }, ({ payload }) => {
        if (this.closed) return;
        this.onDraw?.(payload as DrawOp);
      })
      .on("broadcast", { event: "doc-page" }, ({ payload }) => {
        if (this.closed) return;
        this.onDocPage?.((payload as { page: number }).page);
      })
      .on("broadcast", { event: "bye" }, ({ payload }) => {
        if (this.closed) return;
        const from = (payload as { from?: string }).from;
        if (from && this.peers.has(from)) {
          this.dropPeer(from);
          this.emit();
        }
      })
      .on("broadcast", { event: "state" }, ({ payload }) => this.onPeerState(payload as { from?: string; state?: Partial<PeerState> }))
      .on("presence", { event: "sync" }, () => this.syncPeers())
      .on("system", {}, (payload: { status?: string; message?: string }) => {
        if (this.closed || payload?.status !== "error") return;
        console.warn("[call] realtime system error", payload.message);
        this.onSignalingError?.("CHANNEL_ERROR");
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // Also runs after a silent re-subscribe, which re-announces us.
          void channel.track(this.presenceMeta());
          this.publishState();
        } else if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !this.closed) {
          // Without this a dead signalling channel just looks like "nobody joined".
          this.onSignalingError?.(status);
        }
      });

    return this.localStream;
  }

  /**
   * Presence carries identity only and is tracked once per subscription.
   * Supabase allows a client roughly five presence updates before it starts
   * rejecting them ("Client presence rate limit exceeded") and drops that
   * client from everyone's roster, so anything that changes during a call
   * (mute, camera, hand, whiteboard, document, screen share) travels as a
   * "state" broadcast instead -- see publishState().
   */
  private presenceMeta() {
    return {
      id: this.selfId,
      name: this.selfName,
      profileId: this.selfId.split(":")[0] || null,
      avatarUrl: this.selfAvatarUrl,
      sessionId: this.sessionId,
    };
  }

  private selfState(): PeerState {
    return {
      muted: this.selfMuted,
      cameraOff: this.selfCameraOff,
      sharing: this.selfSharing,
      whiteboardOpen: this.selfWhiteboardOpen,
      docUrl: this.selfDocUrl,
      docName: this.selfDocName,
      docKind: this.selfDocKind,
      raisedHand: this.selfRaisedHand,
      raisedSince: this.selfRaisedSince,
    };
  }

  /** Broadcast our call state, coalescing bursts of toggles into one message. */
  private publishState() {
    if (this.stateTimer || this.closed) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      if (this.closed || !this.channel) return;
      void this.channel.send({
        type: "broadcast",
        event: "state",
        payload: { from: this.selfId, sessionId: this.sessionId, state: this.selfState() },
      });
    }, 60);
  }

  private onPeerState(msg: { from?: string; sessionId?: string; state?: Partial<PeerState> }) {
    if (this.closed || !msg.from || !msg.state || msg.from === this.selfId) return;
    const slot = this.peers.get(msg.from);
    // State can arrive before the sender shows up in presence; keep the latest.
    if (!slot) {
      this.pendingState.set(msg.from, msg.state);
      return;
    }
    Object.assign(slot, normalizeState(msg.state));
    this.emit();
  }

  private presentPeerIds(): {
    id: string;
    name: string;
    profileId: string | null;
    avatarUrl: string | null;
    sessionId: string | null;
  }[] {
    if (!this.channel) return [];
    const state = this.channel.presenceState<{
      id: string;
      name: string;
      profileId?: string | null;
      avatarUrl?: string | null;
      sessionId?: string | null;
    }>();
    const out: { id: string; name: string; profileId: string | null; avatarUrl: string | null; sessionId: string | null }[] = [];
    for (const key of Object.keys(state)) {
      const metas = state[key];
      const meta = metas?.[metas.length - 1];
      if (meta && meta.id !== this.selfId) {
        out.push({
          id: meta.id,
          name: meta.name,
          profileId: meta.profileId ?? meta.id.split(":")[0] ?? null,
          avatarUrl: meta.avatarUrl ?? null,
          sessionId: meta.sessionId ?? null,
        });
      }
    }
    return out;
  }

  /** Reconcile peer connections against the current presence roster. */
  private syncPeers() {
    const present = this.presentPeerIds();
    const presentIds = new Set(present.map((p) => p.id));

    // Remove peers that left -- after a grace period, see PRESENCE_GRACE_MS.
    const now = Date.now();
    let waiting = false;
    for (const [id, slot] of [...this.peers.entries()]) {
      if (presentIds.has(id)) {
        slot.missingSince = null;
        continue;
      }
      slot.missingSince ??= now;
      const dead = slot.pc.connectionState === "failed" || slot.pc.connectionState === "closed";
      if (dead || now - slot.missingSince >= PRESENCE_GRACE_MS) this.dropPeer(id);
      else waiting = true;
    }
    if (waiting && !this.graceTimer && !this.closed) {
      this.graceTimer = setTimeout(() => {
        this.graceTimer = null;
        if (!this.closed) this.syncPeers();
      }, PRESENCE_GRACE_MS);
    }
    let joined = false;
    // Add peers that joined, and refresh identity for peers already
    // connected (presence re-syncs whenever anyone updates their metadata).
    // Adding local tracks in createPeer triggers onnegotiationneeded on both
    // sides; perfect negotiation resolves the glare.
    for (const p of present) {
      let existing = this.peers.get(p.id);
      // A peer that left and rejoined under the same call id arrives with a
      // new session id. Its old RTCPeerConnection belongs to a dead DTLS
      // session, so rebuild instead of renegotiating onto it.
      if (existing && p.sessionId && existing.sessionId && existing.sessionId !== p.sessionId) {
        this.dropPeer(p.id);
        existing = undefined;
      }
      if (existing) {
        existing.name = p.name;
        existing.profileId = p.profileId;
        existing.avatarUrl = p.avatarUrl;
        existing.sessionId = p.sessionId ?? existing.sessionId;
      } else {
        const pending = this.pendingState.get(p.id);
        this.pendingState.delete(p.id);
        this.createPeer(p.id, p.name, { ...p, ...(pending ? normalizeState(pending) : {}) });
        joined = true;
      }
    }
    // Someone new: tell them where we stand (they missed earlier broadcasts).
    if (joined) this.publishState();
    this.emit();
  }

  private createPeer(
    peerId: string,
    name: string,
    meta: Partial<{
      profileId: string | null;
      avatarUrl: string | null;
      sessionId: string | null;
      muted: boolean;
      cameraOff: boolean;
      sharing: boolean;
      whiteboardOpen: boolean;
      docUrl: string | null;
      docName: string | null;
      docKind: "pdf" | "docx" | "excel" | "image" | null;
      raisedHand: boolean;
      raisedSince: number;
    }> = {},
  ): PeerSlot {
    const {
      profileId = peerId.split(":")[0] ?? null,
      avatarUrl = null,
      sessionId = null,
      muted = false,
      cameraOff = false,
      sharing = false,
      whiteboardOpen = false,
      docUrl = null,
      docName = null,
      docKind = null,
      raisedHand = false,
      raisedSince = 0,
    } = meta;
    const pc = new RTCPeerConnection({
      iceServers: this.resolvedIce ?? iceServers(),
      ...(forceRelay() ? { iceTransportPolicy: "relay" as RTCIceTransportPolicy } : {}),
    });
    const slot: PeerSlot = {
      pc,
      makingOffer: false,
      ignoreOffer: false,
      name,
      profileId,
      avatarUrl,
      sessionId,
      pendingIce: [],
      localConn: crypto.randomUUID(),
      remoteConn: null,
      missingSince: null,
      stream: new MediaStream(),
      muted,
      cameraOff,
      sharing,
      whiteboardOpen,
      docUrl,
      docName,
      docKind,
      raisedHand,
      raisedSince,
    };
    this.peers.set(peerId, slot);

    // Publish our local tracks.
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    }

    pc.ontrack = (e) => {
      for (const track of e.streams[0]?.getTracks() ?? [e.track]) {
        if (!slot.stream.getTracks().some((t) => t.id === track.id)) slot.stream.addTrack(track);
      }
      this.emit();
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.send("ice", { from: this.selfId, to: peerId, conn: slot.localConn, candidate: e.candidate.toJSON() });
      }
    };
    pc.onnegotiationneeded = async () => {
      try {
        slot.makingOffer = true;
        await pc.setLocalDescription();
        this.send("sdp", {
          from: this.selfId, to: peerId, conn: slot.localConn, toConn: slot.remoteConn,
          description: pc.localDescription!.toJSON(),
        });
      } catch (err) {
        console.warn("[call] offer failed", err);
        // negotiation will be retried on the next event
      } finally {
        slot.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected") {
        // Often a brief network blip (Wi-Fi handoff, a dropped packet burst) —
        // ask the browser to renegotiate ICE without tearing down the peer.
        // This is the case that was previously left to just sit there,
        // which is what surfaced as "disconnected mid-call".
        try {
          pc.restartIce();
        } catch {
          // Not supported everywhere; the "failed" branch below is the backstop.
        }
      } else if (pc.connectionState === "failed") {
        // Unrecoverable — drop the dead slot and rebuild it immediately from
        // the current presence roster instead of waiting for the next
        // presence "sync" event, which may not fire again for a while if no
        // one else joins/leaves in the meantime.
        this.dropPeer(peerId);
        this.syncPeers();
        return;
      }
      this.emit();
    };
    return slot;
  }

  /**
   * Handlers are async (setRemoteDescription/setLocalDescription). Running
   * them concurrently let an offer be judged against a connection that was
   * still applying the previous answer, so a valid renegotiation was
   * discarded as a "collision" and that pair never exchanged video.
   */
  private enqueue(msg: { from?: string; to?: string }, run: () => Promise<void>) {
    if (msg.to !== this.selfId || !msg.from) return;
    const key = msg.from;
    const next = (this.signalQueues.get(key) ?? Promise.resolve()).then(run).catch((err) => {
      console.warn("[call] signalling step failed", err);
    });
    this.signalQueues.set(key, next);
    void next.then(() => {
      if (this.signalQueues.get(key) === next) this.signalQueues.delete(key);
    });
  }

  private async onSdp(msg: SdpMsg) {
    if (msg.to !== this.selfId || this.closed) return;
    const description = msg.description;
    let slot = this.peers.get(msg.from);
    if (slot && msg.conn && slot.remoteConn && msg.conn !== slot.remoteConn) {
      // The other side rebuilt its connection (rejoin, failure recovery).
      // Ours is paired with a connection that no longer exists: rebuild to
      // match an offer, and ignore answers meant for an older negotiation.
      if (description.type !== "offer") return;
      const keep = { name: slot.name, profileId: slot.profileId, avatarUrl: slot.avatarUrl, sessionId: slot.sessionId };
      this.dropPeer(msg.from);
      slot = this.createPeer(msg.from, keep.name, keep);
    }
    // An answer addressed to one of our earlier connections is stale.
    if (slot && description.type === "answer" && msg.toConn && msg.toConn !== slot.localConn) return;
    if (!slot) {
      // The offer can beat the sender's presence entry; use it if it's there.
      const known = this.presentPeerIds().find((p) => p.id === msg.from);
      slot = this.createPeer(msg.from, known?.name ?? "Participant", known ?? {});
    }
    const pc = slot.pc;
    const polite = this.selfId < msg.from;
    const offerCollision = description.type === "offer" && (slot.makingOffer || pc.signalingState !== "stable");
    slot.ignoreOffer = !polite && offerCollision;
    if (slot.ignoreOffer) {
      console.debug("[call] ignored colliding offer", msg.from);
      return;
    }
    try {
      await pc.setRemoteDescription(description);
      if (msg.conn) slot.remoteConn = msg.conn;
      await this.flushPendingIce(slot);
      if (description.type === "offer") {
        await pc.setLocalDescription();
        this.send("sdp", {
          from: this.selfId, to: msg.from, conn: slot.localConn, toConn: slot.remoteConn,
          description: pc.localDescription!.toJSON(),
        });
      }
    } catch (err) {
      console.warn("[call] remote description failed", description.type, err);
    }
  }

  private async onIce(msg: IceMsg) {
    if (msg.to !== this.selfId) return;
    const slot = this.peers.get(msg.from);
    if (!slot) return;
    // A candidate from a connection this slot is not paired with would
    // poison the pairing; drop it.
    if (msg.conn && slot.remoteConn && msg.conn !== slot.remoteConn) return;
    // Candidates routinely beat their SDP over the broadcast channel. Adding
    // one before setRemoteDescription throws and the candidate is lost for
    // good, which leaves the pair stuck on "connecting" with no media.
    if (!slot.pc.remoteDescription) {
      slot.pendingIce.push(msg.candidate);
      return;
    }
    try {
      await slot.pc.addIceCandidate(msg.candidate);
    } catch {
      if (!slot.ignoreOffer) {
        /* ignore benign candidate errors */
      }
    }
  }

  private async flushPendingIce(slot: PeerSlot) {
    const queued = slot.pendingIce.splice(0);
    for (const candidate of queued) {
      try {
        await slot.pc.addIceCandidate(candidate);
      } catch {
        /* stale candidate from a superseded negotiation */
      }
    }
  }

  private send(event: "sdp" | "ice", payload: SdpMsg | IceMsg) {
    void this.channel?.send({ type: "broadcast", event, payload });
  }

  /** Replace the outgoing video track on all peers (camera <-> screen). */
  private async replaceVideoTrack(track: MediaStreamTrack | null) {
    for (const slot of this.peers.values()) {
      const transceiver = slot.pc
        .getTransceivers()
        .find((t) => t.currentDirection !== "stopped" && (t.sender.track?.kind === "video" || t.receiver.track.kind === "video"));
      if (transceiver) {
        await transceiver.sender.replaceTrack(track);
        // An audio-only participant only has a receive-only video slot (it
        // was created to receive the other side's camera). Sending a screen
        // through it needs the direction opened, which renegotiates.
        if (track && (transceiver.direction === "recvonly" || transceiver.direction === "inactive")) {
          transceiver.direction = "sendrecv";
        }
      } else if (track) {
        // No video slot at all yet: publish the screen as a new track.
        slot.pc.addTrack(track, this.screenStream ?? new MediaStream([track]));
      }
    }
  }

  async startScreenShare(): Promise<MediaStream> {
    // H02: same getDisplayMedia-resolves-after-leave race as join()'s own
    // getUserMedia guard above -- the browser's screen picker can stay
    // open long enough for the call to be left in the meantime.
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    if (this.closed) {
      screen.getTracks().forEach((t) => t.stop());
      throw new Error("Call was left before screen sharing started.");
    }
    this.screenStream = screen;
    const track = screen.getVideoTracks()[0]!;
    await this.replaceVideoTrack(track);
    track.onended = () => void this.stopScreenShare();
    this.selfSharing = true;
    this.publishState();
    return screen;
  }

  async stopScreenShare() {
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    await this.replaceVideoTrack(this.cameraTrack);
    this.selfSharing = false;
    this.publishState();
  }

  /** Open the standalone whiteboard — usable without anyone screen-sharing,
   *  so the board isn't gated behind presenting a screen. Symmetric like
   *  the raise-hand/take-control flags: anyone can open or close it. */
  openWhiteboard() {
    this.selfWhiteboardOpen = true;
    this.publishState();
    this.emit();
  }

  closeWhiteboard() {
    this.selfWhiteboardOpen = false;
    this.publishState();
    this.emit();
  }

  /** Present a shared document (PDF/image/DOCX/XLSX) — everyone renders it
   *  locally from this URL (no pixels are broadcast) and draws on it with
   *  the same annotation layer used over a screen share. Uploading a new
   *  doc while one is open replaces it. */
  openDoc(doc: { url: string; name: string; kind: "pdf" | "docx" | "excel" | "image" }) {
    this.selfDocUrl = doc.url;
    this.selfDocName = doc.name;
    this.selfDocKind = doc.kind;
    this.publishState();
    this.emit();
  }

  closeDoc() {
    this.selfDocUrl = null;
    this.selfDocName = null;
    this.selfDocKind = null;
    this.publishState();
    this.emit();
  }

  /** Broadcast-only (not presence) — unlike docUrl/docKind, the current
   *  page isn't "owned" by whoever opened the doc. Anyone on the call can
   *  turn pages; presence would only ever let the original opener's clicks
   *  do anything, since only their presence record carries a real docUrl.
   *  Trade-off: a late joiner starts assuming page 1 until the next page
   *  turn, same accepted limitation draw ops already have (no history
   *  replay for latecomers). */
  sendDocPage(page: number) {
    void this.channel?.send({ type: "broadcast", event: "doc-page", payload: { page: Math.max(1, page) } });
  }

  sendReaction(emoji: string) {
    void this.channel?.send({
      type: "broadcast",
      event: "reaction",
      payload: { from: this.selfName, emoji },
    });
  }

  /** Broadcast an annotate-layer draw operation (stroke/shape/clear) to every peer. */
  sendDraw(op: DrawOp) {
    void this.channel?.send({ type: "broadcast", event: "draw", payload: op });
  }

  /** Raise a hand — purely informational, does not gate any capability. */
  raiseHand() {
    this.selfRaisedHand = true;
    this.selfRaisedSince = Date.now();
    this.publishState();
    this.emit();
  }

  lowerHand() {
    this.selfRaisedHand = false;
    this.publishState();
    this.emit();
  }

  setMuted(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.selfMuted = muted;
    this.publishState();
  }

  setCameraOff(off: boolean) {
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = !off));
    this.selfCameraOff = off;
    this.publishState();
  }

  private dropPeer(id: string) {
    const slot = this.peers.get(id);
    if (!slot) return;
    try {
      slot.pc.ontrack = null;
      slot.pc.onicecandidate = null;
      slot.pc.onnegotiationneeded = null;
      slot.pc.onconnectionstatechange = null;
      slot.pc.close();
    } catch {
      /* ignore */
    }
    this.peers.delete(id);
  }

  private emit() {
    if (this.closed) return;
    const participants: CallParticipant[] = [...this.peers.entries()].map(([id, slot]) => ({
      id,
      name: slot.name,
      profileId: slot.profileId,
      avatarUrl: slot.avatarUrl,
      stream: slot.stream,
      connection: slot.pc.connectionState,
      muted: slot.muted,
      cameraOff: slot.cameraOff,
      sharing: slot.sharing,
      whiteboardOpen: slot.whiteboardOpen,
      docUrl: slot.docUrl,
      docName: slot.docName,
      docKind: slot.docKind,
      raisedHand: slot.raisedHand,
    }));

    // Raised-hand queue: everyone (self + peers) currently raised, ordered
    // soonest-first — a lightweight speaking order for a call with no host.
    const raised: { id: string; name: string; since: number }[] = [];
    if (this.selfRaisedHand) raised.push({ id: this.selfId, name: this.selfName, since: this.selfRaisedSince });
    for (const [id, slot] of this.peers) {
      if (slot.raisedHand) raised.push({ id, name: slot.name, since: slot.raisedSince });
    }
    raised.sort((a, b) => a.since - b.since);
    const raisedHandQueue = raised.map(({ id, name }) => ({ id, name }));

    this.onState({ participants, raisedHandQueue });
  }

  leave() {
    if (this.channel && !this.closed) {
      // Lets everyone drop us now instead of after the presence grace period.
      void this.channel.send({ type: "broadcast", event: "bye", payload: { from: this.selfId } });
    }
    this.closed = true;
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.stateTimer = null;
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    if (this.channel) {
      void this.channel.untrack();
      void supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }
}

type PeerState = {
  muted: boolean;
  cameraOff: boolean;
  sharing: boolean;
  whiteboardOpen: boolean;
  docUrl: string | null;
  docName: string | null;
  docKind: "pdf" | "docx" | "excel" | "image" | null;
  raisedHand: boolean;
  raisedSince: number;
};

const DOC_KINDS = new Set(["pdf", "docx", "excel", "image"]);

/** Coerce an untrusted state payload to well-typed slot fields. */
function normalizeState(state: Partial<PeerState>): PeerState {
  const docUrl = typeof state.docUrl === "string" && /^https?:\/\//i.test(state.docUrl) ? state.docUrl : null;
  return {
    muted: Boolean(state.muted),
    cameraOff: Boolean(state.cameraOff),
    sharing: Boolean(state.sharing),
    whiteboardOpen: Boolean(state.whiteboardOpen),
    docUrl,
    docName: docUrl && typeof state.docName === "string" ? state.docName.slice(0, 200) : null,
    docKind: docUrl && state.docKind && DOC_KINDS.has(state.docKind) ? state.docKind : null,
    raisedHand: Boolean(state.raisedHand),
    raisedSince: typeof state.raisedSince === "number" ? state.raisedSince : 0,
  };
}

type SdpMsg = {
  from: string;
  to: string;
  /** Sender's connection id; `toConn` is the receiver connection it answers. */
  conn?: string;
  toConn?: string | null;
  description: RTCSessionDescriptionInit;
};
type IceMsg = { from: string; to: string; conn?: string; candidate: RTCIceCandidateInit };
