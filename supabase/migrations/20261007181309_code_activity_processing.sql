-- Applied individually to Katalist_uat (jrdsmmiggezrhiakncwc) on 7 October 2026 after explicit user approval.
-- Mirrors the hosted migration version. AI and background sync remain off.
-- ============ Provider request budget per installation ============
-- 1,000 requests per hour per installation: 700 for background work, 300 reserved for interactive reads.
CREATE TABLE public.code_activity_budget (
  installation_id    bigint PRIMARY KEY,
  window_start       timestamptz NOT NULL DEFAULT now(),
  used_background    integer NOT NULL DEFAULT 0,
  used_interactive   integer NOT NULL DEFAULT 0,
  blocked_until      timestamptz
);
ALTER TABLE public.code_activity_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.code_activity_budget FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.code_activity_server_take_budget(p_installation_id bigint, p_cost integer, p_interactive boolean)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE b public.code_activity_budget;
BEGIN
  IF p_installation_id IS NULL OR p_cost IS NULL OR p_cost < 1 OR p_cost > 100 THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.code_activity_budget (installation_id) VALUES (p_installation_id) ON CONFLICT DO NOTHING;
  SELECT * INTO b FROM public.code_activity_budget WHERE installation_id = p_installation_id FOR UPDATE;
  IF b.window_start < now() - interval '1 hour' THEN
    UPDATE public.code_activity_budget SET window_start = now(), used_background = 0, used_interactive = 0
     WHERE installation_id = p_installation_id;
    b.used_background := 0; b.used_interactive := 0;
  END IF;
  IF b.blocked_until IS NOT NULL AND b.blocked_until > now() THEN RETURN false; END IF;
  IF p_interactive THEN
    IF b.used_interactive + p_cost > 300 THEN RETURN false; END IF;
    UPDATE public.code_activity_budget SET used_interactive = used_interactive + p_cost WHERE installation_id = p_installation_id;
  ELSE
    IF b.used_background + p_cost > 700 THEN RETURN false; END IF;
    UPDATE public.code_activity_budget SET used_background = used_background + p_cost WHERE installation_id = p_installation_id;
  END IF;
  RETURN true;
END;
$$;

-- After a rate-limit reply: no work for this installation until the provider says it is allowed again (max 1 hour).
CREATE FUNCTION public.code_activity_server_block_installation(p_installation_id bigint, p_seconds integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.code_activity_budget (installation_id, blocked_until)
  VALUES (p_installation_id, now() + make_interval(secs => LEAST(GREATEST(COALESCE(p_seconds, 60), 60), 3600)))
  ON CONFLICT (installation_id) DO UPDATE
    SET blocked_until = GREATEST(public.code_activity_budget.blocked_until, EXCLUDED.blocked_until);
END;
$$;

-- ============ Claiming and finishing deliveries ============
-- At most 4 deliveries hold a live lease across ALL instances (an advisory lock makes the count race-free).
-- A lease lasts 60 seconds. A crashed worker's lease simply expires and the row is claimed again.
CREATE FUNCTION public.code_activity_server_claim_deliveries(p_limit integer DEFAULT 4)
RETURNS TABLE (o_delivery_id uuid, o_event text, o_action text, o_installation_id bigint, o_repository_id bigint,
               o_refetch jsonb, o_attempts integer, o_lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE active integer; room integer; r public.code_activity_deliveries;
BEGIN
  IF NOT katalist_priv.code_activity_flag('master') OR NOT katalist_priv.code_activity_flag('sync') THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('code_activity_claim'));
  SELECT count(*) INTO active FROM public.code_activity_deliveries
   WHERE status = 'processing' AND lease_until > now();
  room := LEAST(GREATEST(COALESCE(p_limit, 4), 1), 4 - active);
  IF room <= 0 THEN RETURN; END IF;
  FOR r IN
    SELECT * FROM public.code_activity_deliveries d
     WHERE (d.status IN ('received','failed') AND d.next_attempt_at <= now())
        OR (d.status = 'processing' AND d.lease_until <= now())
     ORDER BY d.received_at
     LIMIT room FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.code_activity_deliveries d
       SET status = 'processing', attempts = r.attempts + 1, lease_token = gen_random_uuid(), lease_until = now() + interval '60 seconds'
     WHERE d.delivery_id = r.delivery_id
     RETURNING d.delivery_id, d.event, d.action, d.installation_id, d.repository_id, d.refetch, d.attempts, d.lease_token
       INTO o_delivery_id, o_event, o_action, o_installation_id, o_repository_id, o_refetch, o_attempts, o_lease_token;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Outcome: processed | ignored | retry | dead. Fenced by the lease token, so an expired worker cannot overwrite a newer one.
-- A retry waits 30 s, 2 min, 10 min, 1 h or 6 h (up to 20 percent extra) and becomes dead after 5 attempts.
CREATE FUNCTION public.code_activity_server_finish_delivery(p_delivery_id uuid, p_lease_token uuid, p_outcome text, p_error_code text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE d public.code_activity_deliveries; wait_s integer;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('processed','ignored','retry','dead') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM public.code_activity_deliveries x
   WHERE x.delivery_id = p_delivery_id AND x.status = 'processing' AND x.lease_token = p_lease_token AND x.lease_until > now()
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_outcome = 'retry' AND d.attempts >= 5 THEN p_outcome := 'dead'; END IF;
  wait_s := (ARRAY[30, 120, 600, 3600, 21600])[LEAST(d.attempts, 5)];
  UPDATE public.code_activity_deliveries x SET
    status = CASE p_outcome WHEN 'processed' THEN 'processed' WHEN 'ignored' THEN 'ignored' WHEN 'dead' THEN 'dead' ELSE 'failed' END::public.code_activity_delivery_status,
    next_attempt_at = CASE WHEN p_outcome = 'retry' THEN now() + make_interval(secs => wait_s + floor(random() * wait_s * 0.2)) ELSE x.next_attempt_at END,
    processed_at = CASE WHEN p_outcome IN ('processed','ignored') THEN now() ELSE x.processed_at END,
    last_error_code = left(p_error_code, 64), lease_token = NULL, lease_until = NULL
   WHERE x.delivery_id = p_delivery_id;
  RETURN true;
END;
$$;

-- Every write made on behalf of a delivery must hold THAT delivery's live lease. The row is locked FOR SHARE so
-- finish_delivery cannot complete it in the middle of the write. Raises when the lease is gone (expired, reclaimed,
-- or finished), so a slow worker cannot overwrite data after losing the work to someone else.
CREATE FUNCTION katalist_priv.code_activity_require_delivery_lease(p_delivery_id uuid, p_lease_token uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM public.code_activity_deliveries d
   WHERE d.delivery_id = p_delivery_id AND d.status = 'processing' AND d.lease_token = p_lease_token AND d.lease_until > now()
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lease lost' USING ERRCODE = '40001';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.code_activity_require_delivery_lease(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Retention: processed and ignored 14 days, failed and dead 30 days.
CREATE FUNCTION public.code_activity_server_prune_deliveries()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.code_activity_deliveries
   WHERE (status IN ('processed','ignored') AND received_at < now() - interval '14 days')
      OR (status IN ('failed','dead') AND received_at < now() - interval '30 days');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Visible to operators through the service role: counts per status, oldest waiting age in seconds.
CREATE FUNCTION public.code_activity_server_queue_health()
RETURNS TABLE (o_status text, o_count bigint, o_oldest_seconds integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT status::text, count(*), COALESCE(EXTRACT(epoch FROM now() - min(received_at))::integer, 0)
  FROM public.code_activity_deliveries GROUP BY status;
$$;

-- ============ Applying events to connections ============

-- Which live connections follow this installation and repository (several Lists may share one repository).
CREATE FUNCTION public.code_activity_server_connections_for_event(p_installation_id bigint, p_repository_id bigint)
RETURNS TABLE (o_connection_id uuid, o_list_id uuid, o_generation integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
  SELECT c.id, c.list_id, c.generation
  FROM public.code_activity_connections c
  WHERE c.installation_id = p_installation_id AND c.repository_id = p_repository_id AND c.status = 'active'
    AND katalist_priv.code_activity_flags_ok_for(c.list_id)
    AND katalist_priv.code_activity_flag('sync');
$$;

-- Upsert changes for one connection. Fenced by status and generation. A row never moves backwards in time, so an
-- older event arriving late cannot overwrite newer data. Same item fields as finish_refresh.
CREATE FUNCTION public.code_activity_server_apply_items(p_connection_id uuid, p_generation integer, p_items jsonb, p_delivery_id uuid, p_lease_token uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE c public.code_activity_connections; n integer;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM katalist_priv.code_activity_require_delivery_lease(p_delivery_id, p_lease_token);
  SELECT * INTO c FROM public.code_activity_connections x
   WHERE x.id = p_connection_id AND x.generation = p_generation AND x.status = 'active' FOR SHARE;
  IF NOT FOUND OR NOT katalist_priv.code_activity_flags_ok_for(c.list_id) OR NOT katalist_priv.code_activity_flag('sync') THEN
    RETURN 0;
  END IF;
  INSERT INTO public.code_activity_changes
    (connection_id, kind, provider_key, pr_number, pr_state, title, head_sha, before_sha, head_ref, base_ref,
     author_login, author_kind, source_url, check_state, checks_revision, provider_updated_at, last_activity_at)
  SELECT p_connection_id, i->>'kind', i->>'provider_key', NULLIF(i->>'pr_number','')::integer, i->>'pr_state',
         left(i->>'title', 300), i->>'head_sha', i->>'before_sha', i->>'head_ref', i->>'base_ref',
         i->>'author_login', COALESCE(i->>'author_kind','unknown'), i->>'source_url',
         COALESCE(i->>'check_state','unavailable'), i->>'checks_revision',
         (i->>'provider_updated_at')::timestamptz, (i->>'last_activity_at')::timestamptz
  FROM jsonb_array_elements(p_items) AS i
  ON CONFLICT (connection_id, kind, provider_key) DO UPDATE SET
    pr_number = EXCLUDED.pr_number, pr_state = EXCLUDED.pr_state, title = EXCLUDED.title,
    head_sha = EXCLUDED.head_sha, before_sha = EXCLUDED.before_sha, head_ref = EXCLUDED.head_ref,
    base_ref = EXCLUDED.base_ref, author_login = EXCLUDED.author_login, author_kind = EXCLUDED.author_kind,
    source_url = EXCLUDED.source_url,
    check_state = CASE
      WHEN EXCLUDED.checks_revision IS NOT NULL THEN EXCLUDED.check_state
      WHEN public.code_activity_changes.head_sha IS NOT DISTINCT FROM EXCLUDED.head_sha THEN public.code_activity_changes.check_state
      ELSE 'unavailable' END,
    checks_revision = CASE
      WHEN EXCLUDED.checks_revision IS NOT NULL THEN EXCLUDED.checks_revision
      WHEN public.code_activity_changes.head_sha IS NOT DISTINCT FROM EXCLUDED.head_sha THEN public.code_activity_changes.checks_revision
      ELSE NULL END,
    provider_updated_at = EXCLUDED.provider_updated_at, last_activity_at = EXCLUDED.last_activity_at, updated_at = now()
  WHERE public.code_activity_changes.provider_updated_at <= EXCLUDED.provider_updated_at;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- A check or status event for one commit: update the stored state of every row at that head commit.
CREATE FUNCTION public.code_activity_server_set_check_state(p_connection_id uuid, p_generation integer, p_sha text, p_state text, p_delivery_id uuid, p_lease_token uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE c public.code_activity_connections; n integer;
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('passed','failing','pending','none','unavailable') OR p_sha !~ '^[0-9a-f]{40,64}$' THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  PERFORM katalist_priv.code_activity_require_delivery_lease(p_delivery_id, p_lease_token);
  SELECT * INTO c FROM public.code_activity_connections x
   WHERE x.id = p_connection_id AND x.generation = p_generation AND x.status = 'active' FOR SHARE;
  IF NOT FOUND OR NOT katalist_priv.code_activity_flags_ok_for(c.list_id) OR NOT katalist_priv.code_activity_flag('sync') THEN
    RETURN 0;
  END IF;
  UPDATE public.code_activity_changes ch SET check_state = p_state, checks_revision = p_sha, updated_at = now()
   WHERE ch.connection_id = p_connection_id AND ch.head_sha = p_sha;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Installation lifecycle (contract v3 section 6.4). Terminal rows (disconnected, revoked) are never reactivated.
--   suspend         : active -> suspended
--   unsuspend       : suspended -> active, sync_status stale, generation + 1 (a verifying refresh is required)
--   deleted         : live -> revoked (generation + 1)
--   removed         : live -> revoked, matched by repository id (generation + 1); at most 200 ids per call, MORE IS AN ERROR
--                     (never silently ignored): intake splits a large removal into chunks of 200
--   removed_overflow: the removal was too large to list. FAIL CLOSED: every live connection of the installation is
--                     suspended, marked stale and flagged needs_reverification. From then on nothing is READ and nothing new
--                     is CONFIRMED for it, and no unsuspend event brings it back. The owner disconnects and connects again
--                     (a flagged row still blocks a second connection, by design).
-- Like every delivery write, it must hold the delivery's live lease.
CREATE FUNCTION public.code_activity_server_apply_installation_event(
  p_installation_id bigint, p_action text, p_removed_repository_ids bigint[], p_delivery_id uuid, p_lease_token uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE n integer := 0; m integer;
BEGIN
  IF p_removed_repository_ids IS NOT NULL AND cardinality(p_removed_repository_ids) > 200 THEN
    RAISE EXCEPTION 'too many repository ids' USING ERRCODE = '22023';
  END IF;
  PERFORM katalist_priv.code_activity_require_delivery_lease(p_delivery_id, p_lease_token);
  IF p_action = 'suspend' THEN
    UPDATE public.code_activity_connections SET status = 'suspended', updated_at = now()
     WHERE installation_id = p_installation_id AND status = 'active';
  ELSIF p_action = 'unsuspend' THEN
    -- Never reactivates a connection whose access is uncertain: that one waits for the owner to reconnect.
    UPDATE public.code_activity_connections SET status = 'active', sync_status = 'stale', generation = generation + 1, updated_at = now()
     WHERE installation_id = p_installation_id AND status = 'suspended' AND NOT needs_reverification;
  ELSIF p_action = 'deleted' THEN
    UPDATE public.code_activity_connections
       SET status = 'revoked', generation = generation + 1, sync_lease_token = NULL, sync_lease_until = NULL, updated_at = now()
     WHERE installation_id = p_installation_id AND status IN ('pending_repository','active','suspended');
  ELSIF p_action = 'removed' AND p_removed_repository_ids IS NOT NULL THEN
    UPDATE public.code_activity_connections
       SET status = 'revoked', generation = generation + 1, sync_lease_token = NULL, sync_lease_until = NULL, updated_at = now()
     WHERE installation_id = p_installation_id AND repository_id = ANY(p_removed_repository_ids)
       AND status IN ('pending_repository','active','suspended');
  ELSIF p_action = 'removed_overflow' THEN
    -- Also blocks reads and new confirmations until the owner disconnects and connects again (needs_reverification).
    -- Already-suspended rows are marked too: an ordinary unsuspend must not bring them back either.
    UPDATE public.code_activity_connections
       SET status = 'suspended', needs_reverification = true, sync_status = 'stale', generation = generation + 1,
           sync_lease_token = NULL, sync_lease_until = NULL, updated_at = now()
     WHERE installation_id = p_installation_id AND status IN ('pending_repository','active','suspended') AND NOT needs_reverification;
  ELSE
    RETURN 0;
  END IF;
  GET DIAGNOSTICS m = ROW_COUNT;
  n := n + m;
  RETURN n;
END;
$$;

-- Reconciliation: take a lease on connections that are due for a full refresh (never synced, or stale), server side.
-- Cooldown and one-at-a-time rules match the user refresh. Returns the List id so the caller can run the same read.
CREATE FUNCTION public.code_activity_server_begin_reconcile(p_limit integer DEFAULT 2, p_stale_after_minutes integer DEFAULT 360)
RETURNS TABLE (o_connection_id uuid, o_list_id uuid, o_generation integer, o_lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE r public.code_activity_connections; v_token uuid;
BEGIN
  IF NOT katalist_priv.code_activity_flag('master') OR NOT katalist_priv.code_activity_flag('sync') THEN RETURN; END IF;
  FOR r IN
    SELECT * FROM public.code_activity_connections c
     WHERE c.status = 'active' AND (c.sync_lease_until IS NULL OR c.sync_lease_until <= now())
       AND (c.last_refresh_started_at IS NULL OR c.last_refresh_started_at < now() - interval '10 seconds')
       AND (c.last_synced_at IS NULL OR c.last_synced_at < now() - make_interval(mins => GREATEST(COALESCE(p_stale_after_minutes, 360), 5)))
       AND katalist_priv.code_activity_flags_ok_for(c.list_id)
     ORDER BY COALESCE(c.last_synced_at, 'epoch'::timestamptz)
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 2), 1), 5) FOR UPDATE SKIP LOCKED
  LOOP
    v_token := gen_random_uuid();
    UPDATE public.code_activity_connections x
       SET sync_lease_token = v_token, sync_lease_until = now() + interval '60 seconds', sync_status = 'syncing',
           last_refresh_started_at = now(), updated_at = now()
     WHERE x.id = r.id;
    o_connection_id := r.id; o_list_id := r.list_id; o_generation := r.generation; o_lease_token := v_token;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ============ Privileges ============

REVOKE ALL ON FUNCTION
  public.code_activity_server_take_budget(bigint, integer, boolean),
  public.code_activity_server_block_installation(bigint, integer),
  public.code_activity_server_claim_deliveries(integer),
  public.code_activity_server_finish_delivery(uuid, uuid, text, text),
  public.code_activity_server_prune_deliveries(),
  public.code_activity_server_queue_health(),
  public.code_activity_server_connections_for_event(bigint, bigint),
  public.code_activity_server_apply_items(uuid, integer, jsonb, uuid, uuid),
  public.code_activity_server_set_check_state(uuid, integer, text, text, uuid, uuid),
  public.code_activity_server_apply_installation_event(bigint, text, bigint[], uuid, uuid),
  public.code_activity_server_begin_reconcile(integer, integer)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.code_activity_server_take_budget(bigint, integer, boolean),
  public.code_activity_server_block_installation(bigint, integer),
  public.code_activity_server_claim_deliveries(integer),
  public.code_activity_server_finish_delivery(uuid, uuid, text, text),
  public.code_activity_server_prune_deliveries(),
  public.code_activity_server_queue_health(),
  public.code_activity_server_connections_for_event(bigint, bigint),
  public.code_activity_server_apply_items(uuid, integer, jsonb, uuid, uuid),
  public.code_activity_server_set_check_state(uuid, integer, text, text, uuid, uuid),
  public.code_activity_server_apply_installation_event(bigint, text, bigint[], uuid, uuid),
  public.code_activity_server_begin_reconcile(integer, integer)
TO service_role;

NOTIFY pgrst, 'reload schema';
