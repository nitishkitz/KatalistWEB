-- Narrow assignable people: actor id + display name + avatar. No email/phone.
CREATE OR REPLACE FUNCTION public.list_assignable_people()
RETURNS TABLE (actor_id uuid, display_name text, avatar_url text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, p.display_name, p.avatar_url
  FROM public.actors a
  JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.kind = 'user'
    AND a.profile_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.list_assignable_people() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_assignable_people() TO authenticated;

-- Stop exposing emails via the old identity view if it exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'public_profiles'
  ) THEN
    REVOKE ALL ON public.public_profiles FROM anon, authenticated;
    DROP VIEW public.public_profiles;
  END IF;
END $$;

-- Avatars bucket: public read, own-folder write.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "avatars public read" ON storage.objects;
CREATE POLICY "avatars public read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars own write" ON storage.objects;
CREATE POLICY "avatars own write"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "avatars own update" ON storage.objects;
CREATE POLICY "avatars own update"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
