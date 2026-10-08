-- CANDIDATE migration. NOT applied anywhere. NOT approved. Promoted from g03/DRAFT_code_activity_connection_schema.sql (read-only connector set).
-- Connection, authorization state, selection proofs, flags, allowlist.
-- Do not copy into supabase/migrations/ or push to a branch Lovable syncs until a reviewer approves this exact file and the
-- target database is named. Applying it changes only new code_activity_* objects; no existing table, policy or function.
-- Scope: connection, authorization state, selection proofs, settings, allowlist (live-functionality-plan G03).
-- A real file name (14-digit timestamp after 20261006160000) is chosen only at implementation time.
-- Design rules (contract-delta.md v4.3): every table private or column-limited; all server access
-- through server-only functions; no direct table privilege for service_role on these tables;
-- final connect compares the browser-binding nonce hash against the caller- and List-bound proof.

-- ============ Types ============

CREATE TYPE public.code_activity_connection_status AS ENUM
  ('pending_repository','active','suspended','revoked','disconnected');

-- ============ Tables ============

-- Operator-written switches. Keys: master, sync, ai. Absent or unreadable = off. Seeded with NO rows.
CREATE TABLE public.code_activity_settings (
  key        text PRIMARY KEY CHECK (key IN ('master','sync','ai')),
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.code_activity_list_allowlist (
  list_id  uuid PRIMARY KEY REFERENCES public.lists(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.code_activity_connections (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id                 uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  status                  public.code_activity_connection_status NOT NULL,
  installation_id         bigint NOT NULL,
  repository_id           bigint,
  repository_full_name    text,                 -- display snapshot only; identity is repository_id
  display_refreshed_at    timestamptz,
  connected_by_profile_id uuid NOT NULL REFERENCES public.profiles(id),
  sharing_acknowledged_at timestamptz,
  generation              integer NOT NULL DEFAULT 1,  -- restarts at 1 for a NEW connection row: bind checks to id AND generation
  -- Access is uncertain (for example after an installation removal too large to list) and the owner must disconnect and
  -- connect again to re-verify. While set: no reads, no new confirmations, and no automatic reactivation.
  needs_reverification    boolean NOT NULL DEFAULT false,
  last_synced_at          timestamptz,
  sync_status             text NOT NULL DEFAULT 'unavailable'
                            CHECK (sync_status IN ('ok','syncing','partial','stale','unavailable')),
  sync_lease_token        uuid,                 -- used from G12
  sync_lease_until        timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  disconnected_at         timestamptz,
  CHECK (status = 'pending_repository' OR repository_id IS NOT NULL)
);
CREATE UNIQUE INDEX code_activity_one_live_per_list ON public.code_activity_connections (list_id)
  WHERE status IN ('pending_repository','active','suspended');
CREATE INDEX code_activity_connections_install_idx ON public.code_activity_connections (installation_id, repository_id);

CREATE TABLE public.code_activity_auth_states (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash  bytea NOT NULL UNIQUE CHECK (octet_length(state_hash) = 32),
  nonce_hash  bytea NOT NULL CHECK (octet_length(nonce_hash) = 32),
  flow        text  NOT NULL CHECK (flow IN ('oauth','install')),
  list_id     uuid  NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  profile_id  uuid  NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX code_activity_auth_states_profile_idx ON public.code_activity_auth_states (profile_id, created_at);

CREATE TABLE public.code_activity_selection_proofs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id                uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  profile_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  nonce_hash             bytea NOT NULL CHECK (octet_length(nonce_hash) = 32),
  installation_id        bigint NOT NULL,
  repository_id          bigint NOT NULL,
  repository_full_name   text NOT NULL,
  visibility             text NOT NULL CHECK (visibility IN ('private','public')),
  repository_updated_at  timestamptz,
  installation_verified_at timestamptz,         -- set ONLY by the server-only function after the narrowed-token check
  expires_at             timestamptz NOT NULL,
  consumed_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_id, profile_id, nonce_hash, repository_id)
);

-- ============ Default deny ============
-- Supabase default privileges may grant new tables to anon, authenticated and service_role.
-- Revoke everything explicitly, including from service_role, then grant back only what is listed.

ALTER TABLE public.code_activity_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_activity_list_allowlist  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_activity_connections     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_activity_auth_states     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_activity_selection_proofs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.code_activity_settings, public.code_activity_list_allowlist,
              public.code_activity_connections, public.code_activity_auth_states,
              public.code_activity_selection_proofs
  FROM PUBLIC, anon, authenticated, service_role;

-- ============ Helpers (flags and read predicate) ============

CREATE FUNCTION katalist_priv.code_activity_flag(_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT COALESCE((SELECT s.value = 'true'::jsonb FROM public.code_activity_settings s WHERE s.key = _key), false);
$$;

-- Flags only (no caller identity). Used by server-only functions and by the user-facing ones below.
CREATE FUNCTION katalist_priv.code_activity_flags_ok_for(_list_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
  SELECT katalist_priv.code_activity_flag('master')
     AND EXISTS (SELECT 1 FROM public.code_activity_list_allowlist a WHERE a.list_id = _list_id)
     AND EXISTS (SELECT 1 FROM public.lists l WHERE l.id = _list_id AND l.archived_at IS NULL);
$$;

-- Read predicate. Membership is part of it, so a non-member learns nothing about the allowlist.
CREATE FUNCTION katalist_priv.code_activity_enabled_for(_list_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
  SELECT katalist_priv.can_view_list(_list_id) AND katalist_priv.code_activity_flags_ok_for(_list_id);
$$;

REVOKE ALL ON FUNCTION katalist_priv.code_activity_flag(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION katalist_priv.code_activity_flags_ok_for(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION katalist_priv.code_activity_enabled_for(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.code_activity_enabled_for(uuid) TO authenticated;  -- needed by the policy

-- ============ The only direct client read: connections, limited columns and rows ============

GRANT SELECT (id, list_id, status, needs_reverification, repository_id, repository_full_name, display_refreshed_at,
              sharing_acknowledged_at, last_synced_at, sync_status, created_at, disconnected_at)
  ON public.code_activity_connections TO authenticated;

CREATE POLICY code_activity_connections_read ON public.code_activity_connections
  FOR SELECT TO authenticated
  USING (status IN ('active','suspended') AND NOT needs_reverification AND katalist_priv.code_activity_enabled_for(list_id));

-- ============ User-scoped functions (auth.uid(); all checks inside) ============

-- Start (E2 / install flow). Caller must own the List and the flags must be on.
CREATE FUNCTION public.code_activity_start_authorization(
  p_list_id uuid, p_flow text, p_state_hash bytea, p_nonce_hash bytea)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE
  v_me uuid := auth.uid();
  v_expires timestamptz := now() + interval '10 minutes';
BEGIN
  IF v_me IS NULL OR p_list_id IS NULL OR p_flow IS NULL OR p_flow NOT IN ('oauth','install')
     OR octet_length(p_state_hash) IS DISTINCT FROM 32 OR octet_length(p_nonce_hash) IS DISTINCT FROM 32
     OR NOT katalist_priv.is_list_owner(p_list_id)
     OR NOT katalist_priv.code_activity_flags_ok_for(p_list_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.code_activity_connections c
             WHERE c.list_id = p_list_id AND c.status IN ('pending_repository','active','suspended')) THEN
    RAISE EXCEPTION 'already connected' USING ERRCODE = '23505';
  END IF;
  -- Serialize admission per person: count-then-insert is not safe against concurrent callers without a lock.
  PERFORM pg_advisory_xact_lock(hashtext('code_activity_auth:' || v_me::text));
  IF (SELECT count(*) FROM public.code_activity_auth_states s
      WHERE s.profile_id = v_me AND s.created_at > now() - interval '10 minutes') >= 5 THEN
    RAISE EXCEPTION 'rate limited' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.code_activity_auth_states (state_hash, nonce_hash, flow, list_id, profile_id, expires_at)
  VALUES (p_state_hash, p_nonce_hash, p_flow, p_list_id, v_me, v_expires);
  RETURN v_expires;
END;
$$;

-- Selection screen (E16). Returns only the minimum, never installation_id, repository_id or nonce_hash.
CREATE FUNCTION public.code_activity_list_selection_proofs(
  p_list_id uuid, p_nonce_hash bytea, p_after text DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE (proof_id uuid, repository_full_name text, visibility text, repository_updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL OR octet_length(p_nonce_hash) IS DISTINCT FROM 32
     OR NOT katalist_priv.is_list_owner(p_list_id)
     OR NOT katalist_priv.code_activity_flags_ok_for(p_list_id) THEN
    RETURN;  -- empty and indistinguishable from "no proofs"
  END IF;
  RETURN QUERY
    SELECT p.id, p.repository_full_name, p.visibility, p.repository_updated_at
    FROM public.code_activity_selection_proofs p
    WHERE p.list_id = p_list_id AND p.profile_id = v_me AND p.nonce_hash = p_nonce_hash
      AND p.consumed_at IS NULL AND p.expires_at > now()
      AND (p_after IS NULL OR p.repository_full_name > p_after)
    ORDER BY p.repository_full_name
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 50);
END;
$$;

-- Final connect (E4). COMPLETE signature, including the mandatory nonce comparison.
-- Every failure raises the same error so the reason is not an oracle.
CREATE FUNCTION public.code_activity_connect(
  p_list_id uuid, p_proof_id uuid, p_nonce_hash bytea, p_sharing_acknowledged boolean)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE
  v_me uuid := auth.uid();
  v_proof public.code_activity_selection_proofs;
  v_id uuid;
BEGIN
  IF v_me IS NULL OR p_list_id IS NULL OR p_proof_id IS NULL
     OR p_sharing_acknowledged IS DISTINCT FROM true
     OR octet_length(p_nonce_hash) IS DISTINCT FROM 32
     OR NOT katalist_priv.is_list_owner(p_list_id)
     OR NOT katalist_priv.code_activity_flags_ok_for(p_list_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  -- Lock and match the proof: this List, this caller, this nonce, unexpired, unconsumed, server-verified.
  SELECT * INTO v_proof FROM public.code_activity_selection_proofs p
   WHERE p.id = p_proof_id AND p.list_id = p_list_id AND p.profile_id = v_me
     AND p.nonce_hash = p_nonce_hash
     AND p.consumed_at IS NULL AND p.expires_at > now()
     AND p.installation_verified_at IS NOT NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.code_activity_selection_proofs SET consumed_at = now() WHERE id = v_proof.id;
  DELETE FROM public.code_activity_selection_proofs
   WHERE list_id = p_list_id AND profile_id = v_me AND consumed_at IS NULL;

  BEGIN
    INSERT INTO public.code_activity_connections
      (list_id, status, installation_id, repository_id, repository_full_name, display_refreshed_at,
       connected_by_profile_id, sharing_acknowledged_at)
    VALUES
      (p_list_id, 'active', v_proof.installation_id, v_proof.repository_id, v_proof.repository_full_name, now(),
       v_me, now())
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already connected' USING ERRCODE = '23505';
  END;
  RETURN v_id;
END;
$$;

-- Disconnect (E5). Terminal. Increments generation so in-flight work is fenced.
CREATE FUNCTION public.code_activity_disconnect(p_list_id uuid, p_confirm boolean)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE v_me uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_me IS NULL OR p_confirm IS DISTINCT FROM true
     OR NOT katalist_priv.is_list_owner(p_list_id)
     OR NOT katalist_priv.code_activity_flags_ok_for(p_list_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.code_activity_connections c
     SET status = 'disconnected', generation = c.generation + 1, disconnected_at = now(), updated_at = now()
   WHERE c.list_id = p_list_id AND c.status IN ('pending_repository','active','suspended')
   RETURNING c.id INTO v_id;
  DELETE FROM public.code_activity_selection_proofs WHERE list_id = p_list_id AND consumed_at IS NULL;
  RETURN v_id;  -- NULL when there was nothing to disconnect
END;
$$;

-- Status for members, including terminal states the read policy hides (revoked, disconnected).
CREATE FUNCTION public.code_activity_connection_status(p_list_id uuid)
RETURNS TABLE (status public.code_activity_connection_status, repository_full_name text,
               last_synced_at timestamptz, sync_status text, needs_reverification boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
  SELECT c.status, c.repository_full_name, c.last_synced_at, c.sync_status, c.needs_reverification
  FROM public.code_activity_connections c
  WHERE c.list_id = p_list_id AND katalist_priv.code_activity_enabled_for(p_list_id)
  ORDER BY c.created_at DESC
  LIMIT 1;
$$;

-- Capabilities (E1). True only for a member of an allowlisted, unarchived List with the master flag on.
-- Identical false for outsiders, unknown Lists and disabled features. Added during G04 (the routes need it).
CREATE FUNCTION public.code_activity_is_enabled(p_list_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
  SELECT COALESCE(katalist_priv.code_activity_enabled_for(p_list_id), false);
$$;

-- ============ Server-only functions (service_role; no auth.uid(); identity passed explicitly) ============
-- The route verifies the Bearer token and passes the VERIFIED user id. Every function re-checks the
-- facts it relies on (ownership, archive state, flags) in the database.

-- Callback: consume the state only when the browser nonce hash also matches. Single use.
CREATE FUNCTION public.code_activity_server_consume_auth_state(p_state_hash bytea, p_nonce_hash bytea)
RETURNS TABLE (o_flow text, o_list_id uuid, o_profile_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE v public.code_activity_auth_states;
BEGIN
  IF octet_length(p_state_hash) IS DISTINCT FROM 32 OR octet_length(p_nonce_hash) IS DISTINCT FROM 32 THEN RETURN; END IF;
  UPDATE public.code_activity_auth_states s SET consumed_at = now()
   WHERE s.state_hash = p_state_hash AND s.nonce_hash = p_nonce_hash
     AND s.consumed_at IS NULL AND s.expires_at > now()
   RETURNING s.* INTO v;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lists l WHERE l.id = v.list_id AND l.owner_profile_id = v.profile_id AND l.archived_at IS NULL)
     OR NOT katalist_priv.code_activity_flags_ok_for(v.list_id) THEN
    RETURN;
  END IF;
  o_flow := v.flow; o_list_id := v.list_id; o_profile_id := v.profile_id;
  RETURN NEXT;
END;
$$;

-- Callback: write proofs only after the provider replies were verified. At most 300 items.
-- p_items: [{installation_id, repository_id, full_name, visibility, updated_at}]
CREATE FUNCTION public.code_activity_server_write_selection_proofs(
  p_list_id uuid, p_profile_id uuid, p_nonce_hash bytea, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE n integer;
BEGIN
  IF octet_length(p_nonce_hash) IS DISTINCT FROM 32 OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) > 300
     OR NOT EXISTS (SELECT 1 FROM public.lists l WHERE l.id = p_list_id AND l.owner_profile_id = p_profile_id AND l.archived_at IS NULL)
     OR NOT katalist_priv.code_activity_flags_ok_for(p_list_id) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.code_activity_selection_proofs
   WHERE list_id = p_list_id AND profile_id = p_profile_id AND consumed_at IS NULL;
  INSERT INTO public.code_activity_selection_proofs
    (list_id, profile_id, nonce_hash, installation_id, repository_id, repository_full_name,
     visibility, repository_updated_at, expires_at)
  SELECT p_list_id, p_profile_id, p_nonce_hash,
         (i->>'installation_id')::bigint, (i->>'repository_id')::bigint, i->>'full_name',
         i->>'visibility', NULLIF(i->>'updated_at','')::timestamptz, now() + interval '15 minutes'
  FROM jsonb_array_elements(p_items) AS i
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Route step before final connect: read the proof's installation and repository for the narrowed-token check.
CREATE FUNCTION public.code_activity_server_get_proof(
  p_proof_id uuid, p_list_id uuid, p_profile_id uuid, p_nonce_hash bytea)
RETURNS TABLE (o_installation_id bigint, o_repository_id bigint, o_repository_full_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
BEGIN
  IF octet_length(p_nonce_hash) IS DISTINCT FROM 32
     OR NOT EXISTS (SELECT 1 FROM public.lists l WHERE l.id = p_list_id AND l.owner_profile_id = p_profile_id AND l.archived_at IS NULL)
     OR NOT katalist_priv.code_activity_flags_ok_for(p_list_id) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.installation_id, p.repository_id, p.repository_full_name
    FROM public.code_activity_selection_proofs p
    WHERE p.id = p_proof_id AND p.list_id = p_list_id AND p.profile_id = p_profile_id
      AND p.nonce_hash = p_nonce_hash AND p.consumed_at IS NULL AND p.expires_at > now();
END;
$$;

-- Records that the server confirmed the installation reaches the repository (narrowed token check).
-- Connect refuses a proof without it, so a direct RPC caller cannot skip the check.
CREATE FUNCTION public.code_activity_server_mark_proof_verified(
  p_proof_id uuid, p_list_id uuid, p_profile_id uuid, p_nonce_hash bytea)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
DECLARE n integer;
BEGIN
  IF octet_length(p_nonce_hash) IS DISTINCT FROM 32
     OR NOT katalist_priv.code_activity_flags_ok_for(p_list_id) THEN
    RETURN false;
  END IF;
  UPDATE public.code_activity_selection_proofs p SET installation_verified_at = now()
   WHERE p.id = p_proof_id AND p.list_id = p_list_id AND p.profile_id = p_profile_id
     AND p.nonce_hash = p_nonce_hash AND p.consumed_at IS NULL AND p.expires_at > now()
     AND EXISTS (SELECT 1 FROM public.lists l WHERE l.id = p_list_id AND l.owner_profile_id = p_profile_id AND l.archived_at IS NULL);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END;
$$;

-- Provider reads: the authorized connection's installation and repository, only while active and (optionally) generation-matched.
-- A connection is identified by its ID AND generation. The generation alone is not enough: a replacement connection
-- for the same List starts at 1 again, so an old request could otherwise be answered with the NEW repository.
CREATE FUNCTION public.code_activity_server_connection_for_provider(
  p_list_id uuid, p_expected_generation integer DEFAULT NULL, p_expected_connection_id uuid DEFAULT NULL)
RETURNS TABLE (o_connection_id uuid, o_installation_id bigint, o_repository_id bigint, o_generation integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv AS $$
  SELECT c.id, c.installation_id, c.repository_id, c.generation
  FROM public.code_activity_connections c
  WHERE c.list_id = p_list_id AND c.status = 'active' AND NOT c.needs_reverification
    AND (p_expected_generation IS NULL OR c.generation = p_expected_generation)
    AND (p_expected_connection_id IS NULL OR c.id = p_expected_connection_id)
    AND katalist_priv.code_activity_flags_ok_for(p_list_id);
$$;

-- ============ Function privileges (explicit; function defaults are not trusted) ============

REVOKE ALL ON FUNCTION
  public.code_activity_start_authorization(uuid, text, bytea, bytea),
  public.code_activity_list_selection_proofs(uuid, bytea, text, integer),
  public.code_activity_connect(uuid, uuid, bytea, boolean),
  public.code_activity_disconnect(uuid, boolean),
  public.code_activity_connection_status(uuid),
  public.code_activity_is_enabled(uuid),
  public.code_activity_server_consume_auth_state(bytea, bytea),
  public.code_activity_server_write_selection_proofs(uuid, uuid, bytea, jsonb),
  public.code_activity_server_get_proof(uuid, uuid, uuid, bytea),
  public.code_activity_server_mark_proof_verified(uuid, uuid, uuid, bytea),
  public.code_activity_server_connection_for_provider(uuid, integer, uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.code_activity_start_authorization(uuid, text, bytea, bytea),
  public.code_activity_list_selection_proofs(uuid, bytea, text, integer),
  public.code_activity_connect(uuid, uuid, bytea, boolean),
  public.code_activity_disconnect(uuid, boolean),
  public.code_activity_connection_status(uuid),
  public.code_activity_is_enabled(uuid)
TO authenticated;

GRANT EXECUTE ON FUNCTION
  public.code_activity_server_consume_auth_state(bytea, bytea),
  public.code_activity_server_write_selection_proofs(uuid, uuid, bytea, jsonb),
  public.code_activity_server_get_proof(uuid, uuid, uuid, bytea),
  public.code_activity_server_mark_proof_verified(uuid, uuid, uuid, bytea),
  public.code_activity_server_connection_for_provider(uuid, integer, uuid)
TO service_role;

NOTIFY pgrst, 'reload schema';
