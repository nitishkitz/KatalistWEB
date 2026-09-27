-- H08: bridge_comment had no idempotency key -- a lost-response Bridge
-- comment submit (the guest never saw the success response, e.g. a flaky
-- mobile connection) always INSERTed a new row on retry, creating a
-- duplicate visible comment. `client_token` is optional so any other
-- INSERT path into thing_comments (there is none today, but this must not
-- assume it stays that way) and a caller that never supplies one are both
-- unaffected. Scoped to (thing_id, author_actor_id) so a legitimate
-- second, distinct comment from the same Bridge session is never blocked
-- -- only a retry carrying the SAME client-generated token is deduplicated.
ALTER TABLE public.thing_comments ADD COLUMN IF NOT EXISTS client_token uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_thing_comments_client_token
  ON public.thing_comments (thing_id, author_actor_id, client_token)
  WHERE client_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.bridge_comment(p_session_token text, p_body text, p_client_token uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_grant public.bridge_grants := katalist_priv.bridge_session_grant(p_session_token);
  v_thing public.things;
  v_body  text := NULLIF(btrim(COALESCE(p_body, '')), '');
  v_id    uuid;
BEGIN
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'a comment cannot be empty';
  END IF;

  SELECT * INTO v_thing FROM public.things WHERE id = v_grant.thing_id;
  IF v_thing.current_assignee_actor_id <> v_grant.actor_id
     OR v_thing.current_assignment_id IS DISTINCT FROM v_grant.assignment_id THEN
    RAISE EXCEPTION 'this link is no longer active';
  END IF;
  IF v_thing.work_status IN ('sorted','cancelled') THEN
    RAISE EXCEPTION 'this Thing is already %', v_thing.work_status;
  END IF;

  IF p_client_token IS NOT NULL THEN
    SELECT c.id INTO v_id
      FROM public.thing_comments c
     WHERE c.thing_id = v_thing.id
       AND c.author_actor_id = v_grant.actor_id
       AND c.client_token = p_client_token;
    IF FOUND THEN
      -- Same retry, same token -- return the comment already created by
      -- the first attempt instead of inserting a second one.
      RETURN v_id;
    END IF;
  END IF;

  INSERT INTO public.thing_comments (thing_id, author_actor_id, body, client_token)
  VALUES (v_thing.id, v_grant.actor_id, v_body, p_client_token)
  ON CONFLICT (thing_id, author_actor_id, client_token)
    WHERE client_token IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL AND p_client_token IS NOT NULL THEN
    -- A concurrent request may have won the unique-key race after our
    -- initial SELECT. Under READ COMMITTED this new statement sees that
    -- committed row and returns the same id rather than a duplicate error.
    SELECT c.id INTO v_id
      FROM public.thing_comments c
     WHERE c.thing_id = v_thing.id
       AND c.author_actor_id = v_grant.actor_id
       AND c.client_token = p_client_token;
  END IF;

  RETURN v_id;
END;
$$;

-- Keep the existing two-argument function during the old-client/new-schema
-- overlap window. Retire it in a later migration after the new API has been
-- deployed and verified. The three-argument form has no default parameter,
-- so PostgREST can resolve either signature unambiguously.

REVOKE EXECUTE ON FUNCTION public.bridge_comment(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bridge_comment(text, text, uuid) TO service_role;
