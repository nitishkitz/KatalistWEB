import { callUngeneratedRpc } from "@/integrations/supabase/rpcs";
import { isPreviewMode } from "@/lib/session-mode";
import { currentDemoActorId } from "@/features/demo/identities";
import { getThing, patchThing } from "../local-state";
import { descriptionText, sanitizeDescription, type DescriptionDocument } from "./document";

export async function saveThingDescription(
  thingId: string,
  document: DescriptionDocument,
  expectedRevision: number,
) {
  const clean = sanitizeDescription(document);
  const content = descriptionText(clean) ? clean : null;
  if (isPreviewMode()) {
    const thing = getThing(thingId);
    if (!thing || thing.owner.id !== currentDemoActorId())
      throw new Error("Only the current Thing owner can edit the description.");
    if ((thing.descriptionRevision ?? 0) !== expectedRevision)
      throw new Error("Description changed in another session. Reload the saved description.");
    const patch = {
      descriptionDocument: content,
      descriptionRevision: expectedRevision + 1,
      descriptionUpdatedAt: new Date().toISOString(),
    };
    patchThing(thingId, patch, "description_updated");
    return patch;
  }
  const { data, error } = await callUngeneratedRpc("set_thing_description", {
    p_thing_id: thingId,
    p_document: content,
    p_expected_revision: expectedRevision,
  });
  if (error) throw new Error(error.message);
  const row = data as {
    description_document: DescriptionDocument | null;
    description_revision: number;
    description_updated_at: string;
    description_updated_by: string;
    updated_at: string;
  };
  return {
    descriptionDocument: row.description_document,
    descriptionRevision: row.description_revision,
    descriptionUpdatedAt: row.description_updated_at,
    descriptionUpdatedBy: row.description_updated_by,
    updatedAt: row.updated_at,
  };
}
