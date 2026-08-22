-- Private FCM subscription + per-device notification outbox.
-- Forward-only. Do not apply automatically.

create table if not exists katalist_priv.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  fcm_token text not null unique,
  platform text not null default 'web' check (platform = 'web'),
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists katalist_priv.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references katalist_priv.push_subscriptions(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'retry', 'dead')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  fcm_message_id text,
  last_error_code text,
  last_error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (notification_id, subscription_id)
);

create index if not exists push_subscriptions_profile_active_idx
  on katalist_priv.push_subscriptions(profile_id, updated_at desc)
  where revoked_at is null;

create index if not exists notification_deliveries_claim_idx
  on katalist_priv.notification_deliveries(next_attempt_at, created_at)
  where status in ('pending', 'retry', 'processing');

alter table katalist_priv.push_subscriptions enable row level security;
alter table katalist_priv.notification_deliveries enable row level security;

revoke all on table katalist_priv.push_subscriptions from public, anon, authenticated;
revoke all on table katalist_priv.notification_deliveries from public, anon, authenticated;
grant all on table katalist_priv.push_subscriptions to service_role;
grant all on table katalist_priv.notification_deliveries to service_role;

drop trigger if exists push_subscriptions_set_updated_at on katalist_priv.push_subscriptions;
create trigger push_subscriptions_set_updated_at
  before update on katalist_priv.push_subscriptions
  for each row execute function public.set_updated_at();

drop trigger if exists notification_deliveries_set_updated_at on katalist_priv.notification_deliveries;
create trigger notification_deliveries_set_updated_at
  before update on katalist_priv.notification_deliveries
  for each row execute function public.set_updated_at();

create or replace function katalist_priv.fanout_notification_deliveries()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'katalist_priv'
as $$
begin
  insert into katalist_priv.notification_deliveries (notification_id, subscription_id, status)
  select NEW.id, s.id, 'pending'
    from katalist_priv.push_subscriptions s
   where s.profile_id = NEW.profile_id
     and s.revoked_at is null
  on conflict (notification_id, subscription_id) do nothing;
  return NEW;
end;
$$;

revoke all on function katalist_priv.fanout_notification_deliveries() from public, anon, authenticated;
grant execute on function katalist_priv.fanout_notification_deliveries() to service_role;

drop trigger if exists notifications_fanout_push on public.notifications;
create trigger notifications_fanout_push
  after insert on public.notifications
  for each row execute function katalist_priv.fanout_notification_deliveries();

create or replace function public.register_push_subscription(
  p_profile_id uuid,
  p_fcm_token text,
  p_user_agent text default null
) returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'katalist_priv'
as $$
declare
  v_id uuid;
  v_token text := btrim(coalesce(p_fcm_token, ''));
begin
  if p_profile_id is null or char_length(v_token) < 20 or char_length(v_token) > 4096 then
    raise exception 'invalid push subscription';
  end if;

  insert into katalist_priv.push_subscriptions (profile_id, fcm_token, user_agent, last_seen_at, revoked_at)
  values (p_profile_id, v_token, nullif(btrim(coalesce(p_user_agent, '')), ''), now(), null)
  on conflict (fcm_token) do update
     set profile_id = excluded.profile_id,
         user_agent = coalesce(excluded.user_agent, katalist_priv.push_subscriptions.user_agent),
         last_seen_at = now(),
         revoked_at = null
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.revoke_push_subscription(
  p_profile_id uuid,
  p_fcm_token text
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'katalist_priv'
as $$
declare
  v_token text := btrim(coalesce(p_fcm_token, ''));
  v_updated integer;
begin
  update katalist_priv.push_subscriptions
     set revoked_at = coalesce(revoked_at, now())
   where profile_id = p_profile_id
     and fcm_token = v_token;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.claim_notification_deliveries(
  p_limit integer,
  p_lease_seconds integer
) returns table (
  delivery_id uuid,
  subscription_id uuid,
  notification_id uuid,
  fcm_token text,
  attempt_count integer,
  kind text,
  title text,
  body text,
  thing_id uuid,
  list_id uuid
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'katalist_priv'
as $$
begin
  if p_limit is null or p_limit < 1 or p_lease_seconds is null or p_lease_seconds < 1 then
    return;
  end if;

  return query
  with picked as (
    select d.id
      from katalist_priv.notification_deliveries d
     where (
            (d.status in ('pending', 'retry') and d.next_attempt_at <= now())
            or (d.status = 'processing' and d.lease_until is not null and d.lease_until < now())
           )
     order by d.next_attempt_at, d.created_at
     limit p_limit
     for update skip locked
  ),
  claimed as (
    update katalist_priv.notification_deliveries d
       set status = 'processing',
           attempt_count = d.attempt_count + 1,
           lease_until = now() + make_interval(secs => p_lease_seconds)
      from picked
     where d.id = picked.id
    returning d.id, d.subscription_id, d.notification_id, d.attempt_count
  )
  select
    c.id,
    c.subscription_id,
    c.notification_id,
    s.fcm_token,
    c.attempt_count,
    n.kind,
    n.title,
    n.body,
    n.thing_id,
    n.list_id
  from claimed c
  join katalist_priv.push_subscriptions s on s.id = c.subscription_id
  join public.notifications n on n.id = c.notification_id;
end;
$$;

create or replace function public.finish_notification_delivery(
  p_delivery_id uuid,
  p_result text,
  p_fcm_message_id text default null,
  p_error_code text default null,
  p_error_detail text default null,
  p_next_attempt_at timestamptz default null,
  p_revoke boolean default false
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'katalist_priv'
as $$
declare
  v_sub uuid;
  v_code text := left(btrim(coalesce(p_error_code, '')), 80);
  v_detail text := left(btrim(coalesce(p_error_detail, '')), 200);
begin
  if p_result not in ('sent', 'retry', 'dead') then
    return false;
  end if;

  if p_result = 'sent' then
    update katalist_priv.notification_deliveries
       set status = 'sent',
           fcm_message_id = nullif(p_fcm_message_id, ''),
           last_error_code = null,
           last_error_detail = null,
           sent_at = now(),
           lease_until = null
     where id = p_delivery_id
       and status = 'processing'
    returning subscription_id into v_sub;
  elsif p_result = 'retry' then
    update katalist_priv.notification_deliveries
       set status = 'retry',
           last_error_code = nullif(v_code, ''),
           last_error_detail = nullif(v_detail, ''),
           next_attempt_at = coalesce(p_next_attempt_at, now() + interval '1 minute'),
           lease_until = null
     where id = p_delivery_id
       and status = 'processing'
    returning subscription_id into v_sub;
  else
    update katalist_priv.notification_deliveries
       set status = 'dead',
           last_error_code = nullif(v_code, ''),
           last_error_detail = nullif(v_detail, ''),
           lease_until = null
     where id = p_delivery_id
       and status = 'processing'
    returning subscription_id into v_sub;
  end if;

  if not found then
    return false;
  end if;

  if p_revoke and v_sub is not null then
    update katalist_priv.push_subscriptions
       set revoked_at = coalesce(revoked_at, now())
     where id = v_sub;
  end if;

  return true;
end;
$$;

revoke all on function public.register_push_subscription(uuid, text, text) from public, anon, authenticated;
revoke all on function public.revoke_push_subscription(uuid, text) from public, anon, authenticated;
revoke all on function public.claim_notification_deliveries(integer, integer) from public, anon, authenticated;
revoke all on function public.finish_notification_delivery(uuid, text, text, text, text, timestamptz, boolean) from public, anon, authenticated;

grant execute on function public.register_push_subscription(uuid, text, text) to service_role;
grant execute on function public.revoke_push_subscription(uuid, text) to service_role;
grant execute on function public.claim_notification_deliveries(integer, integer) to service_role;
grant execute on function public.finish_notification_delivery(uuid, text, text, text, text, timestamptz, boolean) to service_role;

create or replace function public.notification_delivery_status(p_notification_id uuid)
returns table (
  delivery_id uuid,
  status text,
  fcm_message_id text
)
language sql
security definer
set search_path to 'pg_catalog', 'public', 'katalist_priv'
as $$
  select d.id, d.status, d.fcm_message_id
    from katalist_priv.notification_deliveries d
   where d.notification_id = p_notification_id;
$$;

revoke all on function public.notification_delivery_status(uuid) from public, anon, authenticated;
grant execute on function public.notification_delivery_status(uuid) to service_role;
