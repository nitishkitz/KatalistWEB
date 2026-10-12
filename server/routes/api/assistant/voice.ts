import { defineWebSocketHandler } from "nitro";
import { authenticateAssistantToken } from "../../../../src/lib/assistant-route.server";
import { createVoiceBridge, runTurnWithDefaults } from "../../../lib/assistant-voice-bridge";
import { openSarvamStt, synthesizeSarvam, ttsCodecLabel, voiceProviderConfig } from "../../../lib/assistant-voice-sarvam";

/**
 * Coey voice relay: browser audio in, Sarvam STT, shared turn controller,
 * Sarvam TTS, audio out. Runs only when COEY_VOICE_ENABLED=true and a Sarvam
 * key exists on the server. The first message must be a `start` carrying the
 * user's Supabase access token (browsers cannot set headers on a WebSocket).
 */
type PeerLike = { id: string; send(data: string | Uint8Array): void; close(code?: number, reason?: string): void };
const bridges = new Map<string, ReturnType<typeof createVoiceBridge>>();

export default defineWebSocketHandler({
  open(peer) {
    const config = voiceProviderConfig();
    if (process.env.COEY_VOICE_ENABLED !== "true" || !config) {
      peer.send(JSON.stringify({ type: "error", sessionId: null, code: "provider_unavailable", message: "Voice is not enabled on this deployment." }));
      peer.close(1008, "voice_disabled");
      return;
    }
    const p = peer as unknown as PeerLike;
    bridges.set(
      peer.id,
      createVoiceBridge(
        { sendText: (m) => p.send(m), sendBinary: (b) => p.send(b), close: (c, r) => p.close(c, r) },
        {
          authenticate: (token) => authenticateAssistantToken(token),
          openStt: (language, handlers) => openSarvamStt(config, language, handlers),
          synthesize: (request) => synthesizeSarvam(config, request),
          ttsCodec: ttsCodecLabel(config),
          runTurn: runTurnWithDefaults,
          now: () => performance.now(),
          makeId: () => crypto.randomUUID(),
          log: (entry) => console.info(JSON.stringify(entry)),
        },
      ),
    );
  },
  async message(peer, message) {
    const bridge = bridges.get(peer.id);
    if (!bridge) return;
    const raw = message.rawData as unknown;
    if (raw instanceof Uint8Array) return bridge.onBinary(raw);
    if (raw instanceof ArrayBuffer) return bridge.onBinary(new Uint8Array(raw));
    await bridge.onText(message.text());
  },
  close(peer) {
    bridges.get(peer.id)?.close();
    bridges.delete(peer.id);
  },
  error(peer) {
    bridges.get(peer.id)?.close();
    bridges.delete(peer.id);
  },
});
