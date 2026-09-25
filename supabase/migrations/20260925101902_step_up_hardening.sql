-- Hardening after a security review.

-- 1. A fresh code only counts when it came from an authenticator the account already had before this session
--    started. Supabase lets any two-factor session add an authenticator without asking for a code, so
--    without this a stolen session could add its own authenticator, verify it, and pass every fresh-code
--    check (starting sessions from afar, deleting the account). auth.sessions.factor_id is the
--    authenticator the session verified most recently.
create or replace function private.recent_mfa(seconds integer) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
      select 1
      from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as a (claim)
      where a.claim ->> 'method' in ('totp', 'mfa/totp', 'webauthn', 'mfa/webauthn')
        and (a.claim ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - seconds
    )
    and exists (
      select 1
      from auth.sessions s
      join auth.mfa_factors f on f.id = s.factor_id and f.user_id = s.user_id
      where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and s.user_id = auth.uid()
        and f.status = 'verified'
        and f.created_at < s.created_at
    )
$$;

-- 2. A request to start a session is decided once: from waiting to its outcome. Setting it back to waiting
--    would let one fresh code start a session twice, or bring back a request you refused.
create function private.launch_request_decided_once() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'pending' or new.status = 'pending' then
    raise exception 'A request is decided once, from waiting to its outcome.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger launch_requests_decided_once before update on public.launch_requests
  for each row execute function private.launch_request_decided_once();

-- 3. A computer's entry follows its own sign-in only: it can be claimed after that computer's session ended
--    (it signed in again), never taken over while another session holds it, and one session holds one
--    computer. Registering again from the same session returns the same computer.
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
  insert into public.devices (user_id, name, platform, auth_session_id, last_seen_at)
    values (auth.uid(), device_name, device_platform, v_session, now())
    returning id into v_id;
  return v_id;
end $$;

create or replace function public.claim_device(device uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if not private.session_ok() then
    raise exception 'Sign in with two-factor authentication first.' using errcode = '42501';
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

revoke execute on function private.launch_request_decided_once() from public, anon, authenticated;
revoke execute on function private.recent_mfa(integer) from public, anon;
grant execute on function private.recent_mfa(integer) to authenticated;
