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
};

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [];
  const stun = (import.meta.env.VITE_STUN_URLS as string | undefined)?.split(",").map((s) => s.trim()).filter(Boolean);
  servers.push({ urls: stun && stun.length ? stun : ["stun:stun.l.google.com:19302"] });
  const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: import.meta.env.VITE_TURN_USERNAME as string | undefined,
      credential: import.meta.env.VITE_TURN_CREDENTIAL as string | undefined,
    });
  }
  return servers;
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
  private closed = false;

  constructor(opts: {
    listId: string;
    selfId: string;
    selfName: string;
    onState: (state: CallRoomState) => void;
  }) {
    this.listId = opts.listId;
    this.selfId = opts.selfId;
    this.selfName = opts.selfName;
    this.onState = opts.onState;
  }

  /** Acquire local media and join the room. */
  async join(constraints: MediaStreamConstraints = { audio: true, video: true }): Promise<MediaStream> {
    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    this.cameraTrack = this.localStream.getVideoTracks()[0] ?? null;

    const channel = supabase.channel(`call:${this.listId}`, {
      config: { presence: { key: this.selfId }, broadcast: { self: false } },
    });
    this.channel = channel;

    channel
      .on("broadcast", { event: "sdp" }, ({ payload }) => void this.onSdp(payload as SdpMsg))
      .on("broadcast", { event: "ice" }, ({ payload }) => void this.onIce(payload as IceMsg))
      .on("presence", { event: "sync" }, () => this.syncPeers())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ id: this.selfId, name: this.selfName });
        }
      });

    return this.localStream;
  }

  private presentPeerIds(): { id: string; name: string }[] {
    if (!this.channel) return [];
    const state = this.channel.presenceState<{ id: string; name: string }>();
    const out: { id: string; name: string }[] = [];
    for (const key of Object.keys(state)) {
      const metas = state[key];
      const meta = metas?.[0];
      if (meta && meta.id !== this.selfId) out.push({ id: meta.id, name: meta.name });
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
    // Add peers that joined. Adding local tracks in createPeer triggers
    // onnegotiationneeded on both sides; perfect negotiation resolves the glare.
    for (const p of present) {
      if (!this.peers.has(p.id)) this.createPeer(p.id, p.name);
    }
    this.emit();
  }

  private createPeer(peerId: string, name: string): PeerSlot {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const slot: PeerSlot = { pc, makingOffer: false, ignoreOffer: false, name, stream: new MediaStream() };
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

  setMuted(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  setCameraOff(off: boolean) {
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = !off));
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
