/** Resource kinds Katalist can embed. `deck` and `slides` are separate official routes. */
export type FigmaResourceKind = "design" | "figjam" | "prototype" | "slides" | "deck";

export type FigmaUrlErrorCode =
  | "empty"
  | "too_long"
  | "malformed"
  | "insecure_protocol"
  | "credentials_not_allowed"
  | "port_not_allowed"
  | "unsupported_host"
  | "unsupported_route"
  | "invalid_file_key"
  | "invalid_node_id"
  | "invalid_version_id"
  | "invalid_parameter";

export interface FigmaUrlError {
  code: FigmaUrlErrorCode;
  message: string;
}

export interface ParsedFigmaUrl {
  kind: FigmaResourceKind;
  /** Key used by Figma embeds. For branch links this is the branch key. */
  fileKey: string;
  /** Frame or page node in `1-2` form. */
  nodeId: string | null;
  /** Prototype flow starting point in `1-2` form (prototype links only). */
  startingPointNodeId: string | null;
  versionId: string | null;
  /** Page identifier; informational and only used for identity when no node is given. */
  pageId: string | null;
  /** Canonical figma.com link built from allowlisted parts, suitable for Open in Figma and copy. */
  normalizedUrl: string;
  /** Official embed.figma.com URL derived internally; never user supplied. */
  embedUrl: string;
  /** Node actually sent to the embed: the explicit node, or the page for page-only non-prototype links. */
  embedNodeId: string | null;
  /** False when the embed documentation does not list version-id for this kind. */
  embedHonorsVersion: boolean;
  /** Stable key for duplicate detection within a List; see figma-url.ts for the rule. */
  identityKey: string;
}

export type FigmaUrlResult = { ok: true; value: ParsedFigmaUrl } | { ok: false; error: FigmaUrlError };
