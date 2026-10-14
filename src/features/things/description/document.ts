import type { JSONContent } from "@tiptap/react";
import { extractLinks, toSafeHref } from "@/lib/linkify";

export type DescriptionDocument = JSONContent;
export const DESCRIPTION_MAX_BYTES = 50_000;
export const emptyDescription = (): DescriptionDocument => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});

/** An explicit schema, shared by editing and rendering. Never stores or renders pasted HTML. */
export function sanitizeDescription(input: unknown): DescriptionDocument {
  if (JSON.stringify(input ?? null).length > DESCRIPTION_MAX_BYTES)
    throw new Error("Description is too long (maximum 50,000 characters).");
  const allowed = new Set([
    "doc",
    "paragraph",
    "text",
    "hardBreak",
    "bulletList",
    "orderedList",
    "listItem",
  ]);
  function visit(raw: unknown, depth: number): JSONContent | null {
    if (depth > 20) throw new Error("Description lists are too deeply nested.");
    if (!raw || typeof raw !== "object") return null;
    const node = raw as JSONContent;
    if (!node.type || !allowed.has(node.type)) return null;
    if (node.type === "text") {
      if (typeof node.text !== "string" || !node.text) return null;
      const result: JSONContent = { type: "text", text: node.text };
      const marks = (Array.isArray(node.marks) ? node.marks : []).flatMap((mark) => {
        if (mark.type === "bold" || mark.type === "italic") return [{ type: mark.type }];
        if (
          mark.type === "link" &&
          typeof mark.attrs?.href === "string" &&
          /^https?:\/\//i.test(mark.attrs.href)
        ) {
          const href = toSafeHref(mark.attrs.href);
          if (href) return [{ type: "link", attrs: { href } }];
        }
        return [];
      });
      if (marks.length) result.marks = marks;
      return result;
    }
    const content = (Array.isArray(node.content) ? node.content : [])
      .map((child) => visit(child, depth + 1))
      .filter((child): child is JSONContent => Boolean(child));
    const result: JSONContent = { type: node.type };
    if (content.length) result.content = content;
    if (node.type === "orderedList" && Number.isInteger(node.attrs?.start) && node.attrs!.start > 0)
      result.attrs = { start: node.attrs!.start };
    return result;
  }
  const doc = visit(input, 0);
  return doc?.type === "doc"
    ? { type: "doc", content: doc.content?.length ? doc.content : [{ type: "paragraph" }] }
    : emptyDescription();
}

export function legacyDescriptionDocument(text?: string | null): DescriptionDocument {
  return {
    type: "doc",
    content: (text ?? "")
      .split("\n")
      .map((line) => ({
        type: "paragraph",
        ...(line ? { content: [{ type: "text", text: line }] } : {}),
      })),
  };
}

export function descriptionText(doc: DescriptionDocument): string {
  function read(node: JSONContent): string {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    return (node.content ?? [])
      .map(read)
      .join(["doc", "bulletList", "orderedList", "listItem"].includes(node.type ?? "") ? "\n" : "");
  }
  return read(doc).trim();
}

export function descriptionLinks(doc: DescriptionDocument): string[] {
  const links = new Set<string>();
  function visit(node: JSONContent) {
    for (const mark of node.marks ?? []) {
      const href =
        mark.type === "link" && typeof mark.attrs?.href === "string"
          ? toSafeHref(mark.attrs.href)
          : null;
      if (href) links.add(href);
    }
    for (const link of extractLinks(node.text)) links.add(link);
    node.content?.forEach(visit);
  }
  visit(doc);
  return [...links];
}
