import type { ListRole } from "./types";

/**
 * What the Code Activity tab can truthfully show before any live adapter exists.
 * Only states the app can actually verify appear here: there is no "connected" state in this shell.
 */
export type ShellStatus = "not_configured" | "not_connected";

/** Server-reported setup state. The capabilities endpoint arrives in a later gate (G04 to G06). */
export interface ShellCapabilities {
  /** The operator has configured the GitHub App for this environment. */
  configured: boolean;
}

/**
 * Until the server reports otherwise, the honest answer is "not configured". No request is made
 * and nothing is assumed, so this can never show a fake connection.
 */
export const CURRENT_CAPABILITIES: ShellCapabilities = { configured: false };

export function resolveShellStatus(capabilities: ShellCapabilities | null | undefined): ShellStatus {
  return capabilities?.configured === true ? "not_connected" : "not_configured";
}

/** Whether this role is offered the Connect action once connecting exists. */
export function isConnectOwner(role: ListRole): boolean {
  return role === "owner";
}
