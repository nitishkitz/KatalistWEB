import type { QueryClient } from "@tanstack/react-query";
import { getIdentityEpoch, isEpochCurrent, registerIdentityDisposer } from "@/features/realtime/identity-cache-policy";

type ScrollPosition = { epoch: number; top: number; fromBottom: number };
const positions = new WeakMap<QueryClient, Map<string, ScrollPosition>>();

function storeFor(qc: QueryClient): Map<string, ScrollPosition> {
  let store = positions.get(qc);
  if (!store) {
    store = new Map();
    positions.set(qc, store);
    registerIdentityDisposer(qc, () => store?.clear());
  }
  return store;
}

export function saveChatScroll(qc: QueryClient, listId: string, top: number, fromBottom: number): void {
  storeFor(qc).set(listId, { epoch: getIdentityEpoch(qc).epoch, top, fromBottom });
}

export function getChatScroll(qc: QueryClient, listId: string): { top: number; fromBottom: number } | null {
  const position = storeFor(qc).get(listId);
  if (!position || !isEpochCurrent(qc, position.epoch)) return null;
  return position;
}
