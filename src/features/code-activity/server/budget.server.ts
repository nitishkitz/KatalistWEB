import type { RequestMeter } from "./github.server";
import type { RpcClient } from "./service.server";

/** Credits reserved from the database per round trip. Any unused credits are simply forfeited (conservative). */
export const METER_CHUNK = 5;

/**
 * A meter for one installation. It reserves requests from the shared hourly budget (`code_activity_server_take_budget`:
 * 700 background and 300 interactive per hour) in small chunks, then spends them locally, so every provider request is
 * counted without a database round trip per request. If the budget cannot be taken, `take` says no and the caller
 * makes NO request. A database error is treated as "no": failing closed protects the provider limit.
 */
export function createMeter(admin: () => RpcClient, installationId: number, interactive: boolean, chunk: number = METER_CHUNK): RequestMeter & { requests: () => number } {
  let credits = 0;
  let spent = 0;
  return {
    async take() {
      if (credits === 0) {
        const taken = await admin().rpc("code_activity_server_take_budget", { p_installation_id: installationId, p_cost: chunk, p_interactive: interactive });
        if (taken.error || taken.data !== true) return false;
        credits = chunk;
      }
      credits -= 1;
      spent += 1;
      return true;
    },
    requests: () => spent,
  };
}
