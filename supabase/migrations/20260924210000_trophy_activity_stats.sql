-- T06: exact Trophy counters and local-calendar streak without transferring
-- the actor's entire activity history. Invoker RLS mirrors the former read.
CREATE INDEX IF NOT EXISTS idx_thing_activity_actor_event_created
  ON public.thing_activity (actor_id, event, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_trophy_activity_stats(p_timezone text)
RETURNS TABLE (
  sorted_count integer,
  caught_count integer,
  weekly_count integer,
  streak_days integer
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = 'pg_catalog','public' AS $$
DECLARE
  v_actor_id uuid;
  v_today date;
  v_anchor date;
  v_sorted integer;
  v_caught integer;
  v_weekly integer;
  v_streak integer;
BEGIN
  IF p_timezone IS NULL OR length(p_timezone) > 100
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = p_timezone) THEN
    RAISE EXCEPTION 'invalid Trophy timezone' USING ERRCODE = '22023';
  END IF;
  SELECT a.id INTO v_actor_id FROM public.actors a WHERE a.profile_id = auth.uid() LIMIT 1;
  IF v_actor_id IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;

  SELECT count(*) FILTER (WHERE a.event = 'sorted')::integer,
    count(*) FILTER (WHERE a.event = 'caught')::integer,
    count(*) FILTER (WHERE a.created_at >= now() - interval '7 days')::integer
  INTO v_sorted, v_caught, v_weekly
  FROM public.thing_activity a WHERE a.actor_id = v_actor_id;

  v_today := (now() AT TIME ZONE p_timezone)::date;
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.thing_activity a WHERE a.actor_id=v_actor_id
      AND a.event='sorted' AND (a.created_at AT TIME ZONE p_timezone)::date=v_today)
      THEN v_today
    WHEN EXISTS (SELECT 1 FROM public.thing_activity a WHERE a.actor_id=v_actor_id
      AND a.event='sorted' AND (a.created_at AT TIME ZONE p_timezone)::date=v_today-1)
      THEN v_today-1
    ELSE NULL
  END INTO v_anchor;

  WITH sorted_days AS (
    SELECT DISTINCT (a.created_at AT TIME ZONE p_timezone)::date AS day
    FROM public.thing_activity a
    WHERE a.actor_id=v_actor_id AND a.event='sorted'
      AND (a.created_at AT TIME ZONE p_timezone)::date <= v_anchor
  ), ranked AS (
    SELECT day, row_number() OVER (ORDER BY day DESC) AS position FROM sorted_days
  )
  SELECT count(*) FILTER (WHERE day = v_anchor - (position - 1)::integer)::integer
  INTO v_streak FROM ranked;

  RETURN QUERY SELECT v_sorted, v_caught, v_weekly, COALESCE(v_streak,0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_trophy_activity_stats(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trophy_activity_stats(text) TO authenticated;
NOTIFY pgrst, 'reload schema';
