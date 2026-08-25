begin;
select plan(8);

select ok(
  exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'public_identities'
       and c.relkind = 'v'
       and coalesce(c.reloptions::text, '') like '%security_invoker=true%'
  ),
  'public_identities uses security_invoker'
);

select columns_are(
  'public',
  'public_identities',
  array['id', 'display_name', 'avatar_url']
);

select has_function('public', 'resolve_profile_identities', array['uuid[]']);
select has_function('public', 'list_visible_profile_identities', array[]::text[]);

select function_privs_are(
  'public', 'resolve_profile_identities',
  array['uuid[]'], 'anon', array[]::text[]
);
select function_privs_are(
  'public', 'list_visible_profile_identities',
  array[]::text[], 'anon', array[]::text[]
);
select function_privs_are(
  'public', 'resolve_profile_identities',
  array['uuid[]'], 'authenticated', array['EXECUTE']
);
select function_privs_are(
  'public', 'list_visible_profile_identities',
  array[]::text[], 'authenticated', array['EXECUTE']
);

select * from finish();
rollback;
