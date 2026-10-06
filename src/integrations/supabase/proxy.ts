/**
 * Same-origin proxy for Supabase HTTP traffic (see server/routes/supabase).
 * Enabled in production browsers only; set VITE_SUPABASE_PROXY=false to turn
 * it off. Realtime websockets are not proxied (Vercel functions cannot hold
 * a websocket), so they still connect to Supabase directly.
 */
const PROXIED_PATH = /^\/(auth|rest|storage|functions)\/v1(\/|$)/;
/** Vercel functions reject request bodies above ~4.5 MB; send those direct. */
const MAX_PROXIED_BODY_BYTES = 4_000_000;

export function supabaseProxyBase(): string | null {
  if (typeof window === "undefined") return null;
  const env = import.meta.env as Record<string, string | boolean | undefined>;
  if (!env.PROD || env.VITE_SUPABASE_PROXY === "false") return null;
  return `${window.location.origin}/supabase`;
}

/** Rewrite one Supabase API URL to the same-origin proxy; anything else is returned unchanged. */
export function toProxiedUrl(url: string, supabaseUrl: string, proxyBase = supabaseProxyBase()): string {
  if (!proxyBase || !url) return url;
  try {
    const target = new URL(url);
    const origin = new URL(supabaseUrl).origin;
    if (target.origin !== origin || !PROXIED_PATH.test(target.pathname)) return url;
    return `${proxyBase}${target.pathname}${target.search}${target.hash}`;
  } catch {
    return url;
  }
}

function bodySize(body: BodyInit | null | undefined): number {
  if (!body) return 0;
  if (typeof body === "string") return body.length;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof FormData) {
    let total = 0;
    body.forEach((value) => {
      total += typeof value === "string" ? value.length : value.size;
    });
    return total;
  }
  return 0;
}

/** Wrap a fetch so Supabase API calls go through the proxy (large uploads stay direct). */
export function withSupabaseProxy(baseFetch: typeof fetch, supabaseUrl: string): typeof fetch {
  const proxyBase = supabaseProxyBase();
  if (!proxyBase) return baseFetch;
  return (input, init) => {
    if (bodySize(init?.body) > MAX_PROXIED_BODY_BYTES) return baseFetch(input, init);
    if (typeof input === "string") return baseFetch(toProxiedUrl(input, supabaseUrl, proxyBase), init);
    if (input instanceof URL) return baseFetch(toProxiedUrl(input.toString(), supabaseUrl, proxyBase), init);
    const rewritten = toProxiedUrl(input.url, supabaseUrl, proxyBase);
    return baseFetch(rewritten === input.url ? input : new Request(rewritten, input), init);
  };
}

type StorageApi = {
  createSignedUrl: (...args: never[]) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;
  createSignedUrls: (...args: never[]) => Promise<{ data: Array<{ signedUrl: string | null }> | null; error: unknown }>;
  getPublicUrl: (...args: never[]) => { data: { publicUrl: string } };
};

/**
 * Signed and public storage URLs are handed to <img>/<video>/<a> and fetched by
 * the browser directly, so they must point at the proxy too.
 */
export function patchStorageUrls(client: { storage: { from: (bucket: string) => unknown } }, supabaseUrl: string) {
  if (!supabaseProxyBase()) return;
  const rewrite = (value: string) => toProxiedUrl(value, supabaseUrl);
  const originalFrom = client.storage.from.bind(client.storage);
  client.storage.from = (bucket: string) => {
    const api = originalFrom(bucket) as StorageApi;
    const signOne = api.createSignedUrl.bind(api);
    const signMany = api.createSignedUrls.bind(api);
    const publicUrl = api.getPublicUrl.bind(api);
    api.createSignedUrl = (async (...args: never[]) => {
      const res = await signOne(...args);
      if (res.data?.signedUrl) res.data.signedUrl = rewrite(res.data.signedUrl);
      return res;
    }) as StorageApi["createSignedUrl"];
    api.createSignedUrls = (async (...args: never[]) => {
      const res = await signMany(...args);
      for (const entry of res.data ?? []) if (entry.signedUrl) entry.signedUrl = rewrite(entry.signedUrl);
      return res;
    }) as StorageApi["createSignedUrls"];
    api.getPublicUrl = ((...args: never[]) => {
      const res = publicUrl(...args);
      res.data.publicUrl = rewrite(res.data.publicUrl);
      return res;
    }) as StorageApi["getPublicUrl"];
    return api;
  };
}
