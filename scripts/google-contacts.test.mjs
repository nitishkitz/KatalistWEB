import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeContactPhone, normalizeGoogleContacts, readGoogleContacts, CONTACTS_SCOPE } from "../server/lib/contacts/google.ts";

test("Google contact matching normalizes phones/emails, drops duplicates and synthetic emails", () => {
  assert.equal(normalizeContactPhone("90000 00101"), "+919000000101");
  assert.equal(normalizeContactPhone("+1 (415) 555-0123"), "+14155550123");
  assert.equal(normalizeContactPhone("0044 7700 900123"), "+447700900123");
  assert.equal(normalizeContactPhone("1234"), null);
  const contacts = normalizeGoogleContacts([
    { resourceName: "people/test", names: [{ displayName: "Synthetic Person" }], emailAddresses: [{ value: "PERSON@EXAMPLE.TEST" }, { value: "person@example.test" }, { value: "user-123@users.katalist.invalid" }], phoneNumbers: [{ canonicalForm: "+919000000101" }, { value: "9000000101" }] },
    { resourceName: "people/test", emailAddresses: [{ value: "unrelated@example.test" }] },
    { names: [{ displayName: "Missing resource" }] },
  ]);
  assert.deepEqual(contacts, [{ resource: "people/test", name: "Synthetic Person", emails: ["person@example.test"], phones: ["+919000000101"] }]);
});

const config = { clientId: "synthetic-client", clientSecret: "synthetic-secret", origin: "https://example.test" };
const json = body => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
test("OAuth uses one-time server exchange and fetches every contact page with read-only scope", async () => {
  const calls = [];
  const result = await readGoogleContacts("synthetic-code", config, async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return json({ access_token: "synthetic-token", refresh_token: "not-retained", scope: CONTACTS_SCOPE });
    if (calls.length === 2) return json({ connections: [{ resourceName: "people/a", emailAddresses: [{ value: "a@example.test" }] }], nextPageToken: "second" });
    return json({ connections: [{ resourceName: "people/b", phoneNumbers: [{ value: "+447700900123" }] }] });
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].init.body.get("redirect_uri"), config.origin);
  assert.equal(calls[0].init.body.get("client_secret"), config.clientSecret);
  const first = new URL(calls[1].url), next = new URL(calls[2].url);
  assert.equal(first.searchParams.get("sources"), "READ_SOURCE_TYPE_CONTACT");
  assert.equal(next.searchParams.get("pageToken"), "second");
  assert.equal(calls[1].init.headers.Authorization, "Bearer synthetic-token");
  assert.equal(result.length, 2);
  assert(!JSON.stringify(result).includes("synthetic-token"));
});

test("declined permission, failed later page and repeated page token never produce a partial snapshot", async () => {
  await assert.rejects(readGoogleContacts("code", config, async () => json({ access_token: "token", scope: "openid" })), /read-only/);
  let count = 0;
  await assert.rejects(readGoogleContacts("code", config, async () => {
    count++;
    if (count === 1) return json({ access_token: "token", scope: CONTACTS_SCOPE });
    if (count === 2) return json({ connections: [{ resourceName: "people/a" }], nextPageToken: "next" });
    return new Response("private-google-error", { status: 403 });
  }), /denied or expired/);
  count = 0;
  await assert.rejects(readGoogleContacts("code", config, async () => {
    if (++count === 1) return json({ access_token: "token", scope: CONTACTS_SCOPE });
    return json({ connections: [], nextPageToken: "repeat" });
  }), /previous contacts were kept/);
});
