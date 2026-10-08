-- Applied individually to Katalist_uat (jrdsmmiggezrhiakncwc), 7 October 2026.
-- Authorized by the user to use the presently working Supabase project.
-- Recorded at the exact remote migration version; Code Activity objects only.
-- Source: output/code-activity-execution/migration-candidates/20261007100200_code_activity_webhooks.sql

CREATE TYPE public.code_activity_delivery_status AS ENUM ('received','processing','processed','failed','dead','ignored');

CREATE TABLE public.code_activity_deliveries (
  delivery_id      uuid PRIMARY KEY,                              -- X-GitHub-Delivery
  event            text NOT NULL CHECK (event IN ('push','pull_request','check_run','status','installation','installation_repositories')),
  action           text CHECK (char_length(action) <= 64),
  installation_id  bigint NOT NULL,
  repository_id    bigint,
  refetch          jsonb NOT NULL CHECK (octet_length(refetch::text) <= 4096),
  status           public.code_activity_delivery_status NOT NULL DEFAULT 'received',
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  lease_token      uuid,
  lease_until      timestamptz,
  last_error_code  text CHECK (char_length(last_error_code) <= 64),
  received_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz
);
CREATE INDEX code_activity_deliveries_queue_idx ON public.code_activity_deliveries (status, next_attempt_at);
CREATE INDEX code_activity_deliveries_received_idx ON public.code_activity_deliveries (received_at);

ALTER TABLE public.code_activity_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.code_activity_deliveries FROM PUBLIC, anon, authenticated, service_role;

-- Intake. Returns 'recorded', 'duplicate' or 'disabled'. Never touches a connection or GitHub.
-- Sync off (or master off) means nothing is stored and the caller answers 503, so GitHub shows a failed delivery
-- that can be redelivered later.
CREATE FUNCTION public.code_activity_server_record_delivery(
  p_delivery_id uuid, p_event text, p_action text, p_installation_id bigint, p_repository_id bigint, p_refetch jsonb)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE n integer;
BEGIN
  IF NOT katalist_priv.code_activity_flag('master') OR NOT katalist_priv.code_activity_flag('sync') THEN
    RETURN 'disabled';
  END IF;
  IF p_delivery_id IS NULL OR p_installation_id IS NULL OR p_installation_id <= 0
     OR p_event IS NULL OR jsonb_typeof(COALESCE(p_refetch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.code_activity_deliveries (delivery_id, event, action, installation_id, repository_id, refetch)
  VALUES (p_delivery_id, p_event, left(p_action, 64), p_installation_id, p_repository_id, COALESCE(p_refetch, '{}'::jsonb))
  ON CONFLICT (delivery_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN CASE WHEN n = 1 THEN 'recorded' ELSE 'duplicate' END;
END;
$$;

-- A repository-removal event can list many repositories, but one queue row holds at most 4 KiB. Dropping the excess
-- would leave connections un-revoked, so the ids are split into rows of 200 IN ONE TRANSACTION: all of them or none
-- (so a redelivery after a failure can never find "a duplicate" while the rest is missing). The first row keeps the
-- GitHub delivery id, so a redelivery is recognised; the others get ids derived from it. More than 5,000 ids is
-- recorded as one row with overflow = true, which processing treats fail-closed (see apply_installation_event).
CREATE FUNCTION public.code_activity_server_record_removal(p_delivery_id uuid, p_installation_id bigint, p_repository_ids bigint[], p_overflow boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE n integer; chunks integer; i integer; ids bigint[]; child uuid;
BEGIN
  IF NOT katalist_priv.code_activity_flag('master') OR NOT katalist_priv.code_activity_flag('sync') THEN
    RETURN 'disabled';
  END IF;
  IF p_delivery_id IS NULL OR p_installation_id IS NULL OR p_installation_id <= 0 THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF p_overflow IS TRUE OR COALESCE(cardinality(p_repository_ids), 0) > 5000 THEN
    INSERT INTO public.code_activity_deliveries (delivery_id, event, action, installation_id, refetch)
    VALUES (p_delivery_id, 'installation_repositories', 'removed_overflow', p_installation_id, '{"overflow": true}'::jsonb)
    ON CONFLICT (delivery_id) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN CASE WHEN n = 1 THEN 'recorded' ELSE 'duplicate' END;
  END IF;
  IF COALESCE(cardinality(p_repository_ids), 0) = 0 THEN
    RETURN 'duplicate'; -- nothing was removed: nothing to record
  END IF;
  chunks := ((cardinality(p_repository_ids) - 1) / 200) + 1;
  FOR i IN 0 .. chunks - 1 LOOP
    ids := p_repository_ids[(i * 200 + 1) : LEAST((i + 1) * 200, cardinality(p_repository_ids))];
    child := CASE WHEN i = 0 THEN p_delivery_id ELSE md5(p_delivery_id::text || ':' || i::text)::uuid END;
    INSERT INTO public.code_activity_deliveries (delivery_id, event, action, installation_id, refetch)
    VALUES (child, 'installation_repositories', 'removed', p_installation_id, jsonb_build_object('removed', to_jsonb(ids)))
    ON CONFLICT (delivery_id) DO NOTHING;
    IF i = 0 THEN
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n = 0 THEN RETURN 'duplicate'; END IF; -- the first row exists, so the whole set was recorded together before
    END IF;
  END LOOP;
  RETURN 'recorded';
END;
$$;

REVOKE ALL ON FUNCTION public.code_activity_server_record_delivery(uuid, text, text, bigint, bigint, jsonb), public.code_activity_server_record_removal(uuid, bigint, bigint[], boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.code_activity_server_record_removal(uuid, bigint, bigint[], boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.code_activity_server_record_delivery(uuid, text, text, bigint, bigint, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
