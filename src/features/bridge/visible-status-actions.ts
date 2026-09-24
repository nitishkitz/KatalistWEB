export type BridgeWorkStatus = "not_started" | "under_progress" | "sorted" | "cancelled";

/**
 * H03: work status is forward-only on the server (bridge_act's
 * assert_forward_status rejects a request to go back to "not_started"
 * once work has moved past it -- see
 * supabase/migrations/20260818161732_*.sql). Extracted from
 * bridge.$token.tsx into its own file so the route module only exports the
 * component (react-refresh/only-export-components).
 */
export function visibleStatusActions(
  workStatus: BridgeWorkStatus,
): ("not_started" | "under_progress" | "sorted")[] {
  return (["not_started", "under_progress", "sorted"] as const).filter(
    (s) => s !== "not_started" || workStatus === "not_started",
  );
}
