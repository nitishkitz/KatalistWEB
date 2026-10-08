import type { WorkspaceItem } from "./types";

/**
 * Merging several newest-first sources into one list without ever putting a late page above something already shown.
 *
 * A source that still has more pages may later deliver items as new as the OLDEST item it has loaded so far. So an item is
 * only shown when it is strictly newer than that "horizon" of every source with more pages. A source that has not loaded
 * yet, or has loaded nothing but has more, holds the horizon at the top and nothing is shown until it arrives.
 * Items equal to a horizon stay hidden until the next page confirms nothing else shares that moment.
 */
export interface SourceState {
  /** False until the first page arrived. */
  loaded: boolean;
  /** Newest first. */
  items: readonly WorkspaceItem[];
  hasMore: boolean;
}

export interface MergeResult {
  items: WorkspaceItem[];
  /** Items loaded but held back until more pages arrive. */
  heldBack: number;
  /** True while at least one source can still add items. */
  moreAvailable: boolean;
}

const time = (item: WorkspaceItem) => Date.parse(item.occurredAt);

export function compareItems(a: WorkspaceItem, b: WorkspaceItem): number {
  const delta = time(b) - time(a);
  if (delta !== 0) return delta;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function mergeSources(sources: readonly SourceState[], options: { progressive?: boolean } = {}): MergeResult {
  let horizon = -Infinity; // nothing hidden when no source has more
  for (const source of sources) {
    if (!source.hasMore && source.loaded) continue;
    if (!source.loaded || source.items.length === 0) {
      horizon = Infinity;
      break;
    }
    const oldest = Math.min(...source.items.map(time));
    horizon = Math.max(horizon, oldest);
  }

  const seen = new Set<string>();
  const all: WorkspaceItem[] = [];
  for (const source of sources) {
    for (const item of source.items) {
      if (seen.has(item.id)) continue; // an identity never repeats
      seen.add(item.id);
      all.push(item);
    }
  }

  // A push is a wrapper around commits. It is hidden only when a loaded commit has the same SHA (a verified link);
  // otherwise it stays, labelled as a push, rather than being relabelled as a commit.
  const commitShas = new Set(all.filter((i) => i.kind === "commit" && i.sha).map((i) => i.sha));
  const visibleIdentity = all.filter((i) => !(i.kind === "push" && i.sha && commitShas.has(i.sha)));

  // Interactive workspaces show verified rows immediately. Later sources may insert rows in chronological order;
  // their loading/history coverage is disclosed by the caller, and selection remains keyed by identity.
  const shown = visibleIdentity.filter((i) => options.progressive || time(i) > horizon).sort(compareItems);
  const moreAvailable = sources.some((s) => !s.loaded || s.hasMore);
  return { items: shown, heldBack: visibleIdentity.length - shown.length, moreAvailable };
}

/** Which sources a category reads. `checks` are derived from revisions already loaded, so they need commits and pull requests. */
export function sourcesFor(category: "all" | "commits" | "pull_requests" | "checks" | "deployments"): Array<"commits" | "saved" | "deployments"> {
  switch (category) {
    case "commits":
      return ["commits"];
    case "pull_requests":
      return ["saved"];
    case "deployments":
      return ["deployments"];
    case "checks":
      return ["commits", "saved"];
    default:
      return ["commits", "saved", "deployments"];
  }
}

/** One derived `check:<sha>` item per revision with a known result. Shown in the Checks category only. */
export function deriveCheckItems(items: readonly WorkspaceItem[]): WorkspaceItem[] {
  const out: WorkspaceItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if ((item.kind !== "commit" && item.kind !== "pull_request" && item.kind !== "push") || !item.sha) continue;
    if (!item.checkState || item.checkState === "none" || item.checkState === "unavailable") continue;
    if (item.checksRevision !== item.sha) continue; // a result for another revision is not shown as current
    if (seen.has(item.sha)) continue;
    seen.add(item.sha);
    out.push({ ...item, id: `check:${item.sha}`, kind: "check", title: item.title });
  }
  return out;
}
