import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareDescriptionImprovement,
  applyDescriptionReplacements,
} from "../src/features/things/description/improve-document.ts";
const doc = {
  type: "doc",
  content: [
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "bad prose", marks: [{ type: "bold" }] },
                { type: "hardBreak" },
                {
                  type: "text",
                  text: "Site",
                  marks: [{ type: "link", attrs: { href: "https://example.com/" } }],
                },
                { type: "text", text: " https://example.com/" },
              ],
            },
          ],
        },
      ],
    },
  ],
};
test("preserves nested structure, marks, hard breaks and URLs", () => {
  const plan = prepareDescriptionImprovement(doc);
  assert.deepEqual(plan.segments, [{ id: 0, text: "bad prose" }]);
  const result = applyDescriptionReplacements(plan, {
    replacements: [{ id: 0, text: "Better prose" }],
  });
  const expected = structuredClone(doc);
  expected.content[0].content[0].content[0].content[0].text = "Better prose";
  assert.deepEqual(result, expected);
  assert.equal(doc.content[0].content[0].content[0].content[0].text, "bad prose");
});
test("selection uses ProseMirror offsets and preserves prefix and suffix", () => {
  const d = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "one bad end" }] }],
  };
  const plan = prepareDescriptionImprovement(d, { from: 5, to: 8 });
  assert.equal(plan.segments[0].text, "bad");
  assert.equal(
    applyDescriptionReplacements(plan, { replacements: [{ id: 0, text: "good" }] }).content[0]
      .content[0].text,
    "one good end",
  );
  for (const selection of [
    { from: 0, to: 99 },
    { from: 2, to: 2 },
    { from: -1, to: 3 },
  ])
    assert.throws(() => prepareDescriptionImprovement(d, selection));
});
test("rejects invalid, duplicate, missing, empty or URL-adding replacements", () => {
  const plan = prepareDescriptionImprovement(doc);
  for (const replacements of [
    [],
    [{ id: 8, text: "x" }],
    [{ id: 0, text: "" }],
    [{ id: 0, text: "https://evil.com" }],
    [
      { id: 0, text: "x" },
      { id: 0, text: "y" },
    ],
  ])
    assert.throws(() => applyDescriptionReplacements(plan, { replacements }));
});
test("accepts harmless object property ordering", () => {
  const input = {
    content: [{ content: [{ text: "bad prose", type: "text" }], type: "paragraph" }],
    type: "doc",
  };
  assert.deepEqual(prepareDescriptionImprovement(input).segments, [{ id: 0, text: "bad prose" }]);
});
test("partial selection keeps exact marked prefix, suffix and adjacent leaves", () => {
  const input = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "one bad end", marks: [{ type: "italic" }, { type: "bold" }] },
          { type: "text", text: " untouched" },
        ],
      },
    ],
  };
  const result = applyDescriptionReplacements(
    prepareDescriptionImprovement(input, { from: 5, to: 8 }),
    { replacements: [{ id: 0, text: "good" }] },
  );
  const expected = structuredClone(input);
  expected.content[0].content[0].text = "one good end";
  assert.deepEqual(result, expected);
});
test("model trimming cannot join neighboring marked runs", () => {
  const input = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "First " },
          { type: "text", text: "bad ", marks: [{ type: "bold" }] },
          { type: "text", text: " end", marks: [{ type: "italic" }] },
        ],
      },
    ],
  };
  const result = applyDescriptionReplacements(prepareDescriptionImprovement(input), {
    replacements: [
      { id: 0, text: " Start  " },
      { id: 1, text: "better" },
      { id: 2, text: "finish " },
    ],
  });
  assert.deepEqual(
    result.content[0].content.map((node) => node.text),
    ["Start ", "better ", " finish"],
  );
  assert.deepEqual(
    result.content[0].content.map((node) => node.marks),
    input.content[0].content.map((node) => node.marks),
  );
});
test("selected boundary whitespace remains exact despite provider changes", () => {
  const input = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "before \tbad  after", marks: [{ type: "bold" }] }],
      },
    ],
  };
  const plan = prepareDescriptionImprovement(input, { from: 7, to: 14 });
  assert.equal(plan.segments[0].text, " \tbad  ");
  const result = applyDescriptionReplacements(plan, {
    replacements: [{ id: 0, text: " better " }],
  });
  assert.equal(result.content[0].content[0].text, "before \tbetter  after");
});
