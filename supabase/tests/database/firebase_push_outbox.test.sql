begin;
select plan(9);

select has_table('katalist_priv', 'push_subscriptions');
select has_table('katalist_priv', 'notification_deliveries');
select table_privs_are('katalist_priv', 'push_subscriptions', 'anon', array[]::text[]);
select table_privs_are('katalist_priv', 'push_subscriptions', 'authenticated', array[]::text[]);
select table_privs_are('katalist_priv', 'notification_deliveries', 'anon', array[]::text[]);
select table_privs_are('katalist_priv', 'notification_deliveries', 'authenticated', array[]::text[]);
select function_privs_are(
  'public', 'claim_notification_deliveries',
  array['integer','integer'], 'authenticated', array[]::text[]
);
select function_privs_are(
  'public', 'register_push_subscription',
  array['uuid','text','text'], 'anon', array[]::text[]
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'finish_notification_delivery'
  ),
  'finish_notification_delivery exists'
);

select * from finish();
rollback;
