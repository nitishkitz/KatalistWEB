-- @mention notifications for Thing comments and Team/List chat.
--
-- * thing_comments.mention_ids stores the people the author selected in the
--   composer. Each id may be an actor id (Thing owner/assignee/creator) or a
--   profile id (List member); the trigger resolves both to a profile.
-- * One in-app `mention` notification per (recipient, source message/comment),
--   enforced by a partial unique index so retries and re-sends never duplicate.
-- * A mentioned person receives the `mention` notification INSTEAD of the
--   generic "new message" / "new comment" one for the same source.
-- * Notification failures never block the message or comment itself.

ALTER TABLE public.thing_comments
  ADD COLUMN IF NOT EXISTS mention_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_thing_comments_mentions
  ON public.thing_comments USING gin (mention_ids);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_mention_source
  ON public.notifications (profile_id, (payload ->> 'source_id'))
  WHERE kind = 'mention';

-- Resolve a mixed list of actor/profile ids to distinct profile ids.
CREATE OR REPLACE FUNCTION katalist_priv.resolve_mention_profiles(p_ids uuid[])
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog','public'
AS $$
  SELECT COALESCE(array_agg(DISTINCT x.profile_id), '{}'::uuid[])
    FROM (
      SELECT a.profile_id FROM public.actors a
       WHERE a.id = ANY (COALESCE(p_ids, '{}'::uuid[])) AND a.profile_id IS NOT NULL
      UNION
      SELECT p.id FROM public.profiles p
       WHERE p.id = ANY (COALESCE(p_ids, '{}'::uuid[]))
    ) x;
$$;
REVOKE ALL ON FUNCTION katalist_priv.resolve_mention_profiles(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION katalist_priv.resolve_mention_profiles(uuid[]) TO service_role;

-- Thing comments: generic notification now skips people who were mentioned.
CREATE OR REPLACE FUNCTION public.notify_on_thing_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_thing     public.things;
  v_mentioned uuid[] := katalist_priv.resolve_mention_profiles(NEW.mention_ids);
BEGIN
  SELECT * INTO v_thing FROM public.things WHERE id = NEW.thing_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  PERFORM katalist_priv.notify_actor(a.actor_id, 'thing_comment',
    'New comment on a Thing', v_thing.title, v_thing.id, v_thing.list_id, NEW.author_actor_id)
  FROM (
    SELECT DISTINCT x.actor_id FROM (
      VALUES (v_thing.owner_actor_id), (v_thing.current_assignee_actor_id)
    ) AS x(actor_id)
    WHERE x.actor_id IS NOT NULL
  ) a
  WHERE NOT EXISTS (
    SELECT 1 FROM public.actors act
     WHERE act.id = a.actor_id AND act.profile_id = ANY (v_mentioned)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'comment notification skipped: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_thing_comment_mentions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_thing          public.things;
  v_author_profile uuid;
  v_author_name    text;
  v_recipient      uuid;
  v_body           text;
BEGIN
  IF COALESCE(array_length(NEW.mention_ids, 1), 0) = 0 THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_thing FROM public.things WHERE id = NEW.thing_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT a.profile_id INTO v_author_profile FROM public.actors a WHERE a.id = NEW.author_actor_id;
  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'Someone') INTO v_author_name
    FROM public.profiles p WHERE p.id = v_author_profile;
  v_author_name := COALESCE(v_author_name, 'Someone');
  v_body := left(btrim(regexp_replace(NEW.body, '<!--attachments:.*-->', '', 's')), 160);

  FOREACH v_recipient IN ARRAY katalist_priv.resolve_mention_profiles(NEW.mention_ids) LOOP
    CONTINUE WHEN v_recipient IS NOT DISTINCT FROM v_author_profile;
    -- Only people connected to this Thing: its owner/assignee/creator, or its List's owner/members.
    CONTINUE WHEN NOT (
      EXISTS (
        SELECT 1 FROM public.actors a
         WHERE a.profile_id = v_recipient
           AND a.id IN (v_thing.owner_actor_id, v_thing.current_assignee_actor_id, v_thing.creator_actor_id)
      )
      OR (v_thing.list_id IS NOT NULL AND (
        EXISTS (SELECT 1 FROM public.lists l WHERE l.id = v_thing.list_id AND l.owner_profile_id = v_recipient)
        OR EXISTS (SELECT 1 FROM public.list_members m WHERE m.list_id = v_thing.list_id AND m.profile_id = v_recipient)
      ))
    );

    INSERT INTO public.notifications (profile_id, kind, title, body, thing_id, list_id, actor_id, payload)
    VALUES (
      v_recipient, 'mention', left(v_author_name || ' mentioned you', 160),
      NULLIF(v_body, ''), v_thing.id, v_thing.list_id, NEW.author_actor_id,
      jsonb_build_object(
        'source', 'thing_comment', 'source_id', NEW.id::text, 'comment_id', NEW.id,
        'path', '/?thing=' || v_thing.id::text
      )
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'comment mention notification skipped: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_on_thing_comment_mentions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_thing_comment_mentions() TO service_role;

DROP TRIGGER IF EXISTS trg_thing_comments_mentions ON public.thing_comments;
CREATE TRIGGER trg_thing_comments_mentions
  AFTER INSERT ON public.thing_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_thing_comment_mentions();

-- List / Team chat: mentioned members get one `mention`; everyone else the generic notice.
CREATE OR REPLACE FUNCTION public.notify_on_list_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_list        public.lists;
  v_author_name text;
  v_recipient   uuid;
  v_path        text;
BEGIN
  SELECT * INTO v_list FROM public.lists WHERE id = NEW.list_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  v_path := CASE WHEN v_list.kind IN ('dm', 'group') THEN '/team/' ELSE '/lists/' END || v_list.id::text;
  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'Someone') INTO v_author_name
    FROM public.profiles p WHERE p.id = NEW.author_profile_id;
  v_author_name := COALESCE(v_author_name, 'Someone');

  FOR v_recipient IN
    SELECT DISTINCT m.profile_id FROM unnest(NEW.mentioned_profile_ids) AS m(profile_id)
     WHERE m.profile_id IS DISTINCT FROM NEW.author_profile_id
       AND (
         m.profile_id = v_list.owner_profile_id
         OR EXISTS (SELECT 1 FROM public.list_members lm WHERE lm.list_id = NEW.list_id AND lm.profile_id = m.profile_id)
       )
  LOOP
    INSERT INTO public.notifications (profile_id, kind, title, body, list_id, payload)
    VALUES (
      v_recipient, 'mention', left(v_author_name || ' mentioned you in ' || v_list.name, 160),
      NULLIF(left(NEW.body, 160), ''), v_list.id,
      jsonb_build_object('source', 'list_message', 'source_id', NEW.id::text, 'message_id', NEW.id, 'path', v_path)
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  PERFORM katalist_priv.notify_list_participants(
    NEW.list_id,
    ARRAY[NEW.author_profile_id] || NEW.mentioned_profile_ids,
    'list_message', 'New message in ' || v_list.name, left(NEW.body, 160), NEW.author_profile_id,
    '/lists/' || NEW.list_id::text, jsonb_build_object('message_id', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'list message notification skipped: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_on_list_message() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_list_message() TO service_role;

NOTIFY pgrst, 'reload schema';
