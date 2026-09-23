import assert from "node:assert/strict";
import { test, mock } from "node:test";

/**
 * Batch C1: mapDbListRows' cover-URL signing, list_members query, and
 * things query are independent of each other (none needs another's
 * result — only the identity-resolution chain further down needs
 * `members`), but were awaited strictly in sequence. Same deterministic
 * event-order approach as the other C1 tests.
 */

const DELAY_MS = 5;

function delay(value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), DELAY_MS));
}

function makeTracker() {
  const events = [];
  return {
    events,
    track: (name, promiseFactory) => {
      events.push(`${name}:start`);
      return promiseFactory().then((value) => {
        events.push(`${name}:end`);
        return value;
      });
    },
  };
}

test("mapDbListRows runs cover signing, members, and Things concurrently", async () => {
  const { events, track } = makeTracker();

  const directoryMock = mock.module("@/features/people/directory", {
    namedExports: {
      fetchProfileIdentities: () => track("directory", () => delay([{ id: "owner-1", display_name: "Ada", avatar_url: null }])),
      matchAvatarByName: () => null,
    },
  });

  const chainable = (name, result) => {
    const node = {
      select: () => node,
      in: () => node,
      then: (resolve) => {
        track(name, () => delay(result)).then(resolve);
      },
    };
    return node;
  };
  const clientMock = mock.module("@/integrations/supabase/client", {
    namedExports: {
      supabase: {
        storage: {
          from: () => ({
            createSignedUrls: () => track("cover-sign", () => delay({ data: [] })),
          }),
        },
        from: (table) => {
          if (table === "list_members")
            return chainable("members-query", { data: [{ list_id: "list-1", profile_id: "owner-1", role: "owner" }], error: null });
          if (table === "things") return chainable("things-query", { data: [{ id: "t1", list_id: "list-1", work_status: "sorted" }], error: null });
          throw new Error(`unexpected table: ${table}`);
        },
      },
    },
  });

  try {
    const { mapDbListRows } = await import("@/features/lists/map-list-rows");
    const [row] = await mapDbListRows("owner-1", [
      {
        id: "list-1",
        name: "Groceries",
        context: "work",
        owner_profile_id: "owner-1",
        updated_at: new Date().toISOString(),
        description: null,
        cover_storage_path: null,
      },
    ]);

    // Deterministic concurrency proof: cover signing, members, and
    // Things all start before any of them resolves.
    const start = events.indexOf("members-query:start");
    const firstEnd = events.findIndex(
      (e, i) => i > start - 1 && (e === "members-query:end" || e === "things-query:end" || e === "cover-sign:end"),
    );
    const startedBeforeAnyEnded = new Set(events.slice(start, firstEnd).filter((e) => e.endsWith(":start")));
    assert.deepEqual(
      startedBeforeAnyEnded,
      new Set(["members-query:start", "things-query:start"]),
      `expected members and Things queries to start together; event order was: ${events.join(", ")}`,
    );
    // Directory resolution (part of the identity chain, which needs
    // `members`) must not start until members-query has resolved.
    assert.ok(
      events.indexOf("directory:start") > events.indexOf("members-query:end"),
      `expected identity resolution to wait for members-query; event order was: ${events.join(", ")}`,
    );

    // Output assertions.
    assert.equal(row.id, "list-1");
    assert.equal(row.thingCount, 1);
    assert.equal(row.doneCount, 1);
    assert.equal(row.ownerLine, "Owned by you");
  } finally {
    directoryMock.restore();
    clientMock.restore();
  }
});
