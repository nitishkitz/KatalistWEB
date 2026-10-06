-- Restore the private Thing attachment storage policies on the fresh project.
-- Uploads are confined to the authenticated user's staging folder; final
-- objects are readable only when the user can view the associated Thing.
DROP POLICY IF EXISTS "thing-attachments staging insert" ON storage.objects;
CREATE POLICY "thing-attachments staging insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'thing-attachments'
  AND (storage.foldername(name))[1] = 'staging'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS "thing-attachments staging update" ON storage.objects;
CREATE POLICY "thing-attachments staging update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'thing-attachments'
  AND (storage.foldername(name))[1] = 'staging'
  AND (storage.foldername(name))[2] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'thing-attachments'
  AND (storage.foldername(name))[1] = 'staging'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS "thing-attachments staging delete" ON storage.objects;
CREATE POLICY "thing-attachments staging delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'thing-attachments'
  AND (storage.foldername(name))[1] = 'staging'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS "thing-attachments staging select" ON storage.objects;
CREATE POLICY "thing-attachments staging select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'thing-attachments'
  AND (
    (
      (storage.foldername(name))[1] = 'staging'
      AND (storage.foldername(name))[2] = auth.uid()::text
    )
    OR (
      (storage.foldername(name))[1] = 'things'
      AND katalist_priv.can_view_thing(((storage.foldername(name))[2])::uuid)
    )
  )
);
