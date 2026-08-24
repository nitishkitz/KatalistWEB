import { createFileRoute } from "@tanstack/react-router";
import { createMagicBoxTranscribeHandler } from "@/features/ai/magic-box-api.server";

const handle = createMagicBoxTranscribeHandler();

export const Route = createFileRoute("/api/magic-box/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});
