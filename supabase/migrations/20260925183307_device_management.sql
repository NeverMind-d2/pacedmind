-- Sessions run only on your computers, and managing those computers.
--
-- 1. A request from the web app or another computer (launch_requests) can now resume a session or send it back to its
--    agent with changes, not only start one. A Claude Code or Codex conversation stays on the computer that ran it, so
--    resuming or sending changes goes to that computer only: the database refuses a request for a session that ran
--    elsewhere, or for another account's. Every kind keeps the rules starting has: a two-factor code from the last five
--    minutes, from an authenticator older than the sign-in; at most ten waiting; ten minutes to expire; decided once.
--    The computer still decides by its own setting and checks everything again before it acts. The changes text is the
--    user's note to the agent, which reads it through start_task; it never reaches a command line.
-- 2. Computers: one default per account (where sessions go when neither the task nor its project names a computer),
--    the PacedMind version each one runs, and which projects' flows are on at each (for display: every computer keeps
--    that switch itself). Any two-factor session of the account can rename a computer or make it the default; what a
--    computer reports about itself (when it was last seen, what it found of the agents, its version, its flows, its
--    setting for requests from elsewhere) changes only from that computer's own sign-in.
--
-- Postgres regexes repeat at most 255 times, so longer limits are checked with char_length on their own.

/* ---------- requests: start, resume, or send back with changes ---------- */

alter table public.launch_requests
  -- start: a new session for the task. resume: the session target_session_id again. changes: target_session_id back to
  -- its agent with `changes`.
  add column kind text not null default 'start' check (kind in ('start', 'resume', 'changes')),
  -- Where it runs. For start, null means where the task says; for resume, null means where it ran, and 'desktop' moves a
  -- Claude Code conversation from a terminal into the Claude app. The computer checks it against what it has.
  add column surface text check (surface in ('terminal', 'desktop', 'cloud')),
  add column target_session_id text,
  -- What should change, as the user wrote it, without surrounding blanks (the trigger below trims it).
  add column changes text check (char_length(changes) between 1 and 20000),
  add constraint launch_requests_kind_shape check (
    (kind = 'start' and target_session_id is null and changes is null)
    or (kind = 'resume' and target_session_id is not null and changes is null)
    or (kind = 'changes' and target_session_id is not null and changes is not null)
  ),
  add constraint launch_requests_target_fkey foreign key (user_id, target_session_id)
    references public.sessions (user_id, id) on delete cascade;

create index launch_requests_target_idx on public.launch_requests (user_id, target_session_id);
-- Open pages ask for the requests of the last half hour every few seconds.
create index launch_requests_recent_idx on public.launch_requests (user_id, requested_at);

grant insert (kind, surface, target_session_id, changes) on public.launch_requests to authenticated;

-- As before, a request gets its times and status from the database, only for a computer that is still signed in, and
-- a handful at a time. Now also: resuming or sending changes names a session of the request's task and agent that ran
-- on that very computer (the reference above already keeps it within the account).
create or replace function private.launch_request_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_task bigint;
  v_agent text;
  v_device uuid;
begin
  if not exists (select 1 from public.devices d where d.id = new.device_id and d.user_id = new.user_id and d.revoked_at is null) then
    raise exception 'That computer is signed out of PacedMind.' using errcode = '42501';
  end if;
  if (select count(*) from public.launch_requests r
      where r.user_id = new.user_id and r.status = 'pending' and r.expires_at > now()) >= 10 then
    raise exception 'Too many session requests are waiting. Wait for them to start or expire.' using errcode = '54000';
  end if;
  new.changes := nullif(btrim(new.changes, E' \t\r\n'), '');
  if new.kind = 'changes' and new.changes is null then
    raise exception 'Write what should change.' using errcode = '23514';
  end if;
  if new.target_session_id is not null then
    select s.task_id, s.agent, s.device_id into v_task, v_agent, v_device
      from public.sessions s where s.id = new.target_session_id and s.user_id = new.user_id;
    if not found or v_device is distinct from new.device_id then
      raise exception 'That session didn''t run on that computer. Its conversation is there.' using errcode = '42501';
    end if;
    -- is distinct from: a session whose task was deleted (task_id null) matches no request either.
    if v_task is distinct from new.task_id or v_agent is distinct from new.agent then
      raise exception 'That session belongs to another task or agent.' using errcode = '42501';
    end if;
  end if;
  new.requested_at := now();
  new.expires_at := now() + interval '10 minutes';
  new.status := 'pending';
  new.decided_at := null;
  new.session_id := null;
  new.note := null;
  return new;
end $$;

/* ---------- computers ---------- */

alter table public.devices
  -- Where sessions go when neither the task nor its project names a computer. At most one per account (the index
  -- below), and only a computer that is signed in.
  add column is_default boolean not null default false,
  -- PacedMind's version on the computer, as it last said. For display.
  add column app_version text
    check (char_length(app_version) <= 40 and app_version ~ '^[0-9]{1,6}(\.[0-9]{1,6}){0,3}([-+][0-9A-Za-z.+-]{1,32})?$'),
  -- Projects whose flow is switched on at the computer, as it last said. For display: each computer keeps that switch
  -- itself (src/server/device.ts) and never reads it back from here.
  add column flows_on uuid[] not null default '{}'
    check (cardinality(flows_on) <= 200 and array_position(flows_on, null) is null),
  add constraint devices_default_signed_in check (not (is_default and revoked_at is not null)),
  -- Any session of the account can rename a computer now, and the computer takes the name over: plain text only.
  add constraint devices_name_plain check (name !~ '[[:cntrl:]]');

create unique index devices_one_default on public.devices (user_id) where is_default;

-- The name and the default change from any two-factor session (the web app, another computer); the version and the
-- flows come from the computer itself (see devices_reports_itself).
grant update (is_default, app_version, flows_on) on public.devices to authenticated;

-- Making a computer the default takes that from the one that had it. It runs as the caller, within its own rows.
create function private.one_default_device() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.is_default and not old.is_default then
    update public.devices set is_default = false
      where user_id = new.user_id and id <> new.id and is_default;
  end if;
  return new;
end $$;

create trigger devices_one_default before update of is_default on public.devices
  for each row execute function private.one_default_device();

-- What a computer reports about itself comes from its own sign-in only: another browser or computer of the account can
-- rename it or make it the default, but can't make it look online, or change what it found of the agents, its version,
-- its flows or its setting for requests from elsewhere. (The functions below, such as claim_device, run as their owner.)
create function private.device_reports_itself() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated'
     and (new.last_seen_at, new.checked_at, new.agents, new.app_version, new.flows_on, new.remote_start)
         is distinct from (old.last_seen_at, old.checked_at, old.agents, old.app_version, old.flows_on, old.remote_start)
     and new.auth_session_id is distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid then
    raise exception 'Only that computer can change what it reports about itself.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger devices_reports_itself before update on public.devices
  for each row execute function private.device_reports_itself();

-- Open pages refresh when a computer's name, default, setting, sign-out, version, flows or agents change, but not for
-- the minute's "still here" (last_seen_at) or a check that found the same as before.
drop trigger devices_bump on public.devices;
create trigger devices_bump after insert or delete on public.devices
  for each row execute function private.bump_version();
create trigger devices_bump_changes after update on public.devices
  for each row when (
    (old.name, old.remote_start, old.revoked_at, old.is_default, old.app_version, old.flows_on, old.agents)
      is distinct from (new.name, new.remote_start, new.revoked_at, new.is_default, new.app_version, new.flows_on, new.agents)
  ) execute function private.bump_version();

-- Accounts that already have computers: the signed-in one seen most recently becomes the default.
update public.devices d set is_default = true
  where d.revoked_at is null
    and d.id = (select x.id from public.devices x where x.user_id = d.user_id and x.revoked_at is null
                order by x.last_seen_at desc nulls last, x.created_at desc limit 1)
    and not exists (select 1 from public.devices y where y.user_id = d.user_id and y.is_default);

-- As in step_up_hardening, and the account's first computer (or the first after the default one signed out) becomes
-- its default.
create or replace function public.register_device(device_name text, device_platform text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_id uuid;
begin
  if not private.session_ok() then
    raise exception 'Sign in with two-factor authentication first.' using errcode = '42501';
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

-- As before, and a computer that signs out stops being the default.
create or replace function public.revoke_device(device uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_session uuid;
begin
  if not private.session_ok() then
    raise exception 'Sign in with two-factor authentication first.' using errcode = '42501';
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

revoke execute on function private.one_default_device(), private.device_reports_itself() from public, anon, authenticated;
