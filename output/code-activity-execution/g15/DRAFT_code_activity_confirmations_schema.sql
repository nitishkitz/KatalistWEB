-- DRAFT (G15). NOT a migration. NOT in supabase/migrations. NOT applied anywhere. NOT reviewed.
-- Atomic, idempotent creation of a Thing from a change. Depends on the G03 and G07 drafts and on the EXISTING
-- public.create_thing(...) and katalist_priv.current_actor_id(). Nothing existing is modified.
-- The receipt and the Thing are created in ONE transaction: both exist or neither does.

CREATE TABLE public.code_activity_confirmations (
  actor_id        uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
  list_id         uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  payload_hash    text NOT NULL,
  thing_id        uuid REFERENCES public.things(id) ON DELETE SET NULL,
  evidence        jsonb NOT NULL CHECK (octet_length(evidence::text) <= 2048),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, list_id, idempotency_key)
);
-- A permanent minimal record: no time-based deletion, so a late replay can never create a duplicate.
ALTER TABLE public.code_activity_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.code_activity_confirmations FROM PUBLIC, anon, authenticated, service_role;

-- People who can be assigned from here: the List owner and CURRENT collaborators. View Only members and
-- non-members never appear. Owners and collaborators only may ask.
CREATE FUNCTION public.code_activity_assignee_candidates(p_list_id uuid)
RETURNS TABLE (actor_id uuid, name text, role text, is_self boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE v_me uuid := katalist_priv.current_actor_id();
BEGIN
  IF v_me IS NULL OR NOT katalist_priv.can_create_thing_in_list(p_list_id)
     OR NOT katalist_priv.code_activity_flags_ok_for(p_list_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT a.id, COALESCE(NULLIF(btrim(p.display_name), ''), 'Member'), 'owner'::text, a.id = v_me
      FROM public.lists l JOIN public.actors a ON a.profile_id = l.owner_profile_id
      JOIN public.profiles p ON p.id = a.profile_id
     WHERE l.id = p_list_id
    UNION ALL
    SELECT a.id, COALESCE(NULLIF(btrim(p.display_name), ''), 'Member'), 'collaborator'::text, a.id = v_me
      FROM public.list_members m JOIN public.actors a ON a.profile_id = m.profile_id
      JOIN public.profiles p ON p.id = m.profile_id
     WHERE m.list_id = p_list_id AND m.role = 'collaborator'
    ORDER BY 3, 2;
END;
$$;

-- Confirm a draft. Every check is inside the function, so a direct call is exactly as safe as the route.
-- Errors: 42501 not allowed; 22023 invalid input; 55000 the source changed (confirm again knowingly);
-- CA001 AI-written content while AI is off or the owner has not consented; 23505 the key was already used for
-- DIFFERENT content. A repeat of the SAME request returns the original result.
--
-- Two separate paths, deliberately:
--   REPLAY  (a receipt exists): the person must still be able to see the List, and gets the Thing id back only if they
--           can still see that Thing. It does NOT need the feature switched on: a request that completed must stay
--           answerable after a shutdown, or a late retry could look like a failure and be re-sent elsewhere.
--   CREATE  (no receipt): everything is checked afresh, including the flags and, for AI-written text, consent.
CREATE FUNCTION public.confirm_code_activity_draft(
  p_list_id uuid, p_change_id uuid, p_idempotency_key uuid, p_title text, p_notes text, p_assignee_actor_id uuid,
  p_due_at timestamptz, p_importance text, p_head_sha text, p_acknowledge_source_change boolean, p_ai_generated boolean)
RETURNS TABLE (o_thing_id uuid, o_replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE
  v_me uuid := katalist_priv.current_actor_id();
  v_hash text;
  v_prior public.code_activity_confirmations;
  v_change public.code_activity_changes;
  v_thing public.things;
BEGIN
  IF v_me IS NULL OR p_list_id IS NULL OR p_change_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_title IS NULL OR char_length(btrim(p_title)) = 0 OR char_length(p_title) > 300
     OR char_length(COALESCE(p_notes, '')) > 8000 OR p_assignee_actor_id IS NULL
     OR p_importance IS NULL OR p_importance NOT IN ('now','next','later') THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = '22023';
  END IF;

  -- One request per (actor, List, key) at a time, so a retry racing its original waits and then replays.
  PERFORM pg_advisory_xact_lock(hashtext(v_me::text || ':' || p_list_id::text || ':' || p_idempotency_key::text));

  -- A STRUCTURED canonical form: a JSON array keeps every field separate, so "a|b" + "c" can never equal "a" + "b|c".
  -- Every field the person chose is in it, including the acknowledgement and the AI flag. A due date is hashed as an
  -- instant (epoch seconds) so the session time zone cannot change the result.
  v_hash := encode(sha256(convert_to(jsonb_build_array(
      p_list_id, p_change_id, btrim(p_title), COALESCE(p_notes, ''), p_assignee_actor_id,
      COALESCE(extract(epoch FROM p_due_at)::text, ''), p_importance, COALESCE(p_head_sha, ''),
      p_acknowledge_source_change IS TRUE, p_ai_generated IS TRUE)::text, 'UTF8')), 'hex');

  SELECT * INTO v_prior FROM public.code_activity_confirmations c
   WHERE c.actor_id = v_me AND c.list_id = p_list_id AND c.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF NOT katalist_priv.can_view_list(p_list_id) THEN
      RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
    END IF;
    IF v_prior.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'conflict' USING ERRCODE = '23505';
    END IF;
    o_thing_id := CASE WHEN v_prior.thing_id IS NOT NULL AND katalist_priv.can_view_thing(v_prior.thing_id) THEN v_prior.thing_id ELSE NULL END;
    o_replayed := true;
    RETURN NEXT;
    RETURN;
  END IF;

  IF NOT katalist_priv.can_create_thing_in_list(p_list_id) OR NOT katalist_priv.code_activity_flags_ok_for(p_list_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  -- Text a model wrote may only be turned into a Thing while AI is on AND the owner has consented. Enforced here,
  -- not just in the screen, so a direct call cannot mark content as AI-written to get around the setting.
  IF p_ai_generated IS TRUE AND (NOT katalist_priv.code_activity_flag('ai')
     OR NOT COALESCE((SELECT c.enabled FROM public.code_activity_consents c WHERE c.list_id = p_list_id), false)) THEN
    RAISE EXCEPTION 'consent_withdrawn' USING ERRCODE = 'CA001';
  END IF;

  -- The change must belong to a readable connection of THIS List.
  SELECT ch.* INTO v_change FROM public.code_activity_changes ch
    JOIN public.code_activity_connections c ON c.id = ch.connection_id
   WHERE ch.id = p_change_id AND c.list_id = p_list_id AND c.status IN ('active','suspended') AND NOT c.needs_reverification;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  -- The assignee must be the owner or a CURRENT collaborator, chosen explicitly.
  IF NOT EXISTS (
       SELECT 1 FROM public.lists l JOIN public.actors a ON a.profile_id = l.owner_profile_id
        WHERE l.id = p_list_id AND a.id = p_assignee_actor_id
       UNION ALL
       SELECT 1 FROM public.list_members m JOIN public.actors a ON a.profile_id = m.profile_id
        WHERE m.list_id = p_list_id AND m.role = 'collaborator' AND a.id = p_assignee_actor_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  -- The person reviewed one revision. If the change moved on, they must confirm again knowingly.
  IF v_change.head_sha IS DISTINCT FROM p_head_sha AND p_acknowledge_source_change IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'source_changed' USING ERRCODE = '55000';
  END IF;

  -- The existing creation path. It starts every new assignment as Waiting for Catch, including a self-assignment.
  SELECT * INTO v_thing FROM public.create_thing(btrim(p_title), p_assignee_actor_id, NULLIF(btrim(COALESCE(p_notes, '')), ''),
        NULL, p_importance::public.importance, NULL, p_due_at, false, p_list_id);

  INSERT INTO public.code_activity_confirmations (actor_id, list_id, idempotency_key, payload_hash, thing_id, evidence)
  VALUES (v_me, p_list_id, p_idempotency_key, v_hash, v_thing.id, jsonb_build_object(
    'change_id', v_change.id, 'kind', v_change.kind, 'pr_number', v_change.pr_number, 'head_sha', v_change.head_sha,
    'reviewed_sha', p_head_sha, 'title', left(v_change.title, 200), 'source_url', v_change.source_url,
    'ai_generated', p_ai_generated IS TRUE, 'source_change_acknowledged', COALESCE(p_acknowledge_source_change, false)));

  o_thing_id := v_thing.id; o_replayed := false;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION
  public.code_activity_assignee_candidates(uuid),
  public.confirm_code_activity_draft(uuid, uuid, uuid, text, text, uuid, timestamptz, text, text, boolean, boolean)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.code_activity_assignee_candidates(uuid),
  public.confirm_code_activity_draft(uuid, uuid, uuid, text, text, uuid, timestamptz, text, text, boolean, boolean)
TO authenticated;

NOTIFY pgrst, 'reload schema';
