import { createFileRoute } from "@tanstack/react-router";
import { uploadListCover } from "@/features/lists/server/list-covers";

export const Route = createFileRoute("/api/lists/$listId/cover")({ server: { handlers: { POST: ({ request, params }) => uploadListCover(request, params.listId) } } });
