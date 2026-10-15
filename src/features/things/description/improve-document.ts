import { sanitizeDescription, DESCRIPTION_MAX_BYTES, type DescriptionDocument } from "./document";
export type DescriptionSelection = { from: number; to: number };
export type DescriptionSegment = { id: number; text: string };
type Target = { path: number[]; prefix: string; suffix: string };
export type DescriptionImprovementPlan = {
  document: DescriptionDocument;
  segments: DescriptionSegment[];
  targets: Target[];
};
const containsUrl = (text: string) =>
  /(?:https?:\/\/|www\.|\b[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/|\b))/i.test(text);
export function prepareDescriptionImprovement(
  input: unknown,
  selection?: DescriptionSelection,
): DescriptionImprovementPlan {
  if (!input || typeof input !== "object" || (input as DescriptionDocument).type !== "doc")
    throw new Error("Invalid description document.");
  const document = sanitizeDescription(input);
  // Reject unsupported/altered nodes instead of silently discarding the user's structure.
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : value;
  if (JSON.stringify(canonical(input)) !== JSON.stringify(canonical(document)))
    throw new Error("Invalid description structure.");
  const plan: DescriptionImprovementPlan = { document, segments: [], targets: [] };
  let position = 0;
  function visit(node: DescriptionDocument, path: number[], root = false) {
    if (node.type === "text") {
      const text = node.text ?? "";
      const start = position;
      position += text.length;
      const from = selection ? Math.max(0, selection.from - start) : 0;
      const to = selection ? Math.min(text.length, selection.to - start) : text.length;
      const selected = text.slice(from, to);
      if (
        to > from &&
        selected.trim() &&
        /\p{L}/u.test(selected) &&
        !containsUrl(text) &&
        !node.marks?.some((mark) => mark.type === "link")
      ) {
        plan.segments.push({ id: plan.segments.length, text: selected });
        plan.targets.push({ path, prefix: text.slice(0, from), suffix: text.slice(to) });
      }
      return;
    }
    if (node.type === "hardBreak") {
      position++;
      return;
    }
    if (!root) position++;
    node.content?.forEach((child, index) => visit(child, [...path, index]));
    if (!root) position++;
  }
  visit(document, [], true);
  if (
    selection &&
    (!Number.isInteger(selection.from) ||
      !Number.isInteger(selection.to) ||
      selection.from < 0 ||
      selection.to > position ||
      selection.from >= selection.to)
  )
    throw new Error("Select a valid range of description text.");
  if (plan.segments.length > 300) throw new Error("Description has too many text segments.");
  return plan;
}
export function applyDescriptionReplacements(
  plan: DescriptionImprovementPlan,
  input: unknown,
): DescriptionDocument {
  const replacements = (input as { replacements?: unknown })?.replacements;
  if (!Array.isArray(replacements) || replacements.length !== plan.segments.length)
    throw new Error("Incomplete improvement.");
  const document = structuredClone(plan.document);
  const seen = new Set<number>();
  for (const replacement of replacements) {
    const { id, text } = replacement ?? {};
    if (
      !Number.isInteger(id) ||
      !plan.targets[id] ||
      seen.has(id) ||
      typeof text !== "string" ||
      !text.trim() ||
      text.length > Math.max(2000, plan.segments[id].text.length * 4) ||
      containsUrl(text)
    )
      throw new Error("Invalid improvement.");
    seen.add(id);
    const target = plan.targets[id];
    let node = document;
    for (const index of target.path) node = node.content![index];
    // Whitespace separates adjacent marked runs and selected/unselected words.
    // Keep these boundaries deterministic even when the provider trims them.
    const source = plan.segments[id].text;
    const leading = source.match(/^\s*/u)![0];
    const trailing = source.match(/\s*$/u)![0];
    node.text = target.prefix + leading + text.trim() + trailing + target.suffix;
  }
  if (JSON.stringify(document).length > DESCRIPTION_MAX_BYTES)
    throw new Error("Improved description is too long.");
  return document;
}
