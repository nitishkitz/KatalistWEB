/**
 * Pure rules for spoken replies about on-screen proposals. Nothing here
 * performs an action: callers dispatch only the result that names a visible,
 * unexpired proposal, and the server's preview/confirm endpoints remain the
 * only way a write happens.
 */
export type VisibleProposal = {
  proposalId: string;
  /** The session that was live when the proposal was shown. */
  sessionId: string;
  /** Epoch ms when the preview token expires. */
  expiresAt: number;
};

export type OpenTarget = { type: "thing" | "list" | "bucket"; id: string };

export type SpokenReply =
  | { kind: "confirm"; proposalId: string }
  | { kind: "cancel"; proposalId: string }
  | { kind: "open"; target: OpenTarget }
  | { kind: "no_proposal" }
  | { kind: "expired"; proposalId: string }
  | { kind: "stale_session" }
  | { kind: "none" };

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const YES = /^(yes|yeah|yep|yup|confirm|go ahead|do it|sure|ok|okay)( please| thanks| thank you)?$/;
const NO = /^(no|nope|cancel|never mind|dont|do not)( please| thanks| thank you)?$/;
const OPEN = /^(open|show)( it| that| this| the first one| the first)?$/;

export function interpretSpokenReply(
  text: string,
  context: {
    proposal: VisibleProposal | null;
    sessionId: string | null;
    now: number;
    /** Open targets currently visible on screen. "open it" needs exactly one. */
    openTargets: OpenTarget[];
  },
): SpokenReply {
  const t = normalize(text);
  const yes = YES.test(t);
  const no = NO.test(t);
  if (yes || no) {
    const { proposal } = context;
    if (!proposal) return { kind: "no_proposal" };
    if (!context.sessionId || proposal.sessionId !== context.sessionId) return { kind: "stale_session" };
    if (context.now >= proposal.expiresAt) return { kind: "expired", proposalId: proposal.proposalId };
    return yes ? { kind: "confirm", proposalId: proposal.proposalId } : { kind: "cancel", proposalId: proposal.proposalId };
  }
  if (OPEN.test(t) && context.openTargets.length === 1) return { kind: "open", target: context.openTargets[0] };
  return { kind: "none" };
}

type PreviewForReadback = {
  action: { label: string };
  targets: Array<{ title: string; state: string }>;
};

/** The sentence spoken and shown for a prepared proposal, built only from the server's preview. */
export function readbackText(preview: PreviewForReadback): string {
  const ready = preview.targets.filter((target) => target.state === "ready");
  if (!ready.length) return `${preview.action.label}. Nothing is ready to change.`;
  const shown = ready.slice(0, 3).map((target) => target.title);
  const more = ready.length > shown.length ? ` and ${ready.length - shown.length} more` : "";
  return `${preview.action.label}. ${ready.length === 1 ? "Thing" : "Things"}: ${shown.join(", ")}${more}. Say yes to confirm or no to cancel.`;
}

/** Spoken and shown result, built only from the server's confirm response. */
export function resultText(results: Array<{ title: string; state: string; message?: string }>): string {
  const applied = results.filter((r) => r.state === "applied").length;
  const already = results.filter((r) => r.state === "already_applied").length;
  const bad = results.filter((r) => r.state === "rejected" || r.state === "failed").length;
  if (!applied && !already && bad) return `That did not go through. ${bad} Thing${bad === 1 ? "" : "s"} could not be changed.`;
  if (bad) return `Done for ${applied + already}, but ${bad} could not be changed.`;
  if (!applied && already) return "Everything was already up to date.";
  return `Done. ${applied} Thing${applied === 1 ? "" : "s"} updated.`;
}
