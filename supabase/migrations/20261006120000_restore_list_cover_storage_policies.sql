-- Restore private List-cover Storage access after moving to a new Supabase
-- project. The bucket is provisioned through the Storage API/Dashboard; this
-- migration only restores authenticated object policies.

DROP POLICY IF EXISTS "list covers readable by authenticated" ON storage.objects;
CREATE POLICY "list covers readable by authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'list-covers');

DROP POLICY IF EXISTS "list covers insertable by owner" ON storage.objects;
CREATE POLICY "list covers insertable by owner"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'list-covers' AND owner = auth.uid());

DROP POLICY IF EXISTS "list covers updatable by owner" ON storage.objects;
CREATE POLICY "list covers updatable by owner"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'list-covers' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'list-covers' AND owner = auth.uid());

DROP POLICY IF EXISTS "list covers deletable by owner" ON storage.objects;
CREATE POLICY "list covers deletable by owner"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'list-covers' AND owner = auth.uid());
