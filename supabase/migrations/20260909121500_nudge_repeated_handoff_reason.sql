-- repeated_handoff is declared in the nudge_reason enum (BRD SS18.3: "Reassigned
-- twice") but list_nudgeable_things() never actually computed it - only 4 of
-- the 5 reasons were live. Adds the missing branch, ranked between
-- waiting_for_catch (still the most actionable signal) and due_soon.
CREATE OR REPLACE FUNCTION public.list_nudgeable_things()
RETURNS TABLE(thing_id uuid, title text, to_actor_id uuid, reason nudge_reason, since timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
  WITH me AS (SELECT katalist_priv.current_actor_id() AS actor_id),
  candidates AS (
    SELECT t.id,
           t.title,
           t.current_assignee_actor_id AS target,
           CASE
             WHEN t.acknowledgement = 'waiting_for_catch'
                  AND t.updated_at < now() - make_interval(hours => katalist_priv.config_int('nudge_waiting_hours', 4))
               THEN 'waiting_for_catch'
             WHEN (
                    SELECT count(*) FROM public.thing_activity ta
                     WHERE ta.thing_id = t.id AND ta.event = 'reassigned'
                  ) >= katalist_priv.config_int('nudge_repeated_handoff_count', 2)
               THEN 'repeated_handoff'
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
       AND t.owner_actor_id = me.actor_id
       AND t.current_assignee_actor_id <> me.actor_id
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
$function$;
