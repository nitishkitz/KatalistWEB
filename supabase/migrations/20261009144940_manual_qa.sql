-- Manual QA workspace: List-scoped applications, environments, resources, builds,
-- protected test accounts, reusable versioned cases, build-specific runs,
-- append-only attempts, private evidence, Thing links, saved views and audit.
--
-- Authorization model (mirrors designs / list_meetings):
--   * Reads: any List viewer (owner or member) via RLS on katalist_priv.can_view_list,
--     EXCEPT secrets, audit and grants (see below).
--   * Writes: SECURITY DEFINER RPCs only; `authenticated` has no INSERT/UPDATE/DELETE.
--     Shared QA records need the List owner or a collaborator; view_only reads.
--   * Same-List integrity: composite foreign keys + triggers (also bind service_role).
--   * Immutability: case versions, builds and attempts cannot be UPDATEd or DELETEd.
--
-- Credentials:
--   * Account METADATA (label, role, username, grants) is in qa_accounts / qa_account_grants.
--   * Secret material lives ONLY in qa_account_secrets as AES-256-GCM ciphertext written by
--     the server (server/lib/qa/vault.ts) with a key that never reaches the database or the
--     browser. `authenticated` and `anon` have no grant on that table, and no policy exists.
--   * Use vs manage are separate capabilities, granted explicitly by role or profile and
--     always intersected with CURRENT List membership. The List owner is not implicitly
--     granted secret access; the creating member receives manage+use.
--
-- Evidence lives in the private `qa-evidence` bucket. No storage policy is created for it:
-- clients never touch the bucket directly; the server signs uploads and reads after the
-- RPCs below authorise the caller.

-- ============ Authorization helpers ============

CREATE OR REPLACE FUNCTION katalist_priv.can_manage_qa(_list_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.lists l WHERE l.id = _list_id AND l.archived_at IS NULL)
    AND (
      katalist_priv.is_list_owner(_list_id)
      OR katalist_priv.is_list_member(_list_id, ARRAY['collaborator']::public.list_role[])
    );
$$;

CREATE OR REPLACE FUNCTION katalist_priv.qa_my_role(_list_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.lists l WHERE l.id = _list_id AND l.owner_profile_id = auth.uid()) THEN 'owner'
    ELSE (SELECT m.role::text FROM public.list_members m WHERE m.list_id = _list_id AND m.profile_id = auth.uid())
  END;
$$;

CREATE OR REPLACE FUNCTION katalist_priv.qa_is_participant(_list_id uuid, _profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.lists l WHERE l.id = _list_id AND l.owner_profile_id = _profile_id)
      OR EXISTS (SELECT 1 FROM public.list_members m WHERE m.list_id = _list_id AND m.profile_id = _profile_id);
$$;

REVOKE EXECUTE ON FUNCTION katalist_priv.can_manage_qa(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION katalist_priv.qa_my_role(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION katalist_priv.qa_is_participant(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION katalist_priv.can_manage_qa(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.qa_my_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION katalist_priv.qa_is_participant(uuid, uuid) TO service_role;

-- ============ Tables ============

CREATE TABLE IF NOT EXISTS public.qa_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  name text NOT NULL,
  platform_kind text NOT NULL DEFAULT 'web',
  description text,
  archived_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_applications_name_valid CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT qa_applications_kind_valid CHECK (platform_kind IN ('web', 'android', 'ios', 'iot', 'api', 'desktop', 'other')),
  CONSTRAINT qa_applications_description_valid CHECK (description IS NULL OR length(description) <= 2000),
  CONSTRAINT qa_applications_id_list_unique UNIQUE (id, list_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_qa_applications_active_name ON public.qa_applications (list_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.qa_environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  name text NOT NULL,
  restricted boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_environments_name_valid CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT qa_environments_id_list_unique UNIQUE (id, list_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_qa_environments_active_name ON public.qa_environments (list_id, lower(name)) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.qa_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'application',
  label text NOT NULL,
  url text,
  details text,
  owner_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  version_note text,
  archived_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_resources_type_valid CHECK (type IN ('application', 'build', 'api', 'setup', 'docs', 'device', 'other')),
  CONSTRAINT qa_resources_label_valid CHECK (length(btrim(label)) BETWEEN 1 AND 160),
  CONSTRAINT qa_resources_url_valid CHECK (url IS NULL OR (length(url) <= 2048 AND url ~* '^https?://[^[:space:]]+$')),
  CONSTRAINT qa_resources_details_valid CHECK (details IS NULL OR length(details) <= 8000),
  CONSTRAINT qa_resources_app_fkey FOREIGN KEY (application_id, list_id) REFERENCES public.qa_applications (id, list_id) ON DELETE CASCADE,
  CONSTRAINT qa_resources_env_fkey FOREIGN KEY (environment_id, list_id) REFERENCES public.qa_environments (id, list_id) ON DELETE CASCADE,
  CONSTRAINT qa_resources_id_list_unique UNIQUE (id, list_id)
);
CREATE INDEX IF NOT EXISTS idx_qa_resources_scope ON public.qa_resources (list_id, application_id, environment_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.qa_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  identifier text NOT NULL,
  display_version text,
  notes_url text,
  install_url text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_builds_identifier_valid CHECK (length(btrim(identifier)) BETWEEN 1 AND 80),
  CONSTRAINT qa_builds_urls_valid CHECK (
    (notes_url IS NULL OR (length(notes_url) <= 2048 AND notes_url ~* '^https?://[^[:space:]]+$'))
    AND (install_url IS NULL OR (length(install_url) <= 2048 AND install_url ~* '^https?://[^[:space:]]+$'))
  ),
  CONSTRAINT qa_builds_config_object CHECK (jsonb_typeof(config) = 'object' AND pg_column_size(config) <= 8192),
  CONSTRAINT qa_builds_app_fkey FOREIGN KEY (application_id, list_id) REFERENCES public.qa_applications (id, list_id) ON DELETE CASCADE,
  CONSTRAINT qa_builds_env_fkey FOREIGN KEY (environment_id, list_id) REFERENCES public.qa_environments (id, list_id) ON DELETE CASCADE,
  CONSTRAINT qa_builds_unique_identity UNIQUE (application_id, environment_id, identifier),
  CONSTRAINT qa_builds_id_list_unique UNIQUE (id, list_id)
);
CREATE INDEX IF NOT EXISTS idx_qa_builds_scope ON public.qa_builds (list_id, application_id, environment_id, created_at DESC);

-- Account metadata. No secret column exists here by design.
CREATE TABLE IF NOT EXISTS public.qa_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  label text NOT NULL,
  test_role text NOT NULL DEFAULT '',
  username text NOT NULL DEFAULT '',
  instructions text,
  vault_provider text NOT NULL DEFAULT 'native',
  has_secret boolean NOT NULL DEFAULT false,
  secret_updated_at timestamptz,
  archived_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_accounts_label_valid CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  CONSTRAINT qa_accounts_role_valid CHECK (length(test_role) <= 80),
  CONSTRAINT qa_accounts_username_valid CHECK (length(username) <= 320),
  CONSTRAINT qa_accounts_instructions_valid CHECK (instructions IS NULL OR length(instructions) <= 2000),
  CONSTRAINT qa_accounts_provider_valid CHECK (vault_provider IN ('native', 'external')),
  CONSTRAINT qa_accounts_app_fkey FOREIGN KEY (application_id, list_id) REFERENCES public.qa_applications (id, list_id) ON DELETE CASCADE,
  CONSTRAINT qa_accounts_env_fkey FOREIGN KEY (environment_id, list_id) REFERENCES public.qa_environments (id, list_id) ON DELETE CASCADE,
  CONSTRAINT qa_accounts_id_list_unique UNIQUE (id, list_id)
);
CREATE INDEX IF NOT EXISTS idx_qa_accounts_scope ON public.qa_accounts (list_id, application_id, environment_id) WHERE archived_at IS NULL;

-- Ciphertext only. Written/read exclusively by the server with the service role.
CREATE TABLE IF NOT EXISTS public.qa_account_secrets (
  account_id uuid PRIMARY KEY REFERENCES public.qa_accounts(id) ON DELETE CASCADE,
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  auth_tag bytea NOT NULL,
  key_version text NOT NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_account_secrets_sizes CHECK (octet_length(iv) = 12 AND octet_length(auth_tag) = 16 AND octet_length(ciphertext) BETWEEN 1 AND 4096)
);

CREATE TABLE IF NOT EXISTS public.qa_account_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  grantee_kind text NOT NULL,
  grantee_role text,
  grantee_profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  capability text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_account_grants_kind_valid CHECK (
    (grantee_kind = 'role' AND grantee_role IN ('owner', 'collaborator', 'view_only') AND grantee_profile_id IS NULL)
    OR (grantee_kind = 'profile' AND grantee_profile_id IS NOT NULL AND grantee_role IS NULL)
  ),
  CONSTRAINT qa_account_grants_cap_valid CHECK (capability IN ('use', 'manage')),
  CONSTRAINT qa_account_grants_account_fkey FOREIGN KEY (account_id, list_id) REFERENCES public.qa_accounts (id, list_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_qa_account_grants_role ON public.qa_account_grants (account_id, grantee_role, capability) WHERE grantee_kind = 'role';
CREATE UNIQUE INDEX IF NOT EXISTS uq_qa_account_grants_profile ON public.qa_account_grants (account_id, grantee_profile_id, capability) WHERE grantee_kind = 'profile';

CREATE TABLE IF NOT EXISTS public.qa_list_counters (
  list_id uuid PRIMARY KEY REFERENCES public.lists(id) ON DELETE CASCADE,
  next_case_number integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.qa_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  number integer NOT NULL,
  current_version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_cases_number_unique UNIQUE (list_id, number),
  CONSTRAINT qa_cases_id_list_unique UNIQUE (id, list_id)
);

-- Immutable tested content. A run references one of these rows, never the live case.
CREATE TABLE IF NOT EXISTS public.qa_case_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  list_id uuid NOT NULL,
  version integer NOT NULL,
  title text NOT NULL,
  preconditions text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority text NOT NULL DEFAULT 'medium',
  module text,
  platforms text[] NOT NULL DEFAULT '{}',
  change_note text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_case_versions_title_valid CHECK (length(btrim(title)) BETWEEN 1 AND 240),
  CONSTRAINT qa_case_versions_pre_valid CHECK (preconditions IS NULL OR length(preconditions) <= 4000),
  CONSTRAINT qa_case_versions_steps_valid CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) <= 100 AND pg_column_size(steps) <= 65536),
  CONSTRAINT qa_case_versions_priority_valid CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT qa_case_versions_module_valid CHECK (module IS NULL OR length(module) <= 80),
  CONSTRAINT qa_case_versions_platforms_valid CHECK (cardinality(platforms) <= 10),
  CONSTRAINT qa_case_versions_case_fkey FOREIGN KEY (case_id, list_id) REFERENCES public.qa_cases (id, list_id) ON DELETE CASCADE,
  CONSTRAINT qa_case_versions_unique UNIQUE (case_id, version),
  CONSTRAINT qa_case_versions_id_case_unique UNIQUE (id, case_id),
  CONSTRAINT qa_case_versions_id_list_unique UNIQUE (id, list_id)
);

CREATE TABLE IF NOT EXISTS public.qa_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  name text NOT NULL,
  application_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  build_id uuid NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  predecessor_run_id uuid,
  idempotency_key text,
  completion_summary jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  completed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT qa_runs_name_valid CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT qa_runs_status_valid CHECK (status IN ('active', 'completed', 'archived')),
  CONSTRAINT qa_runs_config_valid CHECK (jsonb_typeof(config) = 'object' AND pg_column_size(config) <= 8192),
  CONSTRAINT qa_runs_app_fkey FOREIGN KEY (application_id, list_id) REFERENCES public.qa_applications (id, list_id),
  CONSTRAINT qa_runs_env_fkey FOREIGN KEY (environment_id, list_id) REFERENCES public.qa_environments (id, list_id),
  CONSTRAINT qa_runs_build_fkey FOREIGN KEY (build_id, list_id) REFERENCES public.qa_builds (id, list_id),
  CONSTRAINT qa_runs_pred_fkey FOREIGN KEY (predecessor_run_id, list_id) REFERENCES public.qa_runs (id, list_id),
  CONSTRAINT qa_runs_id_list_unique UNIQUE (id, list_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_qa_runs_idem ON public.qa_runs (list_id, created_by, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qa_runs_list ON public.qa_runs (list_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.qa_run_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  list_id uuid NOT NULL,
  case_id uuid NOT NULL,
  case_version_id uuid NOT NULL,
  position integer NOT NULL,
  assignee_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  retest_of_run_case_id uuid REFERENCES public.qa_run_cases(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_run_cases_run_fkey FOREIGN KEY (run_id, list_id) REFERENCES public.qa_runs (id, list_id) ON DELETE CASCADE,
  CONSTRAINT qa_run_cases_version_fkey FOREIGN KEY (case_version_id, case_id) REFERENCES public.qa_case_versions (id, case_id),
  CONSTRAINT qa_run_cases_version_list_fkey FOREIGN KEY (case_version_id, list_id) REFERENCES public.qa_case_versions (id, list_id),
  CONSTRAINT qa_run_cases_unique UNIQUE (run_id, case_id),
  CONSTRAINT qa_run_cases_id_list_unique UNIQUE (id, list_id),
  CONSTRAINT qa_run_cases_id_run_unique UNIQUE (id, run_id)
);
CREATE INDEX IF NOT EXISTS idx_qa_run_cases_run ON public.qa_run_cases (run_id, position);
CREATE INDEX IF NOT EXISTS idx_qa_run_cases_case ON public.qa_run_cases (case_id);

CREATE TABLE IF NOT EXISTS public.qa_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_case_id uuid NOT NULL,
  run_id uuid NOT NULL,
  list_id uuid NOT NULL,
  status text NOT NULL,
  actual text,
  tester_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  previous_attempt_id uuid REFERENCES public.qa_attempts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_attempts_status_valid CHECK (status IN ('pass', 'fail', 'blocked', 'not_applicable')),
  CONSTRAINT qa_attempts_actual_valid CHECK (actual IS NULL OR length(actual) <= 4000),
  CONSTRAINT qa_attempts_key_valid CHECK (length(idempotency_key) BETWEEN 8 AND 80),
  CONSTRAINT qa_attempts_run_case_fkey FOREIGN KEY (run_case_id, run_id) REFERENCES public.qa_run_cases (id, run_id) ON DELETE CASCADE,
  CONSTRAINT qa_attempts_list_fkey FOREIGN KEY (run_case_id, list_id) REFERENCES public.qa_run_cases (id, list_id) ON DELETE CASCADE,
  CONSTRAINT qa_attempts_idem_unique UNIQUE (run_case_id, idempotency_key),
  CONSTRAINT qa_attempts_id_list_unique UNIQUE (id, list_id)
);
CREATE INDEX IF NOT EXISTS idx_qa_attempts_run_case ON public.qa_attempts (run_case_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_qa_attempts_history ON public.qa_attempts (list_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.qa_attempt_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL,
  list_id uuid NOT NULL,
  storage_key text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum_sha256 text,
  status text NOT NULL DEFAULT 'pending',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_attempt_evidence_status_valid CHECK (status IN ('pending', 'ready')),
  CONSTRAINT qa_attempt_evidence_size_valid CHECK (size_bytes BETWEEN 1 AND 26214400),
  CONSTRAINT qa_attempt_evidence_name_valid CHECK (length(btrim(file_name)) BETWEEN 1 AND 180),
  CONSTRAINT qa_attempt_evidence_checksum_valid CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT qa_attempt_evidence_attempt_fkey FOREIGN KEY (attempt_id, list_id) REFERENCES public.qa_attempts (id, list_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_qa_attempt_evidence_attempt ON public.qa_attempt_evidence (attempt_id);
CREATE INDEX IF NOT EXISTS idx_qa_attempt_evidence_pending ON public.qa_attempt_evidence (created_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.qa_thing_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  thing_id uuid NOT NULL REFERENCES public.things(id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  run_case_id uuid NOT NULL,
  attempt_id uuid,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_thing_links_case_fkey FOREIGN KEY (case_id, list_id) REFERENCES public.qa_cases (id, list_id) ON DELETE CASCADE,
  CONSTRAINT qa_thing_links_run_case_fkey FOREIGN KEY (run_case_id, list_id) REFERENCES public.qa_run_cases (id, list_id) ON DELETE CASCADE,
  CONSTRAINT qa_thing_links_attempt_fkey FOREIGN KEY (attempt_id, list_id) REFERENCES public.qa_attempts (id, list_id) ON DELETE CASCADE,
  CONSTRAINT qa_thing_links_unique UNIQUE (thing_id, run_case_id)
);
CREATE INDEX IF NOT EXISTS idx_qa_thing_links_thing ON public.qa_thing_links (thing_id);
CREATE INDEX IF NOT EXISTS idx_qa_thing_links_list ON public.qa_thing_links (list_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_qa_thing_links_run_case ON public.qa_thing_links (run_case_id);

CREATE TABLE IF NOT EXISTS public.qa_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  view_kind text NOT NULL DEFAULT 'library',
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_saved_views_name_valid CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT qa_saved_views_kind_valid CHECK (view_kind IN ('library', 'runs', 'history')),
  CONSTRAINT qa_saved_views_config_valid CHECK (jsonb_typeof(config) = 'object' AND pg_column_size(config) <= 4096),
  CONSTRAINT qa_saved_views_unique UNIQUE (list_id, profile_id, view_kind, name)
);

CREATE TABLE IF NOT EXISTS public.qa_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.qa_accounts(id) ON DELETE SET NULL,
  actor_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qa_audit_action_valid CHECK (action IN ('credential_create', 'credential_update', 'credential_secret_set', 'credential_grants_change', 'credential_reveal', 'credential_copy', 'credential_archive')),
  CONSTRAINT qa_audit_outcome_valid CHECK (outcome IN ('success', 'denied', 'unavailable', 'error'))
);
CREATE INDEX IF NOT EXISTS idx_qa_audit_list ON public.qa_audit_events (list_id, created_at DESC);

-- ============ Triggers ============

DROP TRIGGER IF EXISTS trg_qa_applications_updated ON public.qa_applications;
CREATE TRIGGER trg_qa_applications_updated BEFORE UPDATE ON public.qa_applications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_qa_environments_updated ON public.qa_environments;
CREATE TRIGGER trg_qa_environments_updated BEFORE UPDATE ON public.qa_environments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_qa_resources_updated ON public.qa_resources;
CREATE TRIGGER trg_qa_resources_updated BEFORE UPDATE ON public.qa_resources FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_qa_accounts_updated ON public.qa_accounts;
CREATE TRIGGER trg_qa_accounts_updated BEFORE UPDATE ON public.qa_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_qa_cases_updated ON public.qa_cases;
CREATE TRIGGER trg_qa_cases_updated BEFORE UPDATE ON public.qa_cases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_qa_saved_views_updated ON public.qa_saved_views;
CREATE TRIGGER trg_qa_saved_views_updated BEFORE UPDATE ON public.qa_saved_views FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Append-only tables: no UPDATE ever, no DELETE unless the whole List is being removed.
CREATE OR REPLACE FUNCTION katalist_priv.qa_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% rows are immutable.', TG_TABLE_NAME USING ERRCODE = '55000', HINT = 'immutable';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lists WHERE id = OLD.list_id) THEN
    RAISE EXCEPTION '% rows cannot be deleted.', TG_TABLE_NAME USING ERRCODE = '55000', HINT = 'immutable';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_qa_case_versions_immutable ON public.qa_case_versions;
CREATE TRIGGER trg_qa_case_versions_immutable BEFORE UPDATE OR DELETE ON public.qa_case_versions FOR EACH ROW EXECUTE FUNCTION katalist_priv.qa_immutable_guard();
DROP TRIGGER IF EXISTS trg_qa_builds_immutable ON public.qa_builds;
CREATE TRIGGER trg_qa_builds_immutable BEFORE UPDATE OR DELETE ON public.qa_builds FOR EACH ROW EXECUTE FUNCTION katalist_priv.qa_immutable_guard();
DROP TRIGGER IF EXISTS trg_qa_attempts_immutable ON public.qa_attempts;
CREATE TRIGGER trg_qa_attempts_immutable BEFORE UPDATE OR DELETE ON public.qa_attempts FOR EACH ROW EXECUTE FUNCTION katalist_priv.qa_immutable_guard();

-- Run build/config/application are frozen once created; status only moves forward.
CREATE OR REPLACE FUNCTION katalist_priv.qa_runs_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  IF NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.environment_id IS DISTINCT FROM OLD.environment_id
     OR NEW.build_id IS DISTINCT FROM OLD.build_id
     OR NEW.config IS DISTINCT FROM OLD.config
     OR NEW.list_id IS DISTINCT FROM OLD.list_id
     OR NEW.predecessor_run_id IS DISTINCT FROM OLD.predecessor_run_id THEN
    RAISE EXCEPTION 'A run''s build and configuration cannot change. Start a new run for a different build.' USING ERRCODE = '55000', HINT = 'run_context_frozen';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT ((OLD.status = 'active' AND NEW.status = 'completed') OR (OLD.status = 'completed' AND NEW.status = 'archived')) THEN
    RAISE EXCEPTION 'A % run cannot become %.', OLD.status, NEW.status USING ERRCODE = '55000', HINT = 'invalid_transition';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_qa_runs_guard ON public.qa_runs;
CREATE TRIGGER trg_qa_runs_guard BEFORE UPDATE ON public.qa_runs FOR EACH ROW EXECUTE FUNCTION katalist_priv.qa_runs_guard();

-- Thing links: the Thing must belong to the same List as the link.
CREATE OR REPLACE FUNCTION katalist_priv.qa_thing_links_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.things t WHERE t.id = NEW.thing_id AND t.list_id = NEW.list_id) THEN
    RAISE EXCEPTION 'Thing not found in this List.' USING ERRCODE = 'P0002', HINT = 'cross_list';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_qa_thing_links_guard ON public.qa_thing_links;
CREATE TRIGGER trg_qa_thing_links_guard BEFORE INSERT OR UPDATE ON public.qa_thing_links FOR EACH ROW EXECUTE FUNCTION katalist_priv.qa_thing_links_guard();

-- Builds and runs must agree on application and environment.
CREATE OR REPLACE FUNCTION katalist_priv.qa_runs_build_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.qa_builds b
    WHERE b.id = NEW.build_id AND b.list_id = NEW.list_id
      AND b.application_id = NEW.application_id AND b.environment_id = NEW.environment_id
  ) THEN
    RAISE EXCEPTION 'The build does not belong to this application and environment.' USING ERRCODE = '23514', HINT = 'build_mismatch';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_qa_runs_build_guard ON public.qa_runs;
CREATE TRIGGER trg_qa_runs_build_guard BEFORE INSERT ON public.qa_runs FOR EACH ROW EXECUTE FUNCTION katalist_priv.qa_runs_build_guard();

REVOKE EXECUTE ON FUNCTION katalist_priv.qa_immutable_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION katalist_priv.qa_runs_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION katalist_priv.qa_thing_links_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION katalist_priv.qa_runs_build_guard() FROM PUBLIC, anon, authenticated;

-- ============ Account capability evaluation ============

-- Live evaluation: current List membership AND an explicit grant. Revoked members fail immediately.
CREATE OR REPLACE FUNCTION katalist_priv.qa_account_can(_account_id uuid, _cap text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.qa_accounts a
    WHERE a.id = _account_id
      AND a.archived_at IS NULL
      AND katalist_priv.can_view_list(a.list_id)
      AND EXISTS (
        SELECT 1 FROM public.qa_account_grants g
        WHERE g.account_id = a.id
          AND (g.capability = _cap OR (_cap = 'use' AND g.capability = 'manage'))
          AND (
            (g.grantee_kind = 'profile' AND g.grantee_profile_id = auth.uid())
            OR (g.grantee_kind = 'role' AND g.grantee_role = katalist_priv.qa_my_role(a.list_id))
          )
      )
  );
$$;
REVOKE EXECUTE ON FUNCTION katalist_priv.qa_account_can(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.qa_account_can(uuid, text) TO authenticated, service_role;

-- ============ RLS and grants ============

ALTER TABLE public.qa_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_account_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_account_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_list_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_case_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_run_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_attempt_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_thing_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_audit_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['qa_applications','qa_environments','qa_resources','qa_builds','qa_accounts','qa_cases','qa_case_versions','qa_runs','qa_run_cases','qa_attempts','qa_thing_links']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || ' select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (katalist_priv.can_view_list(list_id))', t || ' select', t);
  END LOOP;
END $$;

-- Evidence metadata: only finished uploads are listed to viewers; the uploader sees their own pending rows.
DROP POLICY IF EXISTS "qa_attempt_evidence select" ON public.qa_attempt_evidence;
CREATE POLICY "qa_attempt_evidence select" ON public.qa_attempt_evidence FOR SELECT TO authenticated
  USING (katalist_priv.can_view_list(list_id) AND (status = 'ready' OR created_by = auth.uid()));

-- Grants are visible to the people who can manage the account (needed by the edit form).
DROP POLICY IF EXISTS "qa_account_grants select" ON public.qa_account_grants;
CREATE POLICY "qa_account_grants select" ON public.qa_account_grants FOR SELECT TO authenticated
  USING (katalist_priv.qa_account_can(account_id, 'manage'));

DROP POLICY IF EXISTS "qa_saved_views select" ON public.qa_saved_views;
CREATE POLICY "qa_saved_views select" ON public.qa_saved_views FOR SELECT TO authenticated
  USING (profile_id = auth.uid() AND katalist_priv.can_view_list(list_id));

DROP POLICY IF EXISTS "qa_audit_events select" ON public.qa_audit_events;
CREATE POLICY "qa_audit_events select" ON public.qa_audit_events FOR SELECT TO authenticated
  USING (katalist_priv.can_manage_qa(list_id));

-- qa_account_secrets and qa_list_counters: RLS on, no policy for any client role.

REVOKE ALL ON public.qa_applications, public.qa_environments, public.qa_resources, public.qa_builds,
  public.qa_accounts, public.qa_account_secrets, public.qa_account_grants, public.qa_list_counters,
  public.qa_cases, public.qa_case_versions, public.qa_runs, public.qa_run_cases, public.qa_attempts,
  public.qa_attempt_evidence, public.qa_thing_links, public.qa_saved_views, public.qa_audit_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qa_applications, public.qa_environments, public.qa_resources, public.qa_builds,
  public.qa_accounts, public.qa_account_grants, public.qa_cases, public.qa_case_versions, public.qa_runs,
  public.qa_run_cases, public.qa_attempts, public.qa_attempt_evidence, public.qa_thing_links,
  public.qa_saved_views, public.qa_audit_events TO authenticated;
GRANT ALL ON public.qa_applications, public.qa_environments, public.qa_resources, public.qa_builds,
  public.qa_accounts, public.qa_account_secrets, public.qa_account_grants, public.qa_list_counters,
  public.qa_cases, public.qa_case_versions, public.qa_runs, public.qa_run_cases, public.qa_attempts,
  public.qa_attempt_evidence, public.qa_thing_links, public.qa_saved_views, public.qa_audit_events TO service_role;

-- ============ Read views (security invoker: the caller's RLS applies) ============

CREATE OR REPLACE VIEW public.qa_case_current WITH (security_invoker = true) AS
SELECT c.id, c.list_id, c.number, 'TC-' || lpad(c.number::text, 3, '0') AS case_key, c.current_version,
       c.archived_at, c.created_at, c.updated_at,
       v.id AS version_id, v.title, v.preconditions, v.steps, v.priority, v.module, v.platforms,
       v.change_note, v.created_by AS version_created_by, v.created_at AS version_created_at
FROM public.qa_cases c
JOIN public.qa_case_versions v ON v.case_id = c.id AND v.version = c.current_version;

CREATE OR REPLACE VIEW public.qa_run_case_status WITH (security_invoker = true) AS
SELECT rc.id, rc.run_id, rc.list_id, rc.case_id, rc.case_version_id, rc.position, rc.assignee_profile_id,
       rc.retest_of_run_case_id, c.number, 'TC-' || lpad(c.number::text, 3, '0') AS case_key,
       v.version, v.title, v.preconditions, v.steps, v.priority, v.module, v.platforms,
       la.id AS attempt_id, la.status, la.actual, la.created_at AS attempted_at, la.tester_profile_id,
       (SELECT count(*) FROM public.qa_attempts a WHERE a.run_case_id = rc.id)::int AS attempt_count,
       (SELECT count(*) FROM public.qa_thing_links l WHERE l.run_case_id = rc.id)::int AS link_count
FROM public.qa_run_cases rc
JOIN public.qa_cases c ON c.id = rc.case_id
JOIN public.qa_case_versions v ON v.id = rc.case_version_id
LEFT JOIN LATERAL (
  SELECT a.id, a.status, a.actual, a.created_at, a.tester_profile_id
  FROM public.qa_attempts a WHERE a.run_case_id = rc.id
  ORDER BY a.created_at DESC, a.id DESC LIMIT 1
) la ON true;

CREATE OR REPLACE VIEW public.qa_history WITH (security_invoker = true) AS
SELECT a.id, a.list_id, a.run_id, a.run_case_id, a.status, a.actual, a.tester_profile_id, a.created_at,
       a.previous_attempt_id,
       c.number, 'TC-' || lpad(c.number::text, 3, '0') AS case_key, v.version AS case_version, v.title AS case_title,
       r.name AS run_name, r.status AS run_status, r.config AS run_config, r.application_id, r.environment_id,
       app.name AS application_name, app.platform_kind, env.name AS environment_name,
       b.identifier AS build_identifier, b.display_version AS build_display_version,
       (SELECT count(*) FROM public.qa_attempt_evidence e WHERE e.attempt_id = a.id AND e.status = 'ready')::int AS evidence_count,
       (SELECT count(*) FROM public.qa_thing_links l WHERE l.run_case_id = a.run_case_id)::int AS link_count
FROM public.qa_attempts a
JOIN public.qa_run_cases rc ON rc.id = a.run_case_id
JOIN public.qa_cases c ON c.id = rc.case_id
JOIN public.qa_case_versions v ON v.id = rc.case_version_id
JOIN public.qa_runs r ON r.id = a.run_id
JOIN public.qa_applications app ON app.id = r.application_id
JOIN public.qa_environments env ON env.id = r.environment_id
JOIN public.qa_builds b ON b.id = r.build_id;

GRANT SELECT ON public.qa_case_current, public.qa_run_case_status, public.qa_history TO authenticated, service_role;
REVOKE ALL ON public.qa_case_current, public.qa_run_case_status, public.qa_history FROM anon;

-- ============ Access RPCs: applications, environments, resources, builds ============

CREATE OR REPLACE FUNCTION katalist_priv.qa_require_manage(_list_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  IF _list_id IS NULL OR NOT katalist_priv.can_view_list(_list_id) THEN
    RAISE EXCEPTION 'List not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT katalist_priv.can_manage_qa(_list_id) THEN
    RAISE EXCEPTION 'You don''t have permission to manage QA in this List.' USING ERRCODE = '42501';
  END IF;
  RETURN v_me;
END;
$$;
REVOKE EXECUTE ON FUNCTION katalist_priv.qa_require_manage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.qa_require_manage(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.qa_upsert_application(
  p_list_id uuid, p_id uuid, p_name text, p_platform_kind text, p_description text, p_archived boolean DEFAULT false
) RETURNS public.qa_applications
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_me uuid := katalist_priv.qa_require_manage(p_list_id); v_row public.qa_applications;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO public.qa_applications (list_id, name, platform_kind, description, archived_at, created_by)
    VALUES (p_list_id, btrim(p_name), coalesce(p_platform_kind, 'web'), nullif(btrim(coalesce(p_description, '')), ''),
            CASE WHEN p_archived THEN now() END, v_me)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.qa_applications SET name = btrim(p_name), platform_kind = coalesce(p_platform_kind, platform_kind),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      archived_at = CASE WHEN p_archived THEN coalesce(archived_at, now()) ELSE NULL END
    WHERE id = p_id AND list_id = p_list_id RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'Application not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN v_row;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'An application with that name already exists.' USING ERRCODE = '23505', HINT = 'duplicate_name';
END;
$$;

CREATE OR REPLACE FUNCTION public.qa_upsert_environment(
  p_list_id uuid, p_id uuid, p_name text, p_restricted boolean DEFAULT false, p_archived boolean DEFAULT false
) RETURNS public.qa_environments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_me uuid := katalist_priv.qa_require_manage(p_list_id); v_row public.qa_environments;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO public.qa_environments (list_id, name, restricted, archived_at, created_by)
    VALUES (p_list_id, btrim(p_name), coalesce(p_restricted, false), CASE WHEN p_archived THEN now() END, v_me)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.qa_environments SET name = btrim(p_name), restricted = coalesce(p_restricted, restricted),
      archived_at = CASE WHEN p_archived THEN coalesce(archived_at, now()) ELSE NULL END
    WHERE id = p_id AND list_id = p_list_id RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'Environment not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN v_row;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'An environment with that name already exists.' USING ERRCODE = '23505', HINT = 'duplicate_name';
END;
$$;

CREATE OR REPLACE FUNCTION public.qa_upsert_resource(
  p_list_id uuid, p_id uuid, p_application_id uuid, p_environment_id uuid, p_type text, p_label text,
  p_url text, p_details text, p_owner_profile_id uuid DEFAULT NULL, p_version_note text DEFAULT NULL, p_archived boolean DEFAULT false
) RETURNS public.qa_resources
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_me uuid := katalist_priv.qa_require_manage(p_list_id); v_row public.qa_resources;
BEGIN
  IF p_owner_profile_id IS NOT NULL AND NOT katalist_priv.qa_is_participant(p_list_id, p_owner_profile_id) THEN
    RAISE EXCEPTION 'The owner must be a member of this List.' USING ERRCODE = '22023', HINT = 'owner_not_member';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.qa_resources (list_id, application_id, environment_id, type, label, url, details, owner_profile_id, version_note, archived_at, created_by)
    VALUES (p_list_id, p_application_id, p_environment_id, coalesce(p_type, 'application'), btrim(p_label),
            nullif(btrim(coalesce(p_url, '')), ''), nullif(btrim(coalesce(p_details, '')), ''), p_owner_profile_id,
            nullif(btrim(coalesce(p_version_note, '')), ''), CASE WHEN p_archived THEN now() END, v_me)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.qa_resources SET type = coalesce(p_type, type), label = btrim(p_label),
      url = nullif(btrim(coalesce(p_url, '')), ''), details = nullif(btrim(coalesce(p_details, '')), ''),
      owner_profile_id = p_owner_profile_id, version_note = nullif(btrim(coalesce(p_version_note, '')), ''),
      archived_at = CASE WHEN p_archived THEN coalesce(archived_at, now()) ELSE NULL END
    WHERE id = p_id AND list_id = p_list_id AND application_id = p_application_id AND environment_id = p_environment_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'Resource not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN v_row;
END;
$$;

-- Builds are immutable. Registering an identifier that already exists returns the existing build.
CREATE OR REPLACE FUNCTION public.qa_register_build(
  p_list_id uuid, p_application_id uuid, p_environment_id uuid, p_identifier text,
  p_display_version text DEFAULT NULL, p_notes_url text DEFAULT NULL, p_install_url text DEFAULT NULL, p_config jsonb DEFAULT '{}'::jsonb
) RETURNS public.qa_builds
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_me uuid := katalist_priv.qa_require_manage(p_list_id); v_row public.qa_builds;
BEGIN
  INSERT INTO public.qa_builds (list_id, application_id, environment_id, identifier, display_version, notes_url, install_url, config, created_by)
  VALUES (p_list_id, p_application_id, p_environment_id, btrim(p_identifier), nullif(btrim(coalesce(p_display_version, '')), ''),
          nullif(btrim(coalesce(p_notes_url, '')), ''), nullif(btrim(coalesce(p_install_url, '')), ''), coalesce(p_config, '{}'::jsonb), v_me)
  ON CONFLICT (application_id, environment_id, identifier) DO NOTHING
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    SELECT * INTO v_row FROM public.qa_builds
    WHERE application_id = p_application_id AND environment_id = p_environment_id AND identifier = btrim(p_identifier) AND list_id = p_list_id;
  END IF;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'Application or environment not found' USING ERRCODE = 'P0002'; END IF;
  RETURN v_row;
END;
$$;

-- ============ Account RPCs (metadata only; secrets are written by the server) ============

CREATE OR REPLACE FUNCTION public.qa_save_account(
  p_list_id uuid, p_id uuid, p_application_id uuid, p_environment_id uuid, p_label text, p_test_role text,
  p_username text, p_instructions text,
  p_use_roles text[] DEFAULT '{}', p_manage_roles text[] DEFAULT '{}',
  p_use_profiles uuid[] DEFAULT '{}', p_manage_profiles uuid[] DEFAULT '{}'
) RETURNS public.qa_accounts
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me uuid := katalist_priv.qa_require_manage(p_list_id);
  v_row public.qa_accounts;
  v_role text;
  v_profile uuid;
BEGIN
  IF p_id IS NOT NULL AND NOT katalist_priv.qa_account_can(p_id, 'manage') THEN
    RAISE EXCEPTION 'You don''t have permission to manage this account.' USING ERRCODE = '42501';
  END IF;
  FOREACH v_role IN ARRAY coalesce(p_use_roles, '{}') || coalesce(p_manage_roles, '{}') LOOP
    IF v_role NOT IN ('owner', 'collaborator', 'view_only') THEN
      RAISE EXCEPTION 'Unknown role %.', v_role USING ERRCODE = '22023', HINT = 'invalid_input';
    END IF;
  END LOOP;
  FOREACH v_profile IN ARRAY coalesce(p_use_profiles, '{}') || coalesce(p_manage_profiles, '{}') LOOP
    IF NOT katalist_priv.qa_is_participant(p_list_id, v_profile) THEN
      RAISE EXCEPTION 'A grantee is not a member of this List.' USING ERRCODE = '22023', HINT = 'owner_not_member';
    END IF;
  END LOOP;

  IF p_id IS NULL THEN
    INSERT INTO public.qa_accounts (list_id, application_id, environment_id, label, test_role, username, instructions, created_by)
    VALUES (p_list_id, p_application_id, p_environment_id, btrim(p_label), btrim(coalesce(p_test_role, '')), coalesce(p_username, ''),
            nullif(btrim(coalesce(p_instructions, '')), ''), v_me)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.qa_accounts SET label = btrim(p_label), test_role = btrim(coalesce(p_test_role, '')), username = coalesce(p_username, ''),
      instructions = nullif(btrim(coalesce(p_instructions, '')), '')
    WHERE id = p_id AND list_id = p_list_id AND application_id = p_application_id AND environment_id = p_environment_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'Account not found' USING ERRCODE = 'P0002'; END IF;
  END IF;

  DELETE FROM public.qa_account_grants WHERE account_id = v_row.id;
  FOREACH v_role IN ARRAY coalesce(p_use_roles, '{}') LOOP
    INSERT INTO public.qa_account_grants (list_id, account_id, grantee_kind, grantee_role, capability, created_by)
    VALUES (p_list_id, v_row.id, 'role', v_role, 'use', v_me) ON CONFLICT DO NOTHING;
  END LOOP;
  FOREACH v_role IN ARRAY coalesce(p_manage_roles, '{}') LOOP
    INSERT INTO public.qa_account_grants (list_id, account_id, grantee_kind, grantee_role, capability, created_by)
    VALUES (p_list_id, v_row.id, 'role', v_role, 'manage', v_me) ON CONFLICT DO NOTHING;
  END LOOP;
  FOREACH v_profile IN ARRAY coalesce(p_use_profiles, '{}') LOOP
    INSERT INTO public.qa_account_grants (list_id, account_id, grantee_kind, grantee_profile_id, capability, created_by)
    VALUES (p_list_id, v_row.id, 'profile', v_profile, 'use', v_me) ON CONFLICT DO NOTHING;
  END LOOP;
  FOREACH v_profile IN ARRAY coalesce(p_manage_profiles, '{}') LOOP
    INSERT INTO public.qa_account_grants (list_id, account_id, grantee_kind, grantee_profile_id, capability, created_by)
    VALUES (p_list_id, v_row.id, 'profile', v_profile, 'manage', v_me) ON CONFLICT DO NOTHING;
  END LOOP;
  -- The saver keeps manage so an edit can never lock everyone out of the account.
  INSERT INTO public.qa_account_grants (list_id, account_id, grantee_kind, grantee_profile_id, capability, created_by)
  VALUES (p_list_id, v_row.id, 'profile', v_me, 'manage', v_me) ON CONFLICT DO NOTHING;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.qa_account_access(p_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_acc public.qa_accounts;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_acc FROM public.qa_accounts WHERE id = p_account_id;
  IF v_acc.id IS NULL OR NOT katalist_priv.can_view_list(v_acc.list_id) THEN
    RAISE EXCEPTION 'Account not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'list_id', v_acc.list_id,
    'archived', v_acc.archived_at IS NOT NULL,
    'has_secret', v_acc.has_secret,
    'can_use', katalist_priv.qa_account_can(v_acc.id, 'use'),
    'can_manage', katalist_priv.qa_account_can(v_acc.id, 'manage')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.qa_list_account_access(p_list_id uuid)
RETURNS TABLE (account_id uuid, can_use boolean, can_manage boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT a.id, katalist_priv.qa_account_can(a.id, 'use'), katalist_priv.qa_account_can(a.id, 'manage')
  FROM public.qa_accounts a
  WHERE a.list_id = p_list_id AND a.archived_at IS NULL AND katalist_priv.can_view_list(p_list_id);
$$;

CREATE OR REPLACE FUNCTION public.qa_archive_account(p_account_id uuid, p_archived boolean DEFAULT true)
RETURNS public.qa_accounts
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_row public.qa_accounts;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT katalist_priv.qa_account_can(p_account_id, 'manage') THEN
    RAISE EXCEPTION 'You don''t have permission to manage this account.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.qa_accounts SET archived_at = CASE WHEN p_archived THEN now() ELSE NULL END
  WHERE id = p_account_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- ============ Case library RPCs ============

CREATE OR REPLACE FUNCTION katalist_priv.qa_clean_steps(_steps jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
DECLARE v_out jsonb := '[]'::jsonb; v_el jsonb;
BEGIN
  IF _steps IS NULL THEN RETURN v_out; END IF;
  IF jsonb_typeof(_steps) <> 'array' THEN
    RAISE EXCEPTION 'Steps must be a list.' USING ERRCODE = '22023', HINT = 'invalid_input';
  END IF;
  FOR v_el IN SELECT * FROM jsonb_array_elements(_steps) LOOP
    IF jsonb_typeof(v_el) <> 'object' THEN
      RAISE EXCEPTION 'Each step must have an action and an expected result.' USING ERRCODE = '22023', HINT = 'invalid_input';
    END IF;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'action', left(btrim(coalesce(v_el ->> 'action', '')), 1000),
      'expected', left(btrim(coalesce(v_el ->> 'expected', '')), 1000)
    ));
  END LOOP;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION katalist_priv.qa_save_case_internal(
  _list_id uuid, _case_id uuid, _title text, _pre text, _steps jsonb, _priority text, _module text,
  _platforms text[], _note text, _me uuid
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_case public.qa_cases;
  v_cur public.qa_case_versions;
  v_steps jsonb := katalist_priv.qa_clean_steps(_steps);
  v_pre text := nullif(btrim(coalesce(_pre, '')), '');
  v_module text := nullif(btrim(coalesce(_module, '')), '');
  v_platforms text[] := coalesce(_platforms, '{}');
  v_priority text := coalesce(nullif(_priority, ''), 'medium');
  v_new_version boolean := false;
  v_number int;
BEGIN
  IF _case_id IS NULL THEN
    INSERT INTO public.qa_list_counters (list_id, next_case_number) VALUES (_list_id, 2)
    ON CONFLICT (list_id) DO UPDATE SET next_case_number = public.qa_list_counters.next_case_number + 1
    RETURNING next_case_number - 1 INTO v_number;
    INSERT INTO public.qa_cases (list_id, number, current_version, created_by) VALUES (_list_id, v_number, 1, _me)
    RETURNING * INTO v_case;
    INSERT INTO public.qa_case_versions (case_id, list_id, version, title, preconditions, steps, priority, module, platforms, change_note, created_by)
    VALUES (v_case.id, _list_id, 1, btrim(_title), v_pre, v_steps, v_priority, v_module, v_platforms, nullif(btrim(coalesce(_note, '')), ''), _me);
    RETURN jsonb_build_object('case_id', v_case.id, 'number', v_case.number, 'version', 1, 'outcome', 'created');
  END IF;

  SELECT * INTO v_case FROM public.qa_cases WHERE id = _case_id AND list_id = _list_id FOR UPDATE;
  IF v_case.id IS NULL THEN RAISE EXCEPTION 'Case not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_cur FROM public.qa_case_versions WHERE case_id = v_case.id AND version = v_case.current_version;
  IF v_cur.title = btrim(_title) AND v_cur.preconditions IS NOT DISTINCT FROM v_pre AND v_cur.steps = v_steps
     AND v_cur.priority = v_priority AND v_cur.module IS NOT DISTINCT FROM v_module AND v_cur.platforms = v_platforms THEN
    RETURN jsonb_build_object('case_id', v_case.id, 'number', v_case.number, 'version', v_case.current_version, 'outcome', 'unchanged');
  END IF;
  INSERT INTO public.qa_case_versions (case_id, list_id, version, title, preconditions, steps, priority, module, platforms, change_note, created_by)
  VALUES (v_case.id, _list_id, v_case.current_version + 1, btrim(_title), v_pre, v_steps, v_priority, v_module, v_platforms,
          nullif(btrim(coalesce(_note, '')), ''), _me);
  UPDATE public.qa_cases SET current_version = current_version + 1 WHERE id = v_case.id;
  RETURN jsonb_build_object('case_id', v_case.id, 'number', v_case.number, 'version', v_case.current_version + 1, 'outcome', 'updated');
END;
$$;
REVOKE EXECUTE ON FUNCTION katalist_priv.qa_clean_steps(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION katalist_priv.qa_save_case_internal(uuid, uuid, text, text, jsonb, text, text, text[], text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION katalist_priv.qa_clean_steps(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.qa_save_case(
  p_list_id uuid, p_case_id uuid, p_title text, p_preconditions text, p_steps jsonb, p_priority text,
  p_module text, p_platforms text[], p_change_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_me uuid := katalist_priv.qa_require_manage(p_list_id);
BEGIN
  RETURN katalist_priv.qa_save_case_internal(p_list_id, p_case_id, p_title, p_preconditions, p_steps, p_priority, p_module, p_platforms, p_change_note, v_me);
END;
$$;

CREATE OR REPLACE FUNCTION public.qa_archive_case(p_case_id uuid, p_archived boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_list uuid;
BEGIN
  SELECT list_id INTO v_list FROM public.qa_cases WHERE id = p_case_id;
  IF v_list IS NULL THEN RAISE EXCEPTION 'Case not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM katalist_priv.qa_require_manage(v_list);
  UPDATE public.qa_cases SET archived_at = CASE WHEN p_archived THEN coalesce(archived_at, now()) ELSE NULL END WHERE id = p_case_id;
END;
$$;

-- Bulk edit: applies only to cases in lists the caller can manage; each change makes a new version.
CREATE OR REPLACE FUNCTION public.qa_bulk_update_cases(p_case_ids uuid[], p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me uuid := auth.uid(); v_id uuid; v_case public.qa_cases; v_cur public.qa_case_versions;
  v_updated int := 0; v_skipped int := 0; v_res jsonb;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  IF cardinality(coalesce(p_case_ids, '{}')) > 500 THEN
    RAISE EXCEPTION 'Select at most 500 cases at a time.' USING ERRCODE = '22023', HINT = 'invalid_input';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Nothing to change.' USING ERRCODE = '22023', HINT = 'invalid_input';
  END IF;
  FOREACH v_id IN ARRAY coalesce(p_case_ids, '{}') LOOP
    SELECT * INTO v_case FROM public.qa_cases WHERE id = v_id;
    IF v_case.id IS NULL OR NOT katalist_priv.can_manage_qa(v_case.list_id) THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;
    IF p_patch ? 'archived' THEN
      UPDATE public.qa_cases SET archived_at = CASE WHEN (p_patch ->> 'archived')::boolean THEN coalesce(archived_at, now()) ELSE NULL END WHERE id = v_id;
    END IF;
    IF p_patch ? 'priority' OR p_patch ? 'module' OR p_patch ? 'platforms' THEN
      SELECT * INTO v_cur FROM public.qa_case_versions WHERE case_id = v_id AND version = v_case.current_version;
      v_res := katalist_priv.qa_save_case_internal(
        v_case.list_id, v_id, v_cur.title, v_cur.preconditions, v_cur.steps,
        coalesce(p_patch ->> 'priority', v_cur.priority),
        CASE WHEN p_patch ? 'module' THEN p_patch ->> 'module' ELSE v_cur.module END,
        CASE WHEN p_patch ? 'platforms' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch -> 'platforms')) ELSE v_cur.platforms END,
        'Bulk update', v_me);
    END IF;
    v_updated := v_updated + 1;
  END LOOP;
  RETURN jsonb_build_object('updated', v_updated, 'skipped', v_skipped);
END;
$$;

-- Import: validates every row first; p_atomic applies nothing when any row is invalid.
CREATE OR REPLACE FUNCTION public.qa_import_cases(p_list_id uuid, p_rows jsonb, p_strategy text DEFAULT 'skip', p_atomic boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me uuid := katalist_priv.qa_require_manage(p_list_id);
  v_row jsonb; v_idx int := 0; v_errors jsonb := '[]'::jsonb;
  v_created int := 0; v_updated int := 0; v_skipped int := 0;
  v_case_id uuid; v_num int; v_res jsonb; v_key text;
BEGIN
  IF p_strategy NOT IN ('skip', 'update', 'create') THEN
    RAISE EXCEPTION 'Unknown duplicate strategy.' USING ERRCODE = '22023', HINT = 'invalid_input';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION 'Import at most 1000 rows at a time.' USING ERRCODE = '22023', HINT = 'invalid_input';
  END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_idx := v_idx + 1;
    IF jsonb_typeof(v_row) <> 'object' OR length(btrim(coalesce(v_row ->> 'title', ''))) = 0 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_idx, 'message', 'Title is required.')); CONTINUE;
    END IF;
    IF length(v_row ->> 'title') > 240 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_idx, 'message', 'Title is longer than 240 characters.')); CONTINUE;
    END IF;
    IF coalesce(v_row ->> 'priority', '') NOT IN ('', 'low', 'medium', 'high', 'critical') THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', v_idx, 'message', 'Priority must be low, medium, high or critical.')); CONTINUE;
    END IF;
  END LOOP;
  IF jsonb_array_length(v_errors) > 0 AND p_atomic THEN
    RETURN jsonb_build_object('applied', false, 'created', 0, 'updated', 0, 'skipped', 0, 'errors', v_errors);
  END IF;
  v_idx := 0;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_idx := v_idx + 1;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_errors) e WHERE (e ->> 'row')::int = v_idx) THEN CONTINUE; END IF;
    v_case_id := NULL; v_key := nullif(btrim(coalesce(v_row ->> 'case_key', '')), '');
    IF v_key IS NOT NULL AND v_key ~* '^TC-[0-9]+$' AND p_strategy <> 'create' THEN
      v_num := substr(v_key, 4)::int;
      SELECT id INTO v_case_id FROM public.qa_cases WHERE list_id = p_list_id AND number = v_num;
    END IF;
    IF v_case_id IS NOT NULL AND p_strategy = 'skip' THEN v_skipped := v_skipped + 1; CONTINUE; END IF;
    v_res := katalist_priv.qa_save_case_internal(
      p_list_id, v_case_id, v_row ->> 'title', v_row ->> 'preconditions', coalesce(v_row -> 'steps', '[]'::jsonb),
      v_row ->> 'priority', v_row ->> 'module',
      ARRAY(SELECT jsonb_array_elements_text(coalesce(v_row -> 'platforms', '[]'::jsonb))),
      coalesce(v_row ->> 'change_note', 'Imported'), v_me);
    IF v_res ->> 'outcome' = 'created' THEN v_created := v_created + 1;
    ELSIF v_res ->> 'outcome' = 'updated' THEN v_updated := v_updated + 1;
    ELSE v_skipped := v_skipped + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('applied', true, 'created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'errors', v_errors);
END;
$$;

-- ============ Runs ============

CREATE OR REPLACE FUNCTION public.qa_create_run(
  p_list_id uuid, p_name text, p_application_id uuid, p_environment_id uuid, p_build_id uuid, p_config jsonb,
  p_case_ids uuid[], p_assignments jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL
) RETURNS public.qa_runs
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me uuid := katalist_priv.qa_require_manage(p_list_id);
  v_run public.qa_runs; v_id uuid; v_pos int := 0; v_case public.qa_cases; v_assignee uuid;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_run FROM public.qa_runs WHERE list_id = p_list_id AND created_by = v_me AND idempotency_key = p_idempotency_key;
    IF v_run.id IS NOT NULL THEN RETURN v_run; END IF;
  END IF;
  IF cardinality(coalesce(p_case_ids, '{}')) = 0 THEN
    RAISE EXCEPTION 'Select at least one test case.' USING ERRCODE = '22023', HINT = 'invalid_input';
  END IF;
  IF cardinality(p_case_ids) > 1000 THEN
    RAISE EXCEPTION 'A run can include at most 1000 cases.' USING ERRCODE = '22023', HINT = 'invalid_input';
  END IF;
  INSERT INTO public.qa_runs (list_id, name, application_id, environment_id, build_id, config, idempotency_key, created_by)
  VALUES (p_list_id, btrim(p_name), p_application_id, p_environment_id, p_build_id, coalesce(p_config, '{}'::jsonb), p_idempotency_key, v_me)
  RETURNING * INTO v_run;
  FOREACH v_id IN ARRAY p_case_ids LOOP
    SELECT * INTO v_case FROM public.qa_cases WHERE id = v_id AND list_id = p_list_id AND archived_at IS NULL;
    IF v_case.id IS NULL THEN
      RAISE EXCEPTION 'A selected case is missing or archived.' USING ERRCODE = 'P0002', HINT = 'case_unavailable';
    END IF;
    v_assignee := NULLIF(p_assignments ->> v_id::text, '')::uuid;
    IF v_assignee IS NOT NULL AND NOT katalist_priv.qa_is_participant(p_list_id, v_assignee) THEN
      RAISE EXCEPTION 'An assignee is not a member of this List.' USING ERRCODE = '22023', HINT = 'owner_not_member';
    END IF;
    v_pos := v_pos + 1;
    INSERT INTO public.qa_run_cases (run_id, list_id, case_id, case_version_id, position, assignee_profile_id)
    SELECT v_run.id, p_list_id, v_case.id, v.id, v_pos, v_assignee
    FROM public.qa_case_versions v WHERE v.case_id = v_case.id AND v.version = v_case.current_version;
  END LOOP;
  RETURN v_run;
END;
$$;

-- A retest is always a NEW run on an explicitly chosen, different build. The old run is untouched.
CREATE OR REPLACE FUNCTION public.qa_create_retest_run(
  p_predecessor_run_id uuid, p_build_id uuid, p_name text, p_idempotency_key text DEFAULT NULL
) RETURNS public.qa_runs
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_pred public.qa_runs; v_me uuid; v_run public.qa_runs; v_count int;
BEGIN
  SELECT * INTO v_pred FROM public.qa_runs WHERE id = p_predecessor_run_id;
  IF v_pred.id IS NULL THEN RAISE EXCEPTION 'Run not found' USING ERRCODE = 'P0002'; END IF;
  v_me := katalist_priv.qa_require_manage(v_pred.list_id);
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_run FROM public.qa_runs WHERE list_id = v_pred.list_id AND created_by = v_me AND idempotency_key = p_idempotency_key;
    IF v_run.id IS NOT NULL THEN RETURN v_run; END IF;
  END IF;
  IF p_build_id = v_pred.build_id THEN
    RAISE EXCEPTION 'Choose a different build, or record another attempt in the original run.' USING ERRCODE = '22023', HINT = 'same_build';
  END IF;
  INSERT INTO public.qa_runs (list_id, name, application_id, environment_id, build_id, config, predecessor_run_id, idempotency_key, created_by)
  VALUES (v_pred.list_id, btrim(p_name), v_pred.application_id, v_pred.environment_id, p_build_id, v_pred.config, v_pred.id, p_idempotency_key, v_me)
  RETURNING * INTO v_run;
  INSERT INTO public.qa_run_cases (run_id, list_id, case_id, case_version_id, position, assignee_profile_id, retest_of_run_case_id)
  SELECT v_run.id, rc.list_id, rc.case_id, rc.case_version_id, row_number() OVER (ORDER BY rc.position), rc.assignee_profile_id, rc.id
  FROM public.qa_run_cases rc
  JOIN LATERAL (SELECT a.status FROM public.qa_attempts a WHERE a.run_case_id = rc.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1) la ON true
  WHERE rc.run_id = v_pred.id AND la.status IN ('fail', 'blocked');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Nothing to retest: no failed or blocked cases in that run.' USING ERRCODE = '22023', HINT = 'nothing_to_retest';
  END IF;
  -- Carry the defect links forward so the new attempt keeps the connection to the original failure.
  INSERT INTO public.qa_thing_links (list_id, thing_id, case_id, run_case_id, attempt_id, created_by)
  SELECT l.list_id, l.thing_id, l.case_id, nrc.id, NULL, v_me
  FROM public.qa_run_cases nrc
  JOIN public.qa_thing_links l ON l.run_case_id = nrc.retest_of_run_case_id
  WHERE nrc.run_id = v_run.id
  ON CONFLICT DO NOTHING;
  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.qa_record_attempt(
  p_run_case_id uuid, p_status text, p_actual text, p_idempotency_key text
) RETURNS public.qa_attempts
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_rc public.qa_run_cases; v_run public.qa_runs; v_me uuid; v_prev uuid; v_row public.qa_attempts;
  v_actual text := nullif(btrim(coalesce(p_actual, '')), '');
BEGIN
  SELECT * INTO v_rc FROM public.qa_run_cases WHERE id = p_run_case_id FOR UPDATE;
  IF v_rc.id IS NULL THEN RAISE EXCEPTION 'Run case not found' USING ERRCODE = 'P0002'; END IF;
  v_me := katalist_priv.qa_require_manage(v_rc.list_id);
  SELECT * INTO v_row FROM public.qa_attempts WHERE run_case_id = p_run_case_id AND idempotency_key = p_idempotency_key;
  IF v_row.id IS NOT NULL THEN RETURN v_row; END IF;
  SELECT * INTO v_run FROM public.qa_runs WHERE id = v_rc.run_id FOR UPDATE;
  IF v_run.status <> 'active' THEN
    RAISE EXCEPTION 'This run is %. Start a new run to test again.', v_run.status USING ERRCODE = '55000', HINT = 'run_not_active';
  END IF;
  IF p_status NOT IN ('pass', 'fail', 'blocked', 'not_applicable') THEN
    RAISE EXCEPTION 'Unknown result.' USING ERRCODE = '22023', HINT = 'invalid_input';
  END IF;
  IF p_status IN ('fail', 'blocked') AND v_actual IS NULL THEN
    RAISE EXCEPTION 'Describe what happened for a failed or blocked result.' USING ERRCODE = '22023', HINT = 'actual_required';
  END IF;
  SELECT id INTO v_prev FROM public.qa_attempts WHERE run_case_id = p_run_case_id ORDER BY created_at DESC, id DESC LIMIT 1;
  INSERT INTO public.qa_attempts (run_case_id, run_id, list_id, status, actual, tester_profile_id, idempotency_key, previous_attempt_id)
  VALUES (p_run_case_id, v_rc.run_id, v_rc.list_id, p_status, v_actual, v_me, p_idempotency_key, v_prev)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.qa_run_totals(p_run_id uuid)
RETURNS TABLE (total integer, pass integer, fail integer, blocked integer, not_applicable integer, not_run integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  WITH latest AS (
    SELECT rc.id, la.status
    FROM public.qa_run_cases rc
    JOIN public.qa_runs r ON r.id = rc.run_id AND katalist_priv.can_view_list(r.list_id)
    LEFT JOIN LATERAL (SELECT a.status FROM public.qa_attempts a WHERE a.run_case_id = rc.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1) la ON true
    WHERE rc.run_id = p_run_id
  )
  SELECT count(*)::int,
         count(*) FILTER (WHERE status = 'pass')::int,
         count(*) FILTER (WHERE status = 'fail')::int,
         count(*) FILTER (WHERE status = 'blocked')::int,
         count(*) FILTER (WHERE status = 'not_applicable')::int,
         count(*) FILTER (WHERE status IS NULL)::int
  FROM latest;
$$;

-- Completion: Not Run cases and Blocked cases must each be accepted explicitly. Not Applicable counts as resolved.
CREATE OR REPLACE FUNCTION public.qa_complete_run(p_run_id uuid, p_accept_blocked boolean DEFAULT false, p_accept_not_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_run public.qa_runs; v_t record; v_summary jsonb;
BEGIN
  SELECT * INTO v_run FROM public.qa_runs WHERE id = p_run_id FOR UPDATE;
  IF v_run.id IS NULL THEN RAISE EXCEPTION 'Run not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM katalist_priv.qa_require_manage(v_run.list_id);
  IF v_run.status <> 'active' THEN
    RAISE EXCEPTION 'This run is already %.', v_run.status USING ERRCODE = '55000', HINT = 'run_not_active';
  END IF;
  SELECT * INTO v_t FROM public.qa_run_totals(p_run_id);
  IF v_t.not_run > 0 AND NOT coalesce(p_accept_not_run, false) THEN
    RAISE EXCEPTION '% case(s) have not been run.', v_t.not_run USING ERRCODE = '55000', HINT = 'not_run_remaining';
  END IF;
  IF v_t.blocked > 0 AND NOT coalesce(p_accept_blocked, false) THEN
    RAISE EXCEPTION '% case(s) are blocked.', v_t.blocked USING ERRCODE = '55000', HINT = 'blocked_remaining';
  END IF;
  v_summary := jsonb_build_object('total', v_t.total, 'pass', v_t.pass, 'fail', v_t.fail, 'blocked', v_t.blocked,
    'not_applicable', v_t.not_applicable, 'not_run', v_t.not_run,
    'accepted_blocked', coalesce(p_accept_blocked, false) AND v_t.blocked > 0,
    'accepted_not_run', coalesce(p_accept_not_run, false) AND v_t.not_run > 0);
  UPDATE public.qa_runs SET status = 'completed', completed_at = now(), completed_by = auth.uid(), completion_summary = v_summary
  WHERE id = p_run_id;
  RETURN v_summary;
END;
$$;

-- ============ Thing links ============

CREATE OR REPLACE FUNCTION public.qa_link_thing(p_run_case_id uuid, p_attempt_id uuid, p_thing_id uuid)
RETURNS public.qa_thing_links
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_rc public.qa_run_cases; v_me uuid; v_row public.qa_thing_links;
BEGIN
  SELECT * INTO v_rc FROM public.qa_run_cases WHERE id = p_run_case_id;
  IF v_rc.id IS NULL THEN RAISE EXCEPTION 'Run case not found' USING ERRCODE = 'P0002'; END IF;
  v_me := katalist_priv.qa_require_manage(v_rc.list_id);
  IF p_attempt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.qa_attempts a WHERE a.id = p_attempt_id AND a.run_case_id = p_run_case_id) THEN
    RAISE EXCEPTION 'Attempt not found' USING ERRCODE = 'P0002';
  END IF;
  -- Linking never touches the Thing's owner, assignee, Caught state or lifecycle.
  INSERT INTO public.qa_thing_links (list_id, thing_id, case_id, run_case_id, attempt_id, created_by)
  VALUES (v_rc.list_id, p_thing_id, v_rc.case_id, p_run_case_id, p_attempt_id, v_me)
  ON CONFLICT (thing_id, run_case_id) DO NOTHING
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    SELECT * INTO v_row FROM public.qa_thing_links WHERE thing_id = p_thing_id AND run_case_id = p_run_case_id;
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.qa_unlink_thing(p_link_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_list uuid;
BEGIN
  SELECT list_id INTO v_list FROM public.qa_thing_links WHERE id = p_link_id;
  IF v_list IS NULL THEN RAISE EXCEPTION 'Link not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM katalist_priv.qa_require_manage(v_list);
  DELETE FROM public.qa_thing_links WHERE id = p_link_id;
END;
$$;

-- ============ Evidence (called by the server with the caller's session) ============

CREATE OR REPLACE FUNCTION public.qa_begin_evidence(
  p_attempt_id uuid, p_file_name text, p_mime_type text, p_size_bytes bigint, p_checksum text DEFAULT NULL
) RETURNS public.qa_attempt_evidence
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_att public.qa_attempts; v_run public.qa_runs; v_me uuid; v_row public.qa_attempt_evidence;
  v_name text := regexp_replace(btrim(coalesce(p_file_name, '')), '[^A-Za-z0-9._ -]', '_', 'g');
  v_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO v_att FROM public.qa_attempts WHERE id = p_attempt_id;
  IF v_att.id IS NULL THEN RAISE EXCEPTION 'Attempt not found' USING ERRCODE = 'P0002'; END IF;
  v_me := katalist_priv.qa_require_manage(v_att.list_id);
  SELECT * INTO v_run FROM public.qa_runs WHERE id = v_att.run_id;
  IF v_run.status = 'archived' THEN
    RAISE EXCEPTION 'This run is archived.' USING ERRCODE = '55000', HINT = 'run_not_active';
  END IF;
  IF p_mime_type NOT IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'application/pdf', 'text/plain', 'text/csv') THEN
    RAISE EXCEPTION 'That file type is not allowed as evidence.' USING ERRCODE = '22023', HINT = 'mime_not_allowed';
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes < 1 OR p_size_bytes > 26214400 THEN
    RAISE EXCEPTION 'Evidence files must be between 1 byte and 25 MB.' USING ERRCODE = '22023', HINT = 'too_large';
  END IF;
  IF (SELECT count(*) FROM public.qa_attempt_evidence WHERE attempt_id = p_attempt_id) >= 20 THEN
    RAISE EXCEPTION 'An attempt can hold at most 20 evidence files.' USING ERRCODE = '22023', HINT = 'too_many';
  END IF;
  IF length(v_name) = 0 THEN v_name := 'evidence'; END IF;
  INSERT INTO public.qa_attempt_evidence (id, attempt_id, list_id, storage_key, file_name, mime_type, size_bytes, checksum_sha256, status, created_by)
  VALUES (v_id, p_attempt_id, v_att.list_id,
          'qa/' || v_att.list_id::text || '/' || p_attempt_id::text || '/' || v_id::text, left(v_name, 180), p_mime_type, p_size_bytes,
          lower(nullif(p_checksum, '')), 'pending', v_me)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Finalization is server-only: callers must not skip object verification in the HTTP handler.
CREATE OR REPLACE FUNCTION public.qa_finalize_evidence(p_evidence_id uuid, p_actor_id uuid)
RETURNS public.qa_attempt_evidence
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_row public.qa_attempt_evidence;
BEGIN
  SELECT * INTO v_row FROM public.qa_attempt_evidence WHERE id = p_evidence_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.created_by IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Evidence not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.lists l WHERE l.id = v_row.list_id AND l.owner_profile_id = p_actor_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.list_members m WHERE m.list_id = v_row.list_id
      AND m.profile_id = p_actor_id AND m.role = 'collaborator'
  ) THEN
    RAISE EXCEPTION 'You no longer have permission to upload evidence.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.qa_attempt_evidence SET status = 'ready' WHERE id = p_evidence_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Returns the storage key so the server can remove the (possibly partial) object.
CREATE OR REPLACE FUNCTION public.qa_abort_evidence(p_evidence_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_row public.qa_attempt_evidence;
BEGIN
  SELECT * INTO v_row FROM public.qa_attempt_evidence WHERE id = p_evidence_id AND status = 'pending';
  IF v_row.id IS NULL OR v_row.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Evidence not found' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM public.qa_attempt_evidence WHERE id = p_evidence_id;
  RETURN v_row.storage_key;
END;
$$;

-- Server-only orphan sweep (service role): pending uploads older than the cutoff.
CREATE OR REPLACE FUNCTION public.qa_stale_pending_evidence(p_older_than interval DEFAULT interval '1 day')
RETURNS TABLE (id uuid, storage_key text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT e.id, e.storage_key FROM public.qa_attempt_evidence e WHERE e.status = 'pending' AND e.created_at < now() - p_older_than LIMIT 200;
$$;

-- ============ Saved views ============

CREATE OR REPLACE FUNCTION public.qa_save_view(p_list_id uuid, p_view_kind text, p_name text, p_config jsonb)
RETURNS public.qa_saved_views
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE v_me uuid := auth.uid(); v_row public.qa_saved_views;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000'; END IF;
  IF NOT katalist_priv.can_view_list(p_list_id) THEN RAISE EXCEPTION 'List not found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.qa_saved_views (list_id, profile_id, view_kind, name, config)
  VALUES (p_list_id, v_me, coalesce(p_view_kind, 'library'), btrim(p_name), coalesce(p_config, '{}'::jsonb))
  ON CONFLICT (list_id, profile_id, view_kind, name) DO UPDATE SET config = EXCLUDED.config
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.qa_delete_view(p_view_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  DELETE FROM public.qa_saved_views WHERE id = p_view_id AND profile_id = auth.uid();
$$;

-- ============ Execute grants ============

REVOKE EXECUTE ON FUNCTION
  public.qa_upsert_application(uuid, uuid, text, text, text, boolean),
  public.qa_upsert_environment(uuid, uuid, text, boolean, boolean),
  public.qa_upsert_resource(uuid, uuid, uuid, uuid, text, text, text, text, uuid, text, boolean),
  public.qa_register_build(uuid, uuid, uuid, text, text, text, text, jsonb),
  public.qa_save_account(uuid, uuid, uuid, uuid, text, text, text, text, text[], text[], uuid[], uuid[]),
  public.qa_account_access(uuid),
  public.qa_list_account_access(uuid),
  public.qa_archive_account(uuid, boolean),
  public.qa_save_case(uuid, uuid, text, text, jsonb, text, text, text[], text),
  public.qa_archive_case(uuid, boolean),
  public.qa_bulk_update_cases(uuid[], jsonb),
  public.qa_import_cases(uuid, jsonb, text, boolean),
  public.qa_create_run(uuid, text, uuid, uuid, uuid, jsonb, uuid[], jsonb, text),
  public.qa_create_retest_run(uuid, uuid, text, text),
  public.qa_record_attempt(uuid, text, text, text),
  public.qa_run_totals(uuid),
  public.qa_complete_run(uuid, boolean, boolean),
  public.qa_link_thing(uuid, uuid, uuid),
  public.qa_unlink_thing(uuid),
  public.qa_begin_evidence(uuid, text, text, bigint, text),
  public.qa_abort_evidence(uuid),
  public.qa_stale_pending_evidence(interval),
  public.qa_save_view(uuid, text, text, jsonb),
  public.qa_delete_view(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.qa_upsert_application(uuid, uuid, text, text, text, boolean),
  public.qa_upsert_environment(uuid, uuid, text, boolean, boolean),
  public.qa_upsert_resource(uuid, uuid, uuid, uuid, text, text, text, text, uuid, text, boolean),
  public.qa_register_build(uuid, uuid, uuid, text, text, text, text, jsonb),
  public.qa_save_account(uuid, uuid, uuid, uuid, text, text, text, text, text[], text[], uuid[], uuid[]),
  public.qa_account_access(uuid),
  public.qa_list_account_access(uuid),
  public.qa_archive_account(uuid, boolean),
  public.qa_save_case(uuid, uuid, text, text, jsonb, text, text, text[], text),
  public.qa_archive_case(uuid, boolean),
  public.qa_bulk_update_cases(uuid[], jsonb),
  public.qa_import_cases(uuid, jsonb, text, boolean),
  public.qa_create_run(uuid, text, uuid, uuid, uuid, jsonb, uuid[], jsonb, text),
  public.qa_create_retest_run(uuid, uuid, text, text),
  public.qa_record_attempt(uuid, text, text, text),
  public.qa_run_totals(uuid),
  public.qa_complete_run(uuid, boolean, boolean),
  public.qa_link_thing(uuid, uuid, uuid),
  public.qa_unlink_thing(uuid),
  public.qa_begin_evidence(uuid, text, text, bigint, text),
  public.qa_abort_evidence(uuid),
  public.qa_save_view(uuid, text, text, jsonb),
  public.qa_delete_view(uuid)
TO authenticated, service_role;

-- Server verified finalization is not callable through an authenticated client RPC.
REVOKE EXECUTE ON FUNCTION public.qa_finalize_evidence(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qa_finalize_evidence(uuid, uuid) TO service_role;

-- Orphan sweep is service-role only.
REVOKE EXECUTE ON FUNCTION public.qa_stale_pending_evidence(interval) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.qa_stale_pending_evidence(interval) TO service_role;

-- ============ Private evidence bucket (no client policies; the server signs access) ============

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('qa-evidence', 'qa-evidence', false, 26214400)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 26214400;

NOTIFY pgrst, 'reload schema';
