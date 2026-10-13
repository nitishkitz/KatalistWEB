-- Persistent sign-in attempt limiter shared by every server instance.
-- Keys are server-side hashes of the normalised number and the client address;
-- no raw phone number or IP is stored. Called only by the server (service_role).

CREATE TABLE IF NOT EXISTS katalist_priv.phone_login_attempts (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  phone_key text NOT NULL CHECK (phone_key ~ '^[0-9a-f]{64}$'),
  ip_key    text NOT NULL CHECK (ip_key ~ '^[0-9a-f]{64}$'),
  at        timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS phone_login_attempts_phone ON katalist_priv.phone_login_attempts (phone_key, at);
CREATE INDEX IF NOT EXISTS phone_login_attempts_ip ON katalist_priv.phone_login_attempts (ip_key, at);
REVOKE ALL ON katalist_priv.phone_login_attempts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.phone_login_attempt(p_phone_key text, p_ip_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_window interval := interval '15 minutes';
  v_phone  int;
  v_ip     int;
  v_oldest timestamptz;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'server only'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('phone-login:' || p_phone_key, 0));
  DELETE FROM katalist_priv.phone_login_attempts WHERE at < clock_timestamp() - interval '1 day';
  SELECT count(*), min(at) INTO v_phone, v_oldest FROM katalist_priv.phone_login_attempts
   WHERE phone_key = p_phone_key AND at > clock_timestamp() - v_window;
  SELECT count(*) INTO v_ip FROM katalist_priv.phone_login_attempts
   WHERE ip_key = p_ip_key AND at > clock_timestamp() - v_window;
  IF v_phone >= 10 OR v_ip >= 30 THEN
    RETURN jsonb_build_object('allowed', false,
      'retry_after_s', greatest(60, ceil(extract(epoch FROM (COALESCE(v_oldest, clock_timestamp()) + v_window - clock_timestamp())))::int));
  END IF;
  INSERT INTO katalist_priv.phone_login_attempts (phone_key, ip_key) VALUES (p_phone_key, p_ip_key);
  RETURN jsonb_build_object('allowed', true, 'retry_after_s', 0);
END;
$$;
REVOKE ALL ON FUNCTION public.phone_login_attempt(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phone_login_attempt(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
