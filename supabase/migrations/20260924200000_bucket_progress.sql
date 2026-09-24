-- T06: exact UNIQUE progress across direct Thing references and referenced
-- Lists without transferring each member Thing row to the client.
CREATE OR REPLACE FUNCTION public.get_bucket_progress(p_bucket_ids uuid[])
RETURNS TABLE (bucket_id uuid, progress_completed integer, progress_total integer)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = 'pg_catalog','public' AS $$
BEGIN
  IF p_bucket_ids IS NULL OR cardinality(p_bucket_ids) < 1 OR cardinality(p_bucket_ids) > 500
     OR EXISTS (SELECT 1 FROM unnest(p_bucket_ids) id WHERE id IS NULL) THEN
    RAISE EXCEPTION 'expected 1..500 Bucket IDs' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    WITH requested AS (SELECT DISTINCT unnest(p_bucket_ids) AS id),
    candidates AS (
      SELECT bi.bucket_id, t.id AS thing_id, t.work_status
      FROM public.bucket_items bi
      JOIN public.things t ON t.id = bi.thing_id
      JOIN requested r ON r.id = bi.bucket_id
      UNION
      SELECT bi.bucket_id, t.id AS thing_id, t.work_status
      FROM public.bucket_items bi
      JOIN public.things t ON t.list_id = bi.list_id
      JOIN requested r ON r.id = bi.bucket_id
    )
    SELECT b.id,
      count(c.thing_id) FILTER (WHERE c.work_status = 'sorted')::integer,
      count(c.thing_id) FILTER (WHERE c.work_status <> 'cancelled')::integer
    FROM requested r
    JOIN public.buckets b ON b.id = r.id
    LEFT JOIN candidates c ON c.bucket_id = b.id
    GROUP BY b.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_bucket_progress(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bucket_progress(uuid[]) TO authenticated;
NOTIFY pgrst, 'reload schema';
