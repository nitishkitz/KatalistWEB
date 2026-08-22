begin;
select plan(7);

select has_column('public', 'profiles', 'age');
select has_column('public', 'profiles', 'occupation');
select has_table('katalist_priv', 'uat_auth_rate_limits');
select function_privs_are(
  'public', 'consume_uat_auth_rate_limit',
  array['text','integer','integer'], 'anon', array[]::text[]
);
select function_privs_are(
  'public', 'consume_uat_auth_rate_limit',
  array['text','integer','integer'], 'authenticated', array[]::text[]
);

select lives_ok(
  $$
    insert into auth.users (
      id, instance_id, aud, role, phone, encrypted_password,
      email_confirmed_at, phone_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      '919876543210',
      crypt('test-password', gen_salt('bf')),
      now(),
      now(),
      '{"provider":"phone","providers":["phone"]}'::jsonb,
      jsonb_build_object(
        'full_name', 'Naga Reddy',
        'display_name', 'Naga Reddy',
        'age', 29,
        'occupation', 'Designer',
        'uat_profile_complete', true
      ),
      now(),
      now()
    )
  $$,
  'uat metadata creates an auth user'
);

select ok(
  exists (
    select 1
      from public.profiles p
      join public.actors a on a.profile_id = p.id
     where p.id = '11111111-1111-4111-8111-111111111111'
       and p.display_name = 'Naga Reddy'
       and p.age = 29
       and p.occupation = 'Designer'
       and a.kind = 'user'
  ),
  'uat signup creates one profile and one user actor with required fields'
);

select * from finish();
rollback;
