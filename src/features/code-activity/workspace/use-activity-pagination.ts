import { useEffect, useRef } from "react";

/** Cursor-bound prefetch inside the feed, never a document-level infinite request loop. */
export function useActivityPagination({ key, hasMore, busy, failed, loadMore }: { key: string; hasMore: boolean; busy: boolean; failed: boolean; loadMore: () => Promise<void> }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const lastAttempt = useRef<string | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    const end = endRef.current;
    if (!root || !end || !hasMore || busy || failed || typeof IntersectionObserver === "undefined") return;
    let active = true;
    const observer = new IntersectionObserver((entries) => {
      if (!active || !entries.some((entry) => entry.isIntersecting) || lastAttempt.current === key) return;
      lastAttempt.current = key; // A failed or non-advancing cursor can only be retried by the person.
      void loadMore();
    }, { root, rootMargin: "0px 0px 160px 0px", threshold: 0 });
    observer.observe(end);
    return () => { active = false; observer.disconnect(); };
  }, [key, hasMore, busy, failed, loadMore]);
  return { rootRef, endRef };
}
