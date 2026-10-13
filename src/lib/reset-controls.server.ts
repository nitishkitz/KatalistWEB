/** Server-only reset fences. Maintenance is opt-in; workers are opt-in too. */
export function maintenanceActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KATALIST_MAINTENANCE === "true";
}

/** Build identity stays readable during maintenance, so a deployment can be verified before reopening. */
export function maintenanceBlocks(pathname: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return maintenanceActive(env) && pathname !== "/api/version";
}

export function backgroundJobsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !maintenanceActive(env) && env.KATALIST_BACKGROUND_JOBS_ENABLED === "true";
}

export function outboundDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !maintenanceActive(env) && env.KATALIST_OUTBOUND_DELIVERY_ENABLED === "true";
}

export function resetUnavailable(reason = "maintenance"): Response {
  return new Response(JSON.stringify({ error: reason }), {
    status: 503,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "retry-after": "300",
    },
  });
}
