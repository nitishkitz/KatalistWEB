import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/useSession";
import { isPreviewSession } from "@/lib/session-mode";
import {
  advanceIdentityEpoch,
  identityEquals,
  identityKey,
  runRegisteredDisposers,
  type Identity,
} from "@/features/realtime/identity-cache-policy";
import { IdentityContext } from "@/features/realtime/use-current-identity";
import { useIdentityTransitionHeld } from "@/features/realtime/identity-transition-hold";

type GateStatus =
  | { status: "pending" }
  | { status: "aligning"; identity: Identity }
  | { status: "ready"; identity: Identity };

function computeIdentity(loading: boolean, session: ReturnType<typeof useSession>["session"], preview: boolean): Identity {
  if (loading) return { kind: "pending" };
  if (!session?.user) return { kind: "none" };
  return preview ? { kind: "preview", profileId: session.user.id } : { kind: "live", profileId: session.user.id };
}

function AuthResolvingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background" data-testid="identity-boundary-pending">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
    </div>
  );
}

function AligningFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background" data-testid="identity-boundary-aligning">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
    </div>
  );
}

/**
 * P3's transition gate (design doc revision 5). Withholds the entire
 * protected subtree while a real identity change is being disposed of, so
 * nothing under this boundary can ever observe two identities' data at
 * once -- the exclusivity guarantee earlier revisions asserted but never
 * actually established.
 *
 * Render stays pure: it only compares `nextIdentity` against what's
 * committed and calls `setGate` -- a plain state adjustment, safe to run
 * any number of times (Strict Mode's double-render, a discarded
 * concurrent render). Every real side effect (disposal, epoch advance,
 * resetQueries()) lives in the layout effect below, which React
 * guarantees runs after commit but before paint, and whose own
 * `setGate` call is applied (re-rendering and re-committing) before that
 * paint happens too.
 */
export function IdentityBoundary({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const preview = isPreviewSession(session);
  const nextIdentity = computeIdentity(loading, session, preview);
  const qc = useQueryClient();
  const transitionHeld = useIdentityTransitionHeld();

  const [gate, setGate] = useState<GateStatus>(() =>
    nextIdentity.kind === "pending" ? { status: "pending" } : { status: "aligning", identity: nextIdentity },
  );

  // `nextIdentity.kind === "pending"` always wins, checked first and
  // unconditionally -- not guarded behind a comparison against what was
  // previously committed. useSession() currently only reports
  // `loading: true` once, at initial mount, but this boundary is exactly
  // the wrong place to bake in an assumption that stays true forever.
  const committedIdentity = gate.status === "ready" ? gate.identity : null;
  if (nextIdentity.kind === "pending") {
    if (gate.status !== "pending") setGate({ status: "pending" });
  } else if (transitionHeld && gate.status === "ready" && gate.identity.kind === "none") {
    // A screen is finishing its own sign-in transition (see
    // identity-transition-hold.ts); keep the signed-out subtree until it
    // releases, then the swap below runs as normal. Only ever from "none":
    // there is no previous identity's data to keep exclusive, and a switch
    // between two real identities is never deferred.
  } else if (
    !identityEquals(committedIdentity, nextIdentity) &&
    !(gate.status === "aligning" && identityEquals(gate.identity, nextIdentity))
  ) {
    setGate({ status: "aligning", identity: nextIdentity });
  }

  // Runs disposal for BOTH "aligning" and "pending" -- entering pending
  // from a known identity must retire that identity's epoch and claims
  // immediately, not leave them "current" for however long the pending
  // window lasts, even though nothing renders while pending. Tracked via
  // a ref (keyed by the target identity's key, or the literal string
  // "pending") so disposal runs exactly once per distinct entry, not on
  // every render while sitting in one of them.
  const disposedForRef = useRef<string | null>(gate.status === "ready" ? identityKey(gate.identity) : null);
  useLayoutEffect(() => {
    if (gate.status === "ready") return;
    const key = gate.status === "aligning" ? identityKey(gate.identity) : "pending";
    if (disposedForRef.current === key) return;
    // Epoch advances FIRST, before any disposer runs: if a disposer ever
    // accidentally touched QueryClient state, that touch would still be
    // attributed to the retiring epoch. Disposers are also required to
    // be teardown-only regardless, so neither protection has to be
    // trusted alone.
    advanceIdentityEpoch(qc, gate.status === "aligning" ? gate.identity : { kind: "pending" });
    runRegisteredDisposers(qc);
    qc.resetQueries(); // NOT qc.clear() -- clear() does not update already-mounted observers; resetQueries() does.
    disposedForRef.current = key;
    if (gate.status === "aligning") setGate({ status: "ready", identity: gate.identity });
    // If gate.status === "pending", stay in pending -- there's no target
    // identity to become "ready" for yet. The retired epoch and cleared
    // cache mean nothing can misattribute a late side effect to the
    // just-retired identity while pending lasts.
  }, [gate, qc]);

  if (gate.status === "pending") return <AuthResolvingFallback />;
  if (gate.status === "aligning") return <AligningFallback />;

  return (
    <IdentityContext.Provider value={gate.identity}>
      {/* Keyed by identity: forces React to fully unmount the previous
          identity's protected subtree and mount a genuinely fresh one on
          every real identity change, rather than reusing existing component
          instances/observers. This is what closes the mounted-consumer gap
          (e.g. a per-list chat channel whose effect deps don't include
          profile id) -- the remount tears its effect down unconditionally,
          regardless of whether its own dependencies changed. */}
      <Fragment key={identityKey(gate.identity)}>{children}</Fragment>
    </IdentityContext.Provider>
  );
}
