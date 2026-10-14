import type { QueryClient } from "@tanstack/react-query";
import { registerIdentityDisposer } from "@/features/realtime/identity-cache-policy";

// The draft store survives popup dismissal. Its reload guard must survive it too.
const pending = new Map<QueryClient, Set<string>>();
const registered = new WeakSet<QueryClient>();
function warn(event: BeforeUnloadEvent) {
  if (![...pending.values()].some((ids) => ids.size > 0)) return;
  event.preventDefault();
  event.returnValue = "";
}
function sync() {
  if (typeof window === "undefined") return;
  window.removeEventListener("beforeunload", warn);
  if (pending.size) window.addEventListener("beforeunload", warn);
}
export function guardDescriptionDraft(qc: QueryClient, id: string, dirty: boolean) {
  if (!registered.has(qc)) {
    registered.add(qc);
    registerIdentityDisposer(qc, () => {
      pending.delete(qc);
      sync();
    });
  }
  const ids = pending.get(qc) ?? new Set<string>();
  if (dirty) ids.add(id);
  else ids.delete(id);
  if (ids.size) pending.set(qc, ids);
  else pending.delete(qc);
  sync();
}
