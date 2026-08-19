ALTER FUNCTION katalist_priv.run_backend_tests() SECURITY INVOKER;
ALTER FUNCTION public.run_backend_tests() SECURITY INVOKER;
GRANT USAGE ON SCHEMA katalist_priv TO service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.run_backend_tests() TO service_role;