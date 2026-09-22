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
  const v = (import.meta.env as Record<string, unknown>)[key];
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

export class CallRoom {
  private readonly listId: string;
  private readonly selfId: string;
  private readonly selfName: string;
  private readonly onState: (state: CallRoomState) => void;
  private channel: RealtimeChannel | null = null;
  private readonly peers = new Map<string, PeerSlot>();
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

  constructor(opts: {
    listId: string;
    selfId: string;
    selfName: string;
    onState: (state: CallRoomState) => void;
    onReaction?: (p: { from: string; emoji: string }) => void;
    onDraw?: (op: DrawOp) => void;
    onDocPage?: (page: number) => void;
  }) {
    this.listId = opts.listId;
    this.selfId = opts.selfId;
    this.selfName = opts.selfName;
    this.onState = opts.onState;
    this.onReaction = opts.onReaction;
    this.onDraw = opts.onDraw;
    this.onDocPage = opts.onDocPage;
  }

  /** Acquire local media and join the room. */
  async join(constraints: MediaStreamConstraints = { audio: true, video: true }): Promise<MediaStream> {
    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    this.cameraTrack = this.localStream.getVideoTracks()[0] ?? null;
    this.resolvedIce = await loadIceServers();

    const channel = supabase.channel(`call:${this.listId}`, {
      config: { presence: { key: this.selfId }, broadcast: { self: false } },
    });
    this.channel = channel;

    channel
      .on("broadcast", { event: "sdp" }, ({ payload }) => void this.onSdp(payload as SdpMsg))
      .on("broadcast", { event: "ice" }, ({ payload }) => void this.onIce(payload as IceMsg))
      .on("broadcast", { event: "reaction" }, ({ payload }) =>
        this.onReaction?.(payload as { from: string; emoji: string }),
      )
      .on("broadcast", { event: "draw" }, ({ payload }) => this.onDraw?.(payload as DrawOp))
      .on("broadcast", { event: "doc-page" }, ({ payload }) => this.onDocPage?.((payload as { page: number }).page))
      .on("presence", { event: "sync" }, () => this.syncPeers())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track(this.presenceMeta());
        }
      });

    return this.localStream;
  }

  private presenceMeta() {
    return {
      id: this.selfId,
      name: this.selfName,
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

  private presentPeerIds(): {
    id: string;
    name: string;
    muted: boolean;
    cameraOff: boolean;
    sharing: boolean;
    whiteboardOpen: boolean;
    docUrl: string | null;
    docName: string | null;
    docKind: "pdf" | "docx" | "excel" | "image" | null;
    raisedHand: boolean;
    raisedSince: number;
  }[] {
    if (!this.channel) return [];
    const state = this.channel.presenceState<{
      id: string;
      name: string;
      muted?: boolean;
      cameraOff?: boolean;
      sharing?: boolean;
      whiteboardOpen?: boolean;
      docUrl?: string | null;
      docName?: string | null;
      docKind?: "pdf" | "docx" | "excel" | "image" | null;
      raisedHand?: boolean;
      raisedSince?: number;
    }>();
    const out: {
      id: string;
      name: string;
      muted: boolean;
      cameraOff: boolean;
      sharing: boolean;
      whiteboardOpen: boolean;
      docUrl: string | null;
      docName: string | null;
      docKind: "pdf" | "docx" | "excel" | "image" | null;
      raisedHand: boolean;
      raisedSince: number;
    }[] = [];
    for (const key of Object.keys(state)) {
      const metas = state[key];
      const meta = metas?.[0];
      if (meta && meta.id !== this.selfId) {
        out.push({
          id: meta.id,
          name: meta.name,
          muted: Boolean(meta.muted),
          cameraOff: Boolean(meta.cameraOff),
          sharing: Boolean(meta.sharing),
          whiteboardOpen: Boolean(meta.whiteboardOpen),
          docUrl: meta.docUrl ?? null,
          docName: meta.docName ?? null,
          docKind: meta.docKind ?? null,
          raisedHand: Boolean(meta.raisedHand),
          raisedSince: meta.raisedSince ?? 0,
        });
      }
    }
    return out;
  }

  /** Reconcile peer connections against the current presence roster. */
  private syncPeers() {
    const present = this.presentPeerIds();
    const presentIds = new Set(present.map((p) => p.id));

    // Remove peers that left.
    for (const id of [...this.peers.keys()]) {
      if (!presentIds.has(id)) this.dropPeer(id);
    }
    // Add peers that joined, and refresh mute/camera state for peers already
    // connected (presence re-syncs whenever anyone updates their metadata).
    // Adding local tracks in createPeer triggers onnegotiationneeded on both
    // sides; perfect negotiation resolves the glare.
    for (const p of present) {
      const existing = this.peers.get(p.id);
      if (existing) {
        existing.muted = p.muted;
        existing.cameraOff = p.cameraOff;
        existing.sharing = p.sharing;
        existing.whiteboardOpen = p.whiteboardOpen;
        existing.docUrl = p.docUrl;
        existing.docName = p.docName;
        existing.docKind = p.docKind;
        existing.raisedHand = p.raisedHand;
        existing.raisedSince = p.raisedSince;
      } else {
        this.createPeer(p.id, p.name, p);
      }
    }
    this.emit();
  }

  private createPeer(
    peerId: string,
    name: string,
    meta: Partial<{
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
      if (e.candidate) this.send("ice", { from: this.selfId, to: peerId, candidate: e.candidate.toJSON() });
    };
    pc.onnegotiationneeded = async () => {
      try {
        slot.makingOffer = true;
        await pc.setLocalDescription();
        this.send("sdp", { from: this.selfId, to: peerId, description: pc.localDescription!.toJSON() });
      } catch {
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

  private async onSdp(msg: SdpMsg) {
    if (msg.to !== this.selfId) return;
    let slot = this.peers.get(msg.from);
    if (!slot) slot = this.createPeer(msg.from, msg.from);
    const pc = slot.pc;
    const description = msg.description;
    const polite = this.selfId < msg.from;
    const offerCollision = description.type === "offer" && (slot.makingOffer || pc.signalingState !== "stable");
    slot.ignoreOffer = !polite && offerCollision;
    if (slot.ignoreOffer) return;
    try {
      await pc.setRemoteDescription(description);
      if (description.type === "offer") {
        await pc.setLocalDescription();
        this.send("sdp", { from: this.selfId, to: msg.from, description: pc.localDescription!.toJSON() });
      }
    } catch {
      /* ignore */
    }
  }

  private async onIce(msg: IceMsg) {
    if (msg.to !== this.selfId) return;
    const slot = this.peers.get(msg.from);
    if (!slot) return;
    try {
      await slot.pc.addIceCandidate(msg.candidate);
    } catch {
      if (!slot.ignoreOffer) {
        /* ignore benign candidate errors */
      }
    }
  }

  private send(event: "sdp" | "ice", payload: SdpMsg | IceMsg) {
    void this.channel?.send({ type: "broadcast", event, payload });
  }

  /** Replace the outgoing video track on all peers (camera <-> screen). */
  private async replaceVideoTrack(track: MediaStreamTrack | null) {
    for (const slot of this.peers.values()) {
      const sender = slot.pc.getSenders().find((s) => s.track?.kind === "video" || s.track === null);
      if (sender) await sender.replaceTrack(track);
    }
  }

  async startScreenShare(): Promise<MediaStream> {
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    this.screenStream = screen;
    const track = screen.getVideoTracks()[0]!;
    await this.replaceVideoTrack(track);
    track.onended = () => void this.stopScreenShare();
    this.selfSharing = true;
    void this.channel?.track(this.presenceMeta());
    return screen;
  }

  async stopScreenShare() {
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    await this.replaceVideoTrack(this.cameraTrack);
    this.selfSharing = false;
    void this.channel?.track(this.presenceMeta());
  }

  /** Open the standalone whiteboard — usable without anyone screen-sharing,
   *  so the board isn't gated behind presenting a screen. Symmetric like
   *  the raise-hand/take-control flags: anyone can open or close it. */
  openWhiteboard() {
    this.selfWhiteboardOpen = true;
    void this.channel?.track(this.presenceMeta());
    this.emit();
  }

  closeWhiteboard() {
    this.selfWhiteboardOpen = false;
    void this.channel?.track(this.presenceMeta());
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
    void this.channel?.track(this.presenceMeta());
    this.emit();
  }

  closeDoc() {
    this.selfDocUrl = null;
    this.selfDocName = null;
    this.selfDocKind = null;
    void this.channel?.track(this.presenceMeta());
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
    void this.channel?.track(this.presenceMeta());
    this.emit();
  }

  lowerHand() {
    this.selfRaisedHand = false;
    void this.channel?.track(this.presenceMeta());
    this.emit();
  }

  setMuted(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.selfMuted = muted;
    void this.channel?.track(this.presenceMeta());
  }

  setCameraOff(off: boolean) {
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = !off));
    this.selfCameraOff = off;
    void this.channel?.track(this.presenceMeta());
  }

  private dropPeer(id: string) {
    const slot = this.peers.get(id);
    if (!slot) return;
    try {
      slot.pc.ontrack = null;
      slot.pc.onicecandidate = null;
      slot.pc.onnegotiationneeded = null;
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
    this.closed = true;
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

type SdpMsg = { from: string; to: string; description: RTCSessionDescriptionInit };
type IceMsg = { from: string; to: string; candidate: RTCIceCandidateInit };
