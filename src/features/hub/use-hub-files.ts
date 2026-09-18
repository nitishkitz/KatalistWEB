import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { fetchProfileIdentities } from "@/features/people/directory";

const FILES_BUCKET = "hub-files";
const SIGNED_URL_TTL_SECONDS = 3600;

export type HubFile = {
  id: string;
  listId: string;
  parentId: string | null;
  isFolder: boolean;
  name: string;
  storagePath: string | null;
  mime: string | null;
  size: number | null;
  createdBy: string;
  ownerName: string;
  createdAt: string;
};

async function fetchFiles(listId: string, parentId: string | null): Promise<HubFile[]> {
  let q = supabase
    .from("hub_files")
    .select("id, list_id, parent_id, is_folder, name, storage_path, mime, size, created_by, created_at")
    .eq("list_id", listId)
    .is("deleted_at", null);
  q = parentId === null ? q.is("parent_id", null) : q.eq("parent_id", parentId);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    list_id: string;
    parent_id: string | null;
    is_folder: boolean;
    name: string;
    storage_path: string | null;
    mime: string | null;
    size: number | null;
    created_by: string;
    created_at: string;
  }>;

  const identities = await fetchProfileIdentities();
  const nameById = new Map(identities.map((p) => [p.id, p.display_name?.trim() || "Member"]));

  const files = rows.map((r) => ({
    id: r.id,
    listId: r.list_id,
    parentId: r.parent_id,
    isFolder: r.is_folder,
    name: r.name,
    storagePath: r.storage_path,
    mime: r.mime,
    size: r.size,
    createdBy: r.created_by,
    ownerName: nameById.get(r.created_by) ?? "Member",
    createdAt: r.created_at,
  }));

  // Folders first, then alphabetical.
  files.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return files;
}

/** Resolve a fresh signed URL for a stored file (bucket is private). */
export async function getHubFileUrl(storagePath: string): Promise<string | null> {
  const { data } = await supabase.storage.from(FILES_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  return data?.signedUrl ?? null;
}

export function useHubFiles(listId: string, parentId: string | null) {
  const { user } = useSession();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["hub-files", listId, parentId],
    enabled: Boolean(listId) && Boolean(user),
    staleTime: 10_000,
    queryFn: () => fetchFiles(listId, parentId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["hub-files", listId] });

  const createFolder = useMutation({
    mutationFn: async (name: string) => {
      if (!user?.id) throw new Error("Sign in to create a folder.");
      const clean = name.trim();
      if (!clean) throw new Error("A folder needs a name.");
      const { error } = await supabase.from("hub_files").insert({
        list_id: listId,
        parent_id: parentId,
        is_folder: true,
        name: clean,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!user?.id) throw new Error("Sign in to upload files.");
      const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(0, 120) || "file";
      const key = `${listId}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from(FILES_BUCKET).upload(key, file, {
        contentType: file.type || undefined,
        upsert: false,
      });
      if (upErr) throw upErr;
      const { error } = await supabase.from("hub_files").insert({
        list_id: listId,
        parent_id: parentId,
        is_folder: false,
        name: file.name,
        storage_path: key,
        mime: file.type || null,
        size: file.size,
        created_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const rename = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const clean = name.trim();
      if (!clean) throw new Error("A name is required.");
      const { error } = await supabase.from("hub_files").update({ name: clean }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const move = useMutation({
    mutationFn: async ({ id, targetParentId }: { id: string; targetParentId: string | null }) => {
      const { error } = await supabase.from("hub_files").update({ parent_id: targetParentId }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (item: HubFile) => {
      // Soft-delete the row so history is preserved; best-effort remove the blob.
      const { error } = await supabase.from("hub_files").update({ deleted_at: new Date().toISOString() }).eq("id", item.id);
      if (error) throw error;
      if (item.storagePath) {
        void supabase.storage.from(FILES_BUCKET).remove([item.storagePath]);
      }
    },
    onSuccess: invalidate,
  });

  return {
    files: query.data ?? [],
    isLoading: query.isLoading,
    createFolder,
    upload,
    rename,
    move,
    remove,
  };
}
