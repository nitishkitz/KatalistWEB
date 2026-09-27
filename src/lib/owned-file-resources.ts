/**
 * H04: explicit, refcounted ownership for `blob:` URLs created by this
 * app's own `URL.createObjectURL` (via `processFileForUpload`/
 * `getSafeFileUrl` in `file-utils.ts`). Multiple owners can legitimately
 * hold the same URL at once -- e.g. a composer's live state and its
 * persisted session draft both reference the same attached file -- so a
 * URL is only actually revoked once its LAST owner releases it, never on
 * the first release while another owner still needs it.
 *
 * This registry only ever revokes a URL it itself acquired. It is not a
 * general-purpose blob tracker; a remote/signed URL passed to `release`
 * that was never `acquire`d is a silent no-op, never a revoke -- callers
 * cannot accidentally revoke a URL this module didn't create ownership
 * records for.
 */

const ownersByUrl = new Map<string, Set<string>>();

export function acquireBlobUrl(url: string | undefined | null, ownerKey: string): void {
  if (!url || !url.startsWith("blob:")) return;
  const owners = ownersByUrl.get(url) ?? new Set<string>();
  owners.add(ownerKey);
  ownersByUrl.set(url, owners);
}

export function releaseBlobUrl(url: string | undefined | null, ownerKey: string): void {
  if (!url || !url.startsWith("blob:")) return;
  const owners = ownersByUrl.get(url);
  if (!owners) return;
  owners.delete(ownerKey);
  if (owners.size === 0) {
    ownersByUrl.delete(url);
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Already revoked or otherwise invalid -- nothing further to do.
    }
  }
}

/** Moves every acquisition recorded under `fromOwnerKey` to `toOwnerKey`
 *  (e.g. a composer handing its in-flight attachments to a retained
 *  session draft on unmount) without any intermediate revoke, even for a
 *  URL with no other owners. */
export function transferBlobUrlOwnership(fromOwnerKey: string, toOwnerKey: string): void {
  for (const owners of ownersByUrl.values()) {
    if (owners.delete(fromOwnerKey)) owners.add(toOwnerKey);
  }
}

/** Releases every URL still held by `ownerKey` -- e.g. a composer instance
 *  unmounting without transferring ownership anywhere. */
export function releaseAllBlobUrlsForOwner(ownerKey: string): void {
  for (const url of [...ownersByUrl.keys()]) {
    releaseBlobUrl(url, ownerKey);
  }
}

/** Test/debug only: how many distinct owners currently hold `url`. */
export function ownerCountForUrl(url: string): number {
  return ownersByUrl.get(url)?.size ?? 0;
}
