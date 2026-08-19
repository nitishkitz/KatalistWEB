-- =========================================================
-- KATALIST PHASE 1 — CORE IDENTITY FOUNDATION
-- =========================================================

CREATE SCHEMA IF NOT EXISTS katalist_priv;
REVOKE ALL ON SCHEMA katalist_priv FROM PUBLIC;
GRANT USAGE ON SCHEMA katalist_priv TO authenticated, service_role;

-- ---------- Enums ----------
CREATE TYPE public.context_kind AS ENUM ('work','home');
CREATE TYPE public.importance AS ENUM ('now','next','later');
CREATE TYPE public.pace AS ENUM ('now','next','later');
CREATE TYPE public.acknowledgement_state AS ENUM ('waiting_for_catch','caught');
CREATE TYPE public.work_status AS ENUM ('not_started','under_progress','sorted','cancelled');
CREATE TYPE public.list_role AS ENUM ('collaborator','view_only');
CREATE TYPE public.actor_kind AS ENUM ('user','external');
CREATE TYPE public.object_type AS ENUM ('thing','list','bucket');
CREATE TYPE public.nudge_reason AS ENUM ('waiting_for_catch','quiet','due_soon','stale','repeated_handoff');
CREATE TYPE public.activity_event AS ENUM (
  'created','assigned','caught','work_status_changed','importance_changed','due_changed',
  'reassigned','nudged','commented','sorted','cancelled','promoted_to_list',
  'bridge_opened','bridge_revoked'
);
CREATE TYPE public.private_activity_event AS ENUM (
  'bucket_ref_added','bucket_ref_removed','shredded','restored',
  'breakthrough_snoozed','breakthrough_dismissed'
);
CREATE TYPE public.notification_channel AS ENUM ('in_app','push','email','whatsapp','sms');
CREATE TYPE public.delivery_status AS ENUM ('pending','sent','failed','skipped');

-- ---------- Shared updated_at helper ----------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------- app_config ----------
CREATE TABLE public.app_config (
  key           text PRIMARY KEY,
  value         jsonb NOT NULL,
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_config TO authenticated;
GRANT ALL ON public.app_config TO service_role;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_config readable by authenticated"
  ON public.app_config FOR SELECT TO authenticated USING (true);
CREATE TRIGGER trg_app_config_updated_at
  BEFORE UPDATE ON public.app_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.app_config (key, value, description) VALUES
  ('shred_retention_days', '30'::jsonb, 'Recently Shredded recovery window in days'),
  ('nudge_cooldown_minutes', '120'::jsonb, 'Minimum minutes between nudges on one Thing'),
  ('nudge_waiting_hours', '4'::jsonb, 'Hours Waiting for Catch before follow-up surfaces'),
  ('nudge_quiet_hours', '18'::jsonb, 'Hours without movement before Quiet reason'),
  ('nudge_stale_hours', '48'::jsonb, 'Hours without movement before Stale reason'),
  ('nudge_due_soon_hours', '3'::jsonb, 'Hours before due to surface Due Soon'),
  ('doorman_snooze_minutes', '60'::jsonb, 'Default Later snooze for breakthrough Ghost Cards'),
  ('bridge_grant_ttl_hours', '336'::jsonb, 'Bridge magic-link grant lifetime in hours'),
  ('bridge_session_ttl_minutes', '120'::jsonb, 'Bridge HttpOnly session lifetime in minutes');

-- ---------- profiles ----------
CREATE TABLE public.profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_e164      text UNIQUE,
  email           text,
  display_name    text NOT NULL DEFAULT 'Katalist user',
  avatar_url      text,
  active_context  public.context_kind NOT NULL DEFAULT 'work',
  timezone        text NOT NULL DEFAULT 'UTC',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles select own"
  ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles insert own"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "profiles update own"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_profiles_phone ON public.profiles (phone_e164);

-- ---------- external_identities ----------
CREATE TABLE public.external_identities (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164         text UNIQUE,
  email              text UNIQUE,
  display_name       text NOT NULL DEFAULT 'Guest',
  claimed_profile_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  claimed_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_identity_has_handle CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT external_identity_claim_consistent
    CHECK ((claimed_profile_id IS NULL) = (claimed_at IS NULL))
);
-- No client GRANTs: reachable only through SECURITY DEFINER RPCs.
GRANT ALL ON public.external_identities TO service_role;
ALTER TABLE public.external_identities ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_external_identities_updated_at
  BEFORE UPDATE ON public.external_identities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- actors ----------
CREATE TABLE public.actors (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                  public.actor_kind NOT NULL,
  profile_id            uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  external_identity_id  uuid REFERENCES public.external_identities(id) ON DELETE CASCADE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT actor_kind_shape CHECK (
    (kind = 'external' AND profile_id IS NULL AND external_identity_id IS NOT NULL)
    OR
    (kind = 'user' AND profile_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uq_actors_profile
  ON public.actors (profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX uq_actors_external_identity
  ON public.actors (external_identity_id) WHERE external_identity_id IS NOT NULL;

GRANT SELECT ON public.actors TO authenticated;
GRANT ALL ON public.actors TO service_role;
ALTER TABLE public.actors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "actors select own"
  ON public.actors FOR SELECT TO authenticated USING (profile_id = auth.uid());
CREATE TRIGGER trg_actors_updated_at
  BEFORE UPDATE ON public.actors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Actor identity is permanent: id never changes, provenance never erased,
-- profile binding happens exactly once (external -> user claim).
CREATE OR REPLACE FUNCTION public.enforce_actor_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'actors.id is immutable';
  END IF;
  IF OLD.external_identity_id IS NOT NULL
     AND NEW.external_identity_id IS DISTINCT FROM OLD.external_identity_id THEN
    RAISE EXCEPTION 'actors.external_identity_id provenance is immutable once set';
  END IF;
  IF OLD.profile_id IS NOT NULL
     AND NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
    RAISE EXCEPTION 'actors.profile_id is immutable once set';
  END IF;
  IF OLD.kind = 'user' AND NEW.kind <> 'user' THEN
    RAISE EXCEPTION 'an actor cannot revert from user to external';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_actors_immutable
  BEFORE UPDATE ON public.actors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_actor_immutability();

-- ---------- contacts ----------
CREATE TABLE public.contacts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id           uuid REFERENCES public.actors(id) ON DELETE CASCADE,
  alias              text,
  phone_e164         text,
  email              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_contacts_owner_actor
  ON public.contacts (owner_profile_id, actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_contacts_owner ON public.contacts (owner_profile_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts own all"
  ON public.contacts FOR ALL TO authenticated
  USING (owner_profile_id = auth.uid())
  WITH CHECK (owner_profile_id = auth.uid());
CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Private helper functions ----------
CREATE OR REPLACE FUNCTION katalist_priv.current_actor_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
  SELECT a.id FROM public.actors a WHERE a.profile_id = auth.uid() LIMIT 1;
$$;
REVOKE ALL ON FUNCTION katalist_priv.current_actor_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.current_actor_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION katalist_priv.actor_is_external(_actor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
  SELECT COALESCE((SELECT a.kind = 'external' FROM public.actors a WHERE a.id = _actor_id), false);
$$;
REVOKE ALL ON FUNCTION katalist_priv.actor_is_external(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.actor_is_external(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION katalist_priv.active_context()
RETURNS public.context_kind
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
  SELECT COALESCE((SELECT p.active_context FROM public.profiles p WHERE p.id = auth.uid()), 'work'::public.context_kind);
$$;
REVOKE ALL ON FUNCTION katalist_priv.active_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.active_context() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION katalist_priv.config_int(_key text, _fallback integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
  SELECT COALESCE((SELECT (c.value)::text::integer FROM public.app_config c WHERE c.key = _key), _fallback);
$$;
REVOKE ALL ON FUNCTION katalist_priv.config_int(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.config_int(text, integer) TO authenticated, service_role;

-- ---------- Limited public profile lens ----------
CREATE VIEW public.public_profiles
WITH (security_invoker = off) AS
  SELECT p.id, p.display_name, p.avatar_url, p.phone_e164, a.id AS actor_id
  FROM public.profiles p
  JOIN public.actors a ON a.profile_id = p.id;
REVOKE ALL ON public.public_profiles FROM PUBLIC, anon;
GRANT SELECT ON public.public_profiles TO authenticated;

-- ---------- Signup wiring: profile + permanent actor ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_phone text;
  v_name  text;
BEGIN
  v_phone := NULLIF(COALESCE(NEW.phone, NEW.raw_user_meta_data ->> 'phone'), '');
  v_name  := COALESCE(
    NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''),
    NULLIF(NEW.email, ''),
    v_phone,
    'Katalist user'
  );

  INSERT INTO public.profiles (id, phone_e164, email, display_name)
  VALUES (NEW.id, v_phone, NULLIF(NEW.email, ''), v_name)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.actors (kind, profile_id)
  VALUES ('user', NEW.id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();