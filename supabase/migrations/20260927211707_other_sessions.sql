-- The Claude Code and Codex sessions a computer found that PacedMind didn't start (src/server/other-sessions.ts), for
-- the Sessions page on every computer and in the web app. Per session: the tool, its own id, a title of one short
-- line, its folder's name (never the path), the project, its state and two times. The computer writes it through
-- store/shared.ts otherSessionsOf and every reader checks it again with it; the database holds it to a small array.
alter table public.devices
  add column other_sessions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(other_sessions) = 'array' and jsonb_array_length(other_sessions) <= 30 and octet_length(other_sessions::text) <= 24576);

grant update (other_sessions) on public.devices to authenticated;

-- Like everything else a computer reports about itself, only its own sign-in writes it.
create or replace function private.device_reports_itself() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated'
     and (new.last_seen_at, new.checked_at, new.agents, new.app_version, new.flows_on, new.remote_start, new.other_sessions)
         is distinct from (old.last_seen_at, old.checked_at, old.agents, old.app_version, old.flows_on, old.remote_start, old.other_sessions)
     and new.auth_session_id is distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid then
    raise exception 'Only that computer can change what it reports about itself.' using errcode = '42501';
  end if;
  return new;
end $$;

-- Open pages refresh when a computer's sessions change too (it rounds their times to five minutes, so a session at work
-- doesn't refresh them every minute).
drop trigger devices_bump_changes on public.devices;
create trigger devices_bump_changes after update on public.devices
  for each row when (
    (old.name, old.remote_start, old.revoked_at, old.is_default, old.app_version, old.flows_on, old.agents, old.other_sessions)
      is distinct from (new.name, new.remote_start, new.revoked_at, new.is_default, new.app_version, new.flows_on, new.agents, new.other_sessions)
  ) execute function private.bump_version();
