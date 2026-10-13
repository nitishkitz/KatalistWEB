-- Forward-only: repair deployed privilege drift. No user data changes.
DO $$
DECLARE fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','katalist_priv') AND
      (p.proname IN ('run_daily_maintenance','run_nudge_escalation','run_backend_tests')
       OR p.proname LIKE 'test_bridge_%' OR p.proname = 'test_seed_user')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END;
$$;
