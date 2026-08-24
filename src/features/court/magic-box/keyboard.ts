export type ComposerKeyContext = {
  mentionMenuOpen: boolean;
  chipEditorOpen: boolean;
  canToss: boolean;
};

export type ComposerKeyResult =
  | { type: "mention-move"; delta: number }
  | { type: "mention-accept" }
  | { type: "mention-close" }
  | { type: "toss" }
  | { type: "none" };

export function resolveComposerKey(key: string, ctx: ComposerKeyContext): ComposerKeyResult {
  if (ctx.chipEditorOpen) return { type: "none" };
  if (ctx.mentionMenuOpen) {
    if (key === "ArrowDown") return { type: "mention-move", delta: 1 };
    if (key === "ArrowUp") return { type: "mention-move", delta: -1 };
    if (key === "Tab" || key === "Enter") return { type: "mention-accept" };
    if (key === "Escape") return { type: "mention-close" };
  }
  if (key === "Enter" && ctx.canToss) return { type: "toss" };
  return { type: "none" };
}

export function wrapIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (index + delta + length * 8) % length;
}
