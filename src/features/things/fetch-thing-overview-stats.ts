import type { Thing, ThingFile } from "@/domain/thing";
import { callUngeneratedRpc } from "@/integrations/supabase/rpcs";
import { detectFileType, formatFileSize } from "@/lib/file-utils";
import { getThingLastReadAt } from "./read-state";
import { signThingAttachmentPaths, type SignedThingPath } from "./attachments";
import type { DbThingRow } from "./map-thing-rows";

type Preview = {
  id: string; storage_key: string; file_name: string;
  mime_type: string | null; byte_size: number | null;
};
type StatsRow = {
  thing_id: string;
  comment_count: number;
  unread_comment_count: number;
  attachment_count: number;
  preview_attachment: Preview | null;
};

export type ThingOverviewStats = Pick<Thing, "commentCount" | "unreadCommentCount" | "attachmentCount"> & {
  previewFile?: ThingFile;
};

/** One RLS-scoped aggregate per <=500 Things and context, then batched URL
 * signing for the at-most-one image/video preview per Thing. No comment
 * bodies or full attachment lists cross the overview network boundary. */
export async function fetchThingOverviewStats(
  rows: DbThingRow[],
  myActorId?: string | null,
  signal?: AbortSignal,
): Promise<Map<string, ThingOverviewStats>> {
  const stats = new Map<string, ThingOverviewStats>();
  const raw: StatsRow[] = [];
  for (const context of ["work", "home"] as const) {
    const scoped = rows.filter((row) => row.context === context);
    for (let offset = 0; offset < scoped.length; offset += 500) {
      const batch = scoped.slice(offset, offset + 500);
      const request = callUngeneratedRpc("get_thing_overview_stats", {
        p_thing_ids: batch.map((row) => row.id),
        p_last_reads: batch.map((row) => {
          const lastRead = getThingLastReadAt(row.id, myActorId);
          return lastRead > 0 ? new Date(lastRead).toISOString() : null;
        }),
        p_context: context,
      });
      const { data, error } = await (signal ? request.abortSignal(signal) : request);
      if (error) throw error;
      raw.push(...(data ?? []) as StatsRow[]);
    }
  }

  const previewPaths = raw.flatMap((row) => {
    const file = row.preview_attachment;
    if (!file?.storage_key) return [];
    const type = detectFileType(file.file_name, file.mime_type ?? undefined);
    return type === "image" || type === "png" || type === "jpg" || type === "video"
      ? [file.storage_key] : [];
  });
  let signed: Map<string, SignedThingPath>;
  try {
    signed = await signThingAttachmentPaths(previewPaths);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Preview signing failed.";
    signed = new Map(previewPaths.map((path) => [path, { error: reason }]));
  }
  for (const row of raw) {
    const preview = row.preview_attachment;
    const outcome = preview?.storage_key ? signed.get(preview.storage_key) : undefined;
    const previewFile: ThingFile | undefined = preview ? {
      id: preview.id,
      name: preview.file_name,
      type: detectFileType(preview.file_name, preview.mime_type ?? undefined),
      url: outcome?.url,
      urlError: outcome?.error,
      sizeLabel: preview.byte_size ? formatFileSize(preview.byte_size) : undefined,
      mimeType: preview.mime_type ?? undefined,
    } : undefined;
    stats.set(row.thing_id, {
      commentCount: row.comment_count,
      unreadCommentCount: row.unread_comment_count,
      attachmentCount: row.attachment_count,
      previewFile,
    });
  }
  return stats;
}
