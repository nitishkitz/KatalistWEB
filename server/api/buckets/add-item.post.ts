import { defineEventHandler, readBody, createError } from "h3";
import { createClient } from "@supabase/supabase-js";

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as {
    bucketId?: string;
    thingId?: string;
    listId?: string;
  } | null;

  const { bucketId, thingId, listId } = body || {};

  if (!bucketId || (!thingId && !listId)) {
    throw createError({ statusCode: 400, message: "bucketId and either thingId or listId are required." });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://dyxqlgnbwtbxxdfoiqva.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5eHFsZ25id3RieHhkZm9pcXZhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzA1Mjg3OCwiZXhwIjoyMTAyNjI4ODc4fQ.INa1hOmRJVNbj7TBGOqRpYEmT4oA9ij8MI_5M77vyG4";

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Check if item already exists in bucket
  let query = admin.from("bucket_items").select("id").eq("bucket_id", bucketId);
  if (thingId) query = query.eq("thing_id", thingId);
  if (listId) query = query.eq("list_id", listId);

  const { data: existing } = await query.maybeSingle();

  if (existing?.id) {
    return { ok: true, id: existing.id, message: "Item already in bucket" };
  }

  // Insert item into bucket_items
  const { data: inserted, error: insertError } = await admin
    .from("bucket_items")
    .insert({
      bucket_id: bucketId,
      thing_id: thingId || null,
      list_id: listId || null,
    })
    .select()
    .single();

  if (insertError) {
    throw createError({ statusCode: 500, message: insertError.message });
  }

  // Update bucket updated_at timestamp
  await admin
    .from("buckets")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", bucketId);

  return { ok: true, data: inserted };
});
