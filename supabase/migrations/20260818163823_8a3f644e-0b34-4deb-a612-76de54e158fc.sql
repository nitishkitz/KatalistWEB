CREATE OR REPLACE FUNCTION katalist_priv.run_backend_tests()
RETURNS TABLE(ok boolean, test text, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $fn$
DECLARE
  results text[] := '{}';
  v_orig  text := current_setting('role', true);

  owner_id uuid := gen_random_uuid();
  bee_id   uuid := gen_random_uuid();
  cee_id   uuid := gen_random_uuid();
  stranger uuid := gen_random_uuid();
  claimer  uuid := gen_random_uuid();

  a_owner uuid; a_bee uuid; a_cee uuid; a_stranger uuid; a_ext uuid; a_claim uuid;
  ext_id  uuid;
  t_id    uuid;
  l_id    uuid;
  lt_id   uuid;
  c_id    uuid;
  m_id    uuid;
  v_thing public.things;
  v_cnt   int;
  v_txt   text;

  PASS constant text := 'PASS';
BEGIN
  -- =========== helpers as inline code (no nested funcs) ===========
  BEGIN
    -- ---------- fixtures ----------
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
           u.em, jsonb_build_object('display_name', u.nm), now(), now()
      FROM (VALUES
        (owner_id, 'owner@test.katalist', 'Owner'),
        (bee_id,   'bee@test.katalist',   'Bee'),
        (cee_id,   'cee@test.katalist',   'Cee'),
        (stranger, 'stranger@test.katalist', 'Stranger')
      ) AS u(id, em, nm);

    SELECT id INTO a_owner    FROM public.actors WHERE profile_id = owner_id;
    SELECT id INTO a_bee      FROM public.actors WHERE profile_id = bee_id;
    SELECT id INTO a_cee      FROM public.actors WHERE profile_id = cee_id;
    SELECT id INTO a_stranger FROM public.actors WHERE profile_id = stranger;

    -- ===== TEST 1: identity claim reuses the same actor =====
    INSERT INTO public.external_identities (phone_e164, display_name)
    VALUES ('+15550001111', 'Outside Person') RETURNING id INTO ext_id;
    INSERT INTO public.actors (kind, external_identity_id)
    VALUES ('external', ext_id) RETURNING id INTO a_ext;

    INSERT INTO auth.users (id, instance_id, aud, role, phone, raw_user_meta_data, created_at, updated_at)
    VALUES (claimer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            '15550001111', jsonb_build_object('display_name','Claimer','phone','+15550001111'), now(), now());

    SELECT count(*) INTO v_cnt FROM public.actors WHERE profile_id = claimer;
    SELECT id INTO a_claim FROM public.actors WHERE profile_id = claimer;
    results := results || format('%s|identity claim reuses one actor|%s',
      CASE WHEN v_cnt = 1 AND a_claim = a_ext THEN PASS ELSE 'FAIL' END,
      format('actors=%s same_id=%s', v_cnt, a_claim = a_ext));

    SELECT count(*) INTO v_cnt FROM public.external_identities
     WHERE id = ext_id AND claimed_profile_id = claimer AND claimed_at IS NOT NULL;
    results := results || format('%s|external identity marked claimed|', CASE WHEN v_cnt=1 THEN PASS ELSE 'FAIL' END);

    -- ---------- act as Owner ----------
    PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);

    -- Owner creates a standalone Thing and assigns it to Bee.
    t_id := (public.create_thing(p_title => 'Test Thing', p_assignee_actor_id => a_bee,
                                 p_owner_importance => 'now')).id;

    -- ===== TEST 2: creator-only / owner-only visibility, stranger blocked =====
    PERFORM set_config('request.jwt.claims', json_build_object('sub', stranger, 'role','authenticated')::text, true);
    SELECT count(*) INTO v_cnt FROM public.things WHERE id = t_id;
    results := results || format('%s|stranger cannot see the Thing|rows=%s', CASE WHEN v_cnt=0 THEN PASS ELSE 'FAIL' END, v_cnt);

    -- ===== TEST 3: owner (not assignee) cannot Catch / Sort / set pace =====
    PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    BEGIN
      PERFORM public.catch_thing(t_id);
      results := results || format('FAIL|owner cannot Catch|no error raised');
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|owner cannot Catch|%s', PASS, SQLERRM);
    END;
    BEGIN
      PERFORM public.sort_thing(t_id);
      results := results || 'FAIL|owner cannot Sort another holder''s work|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|owner cannot Sort another holder''s work|%s', PASS, SQLERRM);
    END;
    BEGIN
      PERFORM public.set_work_status(t_id, 'under_progress');
      results := results || 'FAIL|owner cannot change holder Work Status|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|owner cannot change holder Work Status|%s', PASS, SQLERRM);
    END;

    -- ---------- act as Bee (current assignee) ----------
    PERFORM set_config('request.jwt.claims', json_build_object('sub', bee_id, 'role','authenticated')::text, true);

    -- ===== TEST 4: pace NULL while waiting, NEXT default on Catch =====
    SELECT * INTO v_thing FROM public.things WHERE id = t_id;
    results := results || format('%s|pace is NULL while waiting for Catch|%s',
      CASE WHEN v_thing.assignee_personal_pace IS NULL THEN PASS ELSE 'FAIL' END, v_thing.assignee_personal_pace);

    v_thing := public.catch_thing(t_id);
    results := results || format('%s|Catch defaults pace to NEXT|%s',
      CASE WHEN v_thing.assignee_personal_pace = 'next' THEN PASS ELSE 'FAIL' END, v_thing.assignee_personal_pace);

    -- ===== TEST 5: importance and pace are independent =====
    v_thing := public.set_personal_pace(t_id, 'later');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    v_thing := public.set_owner_importance(t_id, 'now');
    SELECT * INTO v_thing FROM public.things WHERE id = t_id;
    results := results || format('%s|Owner Importance NOW with Personal Pace LATER|imp=%s pace=%s',
      CASE WHEN v_thing.owner_importance='now' AND v_thing.assignee_personal_pace='later' THEN PASS ELSE 'FAIL' END,
      v_thing.owner_importance, v_thing.assignee_personal_pace);

    -- ===== TEST 6: assignee cannot change importance / due / cancel =====
    PERFORM set_config('request.jwt.claims', json_build_object('sub', bee_id, 'role','authenticated')::text, true);
    BEGIN
      PERFORM public.set_owner_importance(t_id, 'later');
      results := results || 'FAIL|assignee cannot change Owner Importance|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|assignee cannot change Owner Importance|%s', PASS, SQLERRM);
    END;
    BEGIN
      PERFORM public.cancel_thing(t_id, 'nope');
      results := results || 'FAIL|assignee cannot Cancel|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|assignee cannot Cancel|%s', PASS, SQLERRM);
    END;

    -- ===== TEST 7: forward-only work status =====
    PERFORM public.set_work_status(t_id, 'under_progress');
    BEGIN
      PERFORM public.set_work_status(t_id, 'not_started');
      results := results || 'FAIL|Under Progress cannot go back to Not Started|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|Under Progress cannot go back to Not Started|%s', PASS, SQLERRM);
    END;
    BEGIN
      PERFORM public.set_work_status(t_id, 'sorted');
      results := results || 'FAIL|set_work_status refuses terminal states|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|set_work_status refuses terminal states|%s', PASS, SQLERRM);
    END;

    -- ===== TEST 8: comment immutability =====
    INSERT INTO public.thing_comments (thing_id, author_actor_id, body)
    VALUES (t_id, a_bee, 'hello') RETURNING id INTO c_id;
    BEGIN
      UPDATE public.thing_comments SET thing_id = t_id, author_actor_id = a_owner WHERE id = c_id;
      results := results || 'FAIL|comment author cannot be rewritten|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|comment author cannot be rewritten|%s', PASS, SQLERRM);
    END;

    -- ===== TEST 9: reassignment audit + pace/importance behaviour =====
    v_thing := public.reassign_thing(t_id, a_cee);
    results := results || format('%s|reassignment clears pace and waits for Catch|ack=%s pace=%s imp=%s',
      CASE WHEN v_thing.acknowledgement='waiting_for_catch' AND v_thing.assignee_personal_pace IS NULL
             AND v_thing.owner_importance='now' THEN PASS ELSE 'FAIL' END,
      v_thing.acknowledgement, v_thing.assignee_personal_pace, v_thing.owner_importance);

    SELECT count(*) INTO v_cnt FROM public.thing_activity
     WHERE thing_id = t_id AND event = 'reassigned'
       AND detail ->> 'from_actor_id' = a_bee::text
       AND detail ->> 'to_actor_id'   = a_cee::text
       AND (detail ->> 'from_assignment_id') IS NOT NULL
       AND (detail ->> 'to_assignment_id')   IS NOT NULL;
    results := results || format('%s|handover history records real actors|matches=%s',
      CASE WHEN v_cnt=1 THEN PASS ELSE 'FAIL' END, v_cnt);

    -- ===== TEST 10: previous assignee loses access =====
    SELECT count(*) INTO v_cnt FROM public.things WHERE id = t_id;
    results := results || format('%s|previous holder loses access after handover|rows=%s',
      CASE WHEN v_cnt=0 THEN PASS ELSE 'FAIL' END, v_cnt);

    -- ===== TEST 11: creator-only grants nothing =====
    PERFORM set_config('request.jwt.claims', json_build_object('sub', cee_id, 'role','authenticated')::text, true);
    lt_id := (public.create_thing(p_title => 'Handed off', p_assignee_actor_id => a_owner)).id;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    PERFORM public.reassign_thing(lt_id, a_stranger);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', cee_id, 'role','authenticated')::text, true);
    SELECT count(*) INTO v_cnt FROM public.things WHERE id = lt_id;
    results := results || format('%s|creator alone cannot see the Thing|rows=%s',
      CASE WHEN v_cnt=0 THEN PASS ELSE 'FAIL' END, v_cnt);

    -- ===== TEST 12: Lists, roles and promotion integrity =====
    PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    l_id := (public.create_list('Test List', 'work')).id;
    PERFORM public.add_list_member(l_id, bee_id, 'collaborator');
    PERFORM public.add_list_member(l_id, cee_id, 'view_only');

    -- Collaborator creates a Thing in the List: they own it, not the List Owner.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', bee_id, 'role','authenticated')::text, true);
    lt_id := (public.create_thing(p_title => 'List Thing', p_assignee_actor_id => a_bee, p_list_id => l_id)).id;
    SELECT * INTO v_thing FROM public.things WHERE id = lt_id;
    results := results || format('%s|Collaborator who creates a List Thing owns it|owner_is_creator=%s',
      CASE WHEN v_thing.owner_actor_id = a_bee AND v_thing.creator_actor_id = a_bee THEN PASS ELSE 'FAIL' END,
      v_thing.owner_actor_id = a_bee);

    -- View Only cannot post into List Chat.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', cee_id, 'role','authenticated')::text, true);
    BEGIN
      INSERT INTO public.list_messages (list_id, author_profile_id, body) VALUES (l_id, cee_id, 'hi');
      results := results || 'FAIL|View Only cannot post in List Chat|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|View Only cannot post in List Chat|%s', PASS, SQLERRM);
    END;
    -- View Only can read the List Thing.
    SELECT count(*) INTO v_cnt FROM public.things WHERE id = lt_id;
    results := results || format('%s|View Only can read Things in the List|rows=%s',
      CASE WHEN v_cnt=1 THEN PASS ELSE 'FAIL' END, v_cnt);
    -- View Only cannot change Work Status.
    BEGIN
      PERFORM public.set_work_status(lt_id, 'under_progress');
      results := results || 'FAIL|View Only cannot change Work Status|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|View Only cannot change Work Status|%s', PASS, SQLERRM);
    END;

    -- List message immutability.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    INSERT INTO public.list_messages (list_id, author_profile_id, body)
    VALUES (l_id, owner_id, 'owner message') RETURNING id INTO m_id;
    BEGIN
      UPDATE public.list_messages SET author_profile_id = bee_id WHERE id = m_id;
      results := results || 'FAIL|List message author cannot be rewritten|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|List message author cannot be rewritten|%s', PASS, SQLERRM);
    END;

    -- Promotion using an unrelated Thing must be rejected.
    BEGIN
      PERFORM public.promote_thing_person_to_list(t_id, l_id, 'collaborator');
      results := results || 'FAIL|promotion rejects a Thing outside the List|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|promotion rejects a Thing outside the List|%s', PASS, SQLERRM);
    END;

    -- ===== TEST 13: personal Shred rules =====
    BEGIN
      PERFORM public.shred_for_me('thing', t_id);
      results := results || 'FAIL|active responsibility cannot be Shredded|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|active responsibility cannot be Shredded|%s', PASS, SQLERRM);
    END;

    -- ===== TEST 14: private activity never leaks into shared history =====
    SELECT count(*) INTO v_cnt FROM public.thing_activity
     WHERE event::text IN ('bucket_ref_added','bucket_ref_removed','shredded','restored',
                           'breakthrough_snoozed','breakthrough_dismissed');
    results := results || format('%s|private events never enter shared history|rows=%s',
      CASE WHEN v_cnt=0 THEN PASS ELSE 'FAIL' END, v_cnt);

    -- ===== TEST 15: one canonical Thing row =====
    SELECT count(*) INTO v_cnt FROM public.things WHERE title = 'Test Thing';
    results := results || format('%s|exactly one canonical Thing row|rows=%s',
      CASE WHEN v_cnt=1 THEN PASS ELSE 'FAIL' END, v_cnt);

    PERFORM set_config('role', COALESCE(v_orig, 'none'), true);
    -- Roll every fixture back; the accumulated results survive in the variable.
    RAISE EXCEPTION 'KATALIST_TESTS_DONE';

  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'KATALIST_TESTS_DONE' THEN
      results := results || format('FAIL|test harness aborted|%s', SQLERRM);
    END IF;
  END;

  PERFORM set_config('role', COALESCE(v_orig, 'none'), true);

  FOREACH v_txt IN ARRAY results LOOP
    ok     := split_part(v_txt, '|', 1) = 'PASS';
    test   := split_part(v_txt, '|', 2);
    detail := split_part(v_txt, '|', 3);
    RETURN NEXT;
  END LOOP;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION katalist_priv.run_backend_tests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION katalist_priv.run_backend_tests() TO service_role;