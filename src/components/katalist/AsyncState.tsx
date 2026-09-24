import { useEffect, useState, type ReactNode } from "react";

import { extractErrorMessage } from "@/lib/domain-error";
import { SLOW_QUERY_MS, STALLED_QUERY_MS, classifyAsyncError, resolveAsyncBranch } from "@/lib/query-policy";
import { EmptyState } from "@/components/katalist/EmptyState";

/**
 * Shared async-screen presentation (Batch B2). Feature hooks keep owning
 * their queries — this only decides what to render given their result, so
 * "offline", "you don't have access", "nothing here yet", and "that failed,
 * retry" are never collapsed into the same blank/skeleton state.
 */
export type AsyncStateKind =
  | "offline"
  | "unauthenticated"
  | "forbidden"
  | "not-found"
  | "failed"
  | "loading"
  | "empty"
  | "ready";

function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

type AsyncStateProps<T> = {
  /** True only while there is no data yet at all (first load, or after an identity/context switch that cleared it). */
  isLoading: boolean;
  /** True while a background refetch is in flight and stale data is still being shown. */
  isFetching?: boolean;
  data: T | null | undefined;
  error?: unknown;
  onRetry?: () => void;
  /** True when data has loaded successfully but there's nothing in it. */
  isEmpty: boolean;
  /**
   * Whether the underlying query has ever produced a real result — pass
   * `query.data !== undefined` (or the hook's equivalent), NOT
   * `!isLoading`. A query "paused" offline (never fetched, no error) also
   * reports `isLoading: false`, which would otherwise look identical to a
   * confirmed empty result and misrepresent "we don't know" as "you have
   * zero" (or vice versa for the offline-blocking screen).
   */
  hasFetchedOnce: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  /** Skeleton matching the final layout's geometry — shown only during initial loading. */
  loadingContent: ReactNode;
  children: (data: T) => ReactNode;
};

/**
 * Renders one of: offline / unauthenticated / forbidden / not-found /
 * failed / loading / empty / ready(children). Background refetches
 * (isFetching with data already present) never replace already-rendered
 * content — the caller can layer its own subtle "refreshing" indicator on
 * top of `children` if it wants one; this component doesn't try to.
 */
export function AsyncState<T>({
  isLoading,
  data,
  error,
  onRetry,
  isEmpty,
  hasFetchedOnce,
  emptyTitle,
  emptyDescription,
  emptyAction,
  loadingContent,
  children,
}: AsyncStateProps<T>) {
  const online = useOnline();
  const [elapsedTier, setElapsedTier] = useState<"none" | "slow" | "stalled">("none");

  useEffect(() => {
    if (!isLoading) {
      setElapsedTier("none");
      return;
    }
    const slowTimer = setTimeout(() => setElapsedTier("slow"), SLOW_QUERY_MS);
    const stalledTimer = setTimeout(() => setElapsedTier("stalled"), STALLED_QUERY_MS);
    return () => {
      clearTimeout(slowTimer);
      clearTimeout(stalledTimer);
    };
  }, [isLoading]);

  const branch = resolveAsyncBranch({ online, isLoading, error, isEmpty, hasFetchedOnce });

  if (branch === "offline-blocked") {
    return (
      <EmptyState
        title="You're offline"
        description="Reconnect to load this — nothing here is cached yet."
        action={
          onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12.5px] font-medium hover:bg-muted"
            >
              Try again
            </button>
          ) : undefined
        }
      />
    );
  }

  if (branch === "error-blocked") {
    const kind = classifyAsyncError(error);
    const retryButton = onRetry ? (
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12.5px] font-medium hover:bg-muted"
      >
        Retry
      </button>
    ) : undefined;

    if (kind === "unauthenticated") {
      return <EmptyState title="Sign in to continue" description="Your session expired." action={retryButton} />;
    }
    if (kind === "forbidden") {
      return <EmptyState title="You don't have access to this" action={undefined} />;
    }
    if (kind === "not-found") {
      return <EmptyState title="Not found" description="This may have been moved or removed." action={retryButton} />;
    }
    if (kind === "timeout") {
      // T01: read-request.ts's withReadDeadline aborted this read at its
      // own 15s deadline -- same recovery messaging as the elapsed-based
      // "stalled" tier below, since this is the same fact (a read that
      // never came back in a reasonable time), just discovered via an
      // actual abort instead of a still-loading timer.
      return (
        <EmptyState title="Taking longer than usual" description="This is taking a while." action={retryButton} />
      );
    }
    return (
      <EmptyState
        title="Something didn't load"
        description={extractErrorMessage(error) ?? "Try again."}
        action={retryButton}
      />
    );
  }

  if (branch === "loading") {
    if (elapsedTier === "stalled") {
      return (
        <EmptyState
          title="Taking longer than usual"
          description="This is taking a while."
          action={
            onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12.5px] font-medium hover:bg-muted"
              >
                Retry
              </button>
            ) : undefined
          }
        />
      );
    }
    if (elapsedTier === "slow") {
      // 3s+: still just the skeleton geometry, with the plan's "taking
      // longer than usual" copy layered on top — no retry/nav yet, that's
      // reserved for the harder 15s stall above.
      return (
        <div className="relative">
          {loadingContent}
          <p className="pointer-events-none absolute inset-x-0 top-0 pt-1 text-center text-[11.5px] text-muted-foreground">
            Taking longer than usual…
          </p>
        </div>
      );
    }
    return <>{loadingContent}</>;
  }

  if (branch === "empty") {
    return (
      <>
        {!online ? <OfflineBanner /> : null}
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      </>
    );
  }

  return (
    <>
      {!online ? <OfflineBanner /> : null}
      {/* B-03: reaching "ready" with a non-null error means resolveAsyncBranch
          already confirmed this is NOT a confirmed access-loss (those are
          forced to "error-blocked" even with stale data present) -- only an
          ambiguous/transient failure with existing content to fall back on
          lands here. Surface it as a soft, non-blocking warning instead of
          silently hiding that the latest refresh failed. */}
      {online && error != null ? <TransientErrorBanner error={error} onRetry={onRetry} /> : null}
      {children(data as T)}
    </>
  );
}

function OfflineBanner() {
  return (
    <div
      role="status"
      className="mb-3 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900"
    >
      <span>You're offline. Showing what was already loaded.</span>
    </div>
  );
}

function TransientErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div
      role="status"
      className="mb-3 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900"
    >
      <span>Couldn't refresh — showing what was already loaded. {extractErrorMessage(error) ?? ""}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium underline">
          Retry
        </button>
      ) : null}
    </div>
  );
}
