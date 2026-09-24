-- T06: the Hub rail needs one latest-message summary per visible DM/group,
-- never the full message history. Invoker rights keep the existing Lists and
-- list_messages RLS policies authoritative.
CREATE OR REPLACE FUNCTION public.get_hub_conversation_page(
  p_limit integer,
  p_cursor_at timestamptz,
  p_cursor_id uuid
)
RETURNS TABLE (
  id uuid,
  name text,
  kind text,
  owner_profile_id uuid,
  updated_at timestamptz,
  last_body text,
  last_kind text,
  last_at timestamptz,
  last_author_profile_id uuid,
  last_has_attachment boolean,
  sort_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = 'pg_catalog','public' AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100
     OR (p_cursor_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid Hub page bounds' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT l.id, l.name, l.kind, l.owner_profile_id, l.updated_at,
      left(m.body, 240), m.kind, m.created_at, m.author_profile_id,
      (m.attachment IS NOT NULL), COALESCE(m.created_at, l.updated_at)
    FROM public.lists l
    LEFT JOIN LATERAL (
      SELECT lm.body, lm.kind, lm.created_at, lm.author_profile_id, lm.attachment
      FROM public.list_messages lm
      WHERE lm.list_id = l.id AND lm.deleted_at IS NULL
      ORDER BY lm.created_at DESC, lm.id DESC
      LIMIT 1
    ) m ON true
    WHERE l.kind IN ('dm', 'group') AND l.archived_at IS NULL
      AND (p_cursor_at IS NULL OR (COALESCE(m.created_at, l.updated_at), l.id) < (p_cursor_at, p_cursor_id))
    ORDER BY COALESCE(m.created_at, l.updated_at) DESC, l.id DESC
    LIMIT p_limit + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_hub_conversation_page(integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hub_conversation_page(integer, timestamptz, uuid) TO authenticated;
NOTIFY pgrst, 'reload schema';
