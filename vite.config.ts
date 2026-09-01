import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { grokPwaPlugin } from "./scripts/grok-pwa-plugin.mjs";

/**
 * Finish PGLite bootstrap during dev-server setup (before traffic). Vite awaits
 * async `configureServer` hooks. Production: `src/lib/db` kicks `ensureDbReady`
 * on import.
 */
function pgliteBootstrapPlugin(): Plugin {
  return {
    name: "app-builder:pglite-bootstrap",
    apply: "serve",
    async configureServer(server) {
      try {
        const mod = (await server.ssrLoadModule("/src/lib/db.ts")) as {
          ensureDbReady?: () => Promise<void>;
        };
        if (typeof mod.ensureDbReady === "function") {
          await mod.ensureDbReady();
        }
      } catch (err) {
        console.error("[app-builder] DB bootstrap failed:", err);
        throw err;
      }
    },
  };
}

/**
 * Live-preview OAuth popup — handled HERE so the agent never has to create a
 * `/auth/popup` route (and cannot break it by scaffolding a React page that
 * paints the full app shell in the popup).
 *
 * `signIn` (client.ts) opens `/auth/popup?providerId=…` in a top-level window.
 * This middleware runs before TanStack Start, calls `handleAuthPopupRequest`,
 * and returns the 302 / completion HTML. Deployed apps do not use the popup
 * (full-page OAuth redirect), so `apply: "serve"` is enough.
 */
function authPopupPlugin(): Plugin {
  return {
    name: "app-builder:auth-popup",
    apply: "serve",
    configureServer(server) {
      // Register immediately (not in a returned post-hook) so we run BEFORE
      // TanStack Start / the SPA HTML fallback. A model-authored
      // `src/routes/auth/popup.tsx` React page must never win this path.
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          if (pathOnly !== "/auth/popup") {
            next();
            return;
          }
          if ((req.method ?? "GET").toUpperCase() !== "GET") {
            res.statusCode = 405;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("Method Not Allowed");
            return;
          }

          const host = String(
            req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:8080",
          );
          const proto = String(
            req.headers["x-forwarded-proto"] ??
              ((req.socket as { encrypted?: boolean } | undefined)?.encrypted ? "https" : "http"),
          );
          const requestHeaders = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const v of value) requestHeaders.append(key, v);
            } else {
              requestHeaders.set(key, value);
            }
          }
          // Ensure Host is the public preview host so Better Auth's dynamic
          // baseURL / redirect_uri match the popup origin.
          if (!requestHeaders.has("host")) requestHeaders.set("host", host);

          const request = new Request(`${proto}://${host}${rawUrl}`, {
            method: "GET",
            headers: requestHeaders,
          });

          const mod = (await server.ssrLoadModule("/src/lib/auth/popup.server.ts")) as {
            handleAuthPopupRequest: (req: Request) => Promise<Response>;
          };
          const response = await mod.handleAuthPopupRequest(request);

          res.statusCode = response.status;
          // Preserve multiple Set-Cookie headers (OAuth state + session).
          const setCookies =
            typeof response.headers.getSetCookie === "function"
              ? response.headers.getSetCookie()
              : [];
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() === "set-cookie") return;
            res.setHeader(key, value);
          });
          for (const cookie of setCookies) {
            res.appendHeader("set-cookie", cookie);
          }
          const body = Buffer.from(await response.arrayBuffer());
          res.end(body);
        } catch (err) {
          console.error("[app-builder] /auth/popup handler failed:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("auth popup failed");
          }
        }
      });
    },
  };
}

function phoneAuthPlugin(): Plugin {
  return {
    name: "app-builder:phone-auth",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          if (pathOnly !== "/api/auth/phone-login") {
            next();
            return;
          }

          if ((req.method ?? "GET").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Method Not Allowed" }));
            return;
          }

          let body = "";
          for await (const chunk of req) {
            body += chunk;
          }

          const { phone, otp } = JSON.parse(body || "{}");
          if (!phone || otp !== "111111") {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Invalid phone number or OTP. Enter OTP: 111111." }));
            return;
          }

          const { createClient } = await import("@supabase/supabase-js");
          const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://dyxqlgnbwtbxxdfoiqva.supabase.co";
          const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5eHFsZ25id3RieHhkZm9pcXZhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzA1Mjg3OCwiZXhwIjoyMTAyNjI4ODc4fQ.INa1hOmRJVNbj7TBGOqRpYEmT4oA9ij8MI_5M77vyG4";

          const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: { persistSession: false },
          });

          const cleanDigits = phone.replace(/\D/g, "");
          const { data: { users }, error: listErr } = await admin.auth.admin.listUsers();
          if (listErr) throw listErr;

          let user = users?.find((u) => {
            const metaPhone = u.user_metadata?.phone?.replace(/\D/g, "");
            const rawPhone = u.phone?.replace(/\D/g, "");
            return (
              (metaPhone && metaPhone.endsWith(cleanDigits)) ||
              (rawPhone && rawPhone.endsWith(cleanDigits))
            );
          });

          if (!user) {
            const email = `user-${cleanDigits}@users.katalist.invalid`;
            const { data: created, error: createErr } = await admin.auth.admin.createUser({
              email,
              email_confirm: true,
              user_metadata: {
                phone,
                display_name: "Katalist User",
                full_name: "Katalist User",
                uat_profile_complete: true,
              },
            });
            if (createErr) throw createErr;
            user = created.user;
          }

          const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
            type: "magiclink",
            email: user.email,
          });
          if (linkErr) throw linkErr;

          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({
            token_hash: linkData.properties.hashed_token,
            email: user.email,
          }));
        } catch (err: any) {
          console.error("[phone-auth] error:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: err?.message || "Authentication failed" }));
          }
        }
      });
    },
  };
}

function listMemberPlugin(): Plugin {
  return {
    name: "app-builder:list-members",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          if (
            pathOnly !== "/api/lists/add-member" &&
            pathOnly !== "/api/lists/change-role" &&
            pathOnly !== "/api/lists/remove-member"
          ) {
            next();
            return;
          }

          if ((req.method ?? "GET").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Method Not Allowed" }));
            return;
          }

          let bodyStr = "";
          for await (const chunk of req) {
            bodyStr += chunk;
          }
          const { listId, personId, role = "collaborator" } = JSON.parse(bodyStr || "{}");

          if (!listId || !personId) {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "listId and personId are required." }));
            return;
          }

          const { createClient } = await import("@supabase/supabase-js");
          const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://dyxqlgnbwtbxxdfoiqva.supabase.co";
          const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5eHFsZ25id3RieHhkZm9pcXZhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzA1Mjg3OCwiZXhwIjoyMTAyNjI4ODc4fQ.INa1hOmRJVNbj7TBGOqRpYEmT4oA9ij8MI_5M77vyG4";

          const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: { persistSession: false },
          });

          // Resolve personId to profileId
          let targetProfileId: string | null = null;
          const { data: actor } = await admin.from("actors").select("id, profile_id").eq("id", personId).maybeSingle();
          if (actor?.profile_id) targetProfileId = actor.profile_id;

          if (!targetProfileId) {
            const { data: prof } = await admin.from("profiles").select("id").eq("id", personId).maybeSingle();
            if (prof?.id) targetProfileId = prof.id;
          }

          if (!targetProfileId) {
            const { data: byName } = await admin.from("profiles").select("id").ilike("display_name", `%${personId}%`).limit(1);
            if (byName?.[0]?.id) targetProfileId = byName[0].id;
          }

          if (!targetProfileId) {
            const DEMO_PERSONAS: Record<string, string> = {
              priya: "Priya Sharma",
              arjun: "Arjun Mehta",
              sarah: "Sarah Kapoor",
              mike: "Mike Fernandes",
              neha: "Neha Rao",
              rahul: "Rahul Mehta",
              sai: "Sai",
            };
            const demoKey = personId.replace(/^p-/, "").toLowerCase();
            const demoName = DEMO_PERSONAS[demoKey] || Object.values(DEMO_PERSONAS).find((n) => n.toLowerCase().includes(demoKey));
            if (demoName) {
              const { data: demoProf } = await admin.from("profiles").select("id").ilike("display_name", demoName).maybeSingle();
              if (demoProf?.id) {
                targetProfileId = demoProf.id;
              } else {
                const email = `${demoName.toLowerCase().replace(/\s+/g, ".")}@users.katalist.invalid`;
                const { data: created } = await admin.auth.admin.createUser({
                  email,
                  email_confirm: true,
                  user_metadata: {
                    full_name: demoName,
                    display_name: demoName,
                    uat_profile_complete: true,
                  },
                });
                if (created?.user?.id) targetProfileId = created.user.id;
              }
            }
          }

          if (!targetProfileId) {
            res.statusCode = 404;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: `Could not resolve person "${personId}" to a team member profile.` }));
            return;
          }

          if (pathOnly === "/api/lists/add-member") {
            const { data: listData, error: listErr } = await admin.from("lists").select("id, owner_profile_id").eq("id", listId).single();
            if (listErr || !listData) {
              res.statusCode = 404;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: "List not found" }));
              return;
            }

            const { data: member, error: insertErr } = await admin.from("list_members").upsert(
              {
                list_id: listId,
                profile_id: targetProfileId,
                role,
                added_by_profile_id: listData.owner_profile_id,
              },
              { onConflict: "list_id,profile_id" }
            ).select().single();

            if (insertErr) {
              res.statusCode = 500;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: insertErr.message || "Failed to add list member" }));
              return;
            }

            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, member, profileId: targetProfileId }));
            return;
          }

          if (pathOnly === "/api/lists/change-role") {
            const { data: member, error: updateErr } = await admin.from("list_members").update({ role }).eq("list_id", listId).eq("profile_id", targetProfileId).select().single();
            if (updateErr) {
              res.statusCode = 500;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: updateErr.message || "Failed to update role" }));
              return;
            }
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, member }));
            return;
          }

          if (pathOnly === "/api/lists/remove-member") {
            const { error: deleteErr } = await admin.from("list_members").delete().eq("list_id", listId).eq("profile_id", targetProfileId);
            if (deleteErr) {
              res.statusCode = 500;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: deleteErr.message || "Failed to remove member" }));
              return;
            }
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true }));
            return;
          }
        } catch (err: any) {
          console.error("[list-members] error:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: err?.message || "Operation failed" }));
          }
        }
      });
    },
  };
}

// `0.0.0.0:8080` is the live-preview contract — don't change host/port.
// Keep `nitro` out of `vite dev`: enabled there it opens a second port and
// breaks the single-port live preview. Include it for `vite build` (Vercel /
// Netlify) AND `vite preview` — Nitro never emits dist/server/server.js, so
// Start's preview plugin cannot serve a Nitro build on its own.
// The dev server starts once `src/router.tsx` and `src/routes/` exist — see
// AGENTS.md § "First scaffold".
export default defineConfig(({ command, isPreview }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
  plugins: [
    pgliteBootstrapPlugin(),
    // Before tanstackStart so /auth/popup never falls through to the SPA.
    authPopupPlugin(),
    phoneAuthPlugin(),
    listMemberPlugin(),
    // PWA head + ?install=1 tutorial page; runs before Start/Nitro.
    grokPwaPlugin(),
    tailwindcss(),
    tanstackStart(),
    ...(command === "build" || isPreview
      ? [
          nitro({
            preset: process.env.NITRO_PRESET || (process.env.NETLIFY ? "netlify" : "vercel"),
            // Auto-registers server/middleware/* (the PWA install page +
            // manifest + head-tag middleware). Nitro v3 defaults serverDir to
            // false, so removing this silently unwires /?install=1 on deploys.
            serverDir: "./server",
          }),
        ]
      : []),
    viteReact(),
  ],
}));
