-- MFA can be enabled later. Planner access for a human without a verified factor is distinct
-- from computer control. Enrolled accounts still need aal2, and every session must still exist.
-- OAuth approval records its original assurance; enabling MFA later never upgrades an old approval.

create function private.planner_session_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select nullif(auth.jwt() ->> 'client_id', '') is null
    and exists (
      select 1 from auth.sessions s
      where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and s.user_id = auth.uid() and s.oauth_client_id is null
        and (s.not_after is null or s.not_after > now())
    )
    and (
      auth.jwt() ->> 'aal' = 'aal2'
      or (coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal1' and not exists (
        select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'
      ))
    )
$$;

-- Computer access also needs an authenticator that predates this sign-in. A stolen basic
-- session cannot enroll its own factor and gain computer access, including remote_code=false.
-- The user signs in again after first enrollment. recent_mfa keeps its existing fresh-code rule.
create function private.computer_session_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.session_ok() and exists (
    select 1 from auth.sessions s
    join auth.mfa_factors f on f.id = s.factor_id and f.user_id = s.user_id
    where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid and s.user_id = auth.uid()
      and f.status = 'verified' and f.created_at < s.created_at
  )
$$;

-- Existing approvals were issued only after MFA. All new approvals default to basic and only
-- approve_agent_login may record stronger assurance; clients have no insert/update grant.
alter table public.agent_logins add column mfa_approved boolean not null default true;
alter table public.agent_logins alter column mfa_approved set default false;

create function private.agent_computer_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.agent_ok() and exists (
    select 1 from public.agent_logins l
    where l.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and l.user_id = auth.uid() and l.mfa_approved
  ) and exists (
    select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'
  )
$$;

-- A narrow capability check for app/launcher guards. RLS/RPC guards still decide every write.
create function public.can_control_computers() returns boolean
language sql stable security invoker set search_path = '' as $$
  select private.computer_session_ok() or private.agent_computer_ok()
$$;

revoke execute on function private.planner_session_ok(), private.computer_session_ok(), private.agent_computer_ok(),
  public.can_control_computers() from public, anon;
grant execute on function private.planner_session_ok(), private.computer_session_ok(), private.agent_computer_ok(),
  public.can_control_computers() to authenticated;

-- Planner ownership policies and column grants stay intact. Agent OAuth sessions can only use
-- their explicit approval path; neither a missing client_id nor aal2 turns one into a human.
do $$
declare t text;
begin
  foreach t in array array['areas', 'projects', 'tasks', 'subtasks', 'events', 'sessions', 'session_events',
    'edges', 'settings', 'key_counters', 'user_state', 'reports', 'attachments', 'preferences'] loop
    execute format('alter policy "Two-factor session" on public.%I using ((select private.planner_session_ok()) or (select private.agent_ok())) '
      'with check ((select private.planner_session_ok()) or (select private.agent_ok()))', t);
  end loop;
  foreach t in array array['billing', 'agent_logins'] loop
    execute format('alter policy "Two-factor session" on public.%I using ((select private.planner_session_ok())) '
      'with check ((select private.planner_session_ok()))', t);
  end loop;
end $$;

-- Computer metadata is readable to plan work; changing it requires established MFA.
alter policy "Two-factor session" on public.devices
  using ((select private.planner_session_ok()) or (select private.agent_ok()));
alter policy "Two-factor session inserts" on public.devices with check ((select private.computer_session_ok()));
alter policy "Two-factor session updates" on public.devices
  using ((select private.computer_session_ok())) with check ((select private.computer_session_ok()));
alter policy "Two-factor session deletes" on public.devices using ((select private.computer_session_ok()));
alter policy "Two-factor session" on public.session_asks
  using ((select private.computer_session_ok())) with check ((select private.computer_session_ok()));

-- Both request kinds require established MFA, including agents that ask a computer where its
-- fresh-code setting is off. Approval without MFA remains useful for planner MCP tools only.
do $$
declare t text;
begin
  foreach t in array array['launch_requests', 'folder_requests'] loop
    execute format('alter policy "Two-factor session, or the agent''s own" on public.%I using ('
      '(select private.computer_session_ok()) or ((select private.agent_computer_ok()) and '
      'agent_session = nullif(auth.jwt() ->> ''session_id'', '''')::uuid))', t);
    execute format('alter policy "Two-factor session, or an approved agent" on public.%I with check ('
      '(select private.computer_session_ok()) or (select private.agent_computer_ok()))', t);
    execute format('alter policy "Two-factor session updates" on public.%I using ((select private.computer_session_ok())) '
      'with check ((select private.computer_session_ok()))', t);
  end loop;
end $$;
alter policy "Two-factor session deletes" on public.launch_requests using ((select private.computer_session_ok()));

-- Fresh password/recovery authentication permits an unenrolled human to delete their account.
-- MFA accounts retain the stronger, pre-existing-factor requirement. Refreshing a token does
-- not refresh AMR timestamps, and OAuth/session revocation checks come from planner_session_ok.
create function private.recent_primary_auth(seconds integer) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.planner_session_ok()
    and not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
    and exists (
      select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a(claim)
      where a.claim ->> 'method' in ('password', 'recovery')
        and (a.claim ->> 'timestamp')::bigint between extract(epoch from now())::bigint - seconds
          and extract(epoch from now())::bigint
    )
$$;
revoke execute on function private.recent_primary_auth(integer) from public, anon, authenticated;

create or replace function public.approve_agent_login(request_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid;
  v_name text;
  v_redirect text;
  v_expires timestamptz;
  v_id uuid;
begin
  if not private.planner_session_ok() then
    raise exception 'Complete sign-in first.' using errcode = '42501';
  end if;
  select a.client_id, c.client_name, a.redirect_uri, a.expires_at into v_client, v_name, v_redirect, v_expires
    from auth.oauth_authorizations a
    join auth.oauth_clients c on c.id = a.client_id and c.deleted_at is null
    where a.authorization_id = approve_agent_login.request_id and a.user_id = auth.uid() and a.expires_at > now()
      and a.status::text in ('pending', 'approved');
  if v_client is null then
    raise exception 'That sign-in request has expired. Start connecting the agent again.' using errcode = 'P0002';
  end if;
  -- Approving the same request again (a second click) keeps its one approval.
  select l.id into v_id from public.agent_logins l where l.user_id = auth.uid() and l.request_id = approve_agent_login.request_id;
  if v_id is not null then
    return jsonb_build_object('login', v_id, 'redirect_uri', v_redirect);
  end if;
  if (select count(*) from public.agent_logins l
      where l.user_id = auth.uid() and l.session_id is null and l.request_expires_at > now()) >= 5 then
    raise exception 'Too many agent sign-ins are waiting. Wait a few minutes and try again.' using errcode = '54000';
  end if;
  if (select count(*) from public.agent_logins l where l.user_id = auth.uid()) >= 50 then
    raise exception 'Too many agents are connected. Remove some in Settings first.' using errcode = '54000';
  end if;
  insert into public.agent_logins (user_id, request_id, client_id, client_name, request_expires_at, mfa_approved)
    values (auth.uid(), request_id, v_client, left(regexp_replace(coalesce(v_name, ''), '[[:cntrl:]]', '', 'g'), 200), v_expires, private.computer_session_ok())
    returning id into v_id;
  return jsonb_build_object('login', v_id, 'redirect_uri', v_redirect);
end $$;

create or replace function public.revoke_agent_login(login uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid;
begin
  if not private.planner_session_ok() then
    raise exception 'Complete sign-in first.' using errcode = '42501';
  end if;
  delete from public.agent_logins l where l.id = login and l.user_id = auth.uid()
    returning l.client_id into v_client;
  if not found then
    raise exception 'That agent is already disconnected.' using errcode = 'P0002';
  end if;
  delete from auth.sessions s where s.user_id = auth.uid() and s.oauth_client_id = v_client;
  delete from public.agent_logins l where l.user_id = auth.uid() and l.client_id = v_client;
  update auth.oauth_consents c set revoked_at = now()
    where c.user_id = auth.uid() and c.client_id = v_client and c.revoked_at is null;
end $$;

create or replace function public.connected_agents() returns table (id uuid, client_name text, approved_at timestamptz, claimed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.planner_session_ok() then
    raise exception 'Complete sign-in first.' using errcode = '42501';
  end if;
  perform private.bind_agent_logins(auth.uid());
  delete from public.agent_logins l
    where l.user_id = auth.uid() and l.session_id is not null
      and not exists (
        select 1 from auth.sessions s
        where s.id = l.session_id and s.user_id = l.user_id and (s.not_after is null or s.not_after > now()));
  return query
    select l.id, l.client_name, l.approved_at, l.claimed_at from public.agent_logins l
    where l.user_id = auth.uid() order by l.approved_at desc;
end $$;

create or replace function public.cloud_plan() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when private.planner_session_ok() then (
    select jsonb_build_object(
      'enforced', coalesce((select s.enforce from private.billing_switch s), false),
      'writable', private.cloud_writable(),
      'trial_ends_at', b.trial_ends_at,
      'comped', b.comped,
      'customer', b.customer_id is not null,
      'status', b.status,
      'market', b.market,
      'period', b.period,
      'currency', b.currency,
      'amount', b.amount,
      'period_end', b.period_end,
      'cancel_at_period_end', b.cancel_at_period_end
    )
    from public.billing b where b.user_id = auth.uid()
  ) end
$$;

create or replace function public.delete_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not ((private.session_ok() and private.recent_mfa(300)) or private.recent_primary_auth(300)) then
    raise exception 'Confirm your identity again before deleting your account.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.billing b
    where b.user_id = auth.uid() and b.subscription_id is not null and not b.cancel_at_period_end
      and b.status in ('active', 'trialing', 'past_due', 'unpaid')
  ) then
    raise exception 'Cancel your subscription in Manage billing first: it would go on renewing.' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

create or replace function public.register_device(device_name text, device_platform text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_id uuid;
begin
  if not private.computer_session_ok() then
    raise exception 'Enable two-factor authentication, then sign in again to use computers.' using errcode = '42501';
  end if;
  select d.id into v_id from public.devices d
    where d.user_id = auth.uid() and d.auth_session_id = v_session and d.revoked_at is null;
  if v_id is not null then
    return v_id;
  end if;
  if (select count(*) from public.devices d where d.user_id = auth.uid() and d.revoked_at is null) >= 20 then
    raise exception 'Too many computers are signed in. Sign one out in Settings first.' using errcode = '54000';
  end if;
  insert into public.devices (user_id, name, platform, auth_session_id, last_seen_at, is_default)
    values (auth.uid(), device_name, device_platform, v_session, now(),
            not exists (select 1 from public.devices d where d.user_id = auth.uid() and d.is_default))
    returning id into v_id;
  return v_id;
end $$;

create or replace function public.revoke_device(device uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_session uuid;
begin
  if not private.computer_session_ok() then
    raise exception 'Enable two-factor authentication, then sign in again to use computers.' using errcode = '42501';
  end if;
  update public.devices set revoked_at = now(), is_default = false
    where id = device and user_id = auth.uid() and revoked_at is null
    returning auth_session_id into v_session;
  if not found then
    raise exception 'That computer is already signed out.' using errcode = 'P0002';
  end if;
  if v_session is not null then
    delete from auth.sessions where id = v_session and user_id = auth.uid();
  end if;
  update public.launch_requests set status = 'canceled', decided_at = now(), note = 'The computer was signed out'
    where device_id = device and user_id = auth.uid() and status = 'pending';
end $$;

create or replace function public.claim_device(device uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if not private.computer_session_ok() then
    raise exception 'Enable two-factor authentication, then sign in again to use computers.' using errcode = '42501';
  end if;
  if exists (select 1 from public.devices d
             where d.user_id = auth.uid() and d.auth_session_id = v_session and d.id <> device and d.revoked_at is null) then
    raise exception 'This sign-in already belongs to another computer.' using errcode = '42501';
  end if;
  update public.devices d
    set auth_session_id = v_session, last_seen_at = now()
    where d.id = device and d.user_id = auth.uid() and d.revoked_at is null
      and (d.auth_session_id is null or d.auth_session_id = v_session
           or not exists (select 1 from auth.sessions s where s.id = d.auth_session_id));
  if not found then
    raise exception 'This computer was signed out of PacedMind, or is signed in with another session.' using errcode = 'P0002';
  end if;
end $$;
