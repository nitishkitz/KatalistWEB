-- Phase 7: Nudges

CREATE TABLE public.nudges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thing_id uuid NOT NULL REFERENCES public.things(id) ON DELETE CASCADE,
  from_actor_id uuid NOT NULL REFERENCES public.actors(id),
  to_actor_id uuid NOT NULL REFERENCES public.actors(id),
  reason public.nudge_reason NOT NULL,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.nudges TO authenticated;
GRANT ALL ON public.nudges TO service_role;
ALTER TABLE public.nudges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "nudges visible to thing viewers"
  ON public.nudges FOR SELECT TO authenticated
  USING (katalist_priv.can_view_thing(thing_id));

CREATE INDEX idx_nudges_thing_created ON public.nudges (thing_id, created_at DESC);
CREATE INDEX idx_nudges_cooldown ON public.nudges (thing_id, to_actor_id, created_at DESC);

-- History rows are append-only.
CREATE TRIGGER trg_nudges_append_only
  BEFORE UPDATE OR DELETE ON public.nudges
  FOR EACH ROW EXECUTE FUNCTION public.forbid_history_mutation();

-- Send a nudge
CREATE OR REPLACE FUNCTION public.nudge_thing(
  p_thing_id uuid,
  p_reason public.nudge_reason DEFAULT 'quiet',
  p_message text DEFAULT NULL
)
RETURNS public.nudges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me       uuid := katalist_priv.current_actor_id();
  v_thing    public.things;
  v_target   uuid;
  v_cooldown integer := katalist_priv.config_int('nudge_cooldown_minutes', 120);
  v_last     timestamptz;
  v_nudge    public.nudges;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_thing FROM public.things WHERE id = p_thing_id;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'a % Thing cannot be nudged', v_thing.work_status;
  END IF;

  IF v_me = v_thing.owner_actor_id THEN
    v_target := v_thing.current_assignee_actor_id;
  ELSIF v_me = v_thing.current_assignee_actor_id THEN
    v_target := v_thing.owner_actor_id;
  ELSE
    RAISE EXCEPTION 'only the Thing Owner or the current assignee can nudge';
  END IF;

  IF v_target = v_me THEN
    RAISE EXCEPTION 'you cannot nudge yourself';
  END IF;

  SELECT max(n.created_at) INTO v_last
    FROM public.nudges n
   WHERE n.thing_id = p_thing_id AND n.to_actor_id = v_target;

  IF v_last IS NOT NULL AND v_last > now() - make_interval(mins => v_cooldown) THEN
    RAISE EXCEPTION 'you nudged recently — try again later';
  END IF;

  INSERT INTO public.nudges (thing_id, from_actor_id, to_actor_id, reason, message)
  VALUES (p_thing_id, v_me, v_target, COALESCE(p_reason, 'quiet'),
          NULLIF(btrim(COALESCE(p_message, '')), ''))
  RETURNING * INTO v_nudge;

  PERFORM katalist_priv.log_activity(p_thing_id, v_me, 'nudged',
    jsonb_build_object('to_actor_id', v_target, 'reason', v_nudge.reason));

  RETURN v_nudge;
END;
$$;

-- Suggested nudges for the signed-in person
CREATE OR REPLACE FUNCTION public.list_nudgeable_things()
RETURNS TABLE(thing_id uuid, title text, to_actor_id uuid, reason public.nudge_reason, since timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  WITH me AS (SELECT katalist_priv.current_actor_id() AS actor_id),
  candidates AS (
    SELECT t.id,
           t.title,
           CASE WHEN t.owner_actor_id = me.actor_id
                THEN t.current_assignee_actor_id ELSE t.owner_actor_id END AS target,
           CASE
             WHEN t.acknowledgement = 'waiting_for_catch'
                  AND t.updated_at < now() - make_interval(hours => katalist_priv.config_int('nudge_waiting_hours', 4))
               THEN 'waiting_for_catch'
             WHEN t.due_at IS NOT NULL
                  AND t.due_at <= now() + make_interval(hours => katalist_priv.config_int('nudge_due_soon_hours', 3))
               THEN 'due_soon'
             WHEN t.updated_at < now() - make_interval(hours => katalist_priv.config_int('nudge_stale_hours', 48))
               THEN 'stale'
             WHEN t.updated_at < now() - make_interval(hours => katalist_priv.config_int('nudge_quiet_hours', 18))
               THEN 'quiet'
           END::public.nudge_reason AS reason,
           t.updated_at
      FROM public.things t, me
     WHERE t.work_status NOT IN ('sorted','cancelled')
       AND me.actor_id IS NOT NULL
       AND (t.owner_actor_id = me.actor_id OR t.current_assignee_actor_id = me.actor_id)
       AND katalist_priv.can_view_thing(t.id)
  )
  SELECT c.id, c.title, c.target, c.reason, c.updated_at
    FROM candidates c, me
   WHERE c.reason IS NOT NULL
     AND c.target <> me.actor_id
     AND NOT EXISTS (
       SELECT 1 FROM public.nudges n
        WHERE n.thing_id = c.id
          AND n.to_actor_id = c.target
          AND n.created_at > now() - make_interval(mins => katalist_priv.config_int('nudge_cooldown_minutes', 120))
     )
   ORDER BY c.updated_at ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.nudge_thing(uuid, public.nudge_reason, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_nudgeable_things() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nudge_thing(uuid, public.nudge_reason, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_nudgeable_things() TO authenticated, service_role;