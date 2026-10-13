import { maintenanceBlocks, resetUnavailable } from "../../src/lib/reset-controls.server";

// Direct Supabase access and older deployments require provider-side isolation.
export default function resetMaintenance(event: { path?: string; url?: { pathname?: string } }, next: () => unknown) {
  const pathname = event?.url?.pathname ?? (event?.path ?? "/").split("?")[0] ?? "/";
  return maintenanceBlocks(pathname) ? resetUnavailable() : next();
}
