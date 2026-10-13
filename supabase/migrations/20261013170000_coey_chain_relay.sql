-- Relay chains (spec C9, K3): "Ask Ravi to get Priya to approve" starts with
-- Ravi; when Ravi sorts his step, the next step goes to Priya, owned by the
-- original sender, once, and still subject to the connection rule.

ALTER TABLE public.thing_schedules ADD COLUMN IF NOT EXISTS chain_step_of uuid REFERENCES public.things(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS thing_schedules_one_next_chain_step ON public.thing_schedules (chain_step_of) WHERE chain_step_of IS NOT NULL;

CREATE OR REPLACE FUNCTION katalist_priv.advance_chain(p_thing uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  s        public.thing_schedules;
  t        public.things;
  v_next   uuid;
  v_sender uuid;
  v_holder uuid;
  v_new    public.things;
  v_assign uuid;
BEGIN
  SELECT * INTO s FROM public.thing_schedules WHERE thing_id = p_thing;
  IF NOT FOUND OR coalesce(array_length(s.chain, 1), 0) <= s.chain_index + 1 THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.thing_schedules WHERE chain_step_of = p_thing) THEN RETURN NULL; END IF;
  SELECT * INTO t FROM public.things WHERE id = p_thing;
  v_next := s.chain[s.chain_index + 2]; -- arrays are 1-based; chain_index is 0-based
  v_sender := katalist_priv.user_actor_of(s.sender_profile_id);
  v_holder := katalist_priv.user_actor_of(v_next);
  IF v_sender IS NULL OR v_holder IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.things (title, notes, creator_actor_id, owner_actor_id, current_assignee_actor_id, list_id, context,
                             owner_importance, acknowledgement, work_status, due_at, due_has_time)
  VALUES (t.title, t.notes, v_sender, v_sender, v_holder, t.list_id, t.context, t.owner_importance,
          'waiting_for_catch', 'not_started', t.due_at, t.due_has_time)
  RETURNING * INTO v_new;
  INSERT INTO public.thing_assignments (thing_id, assignee_actor_id, assigned_by_actor_id) VALUES (v_new.id, v_holder, v_sender) RETURNING id INTO v_assign;
  UPDATE public.things SET current_assignment_id = v_assign WHERE id = v_new.id;
  PERFORM katalist_priv.log_activity(v_new.id, v_sender, 'created', jsonb_build_object('chain_step_of', p_thing));
  INSERT INTO public.thing_schedules (thing_id, text_raw, kind, mode, sender_profile_id, holder_profile_id, state, chain, chain_index,
    pace, pace_resolution, action_time, event_time, activity_type, chain_step_of, group_id, lane_rule, last_activity_at)
  VALUES (v_new.id, s.text_raw, s.kind, s.mode, s.sender_profile_id, v_next, 'open', s.chain, s.chain_index + 1,
    s.pace, s.pace_resolution, s.action_time, s.event_time, s.activity_type, p_thing, s.group_id, 'C9', now());
  PERFORM katalist_priv.log_transition(v_new.id, 'coey', NULL, NULL, jsonb_build_object('state', 'open', 'holder', v_next), 'C9',
    jsonb_build_object('previous', p_thing, 'step', s.chain_index + 1));
  RETURN v_new.id;
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.advance_chain(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION katalist_priv.spawn_on_sort()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
BEGIN
  IF NEW.work_status = 'sorted' AND OLD.work_status <> 'sorted' THEN
    BEGIN
      PERFORM katalist_priv.spawn_next_occurrence(NEW.id);
    EXCEPTION WHEN insufficient_privilege THEN NULL; -- disconnected: the series stops quietly
    END;
    BEGIN
      PERFORM katalist_priv.advance_chain(NEW.id);
    EXCEPTION WHEN insufficient_privilege THEN NULL; -- the next person is no longer connected: the sender keeps it
    END;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
