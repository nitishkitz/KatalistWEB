import { authedFetch } from "@/lib/authed-fetch";
import { descriptionLinks, sanitizeDescription, type DescriptionDocument } from "./document";

export async function improveDescriptionDraft(
  input: {
    thingId: string;
    document: DescriptionDocument;
    selection?: { from: number; to: number };
  },
  signal: AbortSignal,
): Promise<DescriptionDocument> {
  const response = await authedFetch("/api/things/improve-description", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof body?.message === "string"
        ? body.message
        : "Sarvam could not improve this right now. Try again.",
    );
  if (!body?.document || body.document.type !== "doc" || !Array.isArray(body.document.content))
    throw new Error("Sarvam returned an incomplete suggestion. Your draft is unchanged.");
  const document = sanitizeDescription(body.document);
  // The server rewrites text only. Keep this boundary strict so a malformed
  // response cannot silently remove list items, formatting, or links.
  const structure = (doc: DescriptionDocument) =>
    JSON.stringify(doc, (key, value) => (key === "text" ? "" : value));
  if (
    structure(document) !== structure(input.document) ||
    JSON.stringify(descriptionLinks(document)) !== JSON.stringify(descriptionLinks(input.document))
  )
    throw new Error(
      "The suggestion changed the formatting or links. Your draft is unchanged; try again.",
    );
  return document;
}
