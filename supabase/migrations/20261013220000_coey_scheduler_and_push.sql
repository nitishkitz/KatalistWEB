-- Durable five-minute scheduler for Coey follow-ups, and observable push retries.
--
-- Scheduler: pg_cron (in this Supabase project) calls the deployed
-- /api/jobs/coey-followups every five minutes through pg_net. The URL lives in
-- app_config ('coey_followups_url') and the shared secret in Vault
-- ('coey_scheduler_secret'); neither is in source control. Until both exist,
-- the tick does nothing. Overlapping ticks are safe: delivery is idempotent per
-- holder (advisory lock + schedule/calendar revisions) and pushes are claimed
-- atomically below.
--
-- Push: a notification is marked pushed only after a successful send. Failed
-- sends record the attempt and reason (no content) and are retried up to five
-- times within 24 hours.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS push_attempts smallint NOT NULL DEFAULT 0;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS push_last_attempt_at timestamptz;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS push_error text CHECK (push_error IS NULL OR length(push_error) <= 80);
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS pushed_at timestamptz;

-- Claim up to p_limit Coey pushes that are due, so two overlapping runs never send the same one.
CREATE OR REPLACE FUNCTION public.claim_coey_pushes(p_limit integer DEFAULT 200)
RETURNS TABLE (id uuid, profile_id uuid, title text, body text, thing_id uuid, attempts smallint)
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  UPDATE public.notifications n
     SET push_attempts = n.push_attempts + 1, push_last_attempt_at = now()
   WHERE n.id IN (
     SELECT x.id FROM public.notifications x
      WHERE x.kind = 'coey_nudge' AND x.pushed_at IS NULL AND x.push_attempts < 5
        AND x.created_at > now() - interval '24 hours'
        AND (x.push_last_attempt_at IS NULL OR x.push_last_attempt_at < now() - interval '4 minutes')
      ORDER BY x.created_at
      LIMIT greatest(1, least(p_limit, 500))
      FOR UPDATE SKIP LOCKED)
  RETURNING n.id, n.profile_id, n.title, n.body, n.thing_id, n.push_attempts;
$$;

CREATE OR REPLACE FUNCTION public.finish_coey_push(p_id uuid, p_sent boolean, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  UPDATE public.notifications
     SET pushed_at = CASE WHEN p_sent THEN now() ELSE pushed_at END,
         push_error = CASE WHEN p_sent THEN NULL ELSE left(p_reason, 80) END,
         -- Nothing to retry when the person has no registered device.
         push_attempts = CASE WHEN NOT p_sent AND p_reason = 'no_tokens' THEN 5 ELSE push_attempts END
   WHERE id = p_id;
$$;
REVOKE ALL ON FUNCTION public.claim_coey_pushes(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_coey_push(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_coey_pushes(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_coey_push(uuid, boolean, text) TO service_role;

-- The tick.
CREATE OR REPLACE FUNCTION katalist_priv.coey_scheduler_tick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv', 'extensions'
AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  SELECT value #>> '{}' INTO v_url FROM public.app_config WHERE key = 'coey_followups_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'coey_scheduler_secret' LIMIT 1;
  IF v_url IS NULL OR v_url !~ '^https://' OR v_secret IS NULL THEN RETURN NULL; END IF;
  RETURN net.http_post(
    url := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.coey_scheduler_tick() FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'coey-followups') THEN
    PERFORM cron.unschedule('coey-followups');
  END IF;
  PERFORM cron.schedule('coey-followups', '*/5 * * * *', 'SELECT katalist_priv.coey_scheduler_tick()');
END $$;

NOTIFY pgrst, 'reload schema';
