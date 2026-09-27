import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { retryReadOnce } from "@/lib/query-policy";
import { isReadTimeoutError } from "@/lib/read-request";
import { logTelemetryEvent } from "@/lib/telemetry";

export const getRouter = () => {
  const queryClient = new QueryClient({
    // V-05: one global hook point covers every query/mutation failure app-
    // wide without touching each individual call site. A read's own
    // timeout is already logged inside withReadDeadline (read-request.ts)
    // under its own "query_timeout" category -- skipped here so it isn't
    // double-counted under "query_error" too.
    queryCache: new QueryCache({
      onError: (err) => {
        if (isReadTimeoutError(err)) return;
        logTelemetryEvent({ category: "query_error", outcome: "failure" });
      },
    }),
    mutationCache: new MutationCache({
      onError: () => {
        logTelemetryEvent({ category: "mutation_failure", outcome: "failure" });
      },
    }),
    defaultOptions: {
      // React Query's own default (3 retries, exponential backoff, for any
      // failure) retries permission/auth/not-found errors exactly as hard
      // as a dropped connection. retryReadOnce only retries plausibly
      // transient read failures, and only once. Mutations already default
      // to no automatic retry — left untouched.
      queries: { retry: retryReadOnce },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
