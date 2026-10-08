import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DESIGN_MAX_PAGE_SIZE,
  DESIGN_PAGE_SIZE,
  buildDesignCursorFilter,
  clampDesignPageSize,
  designKeys,
  nextDesignCursor,
  normalizeDesignTags,
  toDesignError,
} from "@/features/designs/design-queries";
import { deriveDesignEmbed, mapDesignResource } from "@/features/designs/records";

const ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const KEY = "AbCdEf1234567890xyZ123";

test("page size is always bounded", () => {
  assert.equal(clampDesignPageSize(undefined), DESIGN_PAGE_SIZE);
  assert.equal(clampDesignPageSize(Number.NaN), DESIGN_PAGE_SIZE);
  assert.equal(clampDesignPageSize(0), 1);
  assert.equal(clampDesignPageSize(10_000), DESIGN_MAX_PAGE_SIZE);
});

test("cursor filter quotes timestamps and rejects injected values", () => {
  const filter = buildDesignCursorFilter({ createdAt: "2026-10-08T12:00:00.123456+00:00", id: ID });
  assert.equal(
    filter,
    `created_at.lt."2026-10-08T12:00:00.123456+00:00",and(created_at.eq."2026-10-08T12:00:00.123456+00:00",id.lt.${ID})`,
  );
  assert.throws(() => buildDesignCursorFilter({ createdAt: '2026"),archived_at.is.null,or(x.eq."', id: ID }), /Invalid design page cursor/);
  assert.throws(() => buildDesignCursorFilter({ createdAt: "2026-10-08T12:00:00Z", id: `${ID},list_id.not.is.null` }), /Invalid design page cursor/);
});

test("next cursor exists only after a full page", () => {
  const rows = [
    { created_at: "2026-10-08T12:00:00Z", id: ID },
    { created_at: "2026-10-07T12:00:00Z", id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
  ];
  assert.equal(nextDesignCursor(rows, 3), undefined);
  assert.deepEqual(nextDesignCursor(rows, 2), { createdAt: "2026-10-07T12:00:00Z", id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" });
  assert.equal(nextDesignCursor([], 0), undefined);
});

test("query keys are scoped by List, filter and (for favorites) member", () => {
  const a = designKeys.resources("L1", { archived: false, folder: "all" });
  assert.deepEqual(a.slice(0, 3), ["designs", "L1", "resources"]);
  assert.notDeepEqual(a, designKeys.resources("L1", { archived: true, folder: "all" }));
  assert.notDeepEqual(a, designKeys.resources("L2", { archived: false, folder: "all" }));
  assert.notDeepEqual(designKeys.favorites("L1", "p1"), designKeys.favorites("L1", "p2"));
  // Invalidating a List's resources prefix covers every filter variant of that List only.
  const prefix = designKeys.resourcesPrefix("L1");
  assert.deepEqual(a.slice(0, prefix.length), [...prefix]);
  assert.notDeepEqual(designKeys.resources("L2").slice(0, prefix.length), [...prefix]);
});

test("database errors map to typed codes", () => {
  assert.equal(toDesignError({ message: "m", hint: "duplicate_design", code: "23505", details: ID }).existingId, ID);
  assert.equal(toDesignError({ message: "m", hint: "duplicate_design", code: "23505" }).code, "duplicate_design");
  assert.equal(toDesignError({ message: "m", hint: "unsupported_host", code: "22023" }).code, "unsupported_host");
  assert.equal(toDesignError({ message: "m", code: "42501" }).code, "forbidden");
  assert.equal(toDesignError({ message: "m", code: "P0002" }).code, "not_found");
  assert.equal(toDesignError({ message: "m", code: "28000" }).code, "not_authenticated");
  assert.equal(toDesignError({ message: "m", code: "23503" }).code, "cross_list");
  assert.equal(toDesignError({ message: "m", hint: "owner_not_member", code: "23514" }).code, "owner_not_member");
  assert.equal(toDesignError({ message: "m", hint: "something-else" }).code, "unknown");
  assert.equal(toDesignError(null).code, "unknown");
});

test("tag normalization matches the database rule", () => {
  assert.deepEqual(normalizeDesignTags(["Web", " web ", "Mobile", ""]), ["Web", "Mobile"]);
});

test("embeds are derived from the stored link, never stored", () => {
  const row = {
    id: ID, list_id: ID, kind: "design", file_key: KEY, node_id: "1-2", starting_point_node_id: null, version_id: null,
    page_id: null, identity_key: `design:${KEY}:1-2::`, original_url: `https://www.figma.com/design/${KEY}?node-id=1-2`,
    title: "t", notes: null, tags: null, owner_profile_id: null, folder_id: null, cover_storage_key: null,
    created_by: null, created_at: "2026-10-08T12:00:00Z", updated_at: "2026-10-08T12:00:00Z", archived_at: null,
  };
  const resource = mapDesignResource(row);
  assert.deepEqual(resource.tags, []);
  const embed = deriveDesignEmbed(resource);
  assert.equal(embed.ok, true);
  assert.equal(embed.value.embedUrl, `https://embed.figma.com/design/${KEY}?node-id=1-2&embed-host=katalist`);
  // A tampered stored value does not yield an iframe source.
  assert.equal(deriveDesignEmbed({ originalUrl: "https://evil.com/design/x" }).ok, false);
});
