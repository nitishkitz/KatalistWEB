import type { ListRole } from "./types";

/**
 * Who sees and can use what in the Code Activity UI. These are display rules.
 * The server and database must enforce the same rules independently (contracts.md).
 *
 * - Everyone in the List reads activity, checks, and available diffs, including View Only members.
 * - Only the Owner connects, disconnects, and changes private-content (AI) consent.
 * - Only Owners and Collaborators draft, summarize, and create.
 * - Consent is never inferred from using a drafting action.
 */
export interface Capabilities {
  canRead: boolean;
  canManageConnection: boolean;
  canChangeConsent: boolean;
  canRefresh: boolean;
  /** Draft and summarize actions are shown at all. */
  showAiActions: boolean;
  canCreateThings: boolean;
}

export function capabilitiesFor(role: ListRole): Capabilities {
  const owner = role === "owner";
  const collaborator = role === "collaborator";
  return {
    canRead: true,
    canManageConnection: owner,
    canChangeConsent: owner,
    canRefresh: owner || collaborator,
    showAiActions: owner || collaborator,
    canCreateThings: owner || collaborator,
  };
}

export type AiActionState =
  | { visible: false }
  | { visible: true; enabled: true }
  | { visible: true; enabled: false; reason: "consent_off_owner" | "consent_off_member"; message: string };

/** State of "Draft with Coey" and "Summarize change". Disabled actions always carry a stated reason. */
export function aiActionState(role: ListRole, consent: boolean): AiActionState {
  const caps = capabilitiesFor(role);
  if (!caps.showAiActions) return { visible: false };
  if (consent) return { visible: true, enabled: true };
  if (caps.canChangeConsent) {
    return {
      visible: true,
      enabled: false,
      reason: "consent_off_owner",
      message:
        "Private repository content is not sent to an AI service for this List. Clicking Draft does not turn this on.",
    };
  }
  return {
    visible: true,
    enabled: false,
    reason: "consent_off_member",
    message: "Drafting is turned off for this List. Ask the List Owner to enable.",
  };
}
