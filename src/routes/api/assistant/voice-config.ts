import { createFileRoute } from "@tanstack/react-router";
import { assistantJson, requireAssistantUser } from "@/lib/assistant-route.server";
import { voiceProviderConfig } from "../../../../server/lib/assistant-voice-sarvam";

/**
 * Server feature flag for the voice controls. Reports only whether voice is
 * usable on this deployment; it never returns key material.
 */
export const Route = createFileRoute("/api/assistant/voice-config")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireAssistantUser(request);
          const enabled = process.env.COEY_VOICE_ENABLED === "true" && Boolean(voiceProviderConfig());
          return assistantJson({ enabled });
        } catch (error) {
          if (error instanceof Response) return error;
          return assistantJson({ enabled: false }, 502);
        }
      },
    },
  },
});
