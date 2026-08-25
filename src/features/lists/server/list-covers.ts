import { randomBytes } from "node:crypto";
import { HttpError, defaultGetUser, jsonNoStore, requireSupabaseUser } from "@/lib/supabase-user.server";
import { listCollaborationServerEnabled } from "../list-flags";

const allowed = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);
function validMagic(type: string, bytes: Uint8Array) {
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.slice(0, 8).every((value, index) => value === [137,80,78,71,13,10,26,10][index]);
  return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

export async function uploadListCover(request: Request, listId: string) {
  if (!listCollaborationServerEnabled()) return jsonNoStore({ error: "not_found" }, 404);
  let uploadedPath: string | null = null;
  try {
    const user = await requireSupabaseUser(request, defaultGetUser);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 5 * 1024 * 1024 || !allowed.has(file.type)) return jsonNoStore({ error: "invalid_file" }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!validMagic(file.type, bytes)) return jsonNoStore({ error: "invalid_file" }, 400);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: list } = await supabaseAdmin.from("lists").select("owner_profile_id").eq("id", listId).maybeSingle();
    if (!list || list.owner_profile_id !== user.id) return jsonNoStore({ error: "forbidden" }, 403);
    uploadedPath = `${listId}/${randomBytes(16).toString("hex")}.${allowed.get(file.type)}`;
    const stored = await supabaseAdmin.storage.from("list-covers").upload(uploadedPath, bytes, { contentType: file.type, upsert: false });
    if (stored.error) throw stored.error;
    const updated = await supabaseAdmin.from("lists").update({ cover_storage_path: uploadedPath }).eq("id", listId).eq("owner_profile_id", user.id);
    if (updated.error) throw updated.error;
    return jsonNoStore({ ok: true });
  } catch (error) {
    if (uploadedPath) { const { supabaseAdmin } = await import("@/integrations/supabase/client.server"); await supabaseAdmin.storage.from("list-covers").remove([uploadedPath]).catch(() => undefined); }
    if (error instanceof HttpError) return jsonNoStore({ error: "unauthorized" }, error.status);
    return jsonNoStore({ error: "retryable", message: "Cover image could not be uploaded." }, 503);
  }
}
