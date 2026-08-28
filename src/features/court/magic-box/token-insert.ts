export type MagicBoxToken = "@" | "#";

export function insertMagicBoxToken(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  token: MagicBoxToken,
) {
  const start = Math.max(0, Math.min(selectionStart, text.length));
  const end = Math.max(start, Math.min(selectionEnd, text.length));
  const prefix = text.slice(0, start);
  const suffix = text.slice(end);
  const separator = prefix.length > 0 && !/\s$/.test(prefix) ? " " : "";
  const insertion = `${separator}${token}`;

  return {
    text: `${prefix}${insertion}${suffix}`,
    caret: prefix.length + insertion.length,
  };
}
