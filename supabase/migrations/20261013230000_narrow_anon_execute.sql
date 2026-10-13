-- Narrow privileges before reopening. Supabase's default grants gave the anon
-- role EXECUTE on every function in the application schemas. Nothing in
-- Katalist calls a database function before sign-in (sign-in itself runs on
-- the server with the service role), so anon keeps none. Functions still
-- check their callers internally; this removes the reliance on that.
DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'katalist_priv') AND p.prokind IN ('f', 'p')
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    -- Keep exactly what signed-in users and the server can do today, explicitly,
    -- so removing the PUBLIC grant cannot take it away from them.
    IF has_function_privilege('authenticated', fn, 'EXECUTE') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn); END IF;
    IF has_function_privilege('service_role', fn, 'EXECUTE') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn); END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
  END LOOP;
END $$;

-- Functions created later by migrations start without anon execute.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA katalist_priv REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
