import { makeThingReference } from "@/features/thing-references/thing-reference";
import type { ChatOperation } from "./chat-operations";
import type { ListChatMessage } from "./use-list-messages";

/** The authoritative server row wins when realtime/refetch beats HTTP send
 * settlement. One UUID always renders as one timeline item. */
export function mergeChatFeed(
  serverRows: ListChatMessage[],
  operations: ChatOperation[],
  self: { name: string; avatarUrl: string | null },
): ListChatMessage[] {
  const byId = new Map(serverRows.map((row) => [row.id, row]));
  for (const operation of operations) {
    if (byId.has(operation.input.id)) continue;
    byId.set(operation.input.id, {
      id: operation.input.id,
      body: operation.input.body,
      author: self.name,
      authorId: operation.input.authorId,
      avatarUrl: self.avatarUrl,
      at: operation.at,
      kind: operation.input.kind,
      attachment: operation.input.attachment,
      pinnedAt: null,
      mentionedProfileIds: operation.input.mentionedProfileIds,
      thingReferences: (operation.input.thingReferenceIds ?? []).flatMap((id) => makeThingReference(id) ?? []),
      delivery: operation.delivery,
      error: operation.error,
    });
  }
  return [...byId.values()].sort((a, b) => {
    const first = Date.parse(a.at);
    const second = Date.parse(b.at);
    const byTime = Number.isFinite(first) && Number.isFinite(second)
      ? first - second
      : a.at.localeCompare(b.at);
    return byTime || a.id.localeCompare(b.id);
  });
}
