import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { retryReadOnce } from "@/lib/query-policy";

export const getRouter = () => {
  const queryClient = new QueryClient({
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
