import assert from "node:assert/strict";
import { test } from "node:test";
import {
  sanitizeDescription,
  descriptionText,
  descriptionLinks,
  legacyDescriptionDocument,
} from "../src/features/things/description/document.ts";

test("description keeps supported formatting but drops executable attributes and unsafe links", () => {
  const doc = sanitizeDescription({
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { onclick: "evil" },
        content: [
          {
            type: "text",
            text: "hello",
            marks: [
              { type: "bold" },
              { type: "link", attrs: { href: "javascript:alert(1)" } },
              { type: "italic" },
            ],
          },
          { type: "image", attrs: { src: "x" } },
        ],
      },
    ],
  });
  assert.deepEqual(doc, {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "hello", marks: [{ type: "bold" }, { type: "italic" }] }],
      },
    ],
  });
});
test("URLs include links with labels and plain URLs, deduplicate and disappear when deleted", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Booking",
            marks: [{ type: "link", attrs: { href: "https://www.irctc.co.in/nget/train-search" } }],
          },
          { type: "text", text: " https://github.com. https://github.com" },
        ],
      },
    ],
  };
  assert.deepEqual(descriptionLinks(doc), [
    "https://www.irctc.co.in/nget/train-search",
    "https://github.com/",
  ]);
  assert.deepEqual(descriptionLinks({ type: "doc", content: [{ type: "paragraph" }] }), []);
});
test("legacy notes remain literal text and newlines survive", () => {
  const doc = legacyDescriptionDocument("<script>alert(1)</script>\nTrain notes");
  assert.equal(descriptionText(doc), "<script>alert(1)</script>\nTrain notes");
});
test("description bounds nesting and total document size", () => {
  assert.throws(
    () =>
      sanitizeDescription({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "a".repeat(60000) }] }],
      }),
    /too long/,
  );
  let doc = { type: "paragraph" };
  for (let i = 0; i < 25; i++)
    doc = { type: "bulletList", content: [{ type: "listItem", content: [doc] }] };
  assert.throws(() => sanitizeDescription({ type: "doc", content: [doc] }), /nested/);
});
