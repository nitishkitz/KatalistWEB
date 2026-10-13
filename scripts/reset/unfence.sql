-- Reopen only after credential/session review and Coey release verification.
-- Restores the six effective role grants recorded in fence-preflight.json.
-- Does not restore anonymous execution of worker/test functions.
BEGIN;
DROP TRIGGER IF EXISTS katalist_reset_signup_fence ON auth.users;
DROP TRIGGER IF EXISTS katalist_reset_storage_fence ON storage.objects;
DROP FUNCTION IF EXISTS katalist_priv.reject_reset_inserts();
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
GRANT USAGE ON SCHEMA katalist_priv TO authenticated,service_role;
UPDATE public.app_config SET value='false'::jsonb WHERE key='reset_maintenance';
NOTIFY pgrst,'reload schema';
COMMIT;
