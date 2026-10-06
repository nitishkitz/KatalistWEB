import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { createError, defineEventHandler, getQuery, setHeader } from "h3";
import { requireUser } from "../lib/require-user";
import { isPrivateAddress, parseLinkPreview, parsePreviewTarget, type LinkPreview } from "../lib/link-preview";

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;

type CacheEntry = { at: number; preview: LinkPreview | null };
const cache = new Map<string, CacheEntry>();

/**
 * DNS lookup that refuses private/internal answers. Validating inside the
 * socket's own lookup (rather than resolving first and fetching later)
 * closes the DNS-rebinding window between "check" and "connect".
 */
const safeLookup: typeof dns.lookup = ((hostname: string, options: unknown, callback: unknown) => {
  const cb = (typeof options === "function" ? options : callback) as (
    err: NodeJS.ErrnoException | null,
    address?: string | dns.LookupAddress[],
    family?: number,
  ) => void;
  const opts = (typeof options === "function" ? {} : options) as dns.LookupOptions;
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return cb(Object.assign(new Error("Blocked address"), { code: "EBLOCKED" }) as NodeJS.ErrnoException);
    }
    if (opts.all) return cb(null, list);
    cb(null, list[0]!.address, list[0]!.family);
  });
}) as typeof dns.lookup;

type Fetched = { status: number; location?: string; contentType: string; body: string };

function fetchOnce(url: URL): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: {
          "user-agent": "KatalistLinkPreview/1.0 (+https://katalist.app)",
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "accept-encoding": "identity",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : undefined;
        const contentType = String(res.headers["content-type"] ?? "").toLowerCase();
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location, contentType, body: "" });
        }
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
          res.resume();
          return resolve({ status, contentType, body: "" });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            chunks.push(chunk.subarray(0, chunk.length - (size - MAX_BYTES)));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        const finish = () => resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") });
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Timed out")));
    req.on("error", reject);
    req.end();
  });
}

async function buildPreview(start: URL): Promise<LinkPreview | null> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchOnce(current);
    if (res.status >= 300 && res.status < 400 && res.location) {
      // Every redirect target goes through the same shape + address checks.
      const next = parsePreviewTarget(new URL(res.location, current).toString());
      if (!next) return null;
      current = next;
      continue;
    }
    if (res.status < 200 || res.status >= 300 || !res.body) return null;
    return parseLinkPreview(res.body, current);
  }
  return null;
}

export default defineEventHandler(async (event) => {
  await requireUser(event);
  const raw = String(getQuery(event).url ?? "");
  const target = parsePreviewTarget(raw);
  if (!target) throw createError({ statusCode: 400, message: "That link cannot be previewed." });

  const key = target.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    setHeader(event, "cache-control", "private, max-age=3600");
    return { ok: true, preview: hit.preview };
  }

  let preview: LinkPreview | null = null;
  try {
    preview = await buildPreview(target);
  } catch {
    preview = null; // unreachable or blocked: the client falls back to a plain link
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), preview });
  setHeader(event, "cache-control", "private, max-age=3600");
  return { ok: true, preview };
});
