import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeAssignablePeople, memberToPerson } from "@/features/people/merge-people";
import { findCallProfile, isGenericName } from "@/features/calls/call-identity";
import { describeUploadError } from "@/lib/upload-errors";
import { parseToss } from "@/features/court/parse-toss";

const ajjju = { id: "actor-ajjju", actorId: "actor-ajjju", name: "Ajjju Reddy", initials: "AR" };
const member = (name, profileId) => memberToPerson({ name, profileId, initials: name.slice(0, 2).toUpperCase() });

test("every List member is selectable and a resolved actor id wins over a profile id", () => {
  const merged = mergeAssignablePeople([ajjju], [member("Ajjju Reddy", "profile-ajjju"), member("Nithesh Kumar", "profile-nithesh")]);
  assert.equal(merged.length, 2);
  const a = merged.find((p) => p.name === "Ajjju Reddy");
  assert.equal(a.id, "actor-ajjju");
  assert.equal(a.profileId, "profile-ajjju");
  assert.equal(a.listMember, true);
  assert.equal(merged.find((p) => p.name === "Nithesh Kumar").id, "profile-nithesh");
});

test("an @mention resolves to the actor id, not the duplicate profile-id entry", () => {
  const people = mergeAssignablePeople([ajjju], [member("Ajjju Reddy", "profile-ajjju")]);
  const result = parseToss("review deck @Ajjju", people);
  assert.deepEqual(result.assigneeIds, ["actor-ajjju"]);
  assert.equal(result.chips.some((c) => c.kind === "unresolved"), false);
});

test("placeholder names are not treated as real call identities", () => {
  assert.equal(isGenericName("Katalist User"), true);
  assert.equal(isGenericName(" someone "), true);
  assert.equal(isGenericName("Ajjju Reddy"), false);
  assert.equal(findCallProfile([{ id: "p1", display_name: "Ajjju", avatar_url: "a.png", email: null }], "p1")?.avatar_url, "a.png");
  assert.equal(findCallProfile([], "p1"), null);
});

test("upload failures keep their real cause", () => {
  assert.match(describeUploadError({ message: "new row violates row-level security policy", statusCode: "403" }), /permission/i);
  assert.match(describeUploadError({ message: "The object exceeded the maximum allowed size", statusCode: "413" }), /larger/i);
  assert.match(describeUploadError({ message: "Bucket not found" }), /storage is not set up/i);
  assert.match(describeUploadError({ message: "mime type application/x is not supported" }), /not supported/i);
  assert.equal(describeUploadError({ message: "Something specific" }), "Something specific");
  assert.equal(describeUploadError(null, "Fallback."), "Fallback.");
});
