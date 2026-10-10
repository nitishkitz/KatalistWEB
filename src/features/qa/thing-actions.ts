import { katalistRpc } from "@/integrations/supabase/rpcs";
import { rpcCreateThing } from "@/features/things/rpc";
import type { QaRunCase } from "./types";

export type DefectContext = { caseKey: string; title: string; buildIdentifier: string; environmentName: string; actual: string; steps: QaRunCase["steps"]; runName: string };

export const defectTitle = (c: { caseKey: string; title: string }) => `[QA] ${c.caseKey}: ${c.title}`.slice(0, 200);

export function defectNotes(c: DefectContext): string {
  const steps = c.steps.map((s, i) => `${i + 1}. ${s.action}${s.expected ? ` (expected: ${s.expected})` : ""}`).join("\n");
  return [`Found in ${c.runName} on build ${c.buildIdentifier} (${c.environmentName}).`, "", "Steps:", steps || "(none recorded)", "", `Actual result: ${c.actual || "(not recorded)"}`].join("\n").slice(0, 4000);
}

/**
 * Creates a Thing with the app's own create-Thing path (no second bug engine). Ownership and
 * assignment are whatever Katalist assigns on creation; QA never edits them afterwards.
 */
export async function createDefectThing(input: { listId: string; context: "work" | "home"; preview: boolean; ctx: DefectContext }): Promise<string> {
  const title = defectTitle(input.ctx);
  if (input.preview) {
    const created = (await rpcCreateThing({ title, context: input.context, listId: input.listId })) as { id?: string } | null;
    if (!created?.id) throw new Error("The Thing could not be created.");
    return created.id;
  }
  const created = (await katalistRpc.createThing({ p_title: title, p_context: input.context, p_list_id: input.listId, p_notes: defectNotes(input.ctx) })) as { id?: string } | null;
  if (!created?.id) throw new Error("The Thing could not be created.");
  return created.id;
}

// A created-but-not-yet-linked Thing must survive a failed link so a retry never creates a second Thing.
const key = (runCaseId: string) => `katalist.qa.pendingThing.${runCaseId}`;
export const readPendingThing = (runCaseId: string): string | null => {
  try {
    return sessionStorage.getItem(key(runCaseId));
  } catch {
    return null;
  }
};
export const writePendingThing = (runCaseId: string, thingId: string | null) => {
  try {
    if (thingId) sessionStorage.setItem(key(runCaseId), thingId);
    else sessionStorage.removeItem(key(runCaseId));
  } catch {
    /* storage unavailable: the in-memory state still covers the current session */
  }
};
