import { useState } from "react";

export const LIST_THING_FILTERS = [
  "all",
  "active",
  "mine",
  "theirs",
  "waiting",
  "progress",
  "completed",
  "cancelled",
  "sorted",
] as const;

export type ListThingFilter = (typeof LIST_THING_FILTERS)[number];

export function parseListThingFilter(value: string | null): ListThingFilter {
  return LIST_THING_FILTERS.includes(value as ListThingFilter)
    ? (value as ListThingFilter)
    : "all";
}

export function listThingFilterStorageKey(identityId: string, listId: string): string {
  return `katalist.lists.things_filter.${identityId}.${listId}`;
}

function readFilter(key: string | null): ListThingFilter {
  if (!key || typeof window === "undefined") return "all";
  try {
    return parseListThingFilter(window.localStorage.getItem(key));
  } catch {
    return "all";
  }
}

/**
 * Filter state belongs to one resolved identity + List pair. The keyed state
 * adjustment happens during render, before effects from the new route can run,
 * so a reused route can never persist List A's value into List B's slot.
 * Writes happen only in the explicit setter; auth-pending users have no key.
 */
export function useListThingsFilter(identityId: string | null, listId: string) {
  const key = identityId ? listThingFilterStorageKey(identityId, listId) : null;
  const [owned, setOwned] = useState(() => ({ key, value: readFilter(key) }));

  if (owned.key !== key) {
    setOwned({ key, value: readFilter(key) });
  }

  const value = owned.key === key ? owned.value : readFilter(key);
  const setValue = (next: ListThingFilter) => {
    setOwned({ key, value: next });
    if (!key || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, next);
    } catch {
      // The in-memory filter still works when storage is unavailable.
    }
  };

  return { value, setValue, storageKey: key };
}
