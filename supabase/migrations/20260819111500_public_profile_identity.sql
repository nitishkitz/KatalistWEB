-- Allow the web app (anon + authenticated) to read names and avatars.
-- Does not expose phone or other private profile fields.
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT id, email, display_name, avatar_url
FROM public.profiles;

ALTER VIEW public.public_profiles SET (security_invoker = false);

REVOKE ALL ON public.public_profiles FROM PUBLIC;
GRANT SELECT ON public.public_profiles TO anon, authenticated;
