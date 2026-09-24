-- Reconciled from production (2026-09-25): this migration was already applied
-- to the linked production database (dyxqlgnbwtbxxdfoiqva) but had no local
-- file recorded. Captured verbatim from supabase_migrations.schema_migrations
-- (read-only) to make local history match what is actually live. Do NOT
-- re-apply -- 'supabase migration list' already shows this version present
-- on both sides once this file exists locally.

alter table public.profiles add column if not exists age smallint;

alter table public.profiles add column if not exists occupation text;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'profiles_age_valid'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles add constraint profiles_age_valid
      check (age is null or age between 1 and 120);
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conname = 'profiles_occupation_valid'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles add constraint profiles_occupation_valid
      check (occupation is null or char_length(btrim(occupation)) between 1 and 100);
  end if;
end;
$$;

create table if not exists katalist_priv.uat_auth_rate_limits (
  scope_hash text primary key,
  window_started_at timestamptz not null,
  attempt_count integer not null,
  updated_at timestamptz not null default now(),
  constraint uat_auth_rate_limits_scope_hash_valid
    check (scope_hash ~ '^[0-9a-f]{64}$'),
  constraint uat_auth_rate_limits_attempt_count_valid
    check (attempt_count >= 1)
);

alter table katalist_priv.uat_auth_rate_limits enable row level security;

revoke all on table katalist_priv.uat_auth_rate_limits from public, anon, authenticated;

grant all on table katalist_priv.uat_auth_rate_limits to service_role;

create or replace function public.consume_uat_auth_rate_limit(
  p_scope_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, katalist_priv
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_allowed boolean;
begin
  if p_scope_hash is null or p_scope_hash !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'p_scope_hash must be a lowercase hexadecimal SHA-256 HMAC';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 2147483646 then
    raise exception using
      errcode = '22023',
      message = 'p_limit must be between 1 and 2147483646';
  end if;

  if p_window_seconds is null or p_window_seconds < 1 then
    raise exception using
      errcode = '22023',
      message = 'p_window_seconds must be positive';
  end if;

  -- Lock an existing scope for the shortest possible interval. The upsert below
  -- also handles the missing-row race atomically.
  perform 1
  from katalist_priv.uat_auth_rate_limits
  where scope_hash = p_scope_hash
  for update;

  insert into katalist_priv.uat_auth_rate_limits (
    scope_hash,
    window_started_at,
    attempt_count,
    updated_at
  )
  values (p_scope_hash, v_now, 1, v_now)
  on conflict (scope_hash) do update
  set
    window_started_at = case
      when katalist_priv.uat_auth_rate_limits.window_started_at
        + make_interval(secs => p_window_seconds) <= v_now
        then v_now
      else katalist_priv.uat_auth_rate_limits.window_started_at
    end,
    attempt_count = case
      when katalist_priv.uat_auth_rate_limits.window_started_at
        + make_interval(secs => p_window_seconds) <= v_now
        then 1
      when katalist_priv.uat_auth_rate_limits.attempt_count >= p_limit
        then p_limit + 1
      else katalist_priv.uat_auth_rate_limits.attempt_count + 1
    end,
    updated_at = v_now
  returning attempt_count <= p_limit into v_allowed;

  return v_allowed;
end;
$$;

revoke execute on function public.consume_uat_auth_rate_limit(text, integer, integer)
  from public, anon, authenticated;

grant execute on function public.consume_uat_auth_rate_limit(text, integer, integer)
  to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, katalist_priv
as $$
declare
  v_phone text;
  v_email text;
  v_name text;
  v_age_text text;
  v_age smallint;
  v_occupation text;
  v_uat_profile_complete boolean;
  v_actor uuid;
begin
  v_phone := nullif(coalesce(new.phone, new.raw_user_meta_data ->> 'phone'), '');
  if v_phone is not null and left(v_phone, 1) <> '+' then
    v_phone := '+' || regexp_replace(v_phone, '[^0-9]', '', 'g');
  end if;
  v_email := nullif(new.email, '');
  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    v_email,
    v_phone,
    'Katalist user'
  );
  v_uat_profile_complete :=
    coalesce(new.raw_user_meta_data ->> 'uat_profile_complete', '') = 'true';

  if v_uat_profile_complete then
    v_name := regexp_replace(
      btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')),
      '[[:space:]]+',
      ' ',
      'g'
    );
    if char_length(v_name) not between 1 and 100 then
      raise exception 'UAT profile requires a valid full name';
    end if;

    v_age_text := btrim(coalesce(new.raw_user_meta_data ->> 'age', ''));
    if v_age_text !~ '^[0-9]{1,3}$'
      or v_age_text::integer not between 1 and 120 then
      raise exception 'UAT profile requires an age between 1 and 120';
    end if;
    v_age := v_age_text::smallint;

    v_occupation := regexp_replace(
      btrim(coalesce(new.raw_user_meta_data ->> 'occupation', '')),
      '[[:space:]]+',
      ' ',
      'g'
    );
    if char_length(v_occupation) not between 1 and 100 then
      raise exception 'UAT profile requires a valid occupation';
    end if;
  end if;

  insert into public.profiles (
    id,
    phone_e164,
    email,
    display_name,
    age,
    occupation
  )
  values (
    new.id,
    v_phone,
    v_email,
    v_name,
    v_age,
    v_occupation
  )
  on conflict (id) do nothing;

  -- Claim path first: never mint a second actor for a person who already exists externally.
  v_actor := katalist_priv.claim_external_for_profile(new.id, v_phone, v_email);

  if v_actor is null
    and not exists (select 1 from public.actors a where a.profile_id = new.id) then
    insert into public.actors (kind, profile_id)
    values ('user', new.id)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
