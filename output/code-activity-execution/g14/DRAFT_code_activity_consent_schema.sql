-- DRAFT (G14). NOT a migration. NOT in supabase/migrations. NOT applied anywhere. NOT reviewed.
-- Optional Coey: per-List consent, a usage log for rate limits, and the checks every AI call must pass.
-- Depends on the G03 and G07 drafts. Connecting GitHub NEVER enables AI: consent is a separate, default-off setting.
-- The 'ai' flag in code_activity_settings (operator-only) must also be on. Absent or false means off.

CREATE TABLE public.code_activity_consents (
  list_id               uuid PRIMARY KEY REFERENCES public.lists(id) ON DELETE CASCADE,
  enabled               boolean NOT NULL DEFAULT false,
  changed_by_profile_id uuid REFERENCES public.profiles(id),
  changed_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.code_activity_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.code_activity_consents FROM PUBLIC, anon, authenticated, service_role;

-- One row per AI attempt, successful or not. Used only for rate limits. No content is ever stored.
CREATE TABLE public.code_activity_ai_usage (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  list_id     uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('draft','summary')),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX code_activity_ai_usage_profile_idx ON public.code_activity_ai_usage (profile_id, at);
CREATE INDEX code_activity_ai_usage_list_idx ON public.code_activity_ai_usage (list_id, at);
ALTER TABLE public.code_activity_ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.code_activity_ai_usage FROM PUBLIC, anon, authenticated, service_role;

-- Whether AI is switched on at all for this List and whether the owner has consented. A BOOLEAN pair for any
-- member (View Only included), never who or when. Same empty answer for outsiders and disabled features.
CREATE FUNCTION public.code_activity_ai_status(p_list_id uuid)
RETURNS TABLE (o_available boolean, o_consent boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
  SELECT katalist_priv.code_activity_flag('ai'),
         COALESCE((SELECT c.enabled FROM public.code_activity_consents c WHERE c.list_id = p_list_id), false)
  WHERE katalist_priv.code_activity_enabled_for(p_list_id);
$$;

-- Owner only. Audit details (who and when) are visible to the owner only.
CREATE FUNCTION public.code_activity_set_consent(p_list_id uuid, p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
BEGIN
  IF auth.uid() IS NULL OR p_enabled IS NULL OR NOT katalist_priv.is_list_owner(p_list_id)
     OR NOT katalist_priv.code_activity_flags_ok_for(p_list_id) OR NOT katalist_priv.code_activity_flag('ai') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.code_activity_consents (list_id, enabled, changed_by_profile_id, changed_at)
  VALUES (p_list_id, p_enabled, auth.uid(), now())
  ON CONFLICT (list_id) DO UPDATE SET enabled = EXCLUDED.enabled, changed_by_profile_id = EXCLUDED.changed_by_profile_id, changed_at = EXCLUDED.changed_at;
  RETURN p_enabled;
END;
$$;

CREATE FUNCTION public.code_activity_consent_details(p_list_id uuid)
RETURNS TABLE (o_enabled boolean, o_changed_at timestamptz, o_changed_by uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
  SELECT c.enabled, c.changed_at, c.changed_by_profile_id FROM public.code_activity_consents c
   WHERE c.list_id = p_list_id AND katalist_priv.is_list_owner(p_list_id) AND katalist_priv.code_activity_flags_ok_for(p_list_id);
$$;

-- Start of every AI call. Owners and collaborators only, with the flag AND consent on, and a rate limit of
-- 3 per person per 10 minutes and 20 per List per hour (failures count, so a loop cannot run free).
-- p_change_id must belong to this List's ACTIVE connection. Returns that connection's ID and generation: every later
-- check is bound to BOTH. The generation alone would not do: a replacement connection for the same List starts at 1
-- again, so a request that began on the old connection would pass its check against the new one.
-- Admission is serialized per person and per List with transaction-scoped advisory locks (always person first, then
-- List, so two callers cannot deadlock). A count followed by an insert is NOT safe without them: two concurrent
-- callers would both see a count below the limit.
CREATE FUNCTION public.code_activity_ai_begin(p_list_id uuid, p_change_id uuid, p_kind text)
RETURNS TABLE (o_connection_id uuid, o_generation integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE v_me uuid := auth.uid(); v_gen integer; v_conn uuid;
BEGIN
  IF v_me IS NULL OR p_kind IS NULL OR p_kind NOT IN ('draft','summary')
     OR NOT katalist_priv.can_create_thing_in_list(p_list_id)
     OR NOT katalist_priv.code_activity_enabled_for(p_list_id)
     OR NOT katalist_priv.code_activity_flag('ai')
     OR NOT COALESCE((SELECT c.enabled FROM public.code_activity_consents c WHERE c.list_id = p_list_id), false) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT cn.id, cn.generation INTO v_conn, v_gen FROM public.code_activity_changes ch JOIN public.code_activity_connections cn ON cn.id = ch.connection_id
   WHERE ch.id = p_change_id AND cn.list_id = p_list_id AND cn.status = 'active' AND NOT cn.needs_reverification;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('code_activity_ai:person:' || v_me::text));
  PERFORM pg_advisory_xact_lock(hashtext('code_activity_ai:list:' || p_list_id::text));
  DELETE FROM public.code_activity_ai_usage WHERE at < now() - interval '2 hours';
  IF (SELECT count(*) FROM public.code_activity_ai_usage WHERE profile_id = v_me AND at > now() - interval '10 minutes') >= 3
     OR (SELECT count(*) FROM public.code_activity_ai_usage WHERE list_id = p_list_id AND at > now() - interval '1 hour') >= 20 THEN
    RAISE EXCEPTION 'rate limited' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.code_activity_ai_usage (list_id, profile_id, kind) VALUES (p_list_id, v_me, p_kind);
  o_connection_id := v_conn; o_generation := v_gen;
  RETURN NEXT;
END;
$$;

-- Asked IMMEDIATELY BEFORE any content is sent to a model, and again after the reply. True only if, right now, the
-- caller may still create here, the flags and the owner's consent are on, AND the connection is still active at the
-- generation the call started with (a disconnect, revocation or re-verification changes it).
CREATE FUNCTION public.code_activity_ai_still_allowed(p_list_id uuid, p_connection_id uuid, p_generation integer)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
  SELECT katalist_priv.can_create_thing_in_list(p_list_id)
     AND katalist_priv.code_activity_enabled_for(p_list_id)
     AND katalist_priv.code_activity_flag('ai')
     AND COALESCE((SELECT c.enabled FROM public.code_activity_consents c WHERE c.list_id = p_list_id), false)
     AND EXISTS (SELECT 1 FROM public.code_activity_connections cn
                  WHERE cn.id = p_connection_id AND cn.list_id = p_list_id AND cn.status = 'active'
                    AND cn.generation = p_generation AND NOT cn.needs_reverification);
$$;

REVOKE ALL ON FUNCTION
  public.code_activity_ai_status(uuid), public.code_activity_set_consent(uuid, boolean),
  public.code_activity_consent_details(uuid), public.code_activity_ai_begin(uuid, uuid, text),
  public.code_activity_ai_still_allowed(uuid, uuid, integer)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.code_activity_ai_status(uuid), public.code_activity_set_consent(uuid, boolean),
  public.code_activity_consent_details(uuid), public.code_activity_ai_begin(uuid, uuid, text),
  public.code_activity_ai_still_allowed(uuid, uuid, integer)
TO authenticated;

NOTIFY pgrst, 'reload schema';
