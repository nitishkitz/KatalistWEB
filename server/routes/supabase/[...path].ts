import { createError, defineEventHandler, getRequestURL, proxyRequest } from "h3";

/**
 * Same-origin pass-through to Supabase's HTTP APIs (auth, REST/RPC, storage,
 * edge functions). Some ISPs block or hijack DNS for *.supabase.co, so a
 * browser that calls Supabase directly cannot sign in at all; routing the
 * calls through the app's own domain avoids that. Only the four public API
 * prefixes are forwarded, and only to the configured project.
 */
const ALLOWED_PATH = /^\/(auth|rest|storage|functions)\/v1(\/|$)/;

export default defineEventHandler((event) => {
  const base = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!base) throw createError({ statusCode: 503, message: "Supabase is not configured." });

  const url = getRequestURL(event);
  const path = url.pathname.replace(/^\/supabase/, "");
  if (!ALLOWED_PATH.test(path)) throw createError({ statusCode: 404, message: "Not found." });

  const target = new URL(path + url.search, base);
  return proxyRequest(event, target.toString(), {
    // Cookies belong to the app's origin, never to Supabase.
    headers: { cookie: "" },
    fetchOptions: { redirect: "manual" },
  });
});
