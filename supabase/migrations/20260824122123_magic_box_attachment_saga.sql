-- Magic Box v2 attachment saga.
-- Bytes move only through the Storage API. These functions read storage.objects
-- metadata and write public.thing_attachments; they never mutate storage.objects.

CREATE TABLE IF NOT EXISTS public.thing_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thing_id uuid NOT NULL REFERENCES public.things(id) ON DELETE CASCADE,
  uploaded_by_actor_id uuid NOT NULL REFERENCES public.actors(id),
  client_id uuid NOT NULL,
  staging_key text NOT NULL,
  storage_key text,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 20971520),
  status text NOT NULL CHECK (status IN ('pending', 'ready')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  UNIQUE (uploaded_by_actor_id, client_id),
  UNIQUE (storage_key)
);

CREATE INDEX IF NOT EXISTS thing_attachments_thing_id_idx ON public.thing_attachments (thing_id);

ALTER TABLE public.thing_attachments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.thing_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.thing_attachments TO authenticated;
GRANT ALL ON public.thing_attachments TO service_role;

DROP POLICY IF EXISTS "thing attachments visible to thing viewers" ON public.thing_attachments;
CREATE POLICY "thing attachments visible to thing viewers"
  ON public.thing_attachments FOR SELECT TO authenticated
  USING (katalist_priv.can_view_thing(thing_id) AND status = 'ready');

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('thing-attachments', 'thing-attachments', false, 20971520)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 20971520;

DROP POLICY IF EXISTS "thing-attachments staging insert" ON storage.objects;
CREATE POLICY "thing-attachments staging insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'thing-attachments'
  AND (storage.foldername(name))[1] = 'staging'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS "thing-attachments staging update" ON storage.objects;
CREATE POLICY "thing-attachments staging update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'thing-attachments'
  AND (storage.foldername(name))[1] = 'staging'
  AND (storage.foldername(name))[2] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'thing-attachments'
  AND (storage.foldername(name))[1] = 'staging'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS "thing-attachments staging delete" ON storage.objects;
CREATE POLICY "thing-attachments staging delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'thing-attachments'
  AND (storage.foldername(name))[1] = 'staging'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS "thing-attachments staging select" ON storage.objects;
CREATE POLICY "thing-attachments staging select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'thing-attachments'
  AND (
    (
      (storage.foldername(name))[1] = 'staging'
      AND (storage.foldername(name))[2] = auth.uid()::text
    )
    OR (
      (storage.foldername(name))[1] = 'things'
      AND katalist_priv.can_view_thing(((storage.foldername(name))[2])::uuid)
    )
  )
);

CREATE OR REPLACE FUNCTION public.reserve_thing_attachment(
  p_thing_id uuid,
  p_client_id uuid,
  p_staging_key text,
  p_file_name text
)
RETURNS public.thing_attachments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv, storage
AS $$
DECLARE
  v_me uuid := katalist_priv.current_actor_id();
  v_uid uuid := auth.uid();
  v_existing public.thing_attachments;
  v_size bigint;
  v_mime text;
  v_count integer;
  v_safe text;
  v_final text;
  v_row public.thing_attachments;
BEGIN
  IF v_me IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to continue.';
  END IF;
  IF NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF p_staging_key IS NULL
     OR p_staging_key NOT LIKE ('staging/' || v_uid::text || '/' || p_client_id::text || '/%')
     OR position('..' in p_staging_key) > 0 THEN
    RAISE EXCEPTION 'invalid staging key';
  END IF;

  SELECT COALESCE((o.metadata->>'size')::bigint, (o.metadata->>'contentLength')::bigint, 0),
         COALESCE(o.metadata->>'mimetype', o.metadata->>'contentType', 'application/octet-stream')
    INTO v_size, v_mime
    FROM storage.objects o
   WHERE o.bucket_id = 'thing-attachments'
     AND o.name = p_staging_key;

  IF NOT FOUND OR v_size IS NULL OR v_size < 1 THEN
    RAISE EXCEPTION 'attachment missing';
  END IF;
  IF v_size > 20971520 THEN
    RAISE EXCEPTION 'attachment too large';
  END IF;

  SELECT * INTO v_existing
    FROM public.thing_attachments
   WHERE uploaded_by_actor_id = v_me
     AND client_id = p_client_id;

  IF FOUND THEN
    IF v_existing.thing_id IS DISTINCT FROM p_thing_id
       OR v_existing.staging_key IS DISTINCT FROM p_staging_key
       OR v_existing.file_name IS DISTINCT FROM p_file_name THEN
      RAISE EXCEPTION 'idempotency collision';
    END IF;
    RETURN v_existing;
  END IF;

  PERFORM 1 FROM public.things WHERE id = p_thing_id FOR UPDATE;

  SELECT count(*)::integer INTO v_count
    FROM public.thing_attachments
   WHERE thing_id = p_thing_id;
  IF v_count >= 5 THEN
    RAISE EXCEPTION 'attachment limit';
  END IF;

  v_safe := left(regexp_replace(COALESCE(p_file_name, 'file'), '[^\w.\-]+', '_', 'g'), 80);
  IF v_safe IS NULL OR v_safe = '' THEN
    v_safe := 'file';
  END IF;

  INSERT INTO public.thing_attachments (
    thing_id, uploaded_by_actor_id, client_id, staging_key, storage_key,
    file_name, mime_type, byte_size, status
  ) VALUES (
    p_thing_id, v_me, p_client_id, p_staging_key, NULL,
    p_file_name, v_mime, v_size, 'pending'
  ) RETURNING * INTO v_row;

  v_final := 'things/' || p_thing_id::text || '/' || v_row.id::text || '/' || v_safe;
  UPDATE public.thing_attachments
     SET storage_key = v_final
   WHERE id = v_row.id
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_thing_attachment(
  p_attachment_id uuid,
  p_storage_key text
)
RETURNS public.thing_attachments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
DECLARE
  v_me uuid := katalist_priv.current_actor_id();
  v_row public.thing_attachments;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in to continue.';
  END IF;
  SELECT * INTO v_row FROM public.thing_attachments WHERE id = p_attachment_id;
  IF NOT FOUND OR NOT katalist_priv.can_view_thing(v_row.thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_row.uploaded_by_actor_id IS DISTINCT FROM v_me THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF v_row.status = 'ready' AND v_row.storage_key IS NOT DISTINCT FROM p_storage_key THEN
    RETURN v_row;
  END IF;
  IF v_row.storage_key IS DISTINCT FROM p_storage_key THEN
    RAISE EXCEPTION 'invalid staging key';
  END IF;
  UPDATE public.thing_attachments
     SET status = 'ready',
         finalized_at = now()
   WHERE id = p_attachment_id
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.abandon_pending_attachment(p_attachment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
DECLARE
  v_me uuid := katalist_priv.current_actor_id();
  v_row public.thing_attachments;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in to continue.';
  END IF;
  SELECT * INTO v_row FROM public.thing_attachments WHERE id = p_attachment_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_row.uploaded_by_actor_id IS DISTINCT FROM v_me OR v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  DELETE FROM public.thing_attachments WHERE id = p_attachment_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_thing_attachments(p_thing_id uuid)
RETURNS SETOF public.thing_attachments
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
  SELECT *
  FROM public.thing_attachments
  WHERE thing_id = p_thing_id
    AND status = 'ready'
    AND katalist_priv.can_view_thing(p_thing_id);
$$;

CREATE OR REPLACE FUNCTION katalist_priv.list_stale_pending_attachments(p_older_than interval DEFAULT interval '24 hours')
RETURNS TABLE (id uuid, staging_key text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
  SELECT t.id, t.staging_key
  FROM public.thing_attachments t
  WHERE t.status = 'pending'
    AND t.created_at < now() - p_older_than;
$$;

REVOKE ALL ON FUNCTION public.reserve_thing_attachment(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_thing_attachment(uuid, uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_thing_attachment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_thing_attachment(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.abandon_pending_attachment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abandon_pending_attachment(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_thing_attachments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_thing_attachments(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION katalist_priv.list_stale_pending_attachments(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION katalist_priv.list_stale_pending_attachments(interval) TO service_role;
