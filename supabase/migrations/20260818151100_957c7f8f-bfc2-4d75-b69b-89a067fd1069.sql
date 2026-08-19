CREATE OR REPLACE FUNCTION public.notify_on_thing_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv'
AS $$
DECLARE
  v_thing public.things;
  v_title text;
BEGIN
  SELECT * INTO v_thing FROM public.things WHERE id = NEW.thing_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  v_title := v_thing.title;

  IF NEW.event = 'assigned' THEN
    PERFORM katalist_priv.notify_actor(
      v_thing.current_assignee_actor_id, 'thing_assigned',
      'A Thing is waiting for your Catch', v_title,
      v_thing.id, v_thing.list_id, NEW.actor_id);

  ELSIF NEW.event = 'caught' THEN
    PERFORM katalist_priv.notify_actor(
      v_thing.owner_actor_id, 'thing_caught',
      'Your Thing was caught', v_title,
      v_thing.id, v_thing.list_id, NEW.actor_id);

  ELSIF NEW.event = 'work_status_changed' THEN
    PERFORM katalist_priv.notify_actor(
      v_thing.owner_actor_id, 'thing_work_status',
      'Progress on your Thing', v_title,
      v_thing.id, v_thing.list_id, NEW.actor_id,
      jsonb_build_object('work_status', NEW.detail ->> 'work_status'));

  ELSIF NEW.event = 'sorted' THEN
    PERFORM katalist_priv.notify_actor(
      v_thing.owner_actor_id, 'thing_sorted',
      'Sorted', v_title,
      v_thing.id, v_thing.list_id, NEW.actor_id);

  ELSIF NEW.event = 'cancelled' THEN
    PERFORM katalist_priv.notify_actor(
      v_thing.current_assignee_actor_id, 'thing_cancelled',
      'A Thing you held was cancelled', v_title,
      v_thing.id, v_thing.list_id, NEW.actor_id);

  ELSIF NEW.event = 'reassigned' THEN
    PERFORM katalist_priv.notify_actor(
      v_thing.owner_actor_id, 'thing_reassigned',
      'Your Thing changed hands', v_title,
      v_thing.id, v_thing.list_id, NEW.actor_id);

  ELSIF NEW.event = 'nudged' THEN
    PERFORM katalist_priv.notify_actor(
      NULLIF(NEW.detail ->> 'to_actor_id','')::uuid, 'nudged',
      'You were nudged', v_title,
      v_thing.id, v_thing.list_id, NEW.actor_id,
      jsonb_build_object('reason', NEW.detail ->> 'reason'));

  ELSIF NEW.event = 'due_changed' THEN
    PERFORM katalist_priv.notify_actor(
      v_thing.current_assignee_actor_id, 'thing_due_changed',
      'Due date changed', v_title,
      v_thing.id, v_thing.list_id, NEW.actor_id,
      jsonb_build_object('due_at', NEW.detail ->> 'due_at'));

  ELSIF NEW.event = 'importance_changed' THEN
    PERFORM katalist_priv.notify_actor(
      v_thing.current_assignee_actor_id, 'thing_importance_changed',
      'Owner Importance changed', v_title,
      v_thing.id, v_thing.list_id, NEW.actor_id,
      jsonb_build_object('owner_importance', NEW.detail ->> 'owner_importance'));
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_on_thing_activity() FROM PUBLIC, anon, authenticated;
