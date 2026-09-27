import "./dom-test-setup.mjs";
import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * H04: no blob: URL created by processFileForUpload/getSafeFileUrl was
 * ever revoked anywhere in the codebase (confirmed by grep -- only
 * lists.index.tsx's List-cover preview revoked its own, unrelated URLs).
 * This is the new registry that closes that gap for every other
 * consumer, without ever revoking a URL a caller didn't itself acquire
 * through this module.
 */
const {
  acquireBlobUrl,
  releaseBlobUrl,
  transferBlobUrlOwnership,
  releaseAllBlobUrlsForOwner,
  ownerCountForUrl,
} = await import("@/lib/owned-file-resources");

test("a single owner: acquire then release revokes exactly once", () => {
  const revoke = mock.method(URL, "revokeObjectURL", () => {});
  acquireBlobUrl("blob:one", "owner-a");
  assert.equal(ownerCountForUrl("blob:one"), 1);
  releaseBlobUrl("blob:one", "owner-a");
  assert.equal(revoke.mock.callCount(), 1);
  assert.equal(revoke.mock.calls[0].arguments[0], "blob:one");
  assert.equal(ownerCountForUrl("blob:one"), 0);
  revoke.mock.restore();
});

test("two owners of the same URL: the first release does not revoke while another owner remains", () => {
  const revoke = mock.method(URL, "revokeObjectURL", () => {});
  acquireBlobUrl("blob:two", "owner-a");
  acquireBlobUrl("blob:two", "owner-b");
  releaseBlobUrl("blob:two", "owner-a");
  assert.equal(revoke.mock.callCount(), 0, "another owner still holds this URL");
  releaseBlobUrl("blob:two", "owner-b");
  assert.equal(revoke.mock.callCount(), 1, "the last owner's release must revoke");
  revoke.mock.restore();
});

test("releasing a URL this registry never acquired is a silent no-op, never a revoke", () => {
  const revoke = mock.method(URL, "revokeObjectURL", () => {});
  releaseBlobUrl("blob:never-acquired", "owner-a");
  assert.equal(revoke.mock.callCount(), 0);
  revoke.mock.restore();
});

test("a remote/signed URL is never registered or revoked, even if release is called on it", () => {
  const revoke = mock.method(URL, "revokeObjectURL", () => {});
  acquireBlobUrl("https://storage.example/signed?sig=abc", "owner-a");
  releaseBlobUrl("https://storage.example/signed?sig=abc", "owner-a");
  assert.equal(revoke.mock.callCount(), 0, "only blob: URLs are ever tracked");
  revoke.mock.restore();
});

test("transferring ownership moves the acquisition without revoking, even with no other owners", () => {
  const revoke = mock.method(URL, "revokeObjectURL", () => {});
  acquireBlobUrl("blob:three", "composer");
  transferBlobUrlOwnership("composer", "retained-draft");
  assert.equal(revoke.mock.callCount(), 0, "a transfer must never revoke mid-handoff");
  assert.equal(ownerCountForUrl("blob:three"), 1);
  releaseBlobUrl("blob:three", "composer");
  assert.equal(revoke.mock.callCount(), 0, "the OLD owner key no longer holds it after transfer");
  releaseBlobUrl("blob:three", "retained-draft");
  assert.equal(revoke.mock.callCount(), 1, "the NEW owner's release must revoke it");
  revoke.mock.restore();
});

test("releaseAllBlobUrlsForOwner releases every URL that owner held, and only that owner's share", () => {
  const revoke = mock.method(URL, "revokeObjectURL", () => {});
  acquireBlobUrl("blob:four", "owner-a");
  acquireBlobUrl("blob:five", "owner-a");
  acquireBlobUrl("blob:five", "owner-b");
  releaseAllBlobUrlsForOwner("owner-a");
  assert.equal(revoke.mock.callCount(), 1, "blob:four had only owner-a and must be revoked");
  assert.equal(revoke.mock.calls[0].arguments[0], "blob:four");
  assert.equal(ownerCountForUrl("blob:five"), 1, "blob:five still has owner-b");
  revoke.mock.restore();
  releaseBlobUrl("blob:five", "owner-b");
});
