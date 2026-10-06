/** Shapes a storage/network failure into a message a person can act on. */
export type UploadErrorLike = {
  message?: string;
  statusCode?: string | number;
  status?: number;
  error?: string;
  name?: string;
};

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function readStatus(err: UploadErrorLike): number | null {
  const raw = err.statusCode ?? err.status;
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Convert any thrown upload error into specific copy, preserving the cause
 * (permission, size, type, missing bucket, network) instead of a generic
 * "couldn't upload". `fallback` is only used when nothing more is known.
 */
export function describeUploadError(error: unknown, fallback = "The file could not be uploaded."): string {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  const err = error as UploadErrorLike;
  const status = readStatus(err);
  const message = (err.message ?? err.error ?? "").trim();
  const lower = message.toLowerCase();

  if (typeof navigator !== "undefined" && navigator.onLine === false) return "You appear to be offline. Reconnect and retry.";
  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("load failed")) {
    return "Network error while uploading. Check your connection and retry.";
  }
  if (status === 413 || lower.includes("exceeded the maximum allowed size") || lower.includes("payload too large")) {
    return "That file is larger than the allowed upload size.";
  }
  if (lower.includes("mime type") || lower.includes("not supported") || status === 415) {
    return "That file type is not supported.";
  }
  if (lower.includes("bucket not found")) return "File storage is not set up for this workspace. Contact support.";
  if (status === 401 || status === 403 || lower.includes("row-level security") || lower.includes("not authorized") || lower.includes("jwt")) {
    return "You do not have permission to upload here. Sign in again or ask the owner for access.";
  }
  if (lower.includes("already exists") || status === 409) return "A file with that name already exists. Rename it and retry.";
  return message || fallback;
}
