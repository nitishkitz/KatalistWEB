CREATE OR REPLACE FUNCTION public.run_backend_tests()
RETURNS TABLE(ok boolean, test text, detail text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT * FROM katalist_priv.run_backend_tests();
$$;
REVOKE EXECUTE ON FUNCTION public.run_backend_tests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_backend_tests() TO service_role;