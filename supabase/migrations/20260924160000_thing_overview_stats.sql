-- T06: one bounded, invoker/RLS-scoped aggregate for overview badges and
-- one preview descriptor per Thing. This never returns comment bodies or
-- all attachment rows. The caller supplies the local read watermark only;
-- the self actor is derived from auth.uid(), not from a spoofable argument.

CREATE INDEX IF NOT EXISTS idx_thing_attachments_overview
  ON public.thing_attachments (thing_id, created_at, id)
  WHERE status = 'ready' AND storage_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_thing_overview_stats(
  p_thing_ids uuid[],
  p_last_reads timestamptz[],
  p_context public.context_kind
)
RETURNS TABLE (
  thing_id uuid,
  comment_count integer,
  unread_comment_count integer,
  attachment_count integer,
  preview_attachment jsonb
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = 'pg_catalog','public' AS $$
BEGIN
  IF p_context IS NULL OR p_thing_ids IS NULL OR cardinality(p_thing_ids) < 1
     OR cardinality(p_thing_ids) > 500 THEN
    RAISE EXCEPTION 'expected 1..500 Thing IDs and a context' USING ERRCODE = '22023';
  END IF;
  IF p_last_reads IS NULL OR cardinality(p_last_reads) <> cardinality(p_thing_ids) THEN
    RAISE EXCEPTION 'read watermark count must match Thing IDs' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_thing_ids) id WHERE id IS NULL) THEN
    RAISE EXCEPTION 'Thing IDs cannot be null' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
    WITH requested AS (
      SELECT DISTINCT ON (p_thing_ids[i])
        p_thing_ids[i] AS id, p_last_reads[i] AS last_read
      FROM generate_subscripts(p_thing_ids, 1) AS i
      ORDER BY p_thing_ids[i], i DESC
    ),
    self_actor AS (
      SELECT a.id FROM public.actors a WHERE a.profile_id = auth.uid() LIMIT 1
    )
    SELECT t.id,
      c.total::integer,
      c.unread::integer,
      a.total::integer,
      preview.file
    FROM requested r
    JOIN public.things t ON t.id = r.id AND t.context = p_context
    CROSS JOIN LATERAL (
      SELECT count(*) AS total,
        count(*) FILTER (
          WHERE c.author_actor_id IS DISTINCT FROM (SELECT id FROM self_actor)
            AND (r.last_read IS NULL OR c.created_at > r.last_read)
        ) AS unread
      FROM public.thing_comments c
      WHERE c.thing_id = t.id AND c.deleted_at IS NULL
    ) c
    CROSS JOIN LATERAL (
      SELECT count(*) AS total FROM public.thing_attachments a
      WHERE a.thing_id = t.id AND a.status = 'ready' AND a.storage_key IS NOT NULL
    ) a
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'id', a.id, 'storage_key', a.storage_key, 'file_name', a.file_name,
        'mime_type', a.mime_type, 'byte_size', a.byte_size
      ) AS file
      FROM public.thing_attachments a
      WHERE a.thing_id = t.id AND a.status = 'ready' AND a.storage_key IS NOT NULL
      ORDER BY a.created_at, a.id LIMIT 1
    ) preview ON true;
END;
$$;

REVOKE ALL ON FUNCTION public.get_thing_overview_stats(uuid[], timestamptz[], public.context_kind)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_thing_overview_stats(uuid[], timestamptz[], public.context_kind)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
