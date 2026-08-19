-- ============ Phase 6a: Buckets (private lens) ============

CREATE TABLE public.buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  context public.context_kind NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT buckets_name_not_blank CHECK (length(btrim(name)) > 0),
  UNIQUE (owner_profile_id, name)
);

CREATE TABLE public.bucket_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id uuid NOT NULL REFERENCES public.buckets(id) ON DELETE CASCADE,
  thing_id uuid REFERENCES public.things(id) ON DELETE CASCADE,
  list_id uuid REFERENCES public.lists(id) ON DELETE CASCADE,
  position integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bucket_items_exactly_one_ref CHECK (num_nonnulls(thing_id, list_id) = 1)
);

CREATE UNIQUE INDEX uq_bucket_items_thing ON public.bucket_items(bucket_id, thing_id) WHERE thing_id IS NOT NULL;
CREATE UNIQUE INDEX uq_bucket_items_list  ON public.bucket_items(bucket_id, list_id)  WHERE list_id IS NOT NULL;
CREATE INDEX idx_buckets_owner ON public.buckets(owner_profile_id);
CREATE INDEX idx_bucket_items_bucket ON public.bucket_items(bucket_id);

CREATE TABLE public.private_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event public.private_activity_event NOT NULL,
  object_type public.object_type NOT NULL,
  object_id uuid NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_private_activity_owner_created ON public.private_activity(profile_id, created_at DESC);

CREATE TRIGGER trg_buckets_updated_at BEFORE UPDATE ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_private_activity_append_only BEFORE UPDATE OR DELETE ON public.private_activity
  FOR EACH ROW EXECUTE FUNCTION public.forbid_history_mutation();

CREATE OR REPLACE FUNCTION public.enforce_bucket_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = 'pg_catalog','public' AS $$
BEGIN
  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'buckets.id is immutable';
  END IF;
  IF NEW.owner_profile_id <> OLD.owner_profile_id THEN
    RAISE EXCEPTION 'a Bucket is private and cannot be transferred';
  END IF;
  IF NEW.context IS DISTINCT FROM OLD.context THEN
    RAISE EXCEPTION 'a Bucket''s context cannot change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_buckets_immutable BEFORE UPDATE ON public.buckets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bucket_immutability();

-- ============ Helpers ============

CREATE OR REPLACE FUNCTION katalist_priv.is_bucket_owner(_bucket_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
  SELECT EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = _bucket_id AND b.owner_profile_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION katalist_priv.log_private(_profile_id uuid, _event public.private_activity_event, _object_type public.object_type, _object_id uuid, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
BEGIN
  INSERT INTO public.private_activity (profile_id, event, object_type, object_id, detail)
  VALUES (_profile_id, _event, _object_type, _object_id, COALESCE(_detail, '{}'::jsonb));
END;
$$;

REVOKE EXECUTE ON FUNCTION katalist_priv.is_bucket_owner(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION katalist_priv.log_private(uuid, public.private_activity_event, public.object_type, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.is_bucket_owner(uuid) TO authenticated;

-- ============ GRANTs + RLS ============

GRANT SELECT, INSERT, UPDATE, DELETE ON public.buckets TO authenticated;
GRANT ALL ON public.buckets TO service_role;

GRANT SELECT ON public.bucket_items TO authenticated;
GRANT ALL ON public.bucket_items TO service_role;

GRANT SELECT ON public.private_activity TO authenticated;
GRANT ALL ON public.private_activity TO service_role;

ALTER TABLE public.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bucket_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "buckets are private to their owner" ON public.buckets
  FOR ALL TO authenticated
  USING (owner_profile_id = auth.uid())
  WITH CHECK (owner_profile_id = auth.uid());

CREATE POLICY "bucket items visible to bucket owner" ON public.bucket_items
  FOR SELECT TO authenticated
  USING (katalist_priv.is_bucket_owner(bucket_id));

CREATE POLICY "private activity visible to its owner" ON public.private_activity
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

-- ============ RPCs ============

CREATE OR REPLACE FUNCTION public.create_bucket(p_name text, p_context public.context_kind DEFAULT NULL)
RETURNS public.buckets LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE
  v_bucket public.buckets;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'a Bucket needs a name';
  END IF;

  INSERT INTO public.buckets (owner_profile_id, name, context)
  VALUES (auth.uid(), btrim(p_name), COALESCE(p_context, katalist_priv.active_context()))
  RETURNING * INTO v_bucket;

  RETURN v_bucket;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_to_bucket(p_bucket_id uuid, p_thing_id uuid DEFAULT NULL, p_list_id uuid DEFAULT NULL)
RETURNS public.bucket_items LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE
  v_item public.bucket_items;
BEGIN
  IF NOT katalist_priv.is_bucket_owner(p_bucket_id) THEN
    RAISE EXCEPTION 'Bucket not found';
  END IF;
  IF num_nonnulls(p_thing_id, p_list_id) <> 1 THEN
    RAISE EXCEPTION 'add exactly one Thing or one List';
  END IF;
  IF p_thing_id IS NOT NULL AND NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF p_list_id IS NOT NULL AND NOT katalist_priv.can_view_list(p_list_id) THEN
    RAISE EXCEPTION 'List not found';
  END IF;

  INSERT INTO public.bucket_items (bucket_id, thing_id, list_id)
  VALUES (p_bucket_id, p_thing_id, p_list_id)
  RETURNING * INTO v_item;

  PERFORM katalist_priv.log_private(
    auth.uid(), 'bucket_ref_added',
    CASE WHEN p_thing_id IS NOT NULL THEN 'thing' ELSE 'list' END::public.object_type,
    COALESCE(p_thing_id, p_list_id),
    jsonb_build_object('bucket_id', p_bucket_id));

  RETURN v_item;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_from_bucket(p_bucket_id uuid, p_thing_id uuid DEFAULT NULL, p_list_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
BEGIN
  IF NOT katalist_priv.is_bucket_owner(p_bucket_id) THEN
    RAISE EXCEPTION 'Bucket not found';
  END IF;
  IF num_nonnulls(p_thing_id, p_list_id) <> 1 THEN
    RAISE EXCEPTION 'remove exactly one Thing or one List';
  END IF;

  DELETE FROM public.bucket_items
   WHERE bucket_id = p_bucket_id
     AND thing_id IS NOT DISTINCT FROM p_thing_id
     AND list_id  IS NOT DISTINCT FROM p_list_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM katalist_priv.log_private(
    auth.uid(), 'bucket_ref_removed',
    CASE WHEN p_thing_id IS NOT NULL THEN 'thing' ELSE 'list' END::public.object_type,
    COALESCE(p_thing_id, p_list_id),
    jsonb_build_object('bucket_id', p_bucket_id));

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_bucket(text, public.context_kind) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_to_bucket(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_from_bucket(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_bucket(text, public.context_kind) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_to_bucket(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_from_bucket(uuid, uuid, uuid) TO authenticated;
