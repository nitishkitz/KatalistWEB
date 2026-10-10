import { toast } from "sonner";
import { requestMagicBoxReferences } from "@/features/court/magic-box-entry";
import { buildThingPermalink, makeThingReference } from "./thing-reference";

/** Writes the canonical permalink as plain text so any tab or external application can read it. */
async function writePermalink(thingId: string): Promise<string | null> {
  const link = buildThingPermalink(thingId, window.location.origin);
  if (!link) {
    toast.error("This Thing cannot be copied.");
    return null;
  }
  try {
    await navigator.clipboard.writeText(link);
    return link;
  } catch {
    // Clipboard access can be refused (permissions, insecure context). Say so, and leave a link the user can select.
    toast.error("Could not copy automatically. Select the link below to copy it.", {
      description: link,
      duration: 12_000,
    });
    return null;
  }
}

export async function copyThingReference(thingId: string) {
  if (await writePermalink(thingId)) toast.success("Thing copied. Paste it into Magic Box, a message, or a comment.");
}

export async function copyThingLink(thingId: string) {
  if (await writePermalink(thingId)) toast.success("Link copied.");
}

/** Hands the reference to the visible Magic Box. Returns false when none is mounted so the caller can open Court. */
export function addThingToMagicBox(thingId: string): boolean {
  const ref = makeThingReference(thingId);
  if (!ref) {
    toast.error("This Thing cannot be added.");
    return false;
  }
  return requestMagicBoxReferences([ref]);
}
