import { createFileRoute } from "@tanstack/react-router";
import { publicLoginConfig } from "../../../../server/lib/phone-auth";
import { maintenanceActive } from "@/lib/reset-controls.server";

// The sign-in screen reads its mode (and, in temporary static mode, the code to
// display) from the server, so display and acceptance cannot drift across builds.
export const Route = createFileRoute("/api/auth/login-config")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify({ ...publicLoginConfig(), maintenance: maintenanceActive() }), {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store, max-age=0" },
        }),
    },
  },
});
