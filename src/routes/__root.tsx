import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { logTelemetryEvent, telemetryScopeForPath } from "@/lib/telemetry";

import { Toaster } from "@/components/ui/sonner";
import { ProfileDirectoryProvider } from "@/features/people/ProfileDirectoryProvider";
import { AppContextProvider } from "@/features/context/AppContextProvider";
import { IdentityBoundary } from "@/features/realtime/IdentityBoundary";
import { RealtimeInvalidationProvider } from "@/features/realtime/RealtimeInvalidationProvider";
import { CallRingProvider } from "@/features/calls/CallRingProvider";
import { PushRegistrar } from "@/features/push/PushRegistrar";
import { MotionPreferenceApplier } from "@/components/layout/MotionPreferenceApplier";
import { InteractionBlockerProvider } from "@/components/katalist/InteractionBlockerProvider";
import { ActiveChatOperationBlocker } from "@/features/lists/ActiveChatOperationBlocker";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Katalist — Life, Sorted." },
      { name: "description", content: "Movement, not storage. Capture, organize, and move things forward with Katalist." },
      { name: "author", content: "Katalist" },
      { property: "og:title", content: "Katalist — Life, Sorted." },
      { property: "og:description", content: "Movement, not storage. Capture, organize, and move things forward with Katalist." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@katalist" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=DM+Sans:wght@500;700&family=Inter:wght@400;500;600;700;800&display=swap",
      },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/** V-05: route path (scope tag only, never the full URL/query string) plus
 *  load duration, using the router's own onBeforeLoad/onLoad pair -- this
 *  is the data-fetching span specifically, not the full navigation
 *  (which also includes render). */
function RouteLoadTelemetry() {
  const router = useRouter();
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const unsubBefore = router.subscribe("onBeforeLoad", () => {
      startedAtRef.current = performance.now();
    });
    const unsubAfter = router.subscribe("onLoad", (event) => {
      const startedAt = startedAtRef.current;
      startedAtRef.current = null;
      logTelemetryEvent({
        category: "route_load",
        outcome: "success",
        scope: telemetryScopeForPath(event.toLocation.pathname),
        durationMs: startedAt != null ? Math.round(performance.now() - startedAt) : undefined,
      });
    });
    return () => {
      unsubBefore();
      unsubAfter();
    };
  }, [router]);

  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* P3: the identity/cache-lifecycle boundary sits here, wrapping
          everything AppContextProvider used to wrap directly -- so
          CallRingProvider/PushRegistrar get the same disposal/remount
          guarantee as routed content, rather than resting solely on
          their own independent user?.id-keyed effects. */}
      <MotionPreferenceApplier />
      <RouteLoadTelemetry />
      <IdentityBoundary>
        {/* P7: mounted once here, inside the remounted subtree, instead of
            once per AppShell instance -- route transitions never multiply
            this owner, and a real identity change (which remounts this
            whole subtree) disposes the old owner and mounts a fresh one
            automatically, in that order, via the same mechanism that
            already makes IdentityBoundary's other guarantees hold. */}
        <RealtimeInvalidationProvider />
        <AppContextProvider>
          <ProfileDirectoryProvider>
            {/* D03: one registry of "don't auto-open Morning Brief right
                now" reasons (active call, open blocking dialog, dirty
                composer) -- consumed starting in F04/H02, but mounted
                here now so those later batches have a real provider to
                register against instead of inventing their own. */}
            <InteractionBlockerProvider>
              <ActiveChatOperationBlocker />
              <Outlet />
              <CallRingProvider />
              <PushRegistrar />
              <Toaster />
            </InteractionBlockerProvider>
          </ProfileDirectoryProvider>
        </AppContextProvider>
      </IdentityBoundary>
    </QueryClientProvider>
  );
}
