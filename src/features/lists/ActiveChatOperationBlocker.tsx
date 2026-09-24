import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBlockWhile } from "@/components/katalist/use-interaction-blocker";
import { chatOperationsRevision, pendingChatOperationCount, subscribeChatOperations } from "./chat-operations";

/** Root ownership keeps a pending send blocking brief auto-open after its
 * composer closes; the operation settles or retires independently of UI. */
export function ActiveChatOperationBlocker() {
  const qc = useQueryClient();
  const subscribe = useCallback((listener: () => void) => subscribeChatOperations(qc, listener), [qc]);
  const snapshot = useCallback(() => chatOperationsRevision(qc), [qc]);
  useSyncExternalStore(subscribe, snapshot, () => 0);
  useBlockWhile(pendingChatOperationCount(qc) > 0, "chat-send");
  return null;
}
