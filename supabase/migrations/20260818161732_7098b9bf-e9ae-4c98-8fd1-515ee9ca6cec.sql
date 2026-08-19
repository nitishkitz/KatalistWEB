-- ============ 1. IDENTITY CLAIM ============
CREATE OR REPLACE FUNCTION katalist_priv.claim_external_for_profile(_profile_id uuid, _phone text, _email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_ext public.external_identities;
  v_actor uuid;
BEGIN
  IF _phone IS NULL AND _email IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_ext
    FROM public.external_identities e
   WHERE (_phone IS NOT NULL AND e.phone_e164 = _phone)
      OR (_email IS NOT NULL AND e.email = _email)
   ORDER BY (e.phone_e164 IS NOT NULL AND e.phone_e164 = _phone) DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Already claimed: only idempotent re-claim by the same profile is allowed.
  IF v_ext.claimed_profile_id IS NOT NULL THEN
    IF v_ext.claimed_profile_id = _profile_id THEN
      SELECT a.id INTO v_actor FROM public.actors a WHERE a.external_identity_id = v_ext.id;
      RETURN v_actor;
    END IF;
    RETURN NULL;
  END IF;

  SELECT a.id INTO v_actor FROM public.actors a WHERE a.external_identity_id = v_ext.id FOR UPDATE;
  IF v_actor IS NULL THEN
    RETURN NULL;
  END IF;

  -- Rebind the SAME actor row; actor id is permanent, provenance preserved.
  UPDATE public.actors
     SET kind = 'user', profile_id = _profile_id
   WHERE id = v_actor;

  UPDATE public.external_identities
     SET claimed_profile_id = _profile_id, claimed_at = now()
   WHERE id = v_ext.id;

  RETURN v_actor;
END;
$$;
REVOKE EXECUTE ON FUNCTION katalist_priv.claim_external_for_profile(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_phone text;
  v_email text;
  v_name  text;
  v_actor uuid;
BEGIN
  v_phone := NULLIF(COALESCE(NEW.phone, NEW.raw_user_meta_data ->> 'phone'), '');
  IF v_phone IS NOT NULL AND left(v_phone, 1) <> '+' THEN
    v_phone := '+' || regexp_replace(v_phone, '[^0-9]', '', 'g');
  END IF;
  v_email := NULLIF(NEW.email, '');
  v_name  := COALESCE(
    NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
    v_email, v_phone, 'Katalist user'
  );

  INSERT INTO public.profiles (id, phone_e164, email, display_name)
  VALUES (NEW.id, v_phone, v_email, v_name)
  ON CONFLICT (id) DO NOTHING;

  -- Claim path FIRST: never mint a second actor for a person who already exists externally.
  v_actor := katalist_priv.claim_external_for_profile(NEW.id, v_phone, v_email);

  IF v_actor IS NULL AND NOT EXISTS (SELECT 1 FROM public.actors a WHERE a.profile_id = NEW.id) THEN
    INSERT INTO public.actors (kind, profile_id)
    VALUES ('user', NEW.id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Explicit claim RPC for phone verified after signup.
CREATE OR REPLACE FUNCTION public.claim_external_identity(p_phone_e164 text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_phone text;
  v_actor uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  v_phone := NULLIF(btrim(p_phone_e164), '');
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'a verified phone number is required';
  END IF;
  -- Auth must already have verified ownership of this number.
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_uid AND u.phone = regexp_replace(v_phone, '^\+', '')) THEN
    RAISE EXCEPTION 'this phone number is not verified for your account';
  END IF;

  v_actor := katalist_priv.claim_external_for_profile(v_uid, v_phone, NULL);
  IF v_actor IS NULL THEN
    SELECT a.id INTO v_actor FROM public.actors a WHERE a.profile_id = v_uid;
  END IF;
  RETURN v_actor;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_external_identity(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_external_identity(text) TO authenticated;

-- ============ 2. LIST PROMOTION INTEGRITY ============
CREATE OR REPLACE FUNCTION public.promote_thing_person_to_list(p_thing_id uuid, p_list_id uuid, p_role list_role DEFAULT 'collaborator'::list_role)
RETURNS list_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_thing   public.things;
  v_profile uuid;
  v_member  public.list_members;
BEGIN
  IF NOT katalist_priv.is_list_owner(p_list_id) THEN
    RAISE EXCEPTION 'only the List Owner can promote someone into this List';
  END IF;
  IF COALESCE(p_role, 'collaborator') NOT IN ('collaborator','view_only') THEN
    RAISE EXCEPTION 'invalid List role';
  END IF;

  SELECT * INTO v_thing FROM public.things t WHERE t.id = p_thing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_thing.list_id IS DISTINCT FROM p_list_id THEN
    RAISE EXCEPTION 'that Thing does not belong to this List';
  END IF;
  IF NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;

  SELECT a.profile_id INTO v_profile FROM public.actors a WHERE a.id = v_thing.current_assignee_actor_id;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'this Thing is not held by a Katalist user';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lists l WHERE l.id = p_list_id AND l.owner_profile_id = v_profile) THEN
    RAISE EXCEPTION 'this person already owns the List';
  END IF;

  INSERT INTO public.list_members (list_id, profile_id, role, added_by_profile_id)
  VALUES (p_list_id, v_profile, COALESCE(p_role, 'collaborator'), auth.uid())
  ON CONFLICT (list_id, profile_id) DO UPDATE SET role = EXCLUDED.role
  RETURNING * INTO v_member;

  PERFORM katalist_priv.log_activity(p_thing_id, katalist_priv.current_actor_id(), 'promoted_to_list',
    jsonb_build_object('list_id', p_list_id, 'role', COALESCE(p_role, 'collaborator')));

  RETURN v_member;
END;
$$;

-- ============ 3. FORWARD-ONLY WORK STATUS ============
CREATE OR REPLACE FUNCTION katalist_priv.assert_forward_status(_from work_status, _to work_status)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
BEGIN
  IF _to = 'not_started' AND _from <> 'not_started' THEN
    RAISE EXCEPTION 'work can only move forward: % cannot go back to Not Started', _from;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION katalist_priv.assert_forward_status(work_status, work_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.assert_forward_status(work_status, work_status) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_work_status(p_thing_id uuid, p_work_status work_status)
RETURNS things
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me    uuid := katalist_priv.current_actor_id();
  v_thing public.things;
BEGIN
  IF p_work_status NOT IN ('not_started','under_progress') THEN
    RAISE EXCEPTION 'use sort_thing or cancel_thing for terminal outcomes';
  END IF;

  SELECT * INTO v_thing FROM public.things WHERE id = p_thing_id FOR UPDATE;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_thing.current_assignee_actor_id <> v_me THEN
    RAISE EXCEPTION 'only the current assignee can change Work Status';
  END IF;
  IF v_thing.acknowledgement <> 'caught' THEN
    RAISE EXCEPTION 'Catch the Thing before changing Work Status';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'a % Thing cannot change status', v_thing.work_status;
  END IF;
  PERFORM katalist_priv.assert_forward_status(v_thing.work_status, p_work_status);

  IF v_thing.work_status = p_work_status THEN
    RETURN v_thing; -- idempotent
  END IF;

  UPDATE public.things SET work_status = p_work_status
   WHERE id = p_thing_id RETURNING * INTO v_thing;

  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'work_status_changed',
    jsonb_build_object('work_status', p_work_status));
  RETURN v_thing;
END;
$$;

-- ============ 4. REASSIGNMENT AUDIT + INTERNAL BRIDGE MINTING ============
CREATE OR REPLACE FUNCTION katalist_priv.mint_bridge_grant(_thing_id uuid, _assignment_id uuid, _actor_id uuid, _issued_by uuid)
RETURNS TABLE(grant_id uuid, token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_token   text := katalist_priv.new_token();
  v_expires timestamptz := now() + make_interval(hours => katalist_priv.config_int('bridge_grant_ttl_hours', 336));
  v_grant   public.bridge_grants;
BEGIN
  UPDATE public.bridge_sessions s SET revoked_at = now()
   WHERE s.revoked_at IS NULL
     AND s.grant_id IN (SELECT g.id FROM public.bridge_grants g WHERE g.assignment_id = _assignment_id);
  UPDATE public.bridge_grants g
     SET revoked_at = now(), revoked_reason = 'reissued'
   WHERE g.assignment_id = _assignment_id AND g.revoked_at IS NULL;

  INSERT INTO public.bridge_grants (thing_id, assignment_id, actor_id, issued_by_actor_id, token_hash, expires_at)
  VALUES (_thing_id, _assignment_id, _actor_id, _issued_by, katalist_priv.hash_token(v_token), v_expires)
  RETURNING * INTO v_grant;

  PERFORM katalist_priv.log_activity(_thing_id, _issued_by, 'bridge_opened',
    jsonb_build_object('expires_at', v_expires));

  RETURN QUERY SELECT v_grant.id, v_token, v_grant.expires_at;
END;
$$;
REVOKE EXECUTE ON FUNCTION katalist_priv.mint_bridge_grant(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_bridge_grant(p_thing_id uuid)
RETURNS TABLE(grant_id uuid, token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me    uuid := katalist_priv.current_actor_id();
  v_thing public.things;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO v_thing FROM public.things WHERE id = p_thing_id;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_thing.owner_actor_id <> v_me THEN
    RAISE EXCEPTION 'only the Thing Owner can open a Bridge';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'a % Thing cannot open a Bridge', v_thing.work_status;
  END IF;
  IF NOT katalist_priv.actor_is_external(v_thing.current_assignee_actor_id) THEN
    RAISE EXCEPTION 'this Thing is held by a Katalist user - no Bridge is needed';
  END IF;

  RETURN QUERY SELECT * FROM katalist_priv.mint_bridge_grant(
    p_thing_id, v_thing.current_assignment_id, v_thing.current_assignee_actor_id, v_me);
END;
$$;

CREATE OR REPLACE FUNCTION public.reassign_thing(p_thing_id uuid, p_new_assignee_actor_id uuid)
RETURNS things
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me      uuid := katalist_priv.current_actor_id();
  v_thing   public.things;
  v_old_assignment uuid;
  v_old_assignee   uuid;
  v_new_assignment uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_thing FROM public.things WHERE id = p_thing_id FOR UPDATE;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'a % Thing cannot be reassigned', v_thing.work_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.actors a WHERE a.id = p_new_assignee_actor_id) THEN
    RAISE EXCEPTION 'unknown assignee';
  END IF;
  IF p_new_assignee_actor_id = v_thing.current_assignee_actor_id THEN
    RAISE EXCEPTION 'this person already holds the Thing';
  END IF;

  IF v_thing.owner_actor_id = v_me THEN
    NULL;
  ELSIF v_thing.current_assignee_actor_id = v_me THEN
    IF v_thing.acknowledgement <> 'caught'
       OR v_thing.work_status NOT IN ('not_started','under_progress') THEN
      RAISE EXCEPTION 'catch the Thing before handing it on';
    END IF;
  ELSE
    RAISE EXCEPTION 'only the Thing Owner or the current assignee can reassign';
  END IF;

  v_old_assignment := v_thing.current_assignment_id;
  v_old_assignee   := v_thing.current_assignee_actor_id;

  UPDATE public.thing_assignments
     SET ended_at = now(), ended_reason = 'reassigned'
   WHERE id = v_old_assignment AND ended_at IS NULL;

  PERFORM katalist_priv.revoke_bridge_for_assignment(v_old_assignment, 'reassigned');

  INSERT INTO public.thing_assignments (thing_id, assignee_actor_id, assigned_by_actor_id)
  VALUES (p_thing_id, p_new_assignee_actor_id, v_me)
  RETURNING id INTO v_new_assignment;

  UPDATE public.things
     SET current_assignee_actor_id = p_new_assignee_actor_id,
         current_assignment_id     = v_new_assignment,
         acknowledgement           = 'waiting_for_catch',
         assignee_personal_pace    = NULL,
         caught_at                 = NULL
   WHERE id = p_thing_id
  RETURNING * INTO v_thing;

  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'reassigned',
    jsonb_build_object(
      'from_actor_id', v_old_assignee,
      'to_actor_id',   p_new_assignee_actor_id,
      'from_assignment_id', v_old_assignment,
      'to_assignment_id',   v_new_assignment,
      'by_actor_id',   v_me));
  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'assigned',
    jsonb_build_object('assignee_actor_id', p_new_assignee_actor_id, 'assignment_id', v_new_assignment));

  RETURN v_thing;
END;
$$;

-- ============ 5+6. COMMENT / MESSAGE IMMUTABILITY ============
CREATE OR REPLACE FUNCTION public.enforce_thing_comment_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.thing_id <> OLD.thing_id
     OR NEW.author_actor_id <> OLD.author_actor_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'a comment cannot change its Thing, author or creation time';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enforce_thing_comment_immutability() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_thing_comments_immutable ON public.thing_comments;
CREATE TRIGGER trg_thing_comments_immutable
  BEFORE UPDATE ON public.thing_comments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_thing_comment_immutability();

CREATE OR REPLACE FUNCTION public.enforce_list_message_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  IF NEW.id <> OLD.id
     OR NEW.list_id <> OLD.list_id
     OR NEW.author_profile_id <> OLD.author_profile_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'a message cannot change its List, author or creation time';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enforce_list_message_immutability() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_list_messages_immutable ON public.list_messages;
CREATE TRIGGER trg_list_messages_immutable
  BEFORE UPDATE ON public.list_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_list_message_immutability();

-- ============ 7. BRIDGE: forward-only + comments ============
CREATE OR REPLACE FUNCTION public.bridge_act(p_session_token text, p_action text)
RETURNS work_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_grant public.bridge_grants := katalist_priv.bridge_session_grant(p_session_token);
  v_thing public.things;
BEGIN
  SELECT * INTO v_thing FROM public.things WHERE id = v_grant.thing_id FOR UPDATE;
  IF v_thing.current_assignee_actor_id <> v_grant.actor_id
     OR v_thing.current_assignment_id IS DISTINCT FROM v_grant.assignment_id THEN
    RAISE EXCEPTION 'this link is no longer active';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'this Thing is already %', v_thing.work_status;
  END IF;

  IF p_action = 'catch' THEN
    IF v_thing.acknowledgement <> 'caught' THEN
      UPDATE public.things
         SET acknowledgement = 'caught', caught_at = now(), assignee_personal_pace = NULL
       WHERE id = v_thing.id RETURNING * INTO v_thing;
      UPDATE public.thing_assignments
         SET acknowledgement = 'caught', caught_at = now()
       WHERE id = v_thing.current_assignment_id;
      PERFORM katalist_priv.log_activity(v_thing.id, v_grant.actor_id, 'caught',
        jsonb_build_object('via', 'bridge'));
    END IF;

  ELSIF p_action IN ('not_started','under_progress') THEN
    IF v_thing.acknowledgement <> 'caught' THEN
      RAISE EXCEPTION 'Catch the Thing before changing its status';
    END IF;
    PERFORM katalist_priv.assert_forward_status(v_thing.work_status, p_action::public.work_status);
    IF v_thing.work_status <> p_action::public.work_status THEN
      UPDATE public.things SET work_status = p_action::public.work_status
       WHERE id = v_thing.id RETURNING * INTO v_thing;
      PERFORM katalist_priv.log_activity(v_thing.id, v_grant.actor_id, 'work_status_changed',
        jsonb_build_object('work_status', p_action, 'via', 'bridge'));
    END IF;

  ELSIF p_action = 'sorted' THEN
    IF v_thing.acknowledgement <> 'caught' THEN
      RAISE EXCEPTION 'Catch the Thing before marking it Sorted';
    END IF;
    UPDATE public.things SET work_status = 'sorted', sorted_at = now()
     WHERE id = v_thing.id RETURNING * INTO v_thing;
    UPDATE public.thing_assignments
       SET ended_at = now(), ended_reason = 'sorted'
     WHERE id = v_thing.current_assignment_id AND ended_at IS NULL;
    PERFORM katalist_priv.log_activity(v_thing.id, v_grant.actor_id, 'sorted',
      jsonb_build_object('via', 'bridge'));
    PERFORM katalist_priv.revoke_bridge_for_assignment(v_thing.current_assignment_id, 'sorted');

  ELSE
    RAISE EXCEPTION 'unsupported action';
  END IF;

  RETURN v_thing.work_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_comment(p_session_token text, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_grant public.bridge_grants := katalist_priv.bridge_session_grant(p_session_token);
  v_thing public.things;
  v_body  text := NULLIF(btrim(COALESCE(p_body, '')), '');
  v_id    uuid;
BEGIN
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'a comment cannot be empty';
  END IF;

  SELECT * INTO v_thing FROM public.things WHERE id = v_grant.thing_id;
  IF v_thing.current_assignee_actor_id <> v_grant.actor_id
     OR v_thing.current_assignment_id IS DISTINCT FROM v_grant.assignment_id THEN
    RAISE EXCEPTION 'this link is no longer active';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'this Thing is already %', v_thing.work_status;
  END IF;

  INSERT INTO public.thing_comments (thing_id, author_actor_id, body)
  VALUES (v_thing.id, v_grant.actor_id, v_body)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bridge_comment(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_comment(text, text) TO service_role;

-- Bridge redeem must also verify the grant's assignment is still the current one.
CREATE OR REPLACE FUNCTION public.bridge_redeem_token(p_token text)
RETURNS TABLE(session_token text, expires_at timestamptz, thing_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_grant   public.bridge_grants;
  v_thing   public.things;
  v_session text;
  v_expires timestamptz;
BEGIN
  SELECT * INTO v_grant
    FROM public.bridge_grants
   WHERE token_hash = katalist_priv.hash_token(p_token)
     AND revoked_at IS NULL
     AND expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this link is no longer active';
  END IF;

  SELECT * INTO v_thing FROM public.things WHERE id = v_grant.thing_id;
  IF NOT FOUND
     OR v_thing.current_assignment_id IS DISTINCT FROM v_grant.assignment_id
     OR v_thing.current_assignee_actor_id <> v_grant.actor_id
     OR v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'this link is no longer active';
  END IF;

  v_session := katalist_priv.new_token();
  v_expires := now() + make_interval(mins => katalist_priv.config_int('bridge_session_ttl_minutes', 120));

  INSERT INTO public.bridge_sessions (grant_id, session_hash, expires_at)
  VALUES (v_grant.id, katalist_priv.hash_token(v_session), v_expires);

  UPDATE public.bridge_grants
     SET first_used_at = COALESCE(first_used_at, now())
   WHERE id = v_grant.id;

  RETURN QUERY SELECT v_session, v_expires, v_grant.thing_id;
END;
$$;

-- ============ 8. NOTIFICATION SAFETY + DEDUPE ============
CREATE OR REPLACE FUNCTION public.notify_on_thing_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_thing public.things;
BEGIN
  SELECT * INTO v_thing FROM public.things WHERE id = NEW.thing_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  PERFORM katalist_priv.notify_actor(a.actor_id, 'thing_comment',
    'New comment on a Thing', v_thing.title, v_thing.id, v_thing.list_id, NEW.author_actor_id)
  FROM (
    SELECT DISTINCT actor_id FROM (
      VALUES (v_thing.owner_actor_id), (v_thing.current_assignee_actor_id)
    ) AS v(actor_id)
    WHERE actor_id IS NOT NULL
  ) a;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'comment notification skipped: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_list_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_list public.lists;
  r      record;
BEGIN
  SELECT * INTO v_list FROM public.lists WHERE id = NEW.list_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT DISTINCT p AS profile_id FROM (
      SELECT v_list.owner_profile_id AS p
      UNION
      SELECT m.profile_id FROM public.list_members m WHERE m.list_id = NEW.list_id
    ) s
    WHERE p IS NOT NULL AND p <> NEW.author_profile_id
  LOOP
    INSERT INTO public.notifications (profile_id, kind, title, body, list_id, payload)
    VALUES (r.profile_id, 'list_message', 'New message in ' || v_list.name, NEW.body, v_list.id, '{}'::jsonb);
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'list message notification skipped: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_thing_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_thing  public.things;
  v_title  text;
  v_detail jsonb := COALESCE(NEW.detail, '{}'::jsonb);
BEGIN
  SELECT * INTO v_thing FROM public.things WHERE id = NEW.thing_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  v_title := v_thing.title;

  IF NEW.event = 'assigned' THEN
    PERFORM katalist_priv.notify_actor(v_thing.current_assignee_actor_id, 'thing_assigned',
      'A Thing is waiting for your Catch', v_title, v_thing.id, v_thing.list_id, NEW.actor_id);

  ELSIF NEW.event = 'caught' THEN
    PERFORM katalist_priv.notify_actor(v_thing.owner_actor_id, 'thing_caught',
      'Your Thing was caught', v_title, v_thing.id, v_thing.list_id, NEW.actor_id);

  ELSIF NEW.event = 'work_status_changed' THEN
    PERFORM katalist_priv.notify_actor(v_thing.owner_actor_id, 'thing_work_status',
      'Progress on your Thing', v_title, v_thing.id, v_thing.list_id, NEW.actor_id,
      jsonb_build_object('work_status', COALESCE(v_detail ->> 'work_status', v_thing.work_status::text)));

  ELSIF NEW.event = 'sorted' THEN
    PERFORM katalist_priv.notify_actor(v_thing.owner_actor_id, 'thing_sorted',
      'Sorted', v_title, v_thing.id, v_thing.list_id, NEW.actor_id);

  ELSIF NEW.event = 'cancelled' THEN
    PERFORM katalist_priv.notify_actor(v_thing.current_assignee_actor_id, 'thing_cancelled',
      'A Thing you held was cancelled', v_title, v_thing.id, v_thing.list_id, NEW.actor_id);

  ELSIF NEW.event = 'reassigned' THEN
    PERFORM katalist_priv.notify_actor(a.actor_id, 'thing_reassigned',
      'Your Thing changed hands', v_title, v_thing.id, v_thing.list_id, NEW.actor_id)
    FROM (
      SELECT DISTINCT actor_id FROM (
        VALUES (v_thing.owner_actor_id),
               (NULLIF(v_detail ->> 'from_actor_id','')::uuid)
      ) AS v(actor_id)
      WHERE actor_id IS NOT NULL
    ) a;

  ELSIF NEW.event = 'nudged' THEN
    PERFORM katalist_priv.notify_actor(NULLIF(v_detail ->> 'to_actor_id','')::uuid, 'nudged',
      'You were nudged', v_title, v_thing.id, v_thing.list_id, NEW.actor_id,
      jsonb_build_object('reason', v_detail ->> 'reason'));

  ELSIF NEW.event = 'due_changed' THEN
    PERFORM katalist_priv.notify_actor(v_thing.current_assignee_actor_id, 'thing_due_changed',
      'Due date changed', v_title, v_thing.id, v_thing.list_id, NEW.actor_id,
      jsonb_build_object('due_at', COALESCE(v_detail ->> 'due_at', v_thing.due_at::text)));

  ELSIF NEW.event = 'importance_changed' THEN
    PERFORM katalist_priv.notify_actor(v_thing.current_assignee_actor_id, 'thing_importance_changed',
      'Owner Importance changed', v_title, v_thing.id, v_thing.list_id, NEW.actor_id,
      jsonb_build_object('owner_importance', COALESCE(v_detail ->> 'owner_importance', v_thing.owner_importance::text)));
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'activity notification skipped: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- ============ 9. DOORMAN METADATA ============
ALTER TABLE public.doorman_state
  ADD COLUMN IF NOT EXISTS breakthrough_reason text,
  ADD COLUMN IF NOT EXISTS last_presented_at timestamptz;

CREATE OR REPLACE FUNCTION public.doorman_mark_presented(p_thing_id uuid, p_reason text DEFAULT NULL)
RETURNS doorman_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.doorman_state;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;

  INSERT INTO public.doorman_state (profile_id, thing_id, breakthrough_reason, last_presented_at)
  VALUES (v_uid, p_thing_id, NULLIF(btrim(COALESCE(p_reason,'')),''), now())
  ON CONFLICT (profile_id, thing_id) DO UPDATE
    SET last_presented_at = now(),
        breakthrough_reason = COALESCE(EXCLUDED.breakthrough_reason, public.doorman_state.breakthrough_reason)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.doorman_mark_presented(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doorman_mark_presented(uuid, text) TO authenticated;