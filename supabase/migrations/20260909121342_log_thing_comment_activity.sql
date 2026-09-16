-- "Commented" is declared in activity_event but was never actually logged:
-- rpcComment() inserts directly into thing_comments with no corresponding
-- thing_activity write. This adds that write via a trigger, following the
-- same defensive pattern as notify_on_thing_comment() (a logging failure
-- must never block the comment insert itself).
CREATE OR REPLACE FUNCTION public.log_thing_comment_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
BEGIN
  PERFORM katalist_priv.log_activity(
    NEW.thing_id,
    NEW.author_actor_id,
    'commented'::activity_event,
    jsonb_build_object('comment_id', NEW.id)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'comment activity logging skipped: %', SQLERRM;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.log_thing_comment_activity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_thing_comments_log_activity ON public.thing_comments;
CREATE TRIGGER trg_thing_comments_log_activity
  AFTER INSERT ON public.thing_comments
  FOR EACH ROW EXECUTE FUNCTION public.log_thing_comment_activity();
