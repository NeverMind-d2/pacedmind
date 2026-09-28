-- Sessions asked for from elsewhere without a fresh two-factor code, on the computers that take them that way.
--
-- Until now every request to a computer (launch_requests: start, resume, changes) needed a two-factor code entered in the
-- last five minutes (private.recent_mfa). A computer can now waive that for itself: its own setting for requests from
-- elsewhere (remoteCode in src/server/device.ts), which it copies to its entry here, remote_code. Like everything else a
-- computer reports about itself, only its own sign-in changes it (device_reports_itself), so a stolen browser session
-- can't switch the code off before using it. Everything else stays: a request still comes from a live two-factor session
-- of the account (the restrictive policy, never an agent's OAuth sign-in), for a computer that is signed in, at most ten
-- waiting, ten minutes to expire, decided once; and the computer still refuses it, asks you, or acts, as its own setting
-- says.
--
-- The database records whether each request came with a fresh code (fresh_code), and the computer refuses one that
-- didn't while its own setting asks for a code, so switching the code back on there counts at once, before its entry
-- here has caught up.

/* ---------- the computer's own setting ---------- */

alter table public.devices
  -- Whether sessions asked for from elsewhere need a two-factor code from the last five minutes. Only the computer's own
  -- sign-in changes it (device_reports_itself); the insert policy on launch_requests reads it.
  add column remote_code boolean not null default true;

grant update (remote_code) on public.devices to authenticated;

-- As in other_sessions, and the code setting too: only that computer's own sign-in changes it.
create or replace function private.device_reports_itself() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated'
     and (new.last_seen_at, new.checked_at, new.agents, new.app_version, new.flows_on, new.remote_start, new.remote_code, new.other_sessions)
         is distinct from (old.last_seen_at, old.checked_at, old.agents, old.app_version, old.flows_on, old.remote_start, old.remote_code, old.other_sessions)
     and new.auth_session_id is distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid then
    raise exception 'Only that computer can change what it reports about itself.' using errcode = '42501';
  end if;
  return new;
end $$;

-- Open pages refresh when it changes, like the computer's other setting.
drop trigger devices_bump_changes on public.devices;
create trigger devices_bump_changes after update on public.devices
  for each row when (
    (old.name, old.remote_start, old.remote_code, old.revoked_at, old.is_default, old.app_version, old.flows_on, old.agents, old.other_sessions)
      is distinct from (new.name, new.remote_start, new.remote_code, new.revoked_at, new.is_default, new.app_version, new.flows_on, new.agents, new.other_sessions)
  ) execute function private.bump_version();

/* ---------- requests ---------- */

alter table public.launch_requests
  -- Whether it came with a two-factor code from the last five minutes, as the database found when it took it: the trigger
  -- below sets it, and no caller can. Every request before this migration needed one.
  add column fresh_code boolean not null default true;
alter table public.launch_requests alter column fresh_code set default false;

-- Whether a computer of this account that is signed in takes requests from elsewhere without a fresh code.
create function private.takes_requests_without_code(device uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.devices d
    where d.id = device and d.user_id = auth.uid() and d.revoked_at is null and not d.remote_code
  )
$$;

-- Starting a session on a computer from elsewhere needs a two-factor code from the last five minutes, unless that computer
-- takes requests without one. The restrictive "Two-factor session" policy still asks for a live two-factor session.
drop policy "Request launches with a fresh second factor" on public.launch_requests;
create policy "Request launches with a fresh code, or where none is needed" on public.launch_requests
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and ((select private.recent_mfa(300)) or private.takes_requests_without_code(device_id))
  );

-- As in device_management, and it records whether the request came with a fresh code.
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
  new.fresh_code := private.recent_mfa(300);
  new.requested_at := now();
  new.expires_at := now() + interval '10 minutes';
  new.status := 'pending';
  new.decided_at := null;
  new.session_id := null;
  new.note := null;
  return new;
end $$;

revoke execute on function private.takes_requests_without_code(uuid) from public, anon;
grant execute on function private.takes_requests_without_code(uuid) to authenticated;
