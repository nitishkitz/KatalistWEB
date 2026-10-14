-- A viewer-local lane is organization, not a shared pace or completion promise.
CREATE TABLE public.thing_court_placement (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  thing_id uuid NOT NULL REFERENCES public.things(id) ON DELETE CASCADE,
  assignee_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE CASCADE,
  lane public.pace NOT NULL,
  PRIMARY KEY (profile_id, thing_id)
);
ALTER TABLE public.thing_court_placement ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.thing_court_placement FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.thing_court_placement TO authenticated;
GRANT ALL ON public.thing_court_placement TO service_role;
CREATE POLICY "current holder reads own Court placement" ON public.thing_court_placement
  FOR SELECT TO authenticated USING (
    profile_id = auth.uid() AND katalist_priv.can_view_thing(thing_id)
    AND EXISTS (SELECT 1 FROM public.things t WHERE t.id = thing_id
      AND t.current_assignee_actor_id = assignee_actor_id
      AND assignee_actor_id = katalist_priv.current_actor_id())
  );

CREATE OR REPLACE FUNCTION public.set_my_court_lane(p_thing_id uuid, p_lane public.pace)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_me uuid := auth.uid(); v_actor uuid := katalist_priv.current_actor_id(); v_thing public.things;
BEGIN
  IF v_me IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_thing FROM public.things WHERE id = p_thing_id FOR UPDATE;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_thing_id) THEN RAISE EXCEPTION 'Thing not found'; END IF;
  IF v_thing.current_assignee_actor_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'only the current assignee can organize their Court';
  END IF;
  -- Clearing one's own override never changes visibility or the shared Thing.
  IF p_lane IS NULL THEN
    DELETE FROM public.thing_court_placement WHERE profile_id = v_me AND thing_id = p_thing_id;
    RETURN;
  END IF;
  IF v_thing.work_status IN ('sorted', 'cancelled') OR v_thing.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'This Thing is no longer active';
  END IF;
  IF EXISTS (SELECT 1 FROM public.thing_schedules s WHERE s.thing_id = p_thing_id
    AND (s.holder_profile_id IS DISTINCT FROM v_me OR s.state IN ('blocked', 'with_sender', 'sorted') OR s.private_wait)) THEN
    RAISE EXCEPTION 'This Thing is not currently in your Court';
  END IF;
  INSERT INTO public.thing_court_placement(profile_id, thing_id, assignee_actor_id, lane)
    VALUES (v_me, p_thing_id, v_actor, p_lane)
    ON CONFLICT (profile_id, thing_id) DO UPDATE
      SET lane = EXCLUDED.lane, assignee_actor_id = EXCLUDED.assignee_actor_id;
  -- Intentionally no writes to things, thing_schedules, activity, promises or nudges.
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_court_lane(uuid, public.pace) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_court_lane(uuid, public.pace) TO authenticated;

CREATE OR REPLACE FUNCTION katalist_priv.clear_personal_court_placement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $$ BEGIN
  IF NEW.current_assignee_actor_id IS DISTINCT FROM OLD.current_assignee_actor_id
    OR NEW.work_status IN ('sorted', 'cancelled') OR NEW.cancelled_at IS NOT NULL THEN
    DELETE FROM public.thing_court_placement WHERE thing_id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER clear_personal_court_placement AFTER UPDATE OF current_assignee_actor_id, work_status, cancelled_at
  ON public.things FOR EACH ROW EXECUTE FUNCTION katalist_priv.clear_personal_court_placement();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.thing_court_placement;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
