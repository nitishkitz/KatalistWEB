import { defineEventHandler, readBody, createError } from "h3";
import { requireUser } from "../../lib/require-user";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { resolvePersonToProfileId } from "../../lib/resolve-person";

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
  const { client } = await requireUser(event);

  const body = (await readBody(event)) as {
    listId?: string;
    personId?: string;
    role?: "collaborator" | "view_only";
  } | null;

  const { listId, personId, role = "collaborator" } = body || {};

  if (!listId || !personId) {
    throw createError({ statusCode: 400, message: "listId and personId are required." });
  }

  // 1. Resolve personId to profileId (scoped to what the caller can see)
  let targetProfileId = await resolvePersonToProfileId(client, personId);

  // Fall back to a fixed demo persona, provisioning the account if needed.
  // Demo personas are shared fixtures, not private profiles, so this
  // deliberately looks them up via the admin client - profiles RLS is
  // "own row only" and would otherwise hide an already-provisioned persona
  // from every user except whoever happened to create it first.
  if (!targetProfileId) {
    const demoKey = personId.replace(/^p-/, "").toLowerCase();
    const demoName = DEMO_PERSONAS[demoKey] || Object.values(DEMO_PERSONAS).find((n) => n.toLowerCase().includes(demoKey));
    if (demoName) {
      const admin = getSupabaseAdmin();
      const { data: demoProf } = await admin.from("profiles").select("id").ilike("display_name", demoName).maybeSingle();
      if (demoProf?.id) {
        targetProfileId = demoProf.id;
      } else {
        const email = `${demoName.toLowerCase().replace(/\s+/g, ".")}@users.katalist.invalid`;
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: {
            full_name: demoName,
            display_name: demoName,
          },
        });
        if (createErr) {
          throw createError({ statusCode: 500, message: createErr.message });
        }
        targetProfileId = created?.user?.id ?? null;
      }
    }
  }

  if (!targetProfileId) {
    throw createError({ statusCode: 404, message: `Could not resolve person "${personId}" to a team member profile.` });
  }

  // 2. Delegate the actual membership write to the secured RPC, which
  // enforces "only the List Owner may add members" via auth.uid() itself.
  const { data: member, error } = await client.rpc("add_list_member", {
    p_list_id: listId,
    p_profile_id: targetProfileId,
    p_role: role,
  });

  if (error) {
    throw createError({ statusCode: 403, message: error.message || "Failed to add list member." });
  }

  return {
    ok: true,
    member,
    profileId: targetProfileId,
  };
});
