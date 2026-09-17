-- List chat: support call-history system events and file attachments.
--
-- 1. `kind` distinguishes normal member messages from system entries (e.g.
--    "started a call") that render inline in the timeline with a timestamp.
-- 2. `attachment` holds a small JSON descriptor { key, name, mime, size } that
--    points at an object in the private `list-chat` storage bucket; the client
--    mints a fresh signed URL when rendering (the stored URL would expire).

ALTER TABLE public.list_messages
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'message';

ALTER TABLE public.list_messages
  ADD COLUMN IF NOT EXISTS attachment jsonb;

-- Private bucket for chat attachments (read via signed URLs only).
INSERT INTO storage.buckets (id, name, public)
VALUES ('list-chat', 'list-chat', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies mirror the list-covers posture: any authenticated user may
-- read (rows are already gated by list_messages RLS + private signed URLs),
-- while write/replace/delete are limited to the uploader.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'list chat readable by authenticated'
  ) THEN
    CREATE POLICY "list chat readable by authenticated"
      ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'list-chat');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'list chat insertable by uploader'
  ) THEN
    CREATE POLICY "list chat insertable by uploader"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'list-chat' AND owner = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'list chat updatable by uploader'
  ) THEN
    CREATE POLICY "list chat updatable by uploader"
      ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'list-chat' AND owner = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'list chat deletable by uploader'
  ) THEN
    CREATE POLICY "list chat deletable by uploader"
      ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'list-chat' AND owner = auth.uid());
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
