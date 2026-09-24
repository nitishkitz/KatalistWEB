import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement as h, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/features/people/directory", { namedExports: { useAvatarUrl: () => null, matchAvatarByName: () => null } });

const { ThingStackCard } = await import("@/features/court/ThingStackCard");

test("a Court overview PDF is a lightweight file tile; opening detail owns rendering", () => {
  const person = { id: "actor-1", name: "Ada", initials: "A" };
  const thing = {
    id: "thing-1", title: "Review report", creator: person, owner: person, assignee: person,
    acknowledgement: "caught", workStatus: "under_progress", ownerImportance: "next", personalPace: "next",
    dueAt: null, dueHasTime: false, context: "work", listId: null, listName: null,
    cancelledAt: null, sortedAt: null, caughtAt: null, updatedAt: "2026-09-24T12:00:00Z",
    files: [{ id: "file-1", name: "report.pdf", type: "pdf", url: "https://example.invalid/private-signed-url" }],
  };
  const html = renderToStaticMarkup(h(ThingStackCard, {
    ref: createRef(), thing, lane: "next", myActorId: person.id, pendingAction: null,
    suppressClickRef: { current: false }, onOpen: () => {}, onAction: () => {},
  }));
  assert.match(html, /report/);
  assert.doesNotMatch(html, /private-signed-url/);
});
