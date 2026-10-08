import { useCallback, useEffect, useMemo, useState } from "react";
import { parseActivityFeed } from "./types";
import type { CodeActivityAdapter } from "./adapter";
import type { ActivityFeedData } from "./types";

export type FeedState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ActivityFeedData };

interface UseCodeActivityResult {
  state: FeedState;
  /** True while a refresh is running. Existing activity stays visible during it. */
  refreshing: boolean;
  refresh: () => void;
  retry: () => void;
}

/**
 * Loads the feed through the adapter. Requests are cancelled on unmount or reload, errors stay
 * inside this feature, and anything the adapter returns is validated before it reaches the UI.
 * `reloadKey` lets the preview bar force a reload when a scenario setting that affects the feed changes.
 */
export function useCodeActivity(adapter: CodeActivityAdapter, reloadKey: string): UseCodeActivityResult {
  const [state, setState] = useState<FeedState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const [manual, setManual] = useState<"initial" | "refresh">("initial");

  useEffect(() => {
    const controller = new AbortController();
    const isRefresh = manual === "refresh";
    if (!isRefresh) setState({ status: "loading" });
    setRefreshing(isRefresh);
    adapter
      .loadFeed(controller.signal)
      .then((raw) => {
        const parsed = parseActivityFeed(raw);
        if (!parsed.ok) throw new Error(`Unexpected activity data: ${parsed.error}`);
        setState({ status: "ready", data: parsed.value });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Activity could not be loaded.",
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setRefreshing(false);
      });
    return () => controller.abort();
  }, [adapter, reloadKey, tick, manual]);

  const refresh = useCallback(() => {
    setManual("refresh");
    setTick((n) => n + 1);
  }, []);
  const retry = useCallback(() => {
    setManual("initial");
    setTick((n) => n + 1);
  }, []);

  return useMemo(() => ({ state, refreshing, refresh, retry }), [state, refreshing, refresh, retry]);
}
