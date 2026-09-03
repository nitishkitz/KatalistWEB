import { defineEventHandler, readBody } from "h3";
import { createClient } from "@supabase/supabase-js";

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as {
    listIds?: string[];
  } | null;

  const listIds = (body?.listIds ?? []).filter(Boolean);
  if (!listIds.length) {
    return { ok: true, lists: [] };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://dyxqlgnbwtbxxdfoiqva.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5eHFsZ25id3RieHhkZm9pcXZhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzA1Mjg3OCwiZXhwIjoyMTAyNjI4ODc4fQ.INa1hOmRJVNbj7TBGOqRpYEmT4oA9ij8MI_5M77vyG4";

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await admin
    .from("lists")
    .select("id, name")
    .in("id", listIds);

  if (error) {
    return { ok: false, lists: [], error: error.message };
  }

  return { ok: true, lists: data ?? [] };
});
