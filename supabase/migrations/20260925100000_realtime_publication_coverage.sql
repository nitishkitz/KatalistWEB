-- T07: the root realtime owner watches these RLS-protected tables, but the
-- original publication only included Things, activity/comments, messages,
-- nudges and notifications. Subscribe callbacks for the missing tables
-- cannot fire until the tables are actually published.
--
-- Keep existing REPLICA IDENTITY settings. DELETE may expose only its primary
-- key under RLS; the client deliberately retains a broad authority fallback.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'lists', 'list_members', 'list_meetings', 'buckets', 'bucket_items',
    'thing_attachments', 'profile_object_state'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', table_name);
    END IF;
  END LOOP;
END;
$$;
