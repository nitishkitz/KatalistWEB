-- Operator step for the reviewed existing target only. Reversible maintenance.
-- Preserve original grants in the count-only operation report before applying.
BEGIN;
INSERT INTO public.app_config(key,value,description)
VALUES ('reset_maintenance','true'::jsonb,'Keep closed until the Coey release is verified')
ON CONFLICT(key) DO UPDATE SET value='true'::jsonb;

CREATE OR REPLACE FUNCTION katalist_priv.reject_reset_inserts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.app_config WHERE key='reset_maintenance' AND value='true'::jsonb) THEN
    RAISE EXCEPTION 'Application is in reset maintenance' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.reject_reset_inserts() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS katalist_reset_signup_fence ON auth.users;
CREATE TRIGGER katalist_reset_signup_fence BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION katalist_priv.reject_reset_inserts();
DROP TRIGGER IF EXISTS katalist_reset_storage_fence ON storage.objects;
CREATE TRIGGER katalist_reset_storage_fence BEFORE INSERT OR UPDATE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION katalist_priv.reject_reset_inserts();

-- Covers direct REST/RPC calls with old user and service credentials.
REVOKE ALL ON SCHEMA public,katalist_priv FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
