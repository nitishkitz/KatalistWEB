-- T06: exact List counters without transferring every member Thing row.
-- Counts reflect exactly the Things visible through existing RLS, matching
-- the former client-side SELECT of id/list_id/work_status.
CREATE OR REPLACE FUNCTION public.get_list_overview_counts(p_list_ids uuid[])
RETURNS TABLE (
  list_id uuid,
  thing_count integer,
  done_count integer,
  in_progress_count integer
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = 'pg_catalog','public' AS $$
BEGIN
  IF p_list_ids IS NULL OR cardinality(p_list_ids) < 1 OR cardinality(p_list_ids) > 500
     OR EXISTS (SELECT 1 FROM unnest(p_list_ids) id WHERE id IS NULL) THEN
    RAISE EXCEPTION 'expected 1..500 List IDs' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT l.id,
      count(t.id)::integer,
      count(t.id) FILTER (WHERE t.work_status = 'sorted')::integer,
      count(t.id) FILTER (WHERE t.work_status = 'under_progress')::integer
    FROM (SELECT DISTINCT unnest(p_list_ids) AS id) requested
    JOIN public.lists l ON l.id = requested.id
    LEFT JOIN public.things t ON t.list_id = l.id
    GROUP BY l.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_list_overview_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_list_overview_counts(uuid[]) TO authenticated;
NOTIFY pgrst, 'reload schema';
