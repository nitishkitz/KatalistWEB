import { defineEventHandler, readBody, createError } from "h3";
import { createClient } from "@supabase/supabase-js";

const DEMO_PERSONAS: Record<string, string> = {
  priya: "Priya Sharma",
  arjun: "Arjun Mehta",
  sarah: "Sarah Kapoor",
  mike: "Mike Fernandes",
  neha: "Neha Rao",
  rahul: "Rahul Mehta",
  sai: "Sai",
};

export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) as {
    listId?: string;
    personId?: string;
    role?: "collaborator" | "view_only";
  } | null;

  const { listId, personId, role = "collaborator" } = body || {};

  if (!listId || !personId) {
    throw createError({ statusCode: 400, message: "listId and personId are required." });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://dyxqlgnbwtbxxdfoiqva.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5eHFsZ25id3RieHhkZm9pcXZhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzA1Mjg3OCwiZXhwIjoyMTAyNjI4ODc4fQ.INa1hOmRJVNbj7TBGOqRpYEmT4oA9ij8MI_5M77vyG4";

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw createError({ statusCode: 500, message: "SUPABASE_SERVICE_ROLE_KEY is not configured." });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1. Resolve personId to profileId
  let targetProfileId: string | null = null;

  // Check if personId is in actors table
  const { data: actor } = await admin.from("actors").select("id, profile_id").eq("id", personId).maybeSingle();
  if (actor?.profile_id) {
    targetProfileId = actor.profile_id;
  }

  // Check if personId is already a profile_id
  if (!targetProfileId) {
    const { data: prof } = await admin.from("profiles").select("id").eq("id", personId).maybeSingle();
    if (prof?.id) {
      targetProfileId = prof.id;
    }
  }

  // Check if personId matches a display_name in profiles
  if (!targetProfileId) {
    const { data: byName } = await admin.from("profiles").select("id").ilike("display_name", `%${personId}%`).limit(1);
    if (byName?.[0]?.id) {
      targetProfileId = byName[0].id;
    }
  }

  // Check if personId is a demo persona key/name
  if (!targetProfileId) {
    const demoKey = personId.replace(/^p-/, "").toLowerCase();
    const demoName = DEMO_PERSONAS[demoKey] || Object.values(DEMO_PERSONAS).find((n) => n.toLowerCase().includes(demoKey));
    if (demoName) {
      const { data: demoProf } = await admin.from("profiles").select("id").ilike("display_name", demoName).maybeSingle();
      if (demoProf?.id) {
        targetProfileId = demoProf.id;
      } else {
        const email = `${demoName.toLowerCase().replace(/\s+/g, ".")}@users.katalist.invalid`;
        const { data: created } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: {
            full_name: demoName,
            display_name: demoName,
            uat_profile_complete: true,
          },
        });
        if (created?.user?.id) {
          targetProfileId = created.user.id;
        }
      }
    }
  }

  if (!targetProfileId) {
    throw createError({ statusCode: 404, message: `Could not resolve person "${personId}" to a team member profile.` });
  }

  // 2. Fetch list
  const { data: listData, error: listErr } = await admin
    .from("lists")
    .select("id, owner_profile_id")
    .eq("id", listId)
    .single();

  if (listErr || !listData) {
    throw createError({ statusCode: 404, message: "List not found." });
  }

  // 3. Upsert into list_members
  const { data: member, error: insertErr } = await admin
    .from("list_members")
    .upsert(
      {
        list_id: listId,
        profile_id: targetProfileId,
        role,
        added_by_profile_id: listData.owner_profile_id,
      },
      { onConflict: "list_id,profile_id" }
    )
    .select()
    .single();

  if (insertErr) {
    throw createError({ statusCode: 500, message: insertErr.message || "Failed to insert list member." });
  }

  return {
    ok: true,
    member,
    profileId: targetProfileId,
  };
});
