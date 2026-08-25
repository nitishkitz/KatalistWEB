-- Collaboration notifications, trusted push paths, and private Bucket pinning.
-- Forward-only; apply to UAT outside the Netlify build.

alter table public.buckets
  add column if not exists pinned_at timestamptz;

create or replace function public.set_bucket_pinned(p_bucket_id uuid, p_pinned boolean)
returns public.buckets
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'katalist_priv'
as $$
declare
  v_bucket public.buckets;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.buckets
     set pinned_at = case when coalesce(p_pinned, false) then clock_timestamp() else null end
   where id = p_bucket_id
     and owner_profile_id = auth.uid()
  returning * into v_bucket;
  if not found then raise exception 'Bucket not found'; end if;
  return v_bucket;
end;
$$;

revoke execute on function public.set_bucket_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_bucket_pinned(uuid, boolean) to authenticated, service_role;

create or replace function katalist_priv.notify_profile(
  p_profile_id uuid,
  p_kind text,
  p_title text,
  p_body text default null,
  p_actor_profile_id uuid default null,
  p_thing_id uuid default null,
  p_list_id uuid default null,
  p_path text default '/',
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'katalist_priv'
as $$
declare
  v_id uuid;
  v_actor_id uuid;
begin
  if p_profile_id is null or p_profile_id = p_actor_profile_id then return null; end if;
  if p_path <> '/'
     and p_path <> '/team'
     and p_path !~ '^/lists/[0-9a-f-]{36}$'
     and p_path !~ '^/\?thing=[0-9a-f-]{36}$' then
    raise exception 'unsafe notification path';
  end if;
  select id into v_actor_id from public.actors where profile_id = p_actor_profile_id;
  insert into public.notifications(profile_id, kind, title, body, thing_id, list_id, actor_id, payload)
  values (
    p_profile_id, left(p_kind, 80), left(p_title, 160), nullif(left(coalesce(p_body, ''), 500), ''),
    p_thing_id, p_list_id, v_actor_id,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('path', p_path)
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function katalist_priv.notify_list_participants(
  p_list_id uuid,
  p_excluded_profile_ids uuid[],
  p_kind text,
  p_title text,
  p_body text,
  p_actor_profile_id uuid,
  p_path text,
  p_payload jsonb default '{}'::jsonb
) returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'katalist_priv'
as $$
declare
  v_recipient uuid;
  v_count integer := 0;
begin
  for v_recipient in
    select distinct profile_id
      from (
        select l.owner_profile_id as profile_id from public.lists l where l.id = p_list_id
        union
        select m.profile_id from public.list_members m where m.list_id = p_list_id
      ) participants
     where profile_id is not null
       and not (profile_id = any(coalesce(p_excluded_profile_ids, '{}'::uuid[])))
  loop
    if katalist_priv.notify_profile(v_recipient, p_kind, p_title, p_body, p_actor_profile_id,
      null, p_list_id, p_path, p_payload) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function katalist_priv.notify_profile(uuid,text,text,text,uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function katalist_priv.notify_list_participants(uuid,uuid[],text,text,text,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function katalist_priv.notify_profile(uuid,text,text,text,uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function katalist_priv.notify_list_participants(uuid,uuid[],text,text,text,uuid,text,jsonb) to service_role;

create or replace function public.request_team_connection(p_recipient_profile_id uuid)
returns uuid language plpgsql security definer
set search_path = 'pg_catalog','public','katalist_priv' as $$
declare v_id uuid; v_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_recipient_profile_id=auth.uid() then raise exception 'you are already on your Team'; end if;
  select display_name into v_name from public.profiles where id=auth.uid();
  insert into katalist_priv.team_requests(sender_profile_id, recipient_profile_id)
  values(auth.uid(), p_recipient_profile_id)
  on conflict (sender_profile_id, recipient_profile_id) where status='pending'
  do update set expires_at=clock_timestamp()+interval '14 days'
  returning id into v_id;
  perform katalist_priv.notify_profile(p_recipient_profile_id, 'team_request',
    'New Team request', coalesce(v_name, 'Someone') || ' wants to connect', auth.uid(),
    null, null, '/team', jsonb_build_object('request_id', v_id));
  return v_id;
end;
$$;

create or replace function public.accept_team_request(p_request_id uuid)
returns boolean language plpgsql security definer
set search_path = 'pg_catalog','public','katalist_priv' as $$
declare v_request katalist_priv.team_requests; v_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_request from katalist_priv.team_requests where id=p_request_id for update;
  if not found or v_request.recipient_profile_id<>auth.uid() or v_request.status<>'pending' or v_request.expires_at<=clock_timestamp() then raise exception 'request is not available'; end if;
  insert into katalist_priv.team_connections(profile_a_id,profile_b_id,created_by_profile_id)
  values(least(v_request.sender_profile_id,auth.uid()),greatest(v_request.sender_profile_id,auth.uid()),auth.uid()) on conflict do nothing;
  update katalist_priv.team_requests set status='accepted',responded_at=clock_timestamp() where id=p_request_id;
  select display_name into v_name from public.profiles where id=auth.uid();
  perform katalist_priv.notify_profile(v_request.sender_profile_id, 'team_request_accepted',
    'Team request accepted', coalesce(v_name, 'Your contact') || ' joined your Team', auth.uid(),
    null, null, '/team', jsonb_build_object('request_id', p_request_id));
  return true;
end;
$$;

create or replace function public.add_connected_list_member(p_list_id uuid, p_profile_id uuid, p_role public.list_role default 'collaborator')
returns public.list_members language plpgsql security definer
set search_path = 'pg_catalog','public','katalist_priv' as $$
declare v_member public.list_members; v_owner uuid; v_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not katalist_priv.is_list_owner(p_list_id) then raise exception 'only the List Owner can add members'; end if;
  select owner_profile_id,name into v_owner,v_name from public.lists where id=p_list_id;
  if p_profile_id=v_owner then raise exception 'Owner is not a member row'; end if;
  if not exists (select 1 from katalist_priv.team_connections c where least(v_owner,p_profile_id)=c.profile_a_id and greatest(v_owner,p_profile_id)=c.profile_b_id) then raise exception 'connect in Team before adding this member'; end if;
  insert into public.list_members(list_id,profile_id,role,added_by_profile_id)
  values(p_list_id,p_profile_id,coalesce(p_role,'collaborator'),auth.uid())
  on conflict(list_id,profile_id) do update set role=excluded.role returning * into v_member;
  perform katalist_priv.notify_profile(p_profile_id, 'list_member_added', 'Added to ' || v_name,
    'You can now open this List', auth.uid(), null, p_list_id, '/lists/' || p_list_id::text,
    jsonb_build_object('role', v_member.role::text));
  perform katalist_priv.notify_list_participants(p_list_id, array[auth.uid(),p_profile_id],
    'list_roster_changed', v_name || ' members changed', 'A Team member was added', auth.uid(),
    '/lists/' || p_list_id::text, jsonb_build_object('change','added','profile_id',p_profile_id));
  return v_member;
end;
$$;

create or replace function public.change_list_role(p_list_id uuid, p_profile_id uuid, p_role public.list_role)
returns public.list_members language plpgsql security definer
set search_path = 'pg_catalog','public','katalist_priv' as $$
declare v_member public.list_members; v_name text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not katalist_priv.is_list_owner(p_list_id) then raise exception 'only the List Owner can change roles'; end if;
  if exists(select 1 from public.lists where id=p_list_id and owner_profile_id=p_profile_id) then raise exception 'Owner is not a member row'; end if;
  select name into v_name from public.lists where id=p_list_id;
  update public.list_members set role=p_role where list_id=p_list_id and profile_id=p_profile_id returning * into v_member;
  if not found then raise exception 'that person is not a member of this List'; end if;
  perform katalist_priv.notify_profile(p_profile_id, 'list_role_changed', 'Role changed in ' || v_name,
    'Your role is now ' || replace(p_role::text,'_',' '), auth.uid(), null, p_list_id,
    '/lists/' || p_list_id::text, jsonb_build_object('role',p_role::text));
  perform katalist_priv.notify_list_participants(p_list_id, array[auth.uid(),p_profile_id],
    'list_roster_changed', v_name || ' members changed', 'A member role changed', auth.uid(),
    '/lists/' || p_list_id::text, jsonb_build_object('change','role','profile_id',p_profile_id,'role',p_role::text));
  return v_member;
end;
$$;

create or replace function public.remove_list_member(p_list_id uuid, p_profile_id uuid)
returns boolean language plpgsql security definer
set search_path = 'pg_catalog','public','katalist_priv' as $$
declare v_name text; v_removed boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not katalist_priv.is_list_owner(p_list_id) and p_profile_id<>auth.uid() then raise exception 'only the List Owner can remove other members'; end if;
  if exists(select 1 from public.lists where id=p_list_id and owner_profile_id=p_profile_id) then raise exception 'Owner is not a member row'; end if;
  select name into v_name from public.lists where id=p_list_id;
  delete from public.list_members where list_id=p_list_id and profile_id=p_profile_id;
  v_removed := found;
  if v_removed then
    perform katalist_priv.notify_profile(p_profile_id, 'list_member_removed', 'Removed from ' || v_name,
      'You no longer have access to this List', auth.uid(), null, p_list_id, '/', jsonb_build_object('list_name',v_name));
    perform katalist_priv.notify_list_participants(p_list_id, array[auth.uid(),p_profile_id],
      'list_roster_changed', v_name || ' members changed', 'A member was removed', auth.uid(),
      '/lists/' || p_list_id::text, jsonb_build_object('change','removed','profile_id',p_profile_id));
  end if;
  return v_removed;
end;
$$;

create or replace function public.create_list_invitation_server(
  p_requester_profile_id uuid, p_list_id uuid, p_invitee_profile_id uuid,
  p_phone_hash bytea, p_token_hash bytea, p_role public.list_role, p_expires_at timestamptz
) returns uuid language plpgsql security definer
set search_path = 'pg_catalog','public','katalist_priv' as $$
declare v_id uuid; v_name text;
begin
  if auth.role() <> 'service_role' then raise exception 'server only'; end if;
  select name into v_name from public.lists where id=p_list_id and owner_profile_id=p_requester_profile_id;
  if not found then raise exception 'only the List Owner can invite'; end if;
  insert into katalist_priv.list_invitations(list_id,inviter_profile_id,invitee_profile_id,phone_hash,token_hash,role,expires_at)
  values(p_list_id,p_requester_profile_id,p_invitee_profile_id,p_phone_hash,p_token_hash,p_role,p_expires_at) returning id into v_id;
  if p_invitee_profile_id is not null then
    perform katalist_priv.notify_profile(p_invitee_profile_id, 'list_invitation', 'Invitation to ' || v_name,
      'Accept to join this List', p_requester_profile_id, null, p_list_id,
      '/lists/' || p_list_id::text, jsonb_build_object('invitation_id',v_id,'role',p_role::text));
  end if;
  return v_id;
end;
$$;

create or replace function public.accept_list_invitation_server(p_token_hash bytea, p_accepting_profile_id uuid)
returns uuid language plpgsql security definer
set search_path = 'pg_catalog','public','katalist_priv' as $$
declare v_invite katalist_priv.list_invitations; v_name text;
begin
  if auth.role() <> 'service_role' then raise exception 'server only'; end if;
  select * into v_invite from katalist_priv.list_invitations where token_hash=p_token_hash for update;
  if not found or v_invite.revoked_at is not null or v_invite.expires_at<=clock_timestamp() then raise exception 'invite is not available'; end if;
  if v_invite.accepted_at is not null then return v_invite.list_id; end if;
  if v_invite.invitee_profile_id is not null and v_invite.invitee_profile_id<>p_accepting_profile_id then raise exception 'invite belongs to another person'; end if;
  select name into v_name from public.lists where id=v_invite.list_id;
  if v_invite.inviter_profile_id<>p_accepting_profile_id then
    insert into katalist_priv.team_connections(profile_a_id,profile_b_id,created_by_profile_id)
    values(least(v_invite.inviter_profile_id,p_accepting_profile_id),greatest(v_invite.inviter_profile_id,p_accepting_profile_id),p_accepting_profile_id) on conflict do nothing;
    insert into public.list_members(list_id,profile_id,role,added_by_profile_id)
    values(v_invite.list_id,p_accepting_profile_id,v_invite.role,v_invite.inviter_profile_id)
    on conflict(list_id,profile_id) do update set role=excluded.role;
  end if;
  update katalist_priv.list_invitations set accepted_at=clock_timestamp(),accepted_by_profile_id=p_accepting_profile_id where id=v_invite.id;
  perform katalist_priv.notify_profile(v_invite.inviter_profile_id, 'list_invitation_accepted',
    coalesce(v_name,'List') || ' invitation accepted', 'Your invitation was accepted', p_accepting_profile_id,
    null, v_invite.list_id, '/lists/' || v_invite.list_id::text, jsonb_build_object('invitation_id',v_invite.id));
  perform katalist_priv.notify_list_participants(v_invite.list_id, array[v_invite.inviter_profile_id,p_accepting_profile_id],
    'list_roster_changed', coalesce(v_name,'List') || ' members changed', 'A new member joined', p_accepting_profile_id,
    '/lists/' || v_invite.list_id::text, jsonb_build_object('change','accepted','profile_id',p_accepting_profile_id));
  return v_invite.list_id;
end;
$$;

create or replace function public.accept_team_invitation_server(p_token_hash bytea, p_accepting_profile_id uuid)
returns boolean language plpgsql security definer
set search_path = 'pg_catalog','public','katalist_priv' as $$
declare v_invite katalist_priv.team_invitations; v_name text;
begin
  if auth.role() <> 'service_role' then raise exception 'server only'; end if;
  select * into v_invite from katalist_priv.team_invitations where token_hash=p_token_hash for update;
  if not found or v_invite.revoked_at is not null or v_invite.expires_at<=clock_timestamp() then raise exception 'invite is not available'; end if;
  if v_invite.accepted_at is not null then return true; end if;
  if v_invite.inviter_profile_id=p_accepting_profile_id then raise exception 'cannot invite yourself'; end if;
  insert into katalist_priv.team_connections(profile_a_id,profile_b_id,created_by_profile_id)
  values(least(v_invite.inviter_profile_id,p_accepting_profile_id),greatest(v_invite.inviter_profile_id,p_accepting_profile_id),p_accepting_profile_id) on conflict do nothing;
  update katalist_priv.team_invitations set accepted_at=clock_timestamp(),accepted_by_profile_id=p_accepting_profile_id where id=v_invite.id;
  select display_name into v_name from public.profiles where id=p_accepting_profile_id;
  perform katalist_priv.notify_profile(v_invite.inviter_profile_id, 'team_invitation_accepted',
    'Team invitation accepted', coalesce(v_name,'Your contact') || ' joined your Team', p_accepting_profile_id,
    null, null, '/team', jsonb_build_object('invitation_id',v_invite.id));
  return true;
end;
$$;

create or replace function public.notify_on_list_message()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog','public','katalist_priv' as $$
declare v_name text;
begin
  select name into v_name from public.lists where id=new.list_id;
  if not found then return new; end if;
  perform katalist_priv.notify_list_participants(new.list_id, array[new.author_profile_id],
    'list_message', 'New message in ' || v_name, left(new.body, 160), new.author_profile_id,
    '/lists/' || new.list_id::text, jsonb_build_object('message_id',new.id));
  return new;
end;
$$;

drop function if exists public.claim_notification_deliveries(integer, integer);
create function public.claim_notification_deliveries(p_limit integer, p_lease_seconds integer)
returns table (
  delivery_id uuid, subscription_id uuid, notification_id uuid, fcm_token text,
  attempt_count integer, kind text, title text, body text, thing_id uuid, list_id uuid, path text
) language plpgsql security definer
set search_path to 'pg_catalog','public','katalist_priv' as $$
begin
  if p_limit is null or p_limit < 1 or p_lease_seconds is null or p_lease_seconds < 1 then return; end if;
  return query
  with picked as (
    select d.id from katalist_priv.notification_deliveries d
     where ((d.status in ('pending','retry') and d.next_attempt_at <= now())
        or (d.status='processing' and d.lease_until is not null and d.lease_until < now()))
     order by d.next_attempt_at,d.created_at limit p_limit for update skip locked
  ), claimed as (
    update katalist_priv.notification_deliveries d
       set status='processing',attempt_count=d.attempt_count+1,
           lease_until=now()+make_interval(secs=>p_lease_seconds)
      from picked where d.id=picked.id
    returning d.id,d.subscription_id,d.notification_id,d.attempt_count
  )
  select c.id,c.subscription_id,c.notification_id,s.fcm_token,c.attempt_count,
         n.kind,n.title,n.body,n.thing_id,n.list_id,
         case
           when n.payload->>'path' = '/team' then '/team'
           when n.payload->>'path' = '/' then '/'
           when n.payload->>'path' ~ '^/lists/[0-9a-f-]{36}$' then n.payload->>'path'
           when n.payload->>'path' ~ '^/\?thing=[0-9a-f-]{36}$' then n.payload->>'path'
           when n.thing_id is not null then '/?thing=' || n.thing_id::text
           when n.list_id is not null then '/lists/' || n.list_id::text
           else '/'
         end as path
    from claimed c
    join katalist_priv.push_subscriptions s on s.id=c.subscription_id
    join public.notifications n on n.id=c.notification_id;
end;
$$;

revoke execute on function public.claim_notification_deliveries(integer,integer) from public, anon, authenticated;
grant execute on function public.claim_notification_deliveries(integer,integer) to service_role;

revoke execute on function public.create_list_invitation_server(uuid,uuid,uuid,bytea,bytea,public.list_role,timestamptz) from public, anon, authenticated;
revoke execute on function public.accept_list_invitation_server(bytea,uuid) from public, anon, authenticated;
revoke execute on function public.accept_team_invitation_server(bytea,uuid) from public, anon, authenticated;
grant execute on function public.create_list_invitation_server(uuid,uuid,uuid,bytea,bytea,public.list_role,timestamptz) to service_role;
grant execute on function public.accept_list_invitation_server(bytea,uuid) to service_role;
grant execute on function public.accept_team_invitation_server(bytea,uuid) to service_role;

revoke execute on function public.request_team_connection(uuid) from public, anon;
revoke execute on function public.accept_team_request(uuid) from public, anon;
revoke execute on function public.add_connected_list_member(uuid,uuid,public.list_role) from public, anon;
revoke execute on function public.change_list_role(uuid,uuid,public.list_role) from public, anon;
revoke execute on function public.remove_list_member(uuid,uuid) from public, anon;
grant execute on function public.request_team_connection(uuid) to authenticated;
grant execute on function public.accept_team_request(uuid) to authenticated;
grant execute on function public.add_connected_list_member(uuid,uuid,public.list_role) to authenticated;
grant execute on function public.change_list_role(uuid,uuid,public.list_role) to authenticated;
grant execute on function public.remove_list_member(uuid,uuid) to authenticated;

-- The existing activity notification trigger must retain the nudge event fan-out.
do $$
begin
  if position('nudged' in pg_get_functiondef('public.notify_on_thing_activity()'::regprocedure)) = 0 then
    raise exception 'nudged notification fan-out is missing';
  end if;
end;
$$;
