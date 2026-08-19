CREATE OR REPLACE FUNCTION katalist_priv.run_backend_tests()
RETURNS TABLE(ok boolean, test text, detail text)
LANGUAGE plpgsql
SECURITY INVOKER
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
  h_id    uuid;
  c_id    uuid;
  m_id    uuid;
  v_thing public.things;
  v_cnt   int;
  v_txt   text;

  PASS constant text := 'PASS';
BEGIN
  BEGIN
    PERFORM katalist_priv.test_seed_user(owner_id, 'owner@test.katalist', NULL, 'Owner');
    PERFORM katalist_priv.test_seed_user(bee_id,   'bee@test.katalist',   NULL, 'Bee');
    PERFORM katalist_priv.test_seed_user(cee_id,   'cee@test.katalist',   NULL, 'Cee');
    PERFORM katalist_priv.test_seed_user(stranger, 'stranger@test.katalist', NULL, 'Stranger');

    SELECT id INTO a_owner    FROM public.actors WHERE profile_id = owner_id;
    SELECT id INTO a_bee      FROM public.actors WHERE profile_id = bee_id;
    SELECT id INTO a_cee      FROM public.actors WHERE profile_id = cee_id;
    SELECT id INTO a_stranger FROM public.actors WHERE profile_id = stranger;

    INSERT INTO public.external_identities (phone_e164, display_name)
    VALUES ('+15550001111', 'Outside Person') RETURNING id INTO ext_id;
    INSERT INTO public.actors (kind, external_identity_id)
    VALUES ('external', ext_id) RETURNING id INTO a_ext;

    PERFORM katalist_priv.test_seed_user(claimer, NULL, '15550001111', 'Claimer');

    SELECT count(*) INTO v_cnt FROM public.actors WHERE profile_id = claimer;
    SELECT id INTO a_claim FROM public.actors WHERE profile_id = claimer;
    results := results || format('%s|identity claim reuses one actor|actors=%s same_id=%s',
      CASE WHEN v_cnt = 1 AND a_claim = a_ext THEN PASS ELSE 'FAIL' END, v_cnt, a_claim = a_ext);

    SELECT count(*) INTO v_cnt FROM public.external_identities
     WHERE id = ext_id AND claimed_profile_id = claimer AND claimed_at IS NOT NULL;
    results := results || format('%s|external identity marked claimed|rows=%s', CASE WHEN v_cnt=1 THEN PASS ELSE 'FAIL' END, v_cnt);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);

    t_id := (public.create_thing(p_title => 'Test Thing', p_assignee_actor_id => a_bee,
                                 p_owner_importance => 'now')).id;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', stranger, 'role','authenticated')::text, true);
    SELECT count(*) INTO v_cnt FROM public.things WHERE id = t_id;
    results := results || format('%s|stranger cannot see the Thing|rows=%s', CASE WHEN v_cnt=0 THEN PASS ELSE 'FAIL' END, v_cnt);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    BEGIN
      PERFORM public.catch_thing(t_id);
      results := results || 'FAIL|owner cannot Catch|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|owner cannot Catch|%s', PASS, SQLERRM);
    END;
    BEGIN
      PERFORM public.sort_thing(t_id);
      results := results || 'FAIL|owner cannot Sort another holder work|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|owner cannot Sort another holder work|%s', PASS, SQLERRM);
    END;
    BEGIN
      PERFORM public.set_work_status(t_id, 'under_progress');
      results := results || 'FAIL|owner cannot change holder Work Status|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|owner cannot change holder Work Status|%s', PASS, SQLERRM);
    END;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', bee_id, 'role','authenticated')::text, true);

    SELECT * INTO v_thing FROM public.things WHERE id = t_id;
    results := results || format('%s|pace is NULL while waiting for Catch|pace=%s',
      CASE WHEN v_thing.assignee_personal_pace IS NULL THEN PASS ELSE 'FAIL' END, v_thing.assignee_personal_pace);

    v_thing := public.catch_thing(t_id);
    results := results || format('%s|Catch defaults pace to NEXT|pace=%s',
      CASE WHEN v_thing.assignee_personal_pace = 'next' THEN PASS ELSE 'FAIL' END, v_thing.assignee_personal_pace);

    v_thing := public.set_personal_pace(t_id, 'later');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    v_thing := public.set_owner_importance(t_id, 'now');
    SELECT * INTO v_thing FROM public.things WHERE id = t_id;
    results := results || format('%s|Owner Importance NOW with Personal Pace LATER|imp=%s pace=%s',
      CASE WHEN v_thing.owner_importance='now' AND v_thing.assignee_personal_pace='later' THEN PASS ELSE 'FAIL' END,
      v_thing.owner_importance, v_thing.assignee_personal_pace);

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

    INSERT INTO public.thing_comments (thing_id, author_actor_id, body)
    VALUES (t_id, a_bee, 'hello') RETURNING id INTO c_id;
    BEGIN
      UPDATE public.thing_comments SET author_actor_id = a_owner WHERE id = c_id;
      results := results || 'FAIL|comment author cannot be rewritten|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|comment author cannot be rewritten|%s', PASS, SQLERRM);
    END;

    v_thing := public.reassign_thing(t_id, a_cee);
    results := results || format('%s|handover resets holder state, keeps Owner Importance|ack=%s pace=%s status=%s imp=%s',
      CASE WHEN v_thing.acknowledgement='waiting_for_catch' AND v_thing.assignee_personal_pace IS NULL
             AND v_thing.work_status='not_started' AND v_thing.owner_importance='now' THEN PASS ELSE 'FAIL' END,
      v_thing.acknowledgement, v_thing.assignee_personal_pace, v_thing.work_status, v_thing.owner_importance);

    SELECT count(*) INTO v_cnt FROM public.things WHERE id = t_id;
    results := results || format('%s|previous holder loses access after handover|rows=%s',
      CASE WHEN v_cnt=0 THEN PASS ELSE 'FAIL' END, v_cnt);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    SELECT count(*) INTO v_cnt FROM public.thing_activity ta
     WHERE ta.thing_id = t_id AND ta.event = 'reassigned'
       AND ta.detail ->> 'from_actor_id' = a_bee::text
       AND ta.detail ->> 'to_actor_id'   = a_cee::text
       AND (ta.detail ->> 'from_assignment_id') IS NOT NULL
       AND (ta.detail ->> 'to_assignment_id')   IS NOT NULL;
    results := results || format('%s|handover history records real actors|matches=%s',
      CASE WHEN v_cnt=1 THEN PASS ELSE 'FAIL' END, v_cnt);

    -- creator alone grants nothing
    PERFORM set_config('request.jwt.claims', json_build_object('sub', cee_id, 'role','authenticated')::text, true);
    h_id := (public.create_thing(p_title => 'Handed off', p_assignee_actor_id => a_owner)).id;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    PERFORM public.catch_thing(h_id);
    PERFORM public.reassign_thing(h_id, a_stranger);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', cee_id, 'role','authenticated')::text, true);
    SELECT count(*) INTO v_cnt FROM public.things WHERE id = h_id;
    results := results || format('%s|creator alone cannot see the Thing|rows=%s',
      CASE WHEN v_cnt=0 THEN PASS ELSE 'FAIL' END, v_cnt);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    l_id := (public.create_list('Test List', 'work')).id;
    PERFORM public.add_list_member(l_id, bee_id, 'collaborator');
    PERFORM public.add_list_member(l_id, cee_id, 'view_only');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', bee_id, 'role','authenticated')::text, true);
    lt_id := (public.create_thing(p_title => 'List Thing', p_assignee_actor_id => a_bee, p_list_id => l_id)).id;
    SELECT * INTO v_thing FROM public.things WHERE id = lt_id;
    results := results || format('%s|Collaborator who creates a List Thing owns it|owner_is_creator=%s',
      CASE WHEN v_thing.owner_actor_id = a_bee AND v_thing.creator_actor_id = a_bee THEN PASS ELSE 'FAIL' END,
      v_thing.owner_actor_id = a_bee);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', cee_id, 'role','authenticated')::text, true);
    BEGIN
      INSERT INTO public.list_messages (list_id, author_profile_id, body) VALUES (l_id, cee_id, 'hi');
      results := results || 'FAIL|View Only cannot post in List Chat|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|View Only cannot post in List Chat|%s', PASS, SQLERRM);
    END;
    SELECT count(*) INTO v_cnt FROM public.things WHERE id = lt_id;
    results := results || format('%s|View Only can read Things in the List|rows=%s',
      CASE WHEN v_cnt=1 THEN PASS ELSE 'FAIL' END, v_cnt);
    BEGIN
      PERFORM public.set_work_status(lt_id, 'under_progress');
      results := results || 'FAIL|View Only cannot change Work Status|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|View Only cannot change Work Status|%s', PASS, SQLERRM);
    END;
    BEGIN
      PERFORM public.reassign_thing(lt_id, a_cee);
      results := results || 'FAIL|View Only cannot reassign|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|View Only cannot reassign|%s', PASS, SQLERRM);
    END;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role','authenticated')::text, true);
    INSERT INTO public.list_messages (list_id, author_profile_id, body)
    VALUES (l_id, owner_id, 'owner message') RETURNING id INTO m_id;
    BEGIN
      UPDATE public.list_messages SET author_profile_id = bee_id WHERE id = m_id;
      results := results || 'FAIL|List message author cannot be rewritten|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|List message author cannot be rewritten|%s', PASS, SQLERRM);
    END;

    BEGIN
      PERFORM public.promote_thing_person_to_list(t_id, l_id, 'collaborator');
      results := results || 'FAIL|promotion rejects a Thing outside the List|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|promotion rejects a Thing outside the List|%s', PASS, SQLERRM);
    END;

    BEGIN
      PERFORM public.shred_for_me('thing', t_id);
      results := results || 'FAIL|active responsibility cannot be Shredded|no error raised';
    EXCEPTION WHEN OTHERS THEN
      results := results || format('%s|active responsibility cannot be Shredded|%s', PASS, SQLERRM);
    END;

    SELECT count(*) INTO v_cnt FROM public.thing_activity ta
     WHERE ta.event::text IN ('bucket_ref_added','bucket_ref_removed','shredded','restored',
                              'breakthrough_snoozed','breakthrough_dismissed');
    results := results || format('%s|private events never enter shared history|rows=%s',
      CASE WHEN v_cnt=0 THEN PASS ELSE 'FAIL' END, v_cnt);

    PERFORM set_config('role', COALESCE(v_orig, 'none'), true);
    SELECT count(*) INTO v_cnt FROM public.things WHERE title = 'Test Thing';
    results := results || format('%s|exactly one canonical Thing row|rows=%s',
      CASE WHEN v_cnt=1 THEN PASS ELSE 'FAIL' END, v_cnt);

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