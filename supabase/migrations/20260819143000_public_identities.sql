-- Narrow identity projection: display name + avatar only. No email, no phone.
CREATE OR REPLACE VIEW public.public_identities AS
SELECT id, display_name, avatar_url
FROM public.profiles;

ALTER VIEW public.public_identities SET (security_invoker = false);
GRANT SELECT ON public.public_identities TO authenticated;
REVOKE ALL ON public.public_identities FROM anon;
