import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_BUCKET = "bucket-note-files";
const PAGE_SIZE = 500;

type AttachmentRow = {
  note_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  created_at: string;
};
type LinkRow = { note_id: string; target_kind: string };

export type NoteCover = {
  name: string;
  mime: string;
  url: string | null;
  kind: "image" | "pdf" | "video" | "document" | "file";
};
export type NoteSummary = {
  fileCount: number;
  thingCount: number;
  listCount: number;
  cover: NoteCover | null;
};

function coverKind(mime: string, name: string): NoteCover["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (mime.startsWith("video/")) return "video";
  if (/\.(docx?|xlsx?|pptx?|csv|txt|rtf)$/i.test(name)) return "document";
  return "file";
}

const coverPriority: Record<NoteCover["kind"], number> = {
  image: 0, pdf: 1, video: 2, document: 3, file: 4,
};

async function readAll<T>(fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }
  return rows;
}

export function useBucketNoteSummaries(noteIds: string[], ownerId: string | undefined) {
  const ids = [...noteIds].sort();
  const idsKey = ids.join(",");
  return useQuery({
    queryKey: ["bucket-note-summaries", ownerId, idsKey],
    enabled: Boolean(ownerId) && ids.length > 0,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<Record<string, NoteSummary>> => {
      const [attachments, links] = await Promise.all([
        readAll<AttachmentRow>(async (from, to) => {
          const { data, error } = await supabase.from("bucket_note_attachments")
            .select("note_id,storage_path,file_name,mime_type,created_at")
            .in("note_id", ids).is("deleted_at", null)
            .order("created_at", { ascending: true }).range(from, to);
          return { data, error };
        }),
        readAll<LinkRow>(async (from, to) => {
          const { data, error } = await supabase.from("bucket_note_links")
            .select("note_id,target_kind")
            .in("note_id", ids).order("created_at", { ascending: true }).range(from, to);
          return { data, error };
        }),
      ]);
      const summary: Record<string, NoteSummary> = Object.fromEntries(ids.map((id) => [id, {
        fileCount: 0, thingCount: 0, listCount: 0, cover: null,
      }]));
      const candidates = new Map<string, AttachmentRow>();
      for (const file of attachments) {
        const item = summary[file.note_id];
        if (!item) continue;
        item.fileCount += 1;
        const previous = candidates.get(file.note_id);
        if (!previous || coverPriority[coverKind(file.mime_type ?? "", file.file_name)] < coverPriority[coverKind(previous.mime_type ?? "", previous.file_name)]) {
          candidates.set(file.note_id, file);
        }
      }
      for (const link of links) {
        const item = summary[link.note_id];
        if (!item) continue;
        if (link.target_kind === "thing") item.thingCount += 1;
        if (link.target_kind === "list") item.listCount += 1;
      }
      await Promise.all([...candidates].map(async ([noteId, file]) => {
        const mime = file.mime_type ?? "application/octet-stream";
        const kind = coverKind(mime, file.file_name);
        const { data } = kind === "image" || kind === "pdf" || kind === "video"
          ? await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(file.storage_path, 60 * 60)
          : { data: null };
        summary[noteId].cover = { name: file.file_name, mime, kind, url: data?.signedUrl ?? null };
      }));
      return summary;
    },
  });
}
