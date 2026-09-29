-- Your agents ask your computers for sessions and folders, and each computer answers as its own settings say.
--
-- 1. launch_requests: an approved agent (PacedMind Cloud's MCP server, private.agent_ok) may ask a computer to start a
--    session on a task, and only a computer that takes requests from elsewhere without a two-factor code: an agent never
--    has a fresh code, even one it verified itself. That setting is the computer's own (remote_code, which only its own
--    sign-in changes), off by default. The computer then does what its own setting for requests from elsewhere says
--    (refuse, ask you there, or start), as for any request without a code, and it checks that setting itself again. The
--    database marks the request as an agent's (requested_via 'agent'), and the agent reads only its own requests, to
--    tell the user what became of them. Resuming a session and sending one back with changes stay with two-factor
--    sessions.
-- 2. folder_requests: an approved agent, the web app or another computer asks a computer to use a folder for a project,
--    an area (its workspace) or a task. Folders are that computer's own settings: a request only suggests one, the
--    computer checks that it exists there, and it's set only once you allow it in that computer's window. Only that
--    computer's own sign-in settles a request, once. The folder is plain text of at most 1000 characters; nothing runs it.

/* ---------- 1. sessions asked for by agents ---------- */

alter table public.launch_requests
  -- The agent's own sign-in (its auth session), for an agent's request: the agent reads its own requests only.
  add column agent_session uuid;

-- Only a person's two-factor session counts as a fresh code: an agent's OAuth sign-in that verified one itself doesn't.
drop policy "Request launches with a fresh code, or where none is needed" on public.launch_requests;
create policy "Request launches with a fresh code, or where none is needed" on public.launch_requests
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (((select private.recent_mfa(300)) and (select private.session_ok())) or private.takes_requests_without_code(device_id))
  );

-- Two-factor sessions as before; approved agents ask, and read what they asked.
drop policy "Two-factor session" on public.launch_requests;
create policy "Two-factor session, or the agent's own" on public.launch_requests as restrictive for select to authenticated
  using (
    (select private.session_ok())
    or ((select private.agent_ok()) and agent_session = nullif(auth.jwt() ->> 'session_id', '')::uuid)
  );
create policy "Two-factor session, or an approved agent" on public.launch_requests as restrictive for insert to authenticated
  with check ((select private.session_ok()) or (select private.agent_ok()));
create policy "Two-factor session updates" on public.launch_requests as restrictive for update to authenticated
  using ((select private.session_ok())) with check ((select private.session_ok()));
create policy "Two-factor session deletes" on public.launch_requests as restrictive for delete to authenticated
  using ((select private.session_ok()));

-- As in remote_code, and an agent's request is marked as one, for a start only, without a fresh code.
create or replace function private.launch_request_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_task bigint;
  v_agent text;
  v_device uuid;
  v_person boolean := private.session_ok();
begin
  if not exists (select 1 from public.devices d where d.id = new.device_id and d.user_id = new.user_id and d.revoked_at is null) then
    raise exception 'That computer is signed out of PacedMind.' using errcode = '42501';
  end if;
  if (select count(*) from public.launch_requests r
      where r.user_id = new.user_id and r.status = 'pending' and r.expires_at > now()) >= 10 then
    raise exception 'Too many session requests are waiting. Wait for them to start or expire.' using errcode = '54000';
  end if;
  if v_person then
    new.agent_session := null;
  else
    -- An approved agent (the restrictive policy let nothing else through): it asks for new sessions only.
    if new.kind is distinct from 'start' then
      raise exception 'Agents ask for new sessions only. Resuming a session or sending it back with changes is the user''s.' using errcode = '42501';
    end if;
    new.requested_via := 'agent';
    new.agent_session := nullif(auth.jwt() ->> 'session_id', '')::uuid;
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
  new.fresh_code := v_person and private.recent_mfa(300);
  new.requested_at := now();
  new.expires_at := now() + interval '10 minutes';
  new.status := 'pending';
  new.decided_at := null;
  new.session_id := null;
  new.note := null;
  return new;
end $$;

/* ---------- 2. folders asked for from elsewhere ---------- */

create table public.folder_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The computer asked, which alone settles it.
  device_id uuid not null,
  -- What gets the folder: a project, an area (its workspace) or a task.
  project_id uuid,
  area_id uuid,
  task_id bigint,
  -- The folder on that computer, as it was asked for: only a suggestion, which that computer checks and you allow there.
  folder text not null check (char_length(folder) between 1 and 1000 and folder !~ '[[:cntrl:]]'),
  -- Who asked: the web app, another computer's desktop app (for you or an agent there), or an approved agent.
  requested_via text not null default 'web' check (requested_via in ('web', 'desktop', 'agent')),
  -- For an agent's request: its sign-in (auth session), so the agent reads its own requests only.
  agent_session uuid,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 day',
  status text not null default 'pending' check (status in ('pending', 'done', 'refused', 'failed', 'expired')),
  decided_at timestamptz,
  note text check (char_length(note) <= 500),
  unique (user_id, id),
  foreign key (user_id, device_id) references public.devices (user_id, id) on delete cascade,
  foreign key (user_id, project_id) references public.projects (user_id, id) on delete cascade,
  foreign key (user_id, area_id) references public.areas (user_id, id) on delete cascade,
  foreign key (user_id, task_id) references public.tasks (user_id, id) on delete cascade,
  check (num_nonnulls(project_id, area_id, task_id) = 1)
);

create index folder_requests_device_idx on public.folder_requests (user_id, device_id, status);

-- Asked of a signed-in computer of the account, at most 20 waiting; the database sets its status, times and who asked.
create function private.folder_request_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.devices d where d.id = new.device_id and d.user_id = new.user_id and d.revoked_at is null) then
    raise exception 'That computer is signed out of PacedMind.' using errcode = '42501';
  end if;
  if (select count(*) from public.folder_requests r
      where r.user_id = new.user_id and r.status = 'pending' and r.expires_at > now()) >= 20 then
    raise exception 'Too many folder requests are waiting. Wait for them to be answered or expire.' using errcode = '54000';
  end if;
  if private.session_ok() then
    new.agent_session := null;
  else
    new.requested_via := 'agent';
    new.agent_session := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  end if;
  new.requested_at := now();
  new.expires_at := now() + interval '1 day';
  new.status := 'pending';
  new.decided_at := null;
  new.note := null;
  return new;
end $$;

-- Decided once, from waiting to its outcome, and only by the computer it asks (its own sign-in).
create function private.folder_request_settled() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status <> 'pending' or new.status = 'pending' then
    raise exception 'A request is decided once, from waiting to its outcome.' using errcode = '42501';
  end if;
  if not private.is_own_computer(old.device_id) then
    raise exception 'Only the computer it asks decides it.' using errcode = '42501';
  end if;
  new.decided_at := now();
  return new;
end $$;

create trigger folder_requests_defaults before insert on public.folder_requests
  for each row execute function private.folder_request_defaults();
create trigger folder_requests_settled before update on public.folder_requests
  for each row execute function private.folder_request_settled();
create trigger folder_requests_bump after insert or update or delete on public.folder_requests
  for each row execute function private.bump_version();
create trigger folder_requests_require_cloud before insert on public.folder_requests
  for each statement execute function private.require_cloud();

revoke all on public.folder_requests from anon;
revoke insert, update, delete, truncate, references, trigger on public.folder_requests from authenticated;
grant insert (device_id, project_id, area_id, task_id, folder, requested_via) on public.folder_requests to authenticated;
grant update (status, note) on public.folder_requests to authenticated;

alter table public.folder_requests enable row level security;

create policy "Read own folder requests" on public.folder_requests for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Ask own computers for folders" on public.folder_requests for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Settle own folder requests" on public.folder_requests for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Two-factor session, or the agent's own" on public.folder_requests as restrictive for select to authenticated
  using (
    (select private.session_ok())
    or ((select private.agent_ok()) and agent_session = nullif(auth.jwt() ->> 'session_id', '')::uuid)
  );
create policy "Two-factor session, or an approved agent" on public.folder_requests as restrictive for insert to authenticated
  with check ((select private.session_ok()) or (select private.agent_ok()));
create policy "Two-factor session updates" on public.folder_requests as restrictive for update to authenticated
  using ((select private.session_ok())) with check ((select private.session_ok()));
