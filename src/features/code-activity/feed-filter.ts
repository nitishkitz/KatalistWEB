import type { ActivityChange } from "./types";

export type FeedFilter = "all" | "pull_request" | "push" | "failing";

export const FEED_FILTERS: ReadonlyArray<{ id: FeedFilter; label: string }> = [
  { id: "all", label: "All activity" },
  { id: "pull_request", label: "Pull requests" },
  { id: "push", label: "Pushes" },
  { id: "failing", label: "Checks failing" },
];

export function applyFeedFilter(changes: readonly ActivityChange[], filter: FeedFilter): ActivityChange[] {
  switch (filter) {
    case "pull_request":
      return changes.filter((c) => c.kind === "pull_request");
    case "push":
      return changes.filter((c) => c.kind === "push");
    case "failing":
      // A stale result is not a current failure, so only current failing checks match.
      return changes.filter((c) => c.kind !== "gap" && c.checkState === "failing" && !c.checksStale);
    default:
      return [...changes];
  }
}
