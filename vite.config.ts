import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { grokPwaPlugin } from "./scripts/grok-pwa-plugin.mjs";
import { getSupabaseAdmin } from "./server/lib/supabase-admin.ts";
import { resolvePersonToProfileId } from "./server/lib/resolve-person.ts";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Dev-middleware equivalent of server/lib/require-user.ts. Vite middleware
 * gets a raw Node req, not an H3Event, so this reads the Authorization
 * header directly instead of sharing that helper.
 */
async function requireUserFromReq(req: import("node:http").IncomingMessage) {
  const authHeader = req.headers["authorization"];
  const token = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;
  if (!token) return null;

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) return null;

  const client = createSupabaseClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;

  return { userId: data.user.id, client };
}

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

          const admin = getSupabaseAdmin();

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
              },
            });
            if (createErr) throw createErr;
            user = created.user;
          }

          const userEmail = user.email || `user-${cleanDigits}@users.katalist.invalid`;
          const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
            type: "magiclink",
            email: userEmail,
          });
          if (linkErr) throw linkErr;

          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({
            token_hash: linkData.properties.hashed_token,
            email: userEmail,
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

const DEMO_PERSONAS: Record<string, string> = {
  priya: "Priya Sharma",
  arjun: "Arjun Mehta",
  sarah: "Sarah Kapoor",
  mike: "Mike Fernandes",
  neha: "Neha Rao",
  rahul: "Rahul Mehta",
  sai: "Sai",
};

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
            pathOnly !== "/api/lists/remove-member" &&
            pathOnly !== "/api/people/directory" &&
            pathOnly !== "/api/buckets/add-item"
          ) {
            next();
            return;
          }

          const auth = await requireUserFromReq(req);
          if (!auth) {
            res.statusCode = 401;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Authentication required." }));
            return;
          }
          const { client } = auth;

          if (pathOnly === "/api/people/directory") {
            // Cross-user directory: profiles/actors RLS is "own row only",
            // so this deliberately uses the admin client - gated on the
            // auth check above rather than reachable anonymously.
            const admin = getSupabaseAdmin();
            const [{ data: profiles }, { data: actors }] = await Promise.all([
              admin.from("profiles").select("id, email, display_name, avatar_url"),
              admin.from("actors").select("id, profile_id, kind"),
            ]);

            const actorByProfile = new Map<string, string>();
            for (const a of actors ?? []) {
              if (a.profile_id) actorByProfile.set(a.profile_id, a.id);
            }

            const list = (profiles ?? []).map((p) => ({
              id: p.id,
              profile_id: p.id,
              actor_id: actorByProfile.get(p.id) || p.id,
              email: p.email,
              display_name: p.display_name && p.display_name !== "Someone" ? p.display_name : "Katalist User",
              avatar_url: p.avatar_url,
            }));

            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, people: list }));
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
          const body = JSON.parse(bodyStr || "{}");

          if (pathOnly === "/api/buckets/add-item") {
            const { bucketId, thingId, listId: reqListId } = body || {};
            if (!bucketId || (!thingId && !reqListId)) {
              res.statusCode = 400;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: "bucketId and either thingId or listId are required." }));
              return;
            }

            // add_to_bucket enforces bucket ownership and viewer permission
            // on the referenced Thing/List, and is already idempotent.
            const { data: inserted, error: rpcErr } = await client.rpc("add_to_bucket", {
              p_bucket_id: bucketId,
              p_thing_id: thingId || null,
              p_list_id: reqListId || null,
            });

            if (rpcErr) {
              res.statusCode = 403;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: rpcErr.message || "Failed to add item to bucket" }));
              return;
            }

            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, data: inserted }));
            return;
          }

          const { listId, personId, role = "collaborator" } = body || {};

          if (!listId || !personId) {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "listId and personId are required." }));
            return;
          }

          let targetProfileId = await resolvePersonToProfileId(client, personId);

          // Demo personas are shared fixtures, not private profiles - look
          // them up via admin, since profiles RLS ("own row only") would
          // otherwise hide an already-provisioned persona from every user
          // except whoever happened to create it first.
          if (!targetProfileId && pathOnly === "/api/lists/add-member") {
            const demoKey = personId.replace(/^p-/, "").toLowerCase();
            const demoName = DEMO_PERSONAS[demoKey] || Object.values(DEMO_PERSONAS).find((n) => n.toLowerCase().includes(demoKey));
            if (demoName) {
              const admin = getSupabaseAdmin();
              const { data: demoProf } = await admin.from("profiles").select("id").ilike("display_name", demoName).maybeSingle();
              if (demoProf?.id) {
                targetProfileId = demoProf.id;
              } else {
                const email = `${demoName.toLowerCase().replace(/\s+/g, ".")}@users.katalist.invalid`;
                const { data: created, error: createErr } = await admin.auth.admin.createUser({
                  email,
                  email_confirm: true,
                  user_metadata: {
                    full_name: demoName,
                    display_name: demoName,
                  },
                });
                if (createErr) {
                  res.statusCode = 500;
                  res.setHeader("content-type", "application/json");
                  res.end(JSON.stringify({ error: createErr.message }));
                  return;
                }
                targetProfileId = created?.user?.id ?? null;
              }
            }
          }

          if (!targetProfileId) {
            res.statusCode = 404;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: `Could not resolve person "${personId}" to a team member profile.` }));
            return;
          }

          // Every membership write below is delegated to the secured RPC,
          // which enforces "only the List Owner" via auth.uid() itself.
          if (pathOnly === "/api/lists/add-member") {
            const { data: member, error: rpcErr } = await client.rpc("add_list_member", {
              p_list_id: listId,
              p_profile_id: targetProfileId,
              p_role: role,
            });

            if (rpcErr) {
              res.statusCode = 403;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: rpcErr.message || "Failed to add list member" }));
              return;
            }

            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, member, profileId: targetProfileId }));
            return;
          }

          if (pathOnly === "/api/lists/change-role") {
            const { data: member, error: rpcErr } = await client.rpc("change_list_role", {
              p_list_id: listId,
              p_profile_id: targetProfileId,
              p_role: role,
            });
            if (rpcErr) {
              res.statusCode = 403;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: rpcErr.message || "Failed to update role" }));
              return;
            }
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, member }));
            return;
          }

          if (pathOnly === "/api/lists/remove-member") {
            const { data: removed, error: rpcErr } = await client.rpc("remove_list_member", {
              p_list_id: listId,
              p_profile_id: targetProfileId,
            });
            if (rpcErr) {
              res.statusCode = 403;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: rpcErr.message || "Failed to remove member" }));
              return;
            }
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, removed }));
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

function thingsReopenPlugin(): Plugin {
  return {
    name: "app-builder:things-reopen",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          if (pathOnly !== "/api/things/reopen") {
            next();
            return;
          }
          if ((req.method ?? "GET").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Method Not Allowed" }));
            return;
          }

          const auth = await requireUserFromReq(req);
          if (!auth) {
            res.statusCode = 401;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Authentication required." }));
            return;
          }
          const { client, userId } = auth;

          let bodyStr = "";
          for await (const chunk of req) {
            bodyStr += chunk;
          }
          const { thingId } = JSON.parse(bodyStr || "{}");
          if (!thingId) {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "thingId is required." }));
            return;
          }

          // things has no UPDATE RLS policy - every mutation goes through a
          // SECURITY DEFINER RPC that checks ownership internally. No reopen
          // RPC exists yet, so the check happens here before falling back to
          // the admin client for the write itself.
          const { data: actorRow } = await client
            .from("actors")
            .select("id")
            .eq("profile_id", userId)
            .eq("kind", "user")
            .maybeSingle();

          if (!actorRow) {
            res.statusCode = 403;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Could not resolve caller identity." }));
            return;
          }

          const { data: thing } = await client
            .from("things")
            .select("id, owner_actor_id, work_status")
            .eq("id", thingId)
            .maybeSingle();

          if (!thing) {
            res.statusCode = 404;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Thing not found." }));
            return;
          }
          if (thing.owner_actor_id !== actorRow.id) {
            res.statusCode = 403;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Only the Thing Owner can reopen it." }));
            return;
          }
          if (thing.work_status !== "cancelled") {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Only a Cancelled Thing can be reopened." }));
            return;
          }

          const admin = getSupabaseAdmin();
          const { data, error } = await admin
            .from("things")
            .update({
              work_status: "not_started",
              cancelled_at: null,
              acknowledgement: "waiting_for_catch",
              updated_at: new Date().toISOString(),
            })
            .eq("id", thingId)
            .select()
            .single();

          if (error) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: error.message }));
            return;
          }

          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: true, thing: data }));
        } catch (err: any) {
          console.error("[things-reopen] error:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: err?.message || "Reopen failed" }));
          }
        }
      });
    },
  };
}

const ATTACHMENTS_BUCKET = "thing-attachments";

function completeAttachmentPlugin(): Plugin {
  return {
    name: "app-builder:complete-attachment",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          if (pathOnly !== "/api/things/complete-attachment") {
            next();
            return;
          }
          if ((req.method ?? "GET").toUpperCase() !== "POST") {
            res.statusCode = 405;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Method Not Allowed" }));
            return;
          }

          const auth = await requireUserFromReq(req);
          if (!auth) {
            res.statusCode = 401;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Authentication required." }));
            return;
          }
          const { client, userId } = auth;

          let bodyStr = "";
          for await (const chunk of req) {
            bodyStr += chunk;
          }
          const { attachmentId, stagingKey, storageKey } = JSON.parse(bodyStr || "{}");
          if (!attachmentId || !stagingKey || !storageKey) {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "attachmentId, stagingKey and storageKey are required." }));
            return;
          }

          const { data: actorRow } = await client
            .from("actors")
            .select("id")
            .eq("profile_id", userId)
            .eq("kind", "user")
            .maybeSingle();
          if (!actorRow) {
            res.statusCode = 403;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Could not resolve caller identity." }));
            return;
          }

          const admin = getSupabaseAdmin();
          const { data: attachment, error: fetchErr } = await admin
            .from("thing_attachments")
            .select("id, uploaded_by_actor_id, staging_key, storage_key, status")
            .eq("id", attachmentId)
            .maybeSingle();

          if (fetchErr || !attachment) {
            res.statusCode = 404;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Attachment not found." }));
            return;
          }
          if (attachment.uploaded_by_actor_id !== actorRow.id) {
            res.statusCode = 403;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "You did not upload this attachment." }));
            return;
          }
          if (attachment.staging_key !== stagingKey || attachment.storage_key !== storageKey) {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Staging/storage key mismatch." }));
            return;
          }

          if (attachment.status !== "pending") {
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, attachment }));
            return;
          }

          const { error: moveErr } = await admin.storage.from(ATTACHMENTS_BUCKET).move(stagingKey, storageKey);
          if (moveErr) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: moveErr.message || "Failed to move attachment into place." }));
            return;
          }

          const { data: completed, error: completeErr } = await client.rpc("complete_thing_attachment", {
            p_attachment_id: attachmentId,
            p_storage_key: storageKey,
          });
          if (completeErr) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: completeErr.message || "Failed to finalize attachment." }));
            return;
          }

          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ ok: true, attachment: completed }));
        } catch (err: any) {
          console.error("[complete-attachment] error:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: err?.message || "Failed to finalize attachment" }));
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
    thingsReopenPlugin(),
    completeAttachmentPlugin(),
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
