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
};

export type CallRoomState = {
  participants: CallParticipant[];
};

type PeerSlot = {
  pc: RTCPeerConnection;
  makingOffer: boolean;
  ignoreOffer: boolean;
  name: string;
  stream: MediaStream;
  muted: boolean;
  cameraOff: boolean;
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

  private readonly onReaction?: (p: { from: string; emoji: string }) => void;

  constructor(opts: {
    listId: string;
    selfId: string;
    selfName: string;
    onState: (state: CallRoomState) => void;
    onReaction?: (p: { from: string; emoji: string }) => void;
  }) {
    this.listId = opts.listId;
    this.selfId = opts.selfId;
    this.selfName = opts.selfName;
    this.onState = opts.onState;
    this.onReaction = opts.onReaction;
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
      .on("presence", { event: "sync" }, () => this.syncPeers())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track(this.presenceMeta());
        }
      });

    return this.localStream;
  }

  private presenceMeta() {
    return { id: this.selfId, name: this.selfName, muted: this.selfMuted, cameraOff: this.selfCameraOff };
  }

  private presentPeerIds(): { id: string; name: string; muted: boolean; cameraOff: boolean }[] {
    if (!this.channel) return [];
    const state = this.channel.presenceState<{ id: string; name: string; muted?: boolean; cameraOff?: boolean }>();
    const out: { id: string; name: string; muted: boolean; cameraOff: boolean }[] = [];
    for (const key of Object.keys(state)) {
      const metas = state[key];
      const meta = metas?.[0];
      if (meta && meta.id !== this.selfId) {
        out.push({ id: meta.id, name: meta.name, muted: Boolean(meta.muted), cameraOff: Boolean(meta.cameraOff) });
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
      } else {
        this.createPeer(p.id, p.name, p.muted, p.cameraOff);
      }
    }
    this.emit();
  }

  private createPeer(peerId: string, name: string, muted = false, cameraOff = false): PeerSlot {
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
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        // leave the slot; a presence re-sync can re-create it
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
    return screen;
  }

  async stopScreenShare() {
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    await this.replaceVideoTrack(this.cameraTrack);
  }

  sendReaction(emoji: string) {
    void this.channel?.send({
      type: "broadcast",
      event: "reaction",
      payload: { from: this.selfName, emoji },
    });
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
    }));
    this.onState({ participants });
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
