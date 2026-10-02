import { useCallback, useEffect, useState } from "react";
import * as tus from "tus-js-client";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_BUCKET = "bucket-note-files";
const RESUMABLE_THRESHOLD = 6 * 1024 * 1024;
const MAX_FILE_BYTES = 200 * 1024 * 1024;

export type NoteFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  path: string;
  url: string | null;
  progress: number;
  state: "ready" | "uploading" | "error";
  error?: string;
};

const attachmentsTable = () => supabase.from("bucket_note_attachments");

function uploadError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/bucket not found/i.test(message)) {
    return new Error("Note uploads aren’t ready yet. The private Notes storage bucket needs to be set up.");
  }
  return error instanceof Error ? error : new Error(message);
}

async function signedUrl(path: string) {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, 15 * 60);
  if (error) throw error;
  return data.signedUrl;
}

async function resumableUpload(path: string, file: File, onProgress: (value: number) => void) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Sign in to attach files.");
  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${baseUrl}/storage/v1/upload/resumable`,
      headers: { authorization: `Bearer ${token}`, apikey: apiKey, "x-upsert": "false" },
      chunkSize: RESUMABLE_THRESHOLD,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: STORAGE_BUCKET, objectName: path, contentType: file.type || "application/octet-stream" },
      onProgress: (sent, total) => onProgress(Math.round((sent / total) * 100)),
      onError: reject,
      onSuccess: () => resolve(),
    });
    void upload.findPreviousUploads().then((previous) => {
      if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }, reject);
  });
}

export function useBucketNoteFiles(noteId: string | null, ownerId: string | undefined) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<NoteFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!noteId || !ownerId) { setFiles([]); return; }
    setLoading(true);
    try {
      const { data, error } = await attachmentsTable()
        .select("id,storage_path,file_name,mime_type,byte_size")
        .eq("note_id", noteId).is("deleted_at", null).order("created_at", { ascending: true });
      if (error) throw error;
      const resolved = await Promise.all(((data ?? []) as Array<{ id: string; storage_path: string; file_name: string; mime_type: string | null; byte_size: number }>).map(async (row) => ({
        id: row.id, name: row.file_name, mime: row.mime_type || "application/octet-stream", size: row.byte_size,
        path: row.storage_path, url: await signedUrl(row.storage_path).catch(() => null), progress: 100,
        state: "ready" as const,
      })));
      setFiles(resolved);
    } finally { setLoading(false); }
  }, [noteId, ownerId]);

  useEffect(() => { void refresh().catch(() => setLoading(false)); }, [refresh]);

  const upload = useCallback(async (file: File) => {
    if (!noteId || !ownerId) throw new Error("Create a note before attaching files.");
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} exceeds the 200 MB limit.`);
    // Check the private bucket before adding an optimistic card. This keeps a
    // missing database migration from leaving broken attachment tiles behind.
    const { error: bucketError } = await supabase.storage.from(STORAGE_BUCKET).list(`${ownerId}/${noteId}`, { limit: 1 });
    if (bucketError) {
      const resolved = uploadError(bucketError);
      setStorageError(resolved.message);
      throw resolved;
    }
    setStorageError(null);
    const id = crypto.randomUUID();
    const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(0, 100) || "file";
    const path = `${ownerId}/${noteId}/${id}-${safeName}`;
    const pending: NoteFile = { id, name: file.name, mime: file.type || "application/octet-stream", size: file.size, path, url: null, progress: 0, state: "uploading" };
    setFiles((old) => [...old, pending]);
    const progress = (value: number) => setFiles((old) => old.map((item) => item.id === id ? { ...item, progress: value } : item));
    try {
      if (file.size > RESUMABLE_THRESHOLD) await resumableUpload(path, file, progress);
      else {
        const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, { upsert: false, contentType: pending.mime });
        if (error) throw error;
      }
      const { error } = await attachmentsTable().insert({
        id, note_id: noteId, owner_profile_id: ownerId, storage_path: path,
        file_name: file.name, mime_type: pending.mime, byte_size: file.size,
      });
      if (error) throw error;
      const url = await signedUrl(path).catch(() => null);
      setFiles((old) => old.map((item) => item.id === id ? { ...item, url, progress: 100, state: "ready" } : item));
      void queryClient.invalidateQueries({ queryKey: ["bucket-note-summaries", ownerId] });
    } catch (error) {
      const resolved = uploadError(error);
      if (/bucket not found/i.test(String(error))) setStorageError(resolved.message);
      setFiles((old) => /bucket not found/i.test(String(error))
        ? old.filter((item) => item.id !== id)
        : old.map((item) => item.id === id ? { ...item, state: "error", error: resolved.message } : item));
      throw resolved;
    }
  }, [noteId, ownerId, queryClient]);

  const remove = useCallback(async (file: NoteFile) => {
    if (file.state === "error" || file.state === "uploading") {
      setFiles((old) => old.filter((item) => item.id !== file.id));
      return;
    }
    const { error } = await attachmentsTable().update({ deleted_at: new Date().toISOString() }).eq("id", file.id);
    if (error) throw error;
    setFiles((old) => old.filter((item) => item.id !== file.id));
    void queryClient.invalidateQueries({ queryKey: ["bucket-note-summaries", ownerId] });
    void supabase.storage.from(STORAGE_BUCKET).remove([file.path]);
  }, [ownerId, queryClient]);

  return { files, loading, storageError, refresh, upload, remove };
}
