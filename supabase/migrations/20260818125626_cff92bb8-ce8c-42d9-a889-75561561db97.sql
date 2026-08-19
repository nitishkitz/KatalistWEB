-- Remove the elevated-rights view; a controlled search RPC replaces it later.
DROP VIEW IF EXISTS public.public_profiles;

-- Internal trigger/event-trigger functions must not be callable from the API.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_actor_immutability() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;