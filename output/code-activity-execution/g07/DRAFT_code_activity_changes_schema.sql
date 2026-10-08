-- DRAFT (G07). NOT a migration. NOT in supabase/migrations. NOT applied anywhere. NOT reviewed.
-- Depends on the G03 draft (connections, flag helpers). Additive only.
-- Stores only feed rows (pull requests and pushes). Descriptions, files, patches and checks are fetched
-- from GitHub on demand after authorization and are never stored here. Counts are not stored: unknown is
-- not zero, and the list endpoint does not provide them.

ALTER TABLE public.code_activity_connections ADD COLUMN last_refresh_started_at timestamptz;

CREATE TABLE public.code_activity_changes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id       uuid NOT NULL REFERENCES public.code_activity_connections(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('pull_request','push')),
  provider_key        text NOT NULL CHECK (char_length(provider_key) <= 300),  -- PR number, or 'branch@after-sha'
  pr_number           integer,
  pr_state            text CHECK (pr_state IN ('draft','open','merged','closed')),
  title               text NOT NULL CHECK (char_length(title) <= 300),
  head_sha            text,
  before_sha          text,            -- pushes: the commit before, for the comparison read
  head_ref            text,
  base_ref            text,
  author_login        text,
  author_kind         text NOT NULL DEFAULT 'unknown' CHECK (author_kind IN ('user','bot','unknown')),
  source_url          text,
  check_state         text NOT NULL DEFAULT 'unavailable' CHECK (check_state IN ('passed','failing','pending','none','unavailable')),
  checks_revision     text,            -- the head sha the check_state was computed for
  provider_updated_at timestamptz NOT NULL,
  last_activity_at    timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, kind, provider_key),
  CHECK ((kind = 'pull_request') = (pr_number IS NOT NULL AND pr_state IS NOT NULL))
);
CREATE INDEX code_activity_changes_feed_idx ON public.code_activity_changes (connection_id, last_activity_at DESC, id DESC);

ALTER TABLE public.code_activity_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.code_activity_changes FROM PUBLIC, anon, authenticated, service_role;

-- ============ User-scoped reads ============

-- Feed (E7). Members of an enabled List. Saved rows stay readable while the connection is suspended.
CREATE FUNCTION public.code_activity_feed(
  p_list_id uuid, p_before_at timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL, p_limit integer DEFAULT 25)
RETURNS TABLE (id uuid, kind text, pr_number integer, pr_state text, title text, head_sha text, head_ref text,
               base_ref text, author_login text, author_kind text, source_url text, check_state text,
               checks_revision text, last_activity_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
  SELECT ch.id, ch.kind, ch.pr_number, ch.pr_state, ch.title, ch.head_sha, ch.head_ref, ch.base_ref,
         ch.author_login, ch.author_kind, ch.source_url, ch.check_state, ch.checks_revision, ch.last_activity_at
  FROM public.code_activity_changes ch
  JOIN public.code_activity_connections c ON c.id = ch.connection_id
  WHERE c.list_id = p_list_id AND c.status IN ('active','suspended') AND NOT c.needs_reverification
    AND katalist_priv.code_activity_enabled_for(p_list_id)
    AND (p_before_at IS NULL OR (ch.last_activity_at, ch.id) < (p_before_at, COALESCE(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  ORDER BY ch.last_activity_at DESC, ch.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
$$;

-- One change, for the detail read. Also returns the connection generation so the provider read can be fenced.
CREATE FUNCTION public.code_activity_change_for_read(p_list_id uuid, p_change_id uuid)
RETURNS TABLE (connection_id uuid, generation integer, id uuid, kind text, pr_number integer, pr_state text, title text,
               head_sha text, before_sha text, head_ref text, base_ref text, author_login text, author_kind text,
               source_url text, last_activity_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
  SELECT c.id, c.generation, ch.id, ch.kind, ch.pr_number, ch.pr_state, ch.title, ch.head_sha, ch.before_sha,
         ch.head_ref, ch.base_ref, ch.author_login, ch.author_kind, ch.source_url, ch.last_activity_at
  FROM public.code_activity_changes ch
  JOIN public.code_activity_connections c ON c.id = ch.connection_id
  WHERE ch.id = p_change_id AND c.list_id = p_list_id AND c.status IN ('active','suspended') AND NOT c.needs_reverification
    AND katalist_priv.code_activity_enabled_for(p_list_id);
$$;

-- ============ Manual Refresh ============

-- Owners and collaborators may start a refresh (View Only may not). One at a time per connection (lease),
-- and not more often than every 10 seconds.
CREATE FUNCTION public.code_activity_begin_refresh(p_list_id uuid)
RETURNS TABLE (o_connection_id uuid, o_generation integer, o_lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE c public.code_activity_connections; v_token uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL
     OR NOT katalist_priv.can_create_thing_in_list(p_list_id)
     OR NOT katalist_priv.code_activity_flags_ok_for(p_list_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.code_activity_connections x
   WHERE x.list_id = p_list_id AND x.status = 'active' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF c.sync_lease_until IS NOT NULL AND c.sync_lease_until > now() THEN
    RAISE EXCEPTION 'refresh in progress' USING ERRCODE = '55006';
  END IF;
  IF c.last_refresh_started_at IS NOT NULL AND c.last_refresh_started_at > now() - interval '10 seconds' THEN
    RAISE EXCEPTION 'rate limited' USING ERRCODE = '54000';
  END IF;
  UPDATE public.code_activity_connections x
     SET sync_lease_token = v_token, sync_lease_until = now() + interval '60 seconds',
         sync_status = 'syncing', last_refresh_started_at = now(), updated_at = now()
   WHERE x.id = c.id;
  o_connection_id := c.id; o_generation := c.generation; o_lease_token := v_token;
  RETURN NEXT;
END;
$$;

-- Server finishes a refresh. Writes only while the connection is still active, the generation matches and the
-- caller holds the lease, so a disconnect during a refresh cannot be undone by late results.
-- p_status: ok | partial | unavailable. p_items may be NULL (a failed refresh keeps the last good rows).
-- Item fields: kind, provider_key, pr_number, pr_state, title, head_sha, before_sha, head_ref, base_ref,
-- author_login, author_kind, source_url, provider_updated_at, last_activity_at, and optionally check_state + checks_revision.
CREATE FUNCTION public.code_activity_server_finish_refresh(
  p_connection_id uuid, p_generation integer, p_lease_token uuid, p_status text, p_full_name text, p_items jsonb)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE c public.code_activity_connections;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('ok','partial','unavailable')
     OR (p_items IS NOT NULL AND (jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) > 200)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.code_activity_connections x
   WHERE x.id = p_connection_id AND x.generation = p_generation AND x.status = 'active'
     AND x.sync_lease_token = p_lease_token AND x.sync_lease_until > now()
   FOR UPDATE;
  IF NOT FOUND OR NOT katalist_priv.code_activity_flags_ok_for(c.list_id) THEN
    RETURN false;
  END IF;

  IF p_items IS NOT NULL THEN
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
      -- A freshly read check state wins. An unread one keeps the old value only for the SAME revision.
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

    -- Bounded retention: keep the 300 most recent rows for this connection.
    DELETE FROM public.code_activity_changes d
     WHERE d.connection_id = p_connection_id
       AND d.id IN (SELECT r.id FROM public.code_activity_changes r WHERE r.connection_id = p_connection_id
                    ORDER BY r.last_activity_at DESC, r.id DESC OFFSET 300);
  END IF;

  UPDATE public.code_activity_connections x
     SET sync_status = p_status,
         last_synced_at = CASE WHEN p_status IN ('ok','partial') THEN now() ELSE x.last_synced_at END,
         repository_full_name = COALESCE(p_full_name, x.repository_full_name),
         display_refreshed_at = CASE WHEN p_full_name IS NOT NULL THEN now() ELSE x.display_refreshed_at END,
         sync_lease_token = NULL, sync_lease_until = NULL, updated_at = now()
   WHERE x.id = p_connection_id;
  RETURN true;
END;
$$;

-- ============ Privileges ============

REVOKE ALL ON FUNCTION
  public.code_activity_feed(uuid, timestamptz, uuid, integer),
  public.code_activity_change_for_read(uuid, uuid),
  public.code_activity_begin_refresh(uuid),
  public.code_activity_server_finish_refresh(uuid, integer, uuid, text, text, jsonb)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.code_activity_feed(uuid, timestamptz, uuid, integer),
  public.code_activity_change_for_read(uuid, uuid),
  public.code_activity_begin_refresh(uuid)
TO authenticated;

GRANT EXECUTE ON FUNCTION public.code_activity_server_finish_refresh(uuid, integer, uuid, text, text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
