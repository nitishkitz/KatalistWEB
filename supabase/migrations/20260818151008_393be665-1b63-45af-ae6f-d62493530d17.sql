-- =========================================
-- PHASE 9: NOTIFICATIONS + REALTIME
-- =========================================

CREATE TABLE public.notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  title           text NOT NULL,
  body            text,
  thing_id        uuid REFERENCES public.things(id) ON DELETE CASCADE,
  list_id         uuid REFERENCES public.lists(id) ON DELETE CASCADE,
  actor_id        uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "notifications_delete_own"
  ON public.notifications FOR DELETE TO authenticated
  USING (profile_id = auth.uid());

CREATE INDEX notifications_profile_unread_idx
  ON public.notifications (profile_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX notifications_profile_created_idx
  ON public.notifications (profile_id, created_at DESC);
CREATE INDEX notifications_thing_idx ON public.notifications (thing_id);

CREATE TRIGGER notifications_set_updated_at
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Immutability: a recipient may only flip read_at.
CREATE OR REPLACE FUNCTION public.enforce_notification_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'pg_catalog','public'
AS $$
BEGIN
  IF NEW.id         <> OLD.id
     OR NEW.profile_id <> OLD.profile_id
     OR NEW.kind     <> OLD.kind
     OR NEW.title    <> OLD.title
     OR NEW.body     IS DISTINCT FROM OLD.body
     OR NEW.thing_id IS DISTINCT FROM OLD.thing_id
     OR NEW.list_id  IS DISTINCT FROM OLD.list_id
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
     OR NEW.payload  IS DISTINCT FROM OLD.payload
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'only the read state of a notification can change';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_notification_immutability() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER notifications_immutable
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_notification_immutability();

-- ---------- internal emit helper ----------
CREATE OR REPLACE FUNCTION katalist_priv.notify_actor(
  p_actor_id  uuid,
  p_kind      text,
  p_title     text,
  p_body      text DEFAULT NULL,
  p_thing_id  uuid DEFAULT NULL,
  p_list_id   uuid DEFAULT NULL,
  p_from_actor uuid DEFAULT NULL,
  p_payload   jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv'
AS $$
DECLARE
  v_profile uuid;
BEGIN
  IF p_actor_id IS NULL THEN
    RETURN;
  END IF;

  SELECT a.profile_id INTO v_profile FROM public.actors a WHERE a.id = p_actor_id;
  -- External (Bridge) actors have no in-app inbox.
  IF v_profile IS NULL THEN
    RETURN;
  END IF;
  -- Never notify someone about their own action.
  IF p_from_actor IS NOT NULL AND p_from_actor = p_actor_id THEN
    RETURN;
  END IF;

  INSERT INTO public.notifications (profile_id, kind, title, body, thing_id, list_id, actor_id, payload)
  VALUES (v_profile, p_kind, p_title, p_body, p_thing_id, p_list_id, p_from_actor, COALESCE(p_payload,'{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.notify_actor(uuid,text,text,text,uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;

-- ---------- fan-out from the shared activity timeline ----------
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
      jsonb_build_object('work_status', NEW.meta ->> 'work_status'));

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
      NULLIF(NEW.meta ->> 'to_actor_id','')::uuid, 'nudged',
      'You were nudged', v_title,
      v_thing.id, v_thing.list_id, NEW.actor_id,
      jsonb_build_object('reason', NEW.meta ->> 'reason'));

  ELSIF NEW.event = 'due_changed' THEN
    PERFORM katalist_priv.notify_actor(
      v_thing.current_assignee_actor_id, 'thing_due_changed',
      'Due date changed', v_title,
      v_thing.id, v_thing.list_id, NEW.actor_id,
      jsonb_build_object('due_at', NEW.meta ->> 'due_at'));

  ELSIF NEW.event = 'importance_changed' THEN
    PERFORM katalist_priv.notify_actor(
      v_thing.current_assignee_actor_id, 'thing_importance_changed',
      'Owner Importance changed', v_title,
      v_thing.id, v_thing.list_id, NEW.actor_id,
      jsonb_build_object('owner_importance', NEW.meta ->> 'owner_importance'));
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_on_thing_activity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER thing_activity_notify
  AFTER INSERT ON public.thing_activity
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_thing_activity();

-- ---------- comments ----------
CREATE OR REPLACE FUNCTION public.notify_on_thing_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv'
AS $$
DECLARE
  v_thing public.things;
BEGIN
  SELECT * INTO v_thing FROM public.things WHERE id = NEW.thing_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  PERFORM katalist_priv.notify_actor(v_thing.owner_actor_id, 'thing_comment',
    'New comment on a Thing', v_thing.title, v_thing.id, v_thing.list_id, NEW.author_actor_id);
  PERFORM katalist_priv.notify_actor(v_thing.current_assignee_actor_id, 'thing_comment',
    'New comment on a Thing', v_thing.title, v_thing.id, v_thing.list_id, NEW.author_actor_id);

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_on_thing_comment() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER thing_comments_notify
  AFTER INSERT ON public.thing_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_thing_comment();

-- ---------- list messages ----------
CREATE OR REPLACE FUNCTION public.notify_on_list_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv'
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
    SELECT v_list.owner_profile_id AS profile_id
    UNION
    SELECT m.profile_id FROM public.list_members m WHERE m.list_id = NEW.list_id
  LOOP
    IF r.profile_id IS NOT NULL AND r.profile_id <> NEW.author_profile_id THEN
      INSERT INTO public.notifications (profile_id, kind, title, body, list_id, payload)
      VALUES (r.profile_id, 'list_message', 'New message in ' || v_list.name, NEW.body, v_list.id, '{}'::jsonb);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_on_list_message() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER list_messages_notify
  AFTER INSERT ON public.list_messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_list_message();

-- ---------- reader RPCs ----------
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id uuid)
RETURNS public.notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv'
AS $$
DECLARE
  v_row public.notifications;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.notifications
     SET read_at = COALESCE(read_at, now())
   WHERE id = p_notification_id AND profile_id = auth.uid()
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'notification not found';
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv'
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  WITH upd AS (
    UPDATE public.notifications
       SET read_at = now()
     WHERE profile_id = auth.uid() AND read_at IS NULL
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM upd;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.unread_notification_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv'
AS $$
  SELECT count(*)::integer
    FROM public.notifications n
   WHERE n.profile_id = auth.uid()
     AND n.read_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.mark_notification_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unread_notification_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unread_notification_count() TO authenticated, service_role;

-- ---------- realtime ----------
ALTER TABLE public.things            REPLICA IDENTITY FULL;
ALTER TABLE public.thing_activity    REPLICA IDENTITY FULL;
ALTER TABLE public.thing_comments    REPLICA IDENTITY FULL;
ALTER TABLE public.thing_assignments REPLICA IDENTITY FULL;
ALTER TABLE public.list_messages     REPLICA IDENTITY FULL;
ALTER TABLE public.nudges            REPLICA IDENTITY FULL;
ALTER TABLE public.notifications     REPLICA IDENTITY FULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['things','thing_activity','thing_comments','thing_assignments','list_messages','nudges','notifications']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END;
$$;
