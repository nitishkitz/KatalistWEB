import { useSyncExternalStore } from "react";
import { subscribeLocal } from "./local-state";

let versionMirror = 0;
function snapshot() { return versionMirror; }
subscribeLocal(() => { versionMirror += 1; });

export function useLocalVersion() {
  return useSyncExternalStore(subscribeLocal, snapshot, snapshot);
}
