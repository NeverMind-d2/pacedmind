-- Agents reach PacedMind Cloud through its hosted MCP server (app.pacedmind.com/api/mcp), signed in as the account
-- with OAuth: Claude Code, Codex or any MCP client registers itself with Supabase Auth's OAuth 2.1 server, sends you to
-- PacedMind's consent page (/oauth/consent), and gets a token for a new auth session of its own.
--
-- Supabase issues those tokens at aal1: the OAuth session never verified a second factor itself, and Supabase's consent
-- step takes any signed-in session, even one that only knows the password. So an agent's token counts only once you
-- approved that very sign-in from a two-factor session:
--
-- 1. agent_logins: an approval, made on the consent page by a two-factor session (approve_agent_login), for one pending
--    authorization of one OAuth client, usable once within ten minutes. The agent's first call to the MCP server claims
--    it for its new auth session (claim_agent_login): same account, same client, a session created after the approval.
-- 2. private.agent_ok(): the request comes from a claimed agent sign-in whose auth session still exists. Signing out
--    everywhere, the session time limits and revoking the agent (revoke_agent_login) all end it.
-- 3. The account's planning data (areas, projects, tasks, events, flows, sessions, reports, settings) answers two-factor
--    sessions and approved agents. Everything that protects the account or decides what runs stays two-factor
--    sessions only: computers (agents read them, never change them), requests to start sessions, what agents wait for
--    you to answer, push keys and subscriptions, and the approvals themselves. Starting a session from afar, answering
--    from elsewhere and deleting the account still need a fresh code (private.recent_mfa), which an agent never has.

/* ---------- 1. approvals ---------- */

create table public.agent_logins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The authorization you approved (Supabase's authorization_id): one approval each.
  request_id text not null check (request_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  -- The OAuth client the approval is for (auth.oauth_clients), taken from that authorization.
  client_id uuid not null,
  -- The client's name as it registered itself, for Settings: plain text, never trusted.
  client_name text not null default '' check (char_length(client_name) <= 200 and client_name !~ '[[:cntrl:]]'),
  approved_at timestamptz not null default now(),
  -- The agent's own auth session, once it used the approval.
  session_id uuid unique,
  claimed_at timestamptz,
  unique (user_id, id),
  unique (user_id, request_id),
  check ((session_id is null) = (claimed_at is null))
);

create index agent_logins_user_idx on public.agent_logins (user_id);

revoke all on public.agent_logins from anon;
revoke insert, update, delete, truncate, references, trigger on public.agent_logins from authenticated;

alter table public.agent_logins enable row level security;

create policy "Own agent logins" on public.agent_logins for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Two-factor session" on public.agent_logins as restrictive for all to authenticated
  using ((select private.session_ok())) with check ((select private.session_ok()));

-- Approves the pending OAuth authorization `request_id` (Supabase's authorization_id, which the consent page got),
-- once it is this account's: its client may sign in once within ten minutes. Two-factor sessions only. Returns the
-- approval's id and the address the authorization goes back to, which the page checks before it sends you there.
create function public.approve_agent_login(request_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid;
  v_name text;
  v_redirect text;
  v_id uuid;
begin
  if not private.session_ok() then
    raise exception 'Sign in with two-factor authentication first.' using errcode = '42501';
  end if;
  select a.client_id, c.client_name, a.redirect_uri into v_client, v_name, v_redirect
    from auth.oauth_authorizations a
    join auth.oauth_clients c on c.id = a.client_id and c.deleted_at is null
    where a.authorization_id = approve_agent_login.request_id and a.user_id = auth.uid() and a.expires_at > now()
      and a.status::text in ('pending', 'approved');
  if v_client is null then
    raise exception 'That sign-in request has expired. Start connecting the agent again.' using errcode = 'P0002';
  end if;
  delete from public.agent_logins l
    where l.user_id = auth.uid() and l.session_id is null and l.approved_at < now() - interval '10 minutes';
  -- Approving the same request again (a second click) keeps its one approval.
  select l.id into v_id from public.agent_logins l where l.user_id = auth.uid() and l.request_id = approve_agent_login.request_id;
  if v_id is not null then
    return jsonb_build_object('login', v_id, 'redirect_uri', v_redirect);
  end if;
  if (select count(*) from public.agent_logins l where l.user_id = auth.uid() and l.session_id is null) >= 5 then
    raise exception 'Too many agent sign-ins are waiting. Wait ten minutes and try again.' using errcode = '54000';
  end if;
  if (select count(*) from public.agent_logins l where l.user_id = auth.uid()) >= 50 then
    raise exception 'Too many agents are connected. Remove some in Settings first.' using errcode = '54000';
  end if;
  insert into public.agent_logins (user_id, request_id, client_id, client_name)
    values (auth.uid(), request_id, v_client, left(regexp_replace(coalesce(v_name, ''), '[[:cntrl:]]', '', 'g'), 200))
    returning id into v_id;
  return jsonb_build_object('login', v_id, 'redirect_uri', v_redirect);
end $$;

-- Called by the MCP server with an agent's own token: claims the oldest unused approval for its client, made at most
-- ten minutes before its auth session started. True once the sign-in is approved (also when it already was).
create function public.claim_agent_login() returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_client uuid := nullif(auth.jwt() ->> 'client_id', '')::uuid;
  v_created timestamptz;
begin
  if v_session is null or v_client is null or auth.uid() is null then
    return false;
  end if;
  if exists (select 1 from public.agent_logins l where l.session_id = v_session and l.user_id = auth.uid() and l.client_id = v_client) then
    return true;
  end if;
  select s.created_at into v_created from auth.sessions s
    where s.id = v_session and s.user_id = auth.uid() and s.oauth_client_id = v_client
      and (s.not_after is null or s.not_after > now());
  if v_created is null then
    return false;
  end if;
  update public.agent_logins l set session_id = v_session, claimed_at = now()
    where l.id = (select x.id from public.agent_logins x
                  where x.user_id = auth.uid() and x.client_id = v_client and x.session_id is null
                    and x.approved_at <= v_created and v_created < x.approved_at + interval '10 minutes'
                  order by x.approved_at limit 1
                  for update skip locked);
  return found;
end $$;

-- Disconnects an agent: its auth session ends (every token of it stops working at once), and its client has to ask
-- again, with the consent page's full details. Two-factor sessions only.
create function public.revoke_agent_login(login uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_session uuid;
  v_client uuid;
begin
  if not private.session_ok() then
    raise exception 'Sign in with two-factor authentication first.' using errcode = '42501';
  end if;
  delete from public.agent_logins l where l.id = login and l.user_id = auth.uid()
    returning l.session_id, l.client_id into v_session, v_client;
  if not found then
    raise exception 'That agent is already disconnected.' using errcode = 'P0002';
  end if;
  if v_session is not null then
    delete from auth.sessions s where s.id = v_session and s.user_id = auth.uid();
  end if;
  if not exists (select 1 from public.agent_logins l where l.user_id = auth.uid() and l.client_id = v_client) then
    update auth.oauth_consents c set revoked_at = now()
      where c.user_id = auth.uid() and c.client_id = v_client and c.revoked_at is null;
  end if;
end $$;

-- The agents you allowed, for Settings: signed in with a sign-in that still exists, or allowed in the last ten minutes
-- and not signed in yet. Approvals whose sign-in ended elsewhere (signing out everywhere, the time limits) go away here.
-- Two-factor sessions only.
create function public.connected_agents() returns table (id uuid, client_name text, approved_at timestamptz, claimed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not private.session_ok() then
    raise exception 'Sign in with two-factor authentication first.' using errcode = '42501';
  end if;
  delete from public.agent_logins l
    where l.user_id = auth.uid()
      and ((l.session_id is null and l.approved_at < now() - interval '10 minutes')
        or (l.session_id is not null and not exists (
              select 1 from auth.sessions s
              where s.id = l.session_id and s.user_id = l.user_id and (s.not_after is null or s.not_after > now()))));
  return query
    select l.id, l.client_name, l.approved_at, l.claimed_at from public.agent_logins l
    where l.user_id = auth.uid() order by l.approved_at desc;
end $$;

/* ---------- 2. who counts as an approved agent ---------- */

-- The request comes from an agent's OAuth sign-in that a two-factor session approved, and its auth session still exists.
create function private.agent_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.agent_logins l
    join auth.sessions s on s.id = l.session_id and s.user_id = l.user_id
    where l.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and l.user_id = auth.uid()
      and s.oauth_client_id = l.client_id
      and l.client_id = nullif(auth.jwt() ->> 'client_id', '')::uuid
      and (s.not_after is null or s.not_after > now())
  )
$$;

revoke execute on function private.agent_ok() from public, anon;
grant execute on function private.agent_ok() to authenticated;
revoke execute on function public.approve_agent_login(text), public.claim_agent_login(), public.revoke_agent_login(uuid), public.connected_agents()
  from public, anon;
grant execute on function public.approve_agent_login(text), public.claim_agent_login(), public.revoke_agent_login(uuid), public.connected_agents()
  to authenticated;

/* ---------- 3. what approved agents may use ---------- */

-- The planning data: two-factor sessions, or approved agents.
do $$
declare
  t text;
begin
  foreach t in array array['areas', 'projects', 'tasks', 'subtasks', 'events', 'sessions', 'session_events', 'edges',
                           'settings', 'key_counters', 'user_state', 'reports', 'attachments'] loop
    execute format('alter policy "Two-factor session" on public.%I using ((select private.session_ok()) or (select private.agent_ok())) '
                   'with check ((select private.session_ok()) or (select private.agent_ok()))', t);
  end loop;
end $$;

-- Computers: approved agents read them (which one a task goes to); only two-factor sessions register, rename, pick the
-- default or sign them out.
drop policy "Two-factor session" on public.devices;
create policy "Two-factor session" on public.devices as restrictive for select to authenticated
  using ((select private.session_ok()) or (select private.agent_ok()));
create policy "Two-factor session inserts" on public.devices as restrictive for insert to authenticated
  with check ((select private.session_ok()));
create policy "Two-factor session updates" on public.devices as restrictive for update to authenticated
  using ((select private.session_ok())) with check ((select private.session_ok()));
create policy "Two-factor session deletes" on public.devices as restrictive for delete to authenticated
  using ((select private.session_ok()));

-- Settings lists the connected agents and refreshes when one signs in or is removed.
create trigger agent_logins_bump after insert or update or delete on public.agent_logins
  for each row execute function private.bump_version();
