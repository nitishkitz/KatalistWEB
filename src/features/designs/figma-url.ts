import type { FigmaResourceKind, FigmaUrlErrorCode, FigmaUrlResult, ParsedFigmaUrl } from "./types";

/**
 * Figma URL contract (Stage 1).
 *
 * Accepts only https links on exact Figma hosts. Embed URLs are derived here from
 * allowlisted parts; no user-supplied query string or HTML is ever passed through.
 *
 * Identity rule (used for duplicate handling):
 *   `${kind}:${fileKey}:${nodeId}:${startingPointNodeId}:${versionId}` with empty
 *   strings for absent parts, plus `page=<pageId>` only when no node is given.
 * Ignored for identity: file-name slug, `t`/`mode`/tracking parameters, `1:2` vs `1-2`
 * node syntax, host variant (figma.com, www, embed), and legacy `/file/` vs `/design/`.
 * Different frames, prototype flows, or versions of one file yield different identities.
 *
 * File keys: Figma does not publish a key format, so validation is a safety rule, not a
 * format claim: 1-128 characters from [A-Za-z0-9_-]. This keeps the key path-safe and
 * bounded without rejecting legitimate keys by length.
 *
 * Page-only links: for Design, FigJam, Slides and deck embeds, `page-id` is sent to the
 * embed as `node-id` when no explicit node exists (Figma documents `node-id` as targeting
 * a page or frame). An explicit `node-id` always wins. Prototype embeds do not document
 * page targeting, so `page-id` is kept in the original link only and the embed opens the
 * prototype default.
 *
 * Compatibility limitation: only plain `N-N` / `N:N` node ids are supported. Nested or
 * instance ids (for example `I1:2;3:4`) are rejected with `invalid_node_id`; the target is
 * never silently dropped.
 */

const APPROVED_HOSTS = new Set(["figma.com", "www.figma.com", "embed.figma.com"]);
const EMBED_ORIGIN = "https://embed.figma.com";
const FIGMA_ORIGIN = "https://www.figma.com";
const EMBED_HOST_ID = "katalist";
const MAX_URL_LENGTH = 2048;

/** Route segment to resource kind. `file` is the legacy name for `design`. */
const ROUTES: Record<string, FigmaResourceKind> = {
  design: "design",
  file: "design",
  board: "figjam",
  proto: "prototype",
  slides: "slides",
  deck: "deck",
};

/** Path segment used on both www.figma.com and embed.figma.com. */
const KIND_PATH: Record<FigmaResourceKind, string> = {
  design: "design",
  figjam: "board",
  prototype: "proto",
  slides: "slides",
  deck: "deck",
};

const FILE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const NODE_ID_PATTERN = /^\d+[-:]\d+$/;
const VERSION_ID_PATTERN = /^\d{1,32}$/;
const PAGE_ID_PATTERN = /^\d+[-:]\d+$/;
const SCALING_VALUES = new Set(["scale-down", "contain", "min-zoom", "scale-down-width", "fit-width", "free"]);
const CONTENT_SCALING_VALUES = new Set(["fixed", "responsive"]);

function fail(code: FigmaUrlErrorCode, message: string): FigmaUrlResult {
  return { ok: false, error: { code, message } };
}

function normalizeNodeId(raw: string): string {
  return raw.replace(":", "-");
}

export function parseFigmaUrl(input: string): FigmaUrlResult {
  const trimmed = typeof input === "string" ? input.trim() : "";
  if (!trimmed) return fail("empty", "Enter a Figma link.");
  if (trimmed.length > MAX_URL_LENGTH) return fail("too_long", "This link is too long to be a Figma link.");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return fail("malformed", "This is not a valid link. Paste the full https link from Figma.");
  }

  if (url.protocol !== "https:") return fail("insecure_protocol", "Only https Figma links are supported.");
  if (url.username || url.password) return fail("credentials_not_allowed", "Links containing credentials are not accepted.");
  if (url.port) return fail("port_not_allowed", "Links with a custom port are not accepted.");
  if (!APPROVED_HOSTS.has(url.hostname)) return fail("unsupported_host", "Only links on figma.com are supported.");

  const segments = url.pathname.split("/").filter(Boolean);
  const kind = ROUTES[segments[0] ?? ""];
  if (!kind) {
    return fail(
      "unsupported_route",
      "This Figma link type is not supported. Use a Design, FigJam, prototype, Slides, or deck link.",
    );
  }

  // Branch links: /design/:mainKey/branch/:branchKey/:name. Embeds use the branch key.
  const isBranch = segments[2] === "branch";
  const fileKey = isBranch ? segments[3] : segments[1];
  if (!fileKey || !FILE_KEY_PATTERN.test(fileKey)) {
    return fail("invalid_file_key", "The file key in this link is missing or invalid.");
  }
  if (isBranch && !FILE_KEY_PATTERN.test(segments[1] ?? "")) {
    return fail("invalid_file_key", "The file key in this link is missing or invalid.");
  }

  const params = url.searchParams;

  const readNode = (name: string): string | null | undefined => {
    const raw = params.get(name);
    if (raw === null) return null;
    if (!NODE_ID_PATTERN.test(raw)) return undefined;
    return normalizeNodeId(raw);
  };

  const nodeId = readNode("node-id");
  if (nodeId === undefined) return fail("invalid_node_id", "The frame (node-id) in this link is not supported. Nested or instance targets cannot be embedded; copy the link to the enclosing frame.");

  let startingPointNodeId: string | null = null;
  if (kind === "prototype") {
    const start = readNode("starting-point-node-id");
    if (start === undefined) {
      return fail("invalid_node_id", "The prototype starting point in this link is not valid.");
    }
    startingPointNodeId = start;
  }

  const versionRaw = params.get("version-id");
  if (versionRaw !== null && !VERSION_ID_PATTERN.test(versionRaw)) {
    return fail("invalid_version_id", "The version in this link is not valid.");
  }
  const versionId = versionRaw;

  const pageRaw = params.get("page-id");
  if (pageRaw !== null && !PAGE_ID_PATTERN.test(pageRaw)) {
    return fail("invalid_parameter", "The page (page-id) in this link is not valid.");
  }
  const pageId = pageRaw === null ? null : normalizeNodeId(pageRaw);

  let scaling: string | null = null;
  let contentScaling: string | null = null;
  if (kind === "prototype") {
    scaling = params.get("scaling");
    if (scaling !== null && !SCALING_VALUES.has(scaling)) {
      return fail("invalid_parameter", "The prototype scaling option in this link is not supported.");
    }
    contentScaling = params.get("content-scaling");
    if (contentScaling !== null && !CONTENT_SCALING_VALUES.has(contentScaling)) {
      return fail("invalid_parameter", "The prototype content scaling option in this link is not supported.");
    }
  }

  const embedHonorsVersion = kind === "prototype";
  const path = `/${KIND_PATH[kind]}/${fileKey}`;

  // Original link for Open in Figma / copy: allowlisted parameters only, no file-name slug.
  const original = new URL(`${FIGMA_ORIGIN}${path}`);
  if (nodeId) original.searchParams.set("node-id", nodeId);
  if (pageId) original.searchParams.set("page-id", pageId);
  if (startingPointNodeId) original.searchParams.set("starting-point-node-id", startingPointNodeId);
  if (versionId) original.searchParams.set("version-id", versionId);
  if (scaling) original.searchParams.set("scaling", scaling);
  if (contentScaling) original.searchParams.set("content-scaling", contentScaling);

  // Embed link: only parameters documented for embeds, plus the host identifier.
  const embed = new URL(`${EMBED_ORIGIN}${path}`);
  const embedNodeId = nodeId ?? (kind === "prototype" ? null : pageId);
  if (embedNodeId) embed.searchParams.set("node-id", embedNodeId);
  if (startingPointNodeId) embed.searchParams.set("starting-point-node-id", startingPointNodeId);
  if (versionId && embedHonorsVersion) embed.searchParams.set("version-id", versionId);
  if (scaling) embed.searchParams.set("scaling", scaling);
  if (contentScaling) embed.searchParams.set("content-scaling", contentScaling);
  embed.searchParams.set("embed-host", EMBED_HOST_ID);

  const identityKey =
    `${kind}:${fileKey}:${nodeId ?? ""}:${startingPointNodeId ?? ""}:${versionId ?? ""}` +
    (!nodeId && pageId ? `:page=${pageId}` : "");

  const value: ParsedFigmaUrl = {
    kind,
    fileKey,
    nodeId,
    startingPointNodeId,
    versionId,
    pageId,
    normalizedUrl: original.toString(),
    embedUrl: embed.toString(),
    embedNodeId,
    embedHonorsVersion,
    identityKey,
  };
  return { ok: true, value };
}

/** Convenience for callers that only need to know whether a link is acceptable. */
export function isSupportedFigmaUrl(input: string): boolean {
  return parseFigmaUrl(input).ok;
}
