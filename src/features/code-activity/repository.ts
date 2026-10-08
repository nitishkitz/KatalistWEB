/**
 * Repository selection helpers (pure).
 *
 * A typed URL is only ever matched against a list of repositories that was already verified for
 * this owner. A URL by itself never connects anything.
 */
export interface SelectableRepository {
  id: string;
  fullName: string;
  visibility: "private" | "public";
  updatedLabel: string;
}

const NAME = "[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?";
const FORMS = [
  new RegExp(`^(?:https?://)?(?:www\\.)?github\\.com/(${NAME})/(${NAME}?)(?:\\.git)?(?:[/?#].*)?$`, "i"),
  new RegExp(`^(${NAME})/(${NAME})$`),
];

/** Returns "owner/name" for an approved GitHub.com URL form or a bare "owner/name", otherwise null. */
export function parseRepositoryInput(input: string): string | null {
  const text = input.trim();
  if (text === "") return null;
  for (const form of FORMS) {
    const match = form.exec(text);
    if (match) return `${match[1]}/${match[2].replace(/\.git$/i, "")}`;
  }
  return null;
}

/** Case-insensitive match against the verified list. Null when the input is invalid or not listed. */
export function matchRepository<T extends SelectableRepository>(input: string, repositories: readonly T[]): T | null {
  const parsed = parseRepositoryInput(input);
  if (!parsed) return null;
  const wanted = parsed.toLowerCase();
  return repositories.find((r) => r.fullName.toLowerCase() === wanted) ?? null;
}
