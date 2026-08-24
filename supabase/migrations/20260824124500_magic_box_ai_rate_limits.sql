-- Magic Box v2 AI credit budgets.
-- Service-role only. Stores a one-way hash of user id + operation, never prompts or audio.
-- Forward-only. Do not apply automatically.

CREATE TABLE IF NOT EXISTS katalist_priv.magic_box_ai_rate_limits (
  bucket_hash text NOT NULL,
  window_kind text NOT NULL CHECK (window_kind IN ('minute', 'day')),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  hit_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_hash, window_kind)
);

ALTER TABLE katalist_priv.magic_box_ai_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE katalist_priv.magic_box_ai_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE katalist_priv.magic_box_ai_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_magic_box_ai_budget(
  p_user_id text,
  p_operation text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv, extensions
AS $$
DECLARE
  v_hash text;
  v_minute_limit integer;
  v_day_limit integer;
  v_now timestamptz := now();
  v_minute katalist_priv.magic_box_ai_rate_limits;
  v_day katalist_priv.magic_box_ai_rate_limits;
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) < 8 OR p_operation IS NULL THEN
    RETURN false;
  END IF;

  IF p_operation = 'correct' THEN
    v_minute_limit := 6;
    v_day_limit := 40;
  ELSIF p_operation = 'coey' THEN
    v_minute_limit := 4;
    v_day_limit := 20;
  ELSIF p_operation = 'transcribe' THEN
    v_minute_limit := 4;
    v_day_limit := 30;
  ELSE
    RETURN false;
  END IF;

  v_hash := encode(extensions.digest(convert_to(p_operation || ':' || p_user_id, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO katalist_priv.magic_box_ai_rate_limits (bucket_hash, window_kind, window_started_at, hit_count)
  VALUES (v_hash, 'minute', v_now, 0), (v_hash, 'day', v_now, 0)
  ON CONFLICT (bucket_hash, window_kind) DO NOTHING;

  SELECT * INTO v_minute
    FROM katalist_priv.magic_box_ai_rate_limits
   WHERE bucket_hash = v_hash AND window_kind = 'minute'
   FOR UPDATE;

  SELECT * INTO v_day
    FROM katalist_priv.magic_box_ai_rate_limits
   WHERE bucket_hash = v_hash AND window_kind = 'day'
   FOR UPDATE;

  IF v_now - v_minute.window_started_at >= interval '1 minute' THEN
    UPDATE katalist_priv.magic_box_ai_rate_limits
       SET window_started_at = v_now, hit_count = 0
     WHERE bucket_hash = v_hash AND window_kind = 'minute';
    v_minute.hit_count := 0;
  END IF;

  IF v_now - v_day.window_started_at >= interval '1 day' THEN
    UPDATE katalist_priv.magic_box_ai_rate_limits
       SET window_started_at = v_now, hit_count = 0
     WHERE bucket_hash = v_hash AND window_kind = 'day';
    v_day.hit_count := 0;
  END IF;

  IF v_minute.hit_count >= v_minute_limit OR v_day.hit_count >= v_day_limit THEN
    RETURN false;
  END IF;

  UPDATE katalist_priv.magic_box_ai_rate_limits
     SET hit_count = hit_count + 1
   WHERE bucket_hash = v_hash AND window_kind = 'minute';

  UPDATE katalist_priv.magic_box_ai_rate_limits
     SET hit_count = hit_count + 1
   WHERE bucket_hash = v_hash AND window_kind = 'day';

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_magic_box_ai_budget(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_magic_box_ai_budget(text, text) TO service_role;
