import { createFileRoute } from "@tanstack/react-router";
import { assistantJson, requireAssistantUser } from "@/lib/assistant-route.server";
export const Route = createFileRoute("/api/things/improve-description")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { userId, client } = await requireAssistantUser(request);
          const { improveDescription, DescriptionImproveError } =
            await import("../../../../server/lib/improve-description");
          // Enforce bytes while streaming, including requests without Content-Length.
          if (Number(request.headers.get("content-length") ?? 0) > 64_000)
            return assistantJson({ message: "Description is too long." }, 413);
          const reader = request.body?.getReader();
          if (!reader) return assistantJson({ message: "A JSON body is required." }, 400);
          const chunks: Uint8Array[] = [];
          let size = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 64_000) {
              await reader.cancel();
              return assistantJson({ message: "Description is too long." }, 413);
            }
            chunks.push(value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          const body = JSON.parse(new TextDecoder().decode(bytes));
          try {
            return assistantJson(
              await improveDescription(body, { userId, client, signal: request.signal }),
            );
          } catch (error) {
            if (error instanceof DescriptionImproveError)
              return assistantJson({ message: error.message }, error.status);
            throw error;
          }
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof SyntaxError)
            return assistantJson({ message: "The request body must be valid JSON." }, 400);
          return assistantJson(
            { message: "Description improvement is temporarily unavailable." },
            502,
          );
        }
      },
    },
  },
});
