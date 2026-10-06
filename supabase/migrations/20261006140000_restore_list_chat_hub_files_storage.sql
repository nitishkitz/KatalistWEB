-- Restore the private `list-chat` and `hub-files` buckets and their object
-- policies on the fresh Supabase project. Team/List call "Present a document",
-- chat attachments and Hub file uploads all write to these buckets; without
-- the INSERT/SELECT policies every upload fails with an RLS error.
INSERT INTO storage.buckets (id, name, public)
VALUES ('list-chat', 'list-chat', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('hub-files', 'hub-files', false)
ON CONFLICT (id) DO NOTHING;

-- list-chat
DROP POLICY IF EXISTS "list chat readable by authenticated" ON storage.objects;
CREATE POLICY "list chat readable by authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'list-chat');

DROP POLICY IF EXISTS "list chat insertable by uploader" ON storage.objects;
CREATE POLICY "list chat insertable by uploader"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'list-chat' AND owner = auth.uid());

DROP POLICY IF EXISTS "list chat updatable by uploader" ON storage.objects;
CREATE POLICY "list chat updatable by uploader"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'list-chat' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'list-chat' AND owner = auth.uid());

DROP POLICY IF EXISTS "list chat deletable by uploader" ON storage.objects;
CREATE POLICY "list chat deletable by uploader"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'list-chat' AND owner = auth.uid());

-- hub-files
DROP POLICY IF EXISTS "hub files readable by authenticated" ON storage.objects;
CREATE POLICY "hub files readable by authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'hub-files');

DROP POLICY IF EXISTS "hub files insertable by owner" ON storage.objects;
CREATE POLICY "hub files insertable by owner"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'hub-files' AND owner = auth.uid());

DROP POLICY IF EXISTS "hub files updatable by owner" ON storage.objects;
CREATE POLICY "hub files updatable by owner"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'hub-files' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'hub-files' AND owner = auth.uid());

DROP POLICY IF EXISTS "hub files deletable by owner" ON storage.objects;
CREATE POLICY "hub files deletable by owner"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'hub-files' AND owner = auth.uid());

NOTIFY pgrst, 'reload schema';
