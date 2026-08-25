export type AccessibleList = { id: string; name: string };
export type ListToken = { start: number; end: number; query: string };
export type ListTokenBinding = { listId: string; listName: string; start: number; end: number };

export function listOptionId(composerId: string, listId: string) {
  return `${composerId}-list-${listId}`;
}

export function findActiveListToken(text: string, caret: number): ListToken | null {
  const before = text.slice(0, Math.max(0, caret));
  const match = /(?:^|\s)#([^#\s]*)$/.exec(before);
  if (!match) return null;
  const hashOffset = match[0].lastIndexOf("#");
  const start = match.index + hashOffset;
  return { start, end: caret, query: match[1] ?? "" };
}

export function replaceListToken(text: string, token: ListToken, list: AccessibleList) {
  const replacement = `#${list.name}`;
  const next = text.slice(0, token.start) + replacement + text.slice(token.end);
  const caret = token.start + replacement.length;
  return {
    text: next,
    caret,
    binding: { listId: list.id, listName: list.name, start: token.start, end: caret },
  };
}

export function resolveListToken(text: string, lists: readonly AccessibleList[]):
  | { status: "none" }
  | { status: "resolved"; list: AccessibleList }
  | { status: "unresolved"; rawToken: string } {
  const matches = [...text.matchAll(/(?:^|\s)#([^#\s]+)/g)];
  if (!matches.length) return { status: "none" };
  const rawToken = matches.at(-1)?.[1] ?? "";
  const normalized = rawToken.toLocaleLowerCase();
  const exact = lists.filter((list) => list.name.toLocaleLowerCase() === normalized);
  return exact.length === 1 ? { status: "resolved", list: exact[0]! } : { status: "unresolved", rawToken };
}

export function listBindingStillValid(text: string, binding: ListTokenBinding | null) {
  return Boolean(binding && text.slice(binding.start, binding.end) === `#${binding.listName}`);
}
