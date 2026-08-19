-- Phase 6b: personal object state (shred/restore) + doorman state

CREATE TABLE public.profile_object_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  object_type public.object_type NOT NULL,
  object_id uuid NOT NULL,
  shredded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, object_type, object_id)
);

GRANT SELECT ON public.profile_object_state TO authenticated;
GRANT ALL ON public.profile_object_state TO service_role;
ALTER TABLE public.profile_object_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own personal object state is readable"
  ON public.profile_object_state FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

CREATE INDEX idx_profile_object_state_lookup
  ON public.profile_object_state (profile_id, object_type, object_id)
  WHERE shredded_at IS NOT NULL;

CREATE TRIGGER trg_profile_object_state_updated_at
  BEFORE UPDATE ON public.profile_object_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.doorman_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  thing_id uuid NOT NULL REFERENCES public.things(id) ON DELETE CASCADE,
  snoozed_until timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, thing_id)
);

GRANT SELECT ON public.doorman_state TO authenticated;
GRANT ALL ON public.doorman_state TO service_role;
ALTER TABLE public.doorman_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own doorman state is readable"
  ON public.doorman_state FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

CREATE INDEX idx_doorman_state_profile ON public.doorman_state (profile_id, snoozed_until);

CREATE TRIGGER trg_doorman_state_updated_at
  BEFORE UPDATE ON public.doorman_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Helper: is an object hidden for the current person?
CREATE OR REPLACE FUNCTION katalist_priv.is_shredded(_object_type public.object_type, _object_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_object_state s
     WHERE s.profile_id = auth.uid()
       AND s.object_type = _object_type
       AND s.object_id = _object_id
       AND s.shredded_at IS NOT NULL
  );
$$;
REVOKE EXECUTE ON FUNCTION katalist_priv.is_shredded(public.object_type, uuid) FROM PUBLIC, anon, authenticated;

-- Shred (hide for me only)
CREATE OR REPLACE FUNCTION public.shred_for_me(p_object_type public.object_type, p_object_id uuid)
RETURNS public.profile_object_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_actor uuid := katalist_priv.current_actor_id();
  v_thing public.things;
  v_state public.profile_object_state;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_object_type = 'bucket' THEN
    RAISE EXCEPTION 'a Bucket is removed, not shredded';
  END IF;

  IF p_object_type = 'thing' THEN
    SELECT * INTO v_thing FROM public.things WHERE id = p_object_id;
    IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_object_id) THEN
      RAISE EXCEPTION 'Thing not found';
    END IF;
    IF v_thing.work_status NOT IN ('sorted','cancelled')
       AND (v_thing.current_assignee_actor_id = v_actor OR v_thing.owner_actor_id = v_actor) THEN
      RAISE EXCEPTION 'you still hold or own this Thing — sort, cancel or hand it on first';
    END IF;
  ELSE
    IF NOT katalist_priv.can_view_list(p_object_id) THEN
      RAISE EXCEPTION 'List not found';
    END IF;
    IF katalist_priv.is_list_owner(p_object_id) THEN
      RAISE EXCEPTION 'the List Owner cannot shred their own List';
    END IF;
  END IF;

  INSERT INTO public.profile_object_state (profile_id, object_type, object_id, shredded_at)
  VALUES (v_me, p_object_type, p_object_id, now())
  ON CONFLICT (profile_id, object_type, object_id)
  DO UPDATE SET shredded_at = now()
  RETURNING * INTO v_state;

  PERFORM katalist_priv.log_private(v_me, 'shredded', p_object_type, p_object_id, '{}'::jsonb);
  RETURN v_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_for_me(p_object_type public.object_type, p_object_id uuid)
RETURNS public.profile_object_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_state public.profile_object_state;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profile_object_state
     SET shredded_at = NULL
   WHERE profile_id = v_me AND object_type = p_object_type AND object_id = p_object_id
  RETURNING * INTO v_state;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'nothing to restore';
  END IF;

  PERFORM katalist_priv.log_private(v_me, 'restored', p_object_type, p_object_id, '{}'::jsonb);
  RETURN v_state;
END;
$$;

-- Doorman: snooze / dismiss a breakthrough card, privately
CREATE OR REPLACE FUNCTION public.snooze_breakthrough(p_thing_id uuid, p_snoozed_until timestamptz DEFAULT NULL)
RETURNS public.doorman_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_until timestamptz;
  v_state public.doorman_state;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;

  v_until := COALESCE(p_snoozed_until,
    now() + make_interval(mins => katalist_priv.config_int('doorman_snooze_minutes', 60)));
  IF v_until <= now() THEN
    RAISE EXCEPTION 'snooze must be in the future';
  END IF;

  INSERT INTO public.doorman_state (profile_id, thing_id, snoozed_until)
  VALUES (v_me, p_thing_id, v_until)
  ON CONFLICT (profile_id, thing_id)
  DO UPDATE SET snoozed_until = EXCLUDED.snoozed_until, dismissed_at = NULL
  RETURNING * INTO v_state;

  PERFORM katalist_priv.log_private(v_me, 'breakthrough_snoozed', 'thing', p_thing_id,
    jsonb_build_object('snoozed_until', v_until));
  RETURN v_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.dismiss_breakthrough(p_thing_id uuid)
RETURNS public.doorman_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_state public.doorman_state;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;

  INSERT INTO public.doorman_state (profile_id, thing_id, dismissed_at)
  VALUES (v_me, p_thing_id, now())
  ON CONFLICT (profile_id, thing_id)
  DO UPDATE SET dismissed_at = now(), snoozed_until = NULL
  RETURNING * INTO v_state;

  PERFORM katalist_priv.log_private(v_me, 'breakthrough_dismissed', 'thing', p_thing_id, '{}'::jsonb);
  RETURN v_state;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.shred_for_me(public.object_type, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restore_for_me(public.object_type, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.snooze_breakthrough(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dismiss_breakthrough(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shred_for_me(public.object_type, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_for_me(public.object_type, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.snooze_breakthrough(uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dismiss_breakthrough(uuid) TO authenticated, service_role;