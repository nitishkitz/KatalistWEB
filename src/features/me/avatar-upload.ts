import { supabase } from "@/integrations/supabase/client";

export async function uploadAvatarForUser(userId: string, file: File): Promise<string> {
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${userId}/avatar.${ext}`;
  const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, {
    upsert: true,
    contentType: file.type,
  });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  const avatar_url = `${data.publicUrl}?v=${Date.now()}`;
  const { error: rowErr } = await supabase.from("profiles").update({ avatar_url }).eq("id", userId);
  if (rowErr) throw rowErr;
  return avatar_url;
}
