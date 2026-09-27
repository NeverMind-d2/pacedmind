-- Answering a running session's agent from anywhere, and web push for the moments a session needs you.
--
-- 1. session_asks: what a running session's agent waits for you to answer, held for a few minutes by the computer it
--    runs on: a tool it wants permission for (Claude Code's PermissionRequest hook) or a question (the ask_user tool).
--    Only that computer's own sign-in asks, for its own sessions, and withdraws what it asked. An answer comes once:
--    from that computer's own sign-in, or from anywhere else with a two-factor code from the last five minutes.
--    Whether the computer takes answers from elsewhere at all is its own setting, which it checks itself when an
--    answer comes (remote_ok only tells your other devices what to offer).
-- 2. push_keys and push_subscriptions: the account's own VAPID key pair for web push, and the browsers that asked for
--    notifications. The computer a session runs on sends them (src/server/push.ts), so no server holds a key. Only the
--    push services' own addresses are taken, so a subscription can't aim this computer at another address.

/* ---------- 1. what a running session waits for you to answer ---------- */

create table public.session_asks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id text not null,
  -- The computer the session runs on, which asked.
  device_id uuid not null,
  kind text not null check (kind in ('permission', 'question')),
  -- The tool it wants to use, as the agent names it (Bash, Edit, mcp__server__tool…).
  tool text check (tool ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  -- The question, or what the tool would do.
  text text not null check (char_length(text) between 1 and 4000),
  -- The computer's own setting when it asked, for your other devices; the computer checks its setting itself.
  remote_ok boolean not null default false,
  asked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'answered', 'expired', 'withdrawn')),
  answer text check (char_length(answer) between 1 and 20000),
  answered_at timestamptz,
  answered_via text check (answered_via in ('computer', 'elsewhere')),
  unique (user_id, id),
  foreign key (user_id, session_id) references public.sessions (user_id, id) on delete cascade,
  foreign key (user_id, device_id) references public.devices (user_id, id) on delete cascade,
  check (expires_at > asked_at and expires_at <= asked_at + interval '31 minutes'),
  check ((kind = 'permission') = (tool is not null)),
  check (status <> 'answered' or (answer is not null and (kind = 'question' or answer in ('allow', 'deny'))))
);

create index session_asks_session_idx on public.session_asks (user_id, session_id);
create index session_asks_status_idx on public.session_asks (user_id, status);

-- Whether the request comes from that computer's own sign-in (its entry in devices points at this session).
create function private.is_own_computer(device uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.devices d
    where d.id = device and d.user_id = auth.uid() and d.revoked_at is null
      and d.auth_session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
  )
$$;

-- Answered once, from waiting to its outcome: by the computer itself, or from elsewhere with a fresh code, before the
-- agent stops waiting. Only the computer lets it expire or withdraws it. It records where the answer came from.
create function private.session_ask_answered() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_computer boolean := private.is_own_computer(old.device_id);
begin
  if old.status <> 'pending' or new.status = 'pending' then
    raise exception 'This was answered already, or the agent stopped waiting for it.' using errcode = '42501';
  end if;
  if new.status in ('expired', 'withdrawn') then
    if not v_computer then
      raise exception 'Only the computer the session runs on withdraws what it asked.' using errcode = '42501';
    end if;
    new.answer := null;
    return new;
  end if;
  if now() >= old.expires_at then
    raise exception 'The agent stopped waiting for this answer.' using errcode = '42501';
  end if;
  if not v_computer and not private.recent_mfa(300) then
    raise exception 'Enter a current two-factor code first.' using errcode = '42501';
  end if;
  new.answered_at := now();
  new.answered_via := case when v_computer then 'computer' else 'elsewhere' end;
  return new;
end $$;

create trigger session_asks_answered before update on public.session_asks
  for each row execute function private.session_ask_answered();
create trigger session_asks_bump after insert or update or delete on public.session_asks
  for each row execute function private.bump_version();

revoke all on public.session_asks from anon;
revoke insert, update, delete, truncate, references, trigger on public.session_asks from authenticated;
grant insert (session_id, device_id, kind, tool, text, remote_ok, expires_at) on public.session_asks to authenticated;
grant update (status, answer) on public.session_asks to authenticated;

alter table public.session_asks enable row level security;

create policy "Read own asks" on public.session_asks for select to authenticated
  using ((select auth.uid()) = user_id);
-- A computer asks for its own sessions only.
create policy "Ask from the session's computer" on public.session_asks for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and private.is_own_computer(device_id)
    and exists (select 1 from public.sessions s where s.user_id = (select auth.uid()) and s.id = session_id and s.device_id = session_asks.device_id)
  );
create policy "Answer own asks" on public.session_asks for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Two-factor session" on public.session_asks as restrictive for all to authenticated
  using ((select private.session_ok())) with check ((select private.session_ok()));

/* ---------- 2. web push ---------- */

-- The account's VAPID key pair (P-256, base64url): browsers subscribe with the public key, and the account's computers
-- sign what they send with the private one. It only lets them send notifications to the account's own browsers.
create table public.push_keys (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  public_key text not null check (public_key ~ '^[A-Za-z0-9_-]{86,88}$'),
  private_key text not null check (private_key ~ '^[A-Za-z0-9_-]{42,44}$'),
  created_at timestamptz not null default now()
);

-- A browser that asked for notifications. Only the push services' addresses: Google (Chrome, Edge on Android),
-- Mozilla (Firefox), Apple (Safari, iPhone and iPad) and Microsoft (Edge).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null check (
    char_length(endpoint) <= 1000
    and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com)/[A-Za-z0-9_:%./=+?&-]+$'
  ),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}={0,2}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}={0,2}$'),
  label text not null default '' check (char_length(label) <= 100 and label !~ '[[:cntrl:]]'),
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

revoke all on public.push_keys, public.push_subscriptions from anon;
revoke insert, update, delete, truncate, references, trigger on public.push_keys, public.push_subscriptions from authenticated;
grant insert (public_key, private_key) on public.push_keys to authenticated;
grant delete on public.push_keys to authenticated;
grant insert (endpoint, p256dh, auth, label) on public.push_subscriptions to authenticated;
grant delete on public.push_subscriptions to authenticated;

alter table public.push_keys enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "Own push keys" on public.push_keys for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own push subscriptions" on public.push_subscriptions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Two-factor session" on public.push_keys as restrictive for all to authenticated
  using ((select private.session_ok())) with check ((select private.session_ok()));
create policy "Two-factor session" on public.push_subscriptions as restrictive for all to authenticated
  using ((select private.session_ok())) with check ((select private.session_ok()));

revoke execute on function private.session_ask_answered() from public, anon, authenticated;
revoke execute on function private.is_own_computer(uuid) from public, anon;
grant execute on function private.is_own_computer(uuid) to authenticated;
