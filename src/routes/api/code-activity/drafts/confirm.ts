import { createFileRoute } from "@tanstack/react-router";

// E13. The browser sends what the person reviewed. Every authorization and consistency check, and the creation
// itself, happen inside one database function.
export const Route = createFileRoute("/api/code-activity/drafts/confirm")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const http = await import("@/features/code-activity/server/http.server");
        const thing = await import("@/features/code-activity/server/thing.server");
        const authed = await http.authenticate(request);
        if (!authed) return http.unauthorized();
        const b = await http.readJson(request);
        return http.toResponse(
          await thing.confirmDraft({
            user: authed.user,
            listId: b.listId,
            changeId: b.changeId,
            key: b.key,
            title: b.title,
            notes: b.notes,
            assigneeActorId: b.assigneeActorId,
            dueAt: b.dueAt,
            importance: b.importance,
            headSha: b.headSha,
            acknowledgeSourceChange: b.acknowledgeSourceChange,
            aiGenerated: b.aiGenerated,
          }),
        );
      },
    },
  },
});
