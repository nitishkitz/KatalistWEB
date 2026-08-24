-- Magic Box v2 attachments: private bucket, RLS via can_view_thing, finalize RPC.
-- Writes go through finalize_thing_attachment. Clients never insert rows directly.

CREATE TABLE public.thing_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thing_id uuid NOT NULL REFERENCES public.things(id) ON DELETE CASCADE,
  uploaded_by_actor_id uuid NOT NULL REFERENCES public.actors(id),
  storage_key text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX thing_attachments_thing_id_idx ON public.thing_attachments (thing_id);

ALTER TABLE public.thing_attachments ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.thing_attachments TO authenticated;
GRANT ALL ON public.thing_attachments TO service_role;

CREATE POLICY "thing attachments visible to thing viewers"
  ON public.thing_attachments FOR SELECT TO authenticated
  USING (katalist_priv.can_view_thing(thing_id));

INSERT INTO storage.buckets (id, name, public)
VALUES ('thing-attachments', 'thing-attachments', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "thing-attachments staging insert" ON storage.objects;
CREATE POLICY "thing-attachments staging insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'thing-attachments'
  AND (storage.foldername(name))[1] = 'staging'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS "thing-attachments staging update" ON storage.objects;
CREATE POLICY "thing-attachments staging update"
ON storage.objects FOR UPDATE
TO authenticated
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
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'thing-attachments'
  AND (storage.foldername(name))[1] = 'staging'
  AND (storage.foldername(name))[2] = auth.uid()::text
);

DROP POLICY IF EXISTS "thing-attachments read" ON storage.objects;
CREATE POLICY "thing-attachments read"
ON storage.objects FOR SELECT
TO authenticated
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

CREATE OR REPLACE FUNCTION public.finalize_thing_attachment(
  p_thing_id uuid,
  p_storage_key text,
  p_file_name text,
  p_mime_type text,
  p_byte_size integer
)
RETURNS public.thing_attachments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv, storage
AS $$
DECLARE
  v_me uuid := katalist_priv.current_actor_id();
  v_uid uuid := auth.uid();
  v_row public.thing_attachments;
  v_final_key text;
  v_safe_name text;
  v_count integer;
BEGIN
  IF v_me IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT katalist_priv.can_view_thing(p_thing_id) THEN
    RAISE EXCEPTION 'Thing not found';
  END IF;
  IF p_storage_key IS NULL
     OR p_storage_key NOT LIKE ('staging/' || v_uid::text || '/%')
     OR position('..' in p_storage_key) > 0 THEN
    RAISE EXCEPTION 'invalid staging key';
  END IF;
  IF p_byte_size IS NULL OR p_byte_size <= 0 OR p_byte_size > 20971520 THEN
    RAISE EXCEPTION 'file too large';
  END IF;
  IF COALESCE(p_file_name, '') = '' THEN
    RAISE EXCEPTION 'invalid file name';
  END IF;

  SELECT count(*) INTO v_count FROM public.thing_attachments WHERE thing_id = p_thing_id;
  IF v_count >= 5 THEN
    RAISE EXCEPTION 'too many attachments';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'thing-attachments' AND o.name = p_storage_key
  ) THEN
    RAISE EXCEPTION 'staging object missing';
  END IF;

  v_safe_name := regexp_replace(p_file_name, '[^\w.\-]+', '_', 'g');
  v_safe_name := left(v_safe_name, 80);
  IF v_safe_name = '' THEN
    v_safe_name := 'file';
  END IF;

  INSERT INTO public.thing_attachments (
    thing_id, uploaded_by_actor_id, storage_key, file_name, mime_type, byte_size
  ) VALUES (
    p_thing_id, v_me, p_storage_key, p_file_name, COALESCE(NULLIF(p_mime_type, ''), 'application/octet-stream'), p_byte_size
  ) RETURNING * INTO v_row;

  v_final_key := 'things/' || p_thing_id::text || '/' || v_row.id::text || '/' || v_safe_name;

  UPDATE storage.objects
     SET name = v_final_key
   WHERE bucket_id = 'thing-attachments'
     AND name = p_storage_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'staging object missing';
  END IF;

  UPDATE public.thing_attachments
     SET storage_key = v_final_key
   WHERE id = v_row.id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_thing_attachment(uuid, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_thing_attachment(uuid, text, text, text, integer) TO authenticated, service_role;
