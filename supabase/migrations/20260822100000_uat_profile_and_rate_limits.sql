-- UAT required profile fields + service-role-only auth rate limiting.
-- Forward-only. Do not apply automatically.

alter table public.profiles add column if not exists age smallint;
alter table public.profiles add column if not exists occupation text;

alter table public.profiles drop constraint if exists profiles_age_valid;
alter table public.profiles add constraint profiles_age_valid
  check (age is null or age between 1 and 120);

alter table public.profiles drop constraint if exists profiles_occupation_valid;
alter table public.profiles add constraint profiles_occupation_valid
  check (occupation is null or char_length(btrim(occupation)) between 1 and 100);

create table if not exists katalist_priv.uat_auth_rate_limits (
  scope_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table katalist_priv.uat_auth_rate_limits enable row level security;
revoke all on table katalist_priv.uat_auth_rate_limits from public, anon, authenticated;
grant all on table katalist_priv.uat_auth_rate_limits to service_role;

create or replace function public.consume_uat_auth_rate_limit(
  p_scope_hash text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'katalist_priv'
as $$
declare
  v_row katalist_priv.uat_auth_rate_limits;
  v_now timestamptz := now();
begin
  if p_scope_hash is null or length(p_scope_hash) < 8
     or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds < 1 then
    return false;
  end if;

  insert into katalist_priv.uat_auth_rate_limits (scope_hash, window_started_at, attempt_count, updated_at)
  values (p_scope_hash, v_now, 0, v_now)
  on conflict (scope_hash) do nothing;

  select * into v_row
    from katalist_priv.uat_auth_rate_limits
   where scope_hash = p_scope_hash
   for update;

  if v_now - v_row.window_started_at >= make_interval(secs => p_window_seconds) then
    update katalist_priv.uat_auth_rate_limits
       set window_started_at = v_now,
           attempt_count = 1,
           updated_at = v_now
     where scope_hash = p_scope_hash;
    return true;
  end if;

  if v_row.attempt_count >= p_limit then
    return false;
  end if;

  update katalist_priv.uat_auth_rate_limits
     set attempt_count = attempt_count + 1,
         updated_at = v_now
   where scope_hash = p_scope_hash;
  return true;
end;
$$;

revoke all on function public.consume_uat_auth_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_uat_auth_rate_limit(text, integer, integer) to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'katalist_priv'
as $$
declare
  v_phone text;
  v_email text;
  v_name  text;
  v_actor uuid;
  v_age smallint;
  v_occupation text;
  v_uat boolean;
begin
  v_phone := nullif(coalesce(NEW.phone, NEW.raw_user_meta_data ->> 'phone'), '');
  if v_phone is not null and left(v_phone, 1) <> '+' then
    v_phone := '+' || regexp_replace(v_phone, '[^0-9]', '', 'g');
  end if;
  v_email := nullif(NEW.email, '');
  v_uat := coalesce(NEW.raw_user_meta_data ->> 'uat_profile_complete', '') in ('true', 't');

  if v_uat then
    v_name := nullif(btrim(regexp_replace(coalesce(
      NEW.raw_user_meta_data ->> 'full_name',
      NEW.raw_user_meta_data ->> 'display_name',
      ''
    ), '\s+', ' ', 'g')), '');
    begin
      v_age := (NEW.raw_user_meta_data ->> 'age')::smallint;
    exception when others then
      v_age := null;
    end;
    v_occupation := nullif(btrim(regexp_replace(coalesce(NEW.raw_user_meta_data ->> 'occupation', ''), '\s+', ' ', 'g')), '');
    if v_name is null or char_length(v_name) not between 1 and 100
       or v_age is null or v_age not between 1 and 120
       or v_occupation is null or char_length(v_occupation) not between 1 and 100 then
      raise exception 'uat profile is incomplete';
    end if;
  else
    v_name := coalesce(
      nullif(NEW.raw_user_meta_data ->> 'display_name', ''),
      nullif(NEW.raw_user_meta_data ->> 'full_name', ''),
      v_email, v_phone, 'Katalist user'
    );
    begin
      v_age := nullif(NEW.raw_user_meta_data ->> 'age', '')::smallint;
    exception when others then
      v_age := null;
    end;
    v_occupation := nullif(btrim(coalesce(NEW.raw_user_meta_data ->> 'occupation', '')), '');
  end if;

  insert into public.profiles (id, phone_e164, email, display_name, age, occupation)
  values (NEW.id, v_phone, v_email, v_name, v_age, v_occupation)
  on conflict (id) do nothing;

  v_actor := katalist_priv.claim_external_for_profile(NEW.id, v_phone, v_email);

  if v_actor is null and not exists (select 1 from public.actors a where a.profile_id = NEW.id) then
    insert into public.actors (kind, profile_id)
    values ('user', NEW.id)
    on conflict do nothing;
  end if;

  return NEW;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
