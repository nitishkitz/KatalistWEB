import { DesignOperationError } from "./design-queries";

/** Manual cover images for designs: validation, storage keys, and replace/remove with recovery. */

export const COVER_BUCKET = "design-covers";
export const COVER_MAX_BYTES = 5 * 1024 * 1024;
export const COVER_SIGNED_URL_SECONDS = 3600;
export const COVER_SIGN_BATCH_LIMIT = 100;

const ACCEPTED: Record<string, { ext: string; mime: string }> = {
  "image/png": { ext: "png", mime: "image/png" },
  "image/jpeg": { ext: "jpg", mime: "image/jpeg" },
  "image/webp": { ext: "webp", mime: "image/webp" },
};
export const COVER_ACCEPT = Object.keys(ACCEPTED).join(",");

export type CoverValidation = { ok: true; ext: string; mime: string } | { ok: false; message: string };

function sniffImage(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Checks size, declared type and the file's real signature. A renamed non-image, an
 * unsupported format (GIF, SVG, HEIC) or an empty/oversized file is refused before upload.
 * The bucket enforces the same limits again on the server.
 */
export function validateCoverFile(file: { name: string; size: number; type: string }, head: Uint8Array): CoverValidation {
  if (file.size <= 0) return { ok: false, message: `${file.name} is empty.` };
  if (file.size > COVER_MAX_BYTES) return { ok: false, message: `${file.name} is larger than 5 MB. Choose a smaller image.` };
  const declared = ACCEPTED[file.type];
  if (!declared) return { ok: false, message: "Use a PNG, JPEG or WebP image." };
  const actual = sniffImage(head);
  if (!actual) return { ok: false, message: `${file.name} does not look like a PNG, JPEG or WebP image.` };
  if (actual !== file.type) return { ok: false, message: `${file.name} is not really a ${declared.ext.toUpperCase()} image.` };
  return { ok: true, ext: declared.ext, mime: declared.mime };
}

/** `{list}/{design}/{uuid}.{ext}`: a fresh name per upload, so a replacement never overwrites. */
export function coverStorageKey(listId: string, resourceId: string, uniqueId: string, ext: string): string {
  return `${listId}/${resourceId}/${uniqueId}.${ext}`;
}

export type CoverDeps = {
  upload(key: string, file: Blob, contentType: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
  setCover(resourceId: string, key: string): Promise<string | null>;
  clearCover(resourceId: string): Promise<string | null>;
  newId(): string;
};

export type CoverOutcome = {
  /** True when the replaced object could not be deleted and may remain in storage. */
  orphanedKey: string | null;
};

/**
 * Upload, then point the design at the new object, then delete the replaced one.
 *  - Upload fails: nothing changed.
 *  - Association fails: the just-uploaded object is deleted (best effort) and the error is thrown,
 *    so the design keeps its previous cover and the caller never reports success.
 *  - Deleting the replaced object fails: the new cover is already in effect; the old key is returned
 *    as `orphanedKey` instead of failing the whole operation.
 */
export async function replaceDesignCover(
  input: { listId: string; resourceId: string; file: File; head: Uint8Array },
  deps: CoverDeps,
): Promise<CoverOutcome> {
  const check = validateCoverFile(input.file, input.head);
  if (!check.ok) throw new DesignOperationError("invalid_input", check.message);
  const key = coverStorageKey(input.listId, input.resourceId, deps.newId(), check.ext);
  await deps.upload(key, input.file, check.mime);
  let previous: string | null;
  try {
    previous = await deps.setCover(input.resourceId, key);
  } catch (error) {
    await deps.remove([key]).catch(() => {});
    throw error;
  }
  if (!previous) return { orphanedKey: null };
  try {
    await deps.remove([previous]);
    return { orphanedKey: null };
  } catch {
    return { orphanedKey: previous };
  }
}

export async function removeDesignCover(resourceId: string, deps: CoverDeps): Promise<CoverOutcome> {
  const previous = await deps.clearCover(resourceId);
  if (!previous) return { orphanedKey: null };
  try {
    await deps.remove([previous]);
    return { orphanedKey: null };
  } catch {
    return { orphanedKey: previous };
  }
}

/** First bytes of a file, for signature checks (FileReader fallback for older runtimes). */
export async function readFileHead(file: Blob): Promise<Uint8Array> {
  const slice = file.slice(0, 16);
  if (typeof slice.arrayBuffer === "function") return new Uint8Array(await slice.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image."));
    reader.readAsArrayBuffer(slice);
  });
}
