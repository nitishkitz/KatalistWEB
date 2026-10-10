-- Private Google-contact discovery. Imported identifiers are used for matching
-- inside this transaction, never stored. Only matched profile IDs are retained.
CREATE TABLE public.google_contact_matches (
  owner_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (owner_profile_id, profile_id),
  CHECK (owner_profile_id <> profile_id)
);
CREATE TABLE public.google_contact_syncs (
  owner_profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  synced_at timestamptz NOT NULL DEFAULT now(),
  contact_count integer NOT NULL DEFAULT 0 CHECK (contact_count >= 0),
  matched_count integer NOT NULL DEFAULT 0 CHECK (matched_count >= 0)
);
ALTER TABLE public.google_contact_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_contact_syncs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_contact_matches, public.google_contact_syncs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.google_contact_matches, public.google_contact_syncs TO authenticated;
GRANT ALL ON public.google_contact_matches, public.google_contact_syncs TO service_role;
CREATE POLICY google_contact_matches_owner ON public.google_contact_matches
  FOR SELECT TO authenticated USING (owner_profile_id = auth.uid());
CREATE POLICY google_contact_syncs_owner ON public.google_contact_syncs
  FOR SELECT TO authenticated USING (owner_profile_id = auth.uid());

CREATE FUNCTION public.sync_google_contact_matches(p_owner uuid, p_contacts jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_count integer;
BEGIN
  IF p_owner IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_owner) THEN
    RAISE EXCEPTION 'unknown owner';
  END IF;
  IF jsonb_typeof(p_contacts) <> 'array' OR p_contacts IS NULL OR jsonb_array_length(p_contacts) > 10000 THEN
    RAISE EXCEPTION 'invalid contact snapshot';
  END IF;
  -- Serialize snapshots for the same account. A failed insert rolls back the delete.
  PERFORM 1 FROM public.profiles WHERE id = p_owner FOR UPDATE;
  DELETE FROM public.google_contact_matches WHERE owner_profile_id = p_owner;
  INSERT INTO public.google_contact_matches (owner_profile_id, profile_id)
  WITH matches AS (
    SELECT c->>'resource' AS resource, p.id
    FROM jsonb_array_elements(p_contacts) c
    JOIN public.profiles p ON (
      (lower(btrim(p.email)) NOT LIKE '%.invalid' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(c->'emails') e WHERE e = lower(btrim(p.email))))
      OR (p.phone_e164 IS NOT NULL AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(c->'phones') n WHERE n = p.phone_e164))
    )
    WHERE p.id <> p_owner AND nullif(c->>'resource', '') IS NOT NULL
  ), unique_matches AS (
    -- Ambiguous contacts never silently connect the wrong account.
    SELECT resource, (array_agg(DISTINCT id))[1] AS profile_id
    FROM matches GROUP BY resource HAVING count(DISTINCT id) = 1
  )
  SELECT DISTINCT p_owner, profile_id FROM unique_matches;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.google_contact_syncs (owner_profile_id, synced_at, contact_count, matched_count)
    VALUES (p_owner, now(), jsonb_array_length(p_contacts), v_count)
    ON CONFLICT (owner_profile_id) DO UPDATE SET synced_at = now(), contact_count = EXCLUDED.contact_count,
      matched_count = EXCLUDED.matched_count;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_google_contact_matches(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_google_contact_matches(uuid, jsonb) TO service_role;

-- Enforce discovery eligibility below the UI. Guessing a profile/actor UUID
-- cannot send a connection request to an arbitrary registered user.
CREATE OR REPLACE FUNCTION public.send_contact_request(p_addressee_profile_id uuid)
RETURNS public.contact_requests LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_me uuid := auth.uid(); v_other uuid := p_addressee_profile_id; v_row public.contact_requests;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_other) THEN
    SELECT profile_id INTO v_other FROM public.actors WHERE id = p_addressee_profile_id;
  END IF;
  IF v_other IS NULL OR v_other = v_me THEN RAISE EXCEPTION 'pick another person'; END IF;
  SELECT * INTO v_row FROM public.contact_requests WHERE status = 'accepted'
    AND ((requester_profile_id = v_me AND addressee_profile_id = v_other)
      OR (requester_profile_id = v_other AND addressee_profile_id = v_me)) LIMIT 1;
  IF FOUND THEN RETURN v_row; END IF;
  -- An incoming pending request may be explicitly accepted without Google sync.
  UPDATE public.contact_requests SET status = 'accepted', responded_at = now()
    WHERE requester_profile_id = v_other AND addressee_profile_id = v_me AND status = 'pending'
    RETURNING * INTO v_row;
  IF FOUND THEN RETURN v_row; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.google_contact_matches WHERE owner_profile_id = v_me AND profile_id = v_other) THEN
    RAISE EXCEPTION 'Sync this person from your Google Contacts before connecting';
  END IF;
  INSERT INTO public.contact_requests (requester_profile_id, addressee_profile_id, status)
    VALUES (v_me, v_other, 'pending')
    ON CONFLICT (requester_profile_id, addressee_profile_id) DO UPDATE SET status = 'pending', responded_at = NULL
    RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.send_contact_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_contact_request(uuid) TO authenticated, service_role;
