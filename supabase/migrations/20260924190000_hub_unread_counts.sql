-- T06: one viewer-specific count request for a bounded Hub page, rather
-- than one HEAD count per unread row. Read watermarks remain device-local;
-- callers provide only the timestamp, never the viewer identity.
CREATE OR REPLACE FUNCTION public.get_hub_unread_counts(
  p_list_ids uuid[], p_last_reads timestamptz[]
)
RETURNS TABLE (list_id uuid, unread_count integer, mention_count integer)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = 'pg_catalog','public' AS $$
BEGIN
  IF p_list_ids IS NULL OR cardinality(p_list_ids) < 1 OR cardinality(p_list_ids) > 100
     OR p_last_reads IS NULL OR cardinality(p_last_reads) <> cardinality(p_list_ids)
     OR EXISTS (SELECT 1 FROM unnest(p_list_ids) id WHERE id IS NULL) THEN
    RAISE EXCEPTION 'invalid Hub unread-count inputs' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    WITH requested AS (
      SELECT DISTINCT ON (p_list_ids[i]) p_list_ids[i] AS id, p_last_reads[i] AS last_read
      FROM generate_subscripts(p_list_ids, 1) AS i
      ORDER BY p_list_ids[i], i DESC
    )
    SELECT l.id,
      count(m.id) FILTER (
        WHERE m.author_profile_id <> auth.uid()
          AND (r.last_read IS NULL OR m.created_at > r.last_read)
      )::integer,
      count(m.id) FILTER (
        WHERE m.author_profile_id <> auth.uid()
          AND (r.last_read IS NULL OR m.created_at > r.last_read)
          AND m.mentioned_profile_ids @> ARRAY[auth.uid()]
      )::integer
    FROM requested r
    JOIN public.lists l ON l.id = r.id AND l.kind IN ('dm','group') AND l.archived_at IS NULL
    LEFT JOIN public.list_messages m ON m.list_id = l.id AND m.deleted_at IS NULL
    GROUP BY l.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_hub_unread_counts(uuid[], timestamptz[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hub_unread_counts(uuid[], timestamptz[]) TO authenticated;
NOTIFY pgrst, 'reload schema';
