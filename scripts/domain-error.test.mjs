import assert from "node:assert/strict";
import { test } from "node:test";
import { domainErrorMessage, isNetworkError } from "@/lib/domain-error";

test("transport failures show the connection message", () => {
  const error = new TypeError("Failed to fetch");
  assert.equal(isNetworkError(error), true);
  assert.equal(domainErrorMessage(error), "Couldn’t reach Katalist. Try again.");
});

test("domain failures beginning with Failed to keep their actual message", () => {
  const error = { message: "Failed to set pace because this Thing has not been caught" };
  assert.equal(isNetworkError(error), false);
  assert.equal(domainErrorMessage(error), error.message);
});

test("duplicate bucket names explain the account-wide name conflict without database details", () => {
  for (const error of [
    { code: "23505", message: 'duplicate key value violates unique constraint "buckets_owner_profile_id_name_key"' },
    new Error('duplicate key value violates unique constraint "buckets_owner_profile_id_name_key"'),
  ]) {
    assert.equal(domainErrorMessage(error), "You already have a bucket with this name in Work or Home. Choose a different name.");
  }
});
