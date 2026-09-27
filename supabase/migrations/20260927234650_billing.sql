-- Billing for PacedMind Cloud. The One device plan (no account) is free; Cloud is a subscription, with 7 days free
-- from sign-up. The database decides whether an account may still write, so the app's own code (which anyone can
-- change and run) can't get around it.
--
-- 1. billing: one row per account, which the account reads and only the payment provider's webhook writes (the
--    stripe-webhook Edge Function, with the service role). The trial starts when the account is made.
-- 2. The switch: until billing launches, every account may write (private.billing_switch.enforce is false).
-- 3. Read-only once the trial or the subscription is over: a statement trigger on the data tables refuses inserts
--    and updates with SQLSTATE PT402 (PostgREST answers 402). Reads and deletes always work, and so does the
--    computers' own bookkeeping (devices), so an account whose Cloud ended can still see its data, delete it, and
--    move it back to a computer. A trigger rather than a restrictive policy: an update a policy hides changes
--    nothing and reports no error, so the app would say it saved.
-- 4. An account with a subscription that would renew can't be deleted: it would go on being charged.

/* ---------- 1. the account's plan ---------- */

create table public.billing (
  user_id uuid primary key references auth.users (id) on delete cascade,
  trial_ends_at timestamptz not null,
  -- Cloud without paying (the owner's own account, say), set by hand.
  comped boolean not null default false,
  customer_id text check (customer_id ~ '^cus_[A-Za-z0-9]{1,64}$'),
  subscription_id text check (subscription_id ~ '^sub_[A-Za-z0-9]{1,64}$'),
  -- The subscription's status as the payment provider says; 'none' before the first one.
  status text not null default 'none' check (status in (
    'none', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'
  )),
  -- The price it pays: the country whose price it is, monthly or yearly, and the amount in the currency's minor unit.
  market text check (market ~ '^[A-Z]{2}$'),
  period text check (period in ('month', 'year')),
  currency text check (currency ~ '^[a-z]{3}$'),
  amount integer check (amount between 0 and 100000000),
  period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create unique index billing_customer_idx on public.billing (customer_id) where customer_id is not null;

create trigger billing_bump after insert or update on public.billing
  for each row execute function private.bump_version();

revoke all on public.billing from anon;
revoke insert, update, delete, truncate, references, trigger on public.billing from authenticated;

alter table public.billing enable row level security;

create policy "Own billing" on public.billing for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Two-factor session" on public.billing as restrictive for all to authenticated
  using ((select private.session_ok())) with check ((select private.session_ok()));

-- Every account that exists gets its row; the launch sets their trial to end 7 days after it.
insert into public.billing (user_id, trial_ends_at)
  select id, now() + interval '7 days' from auth.users
  on conflict (user_id) do nothing;

-- A new account starts its trial.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.billing (user_id, trial_ends_at) values (new.id, now() + interval '7 days')
    on conflict (user_id) do nothing;
  insert into public.areas (user_id, name, key, color, sort) values
    (new.id, 'Work', 'WRK', '#6A8DC3', 0),
    (new.id, 'Personal', 'PER', '#70B192', 1),
    (new.id, 'Health', 'HLT', '#B97C97', 2),
    (new.id, 'Learning', 'LRN', '#9485C0', 3),
    (new.id, 'Dev', 'DEV', '#68AAB9', 4);
  insert into public.user_state (user_id, version) values (new.id, 0) on conflict do nothing;
  return new;
end $$;

/* ---------- 2. the switch ---------- */

create table private.billing_switch (
  id boolean primary key default true check (id),
  enforce boolean not null default false
);
insert into private.billing_switch default values;
alter table private.billing_switch enable row level security;
revoke all on private.billing_switch from public, anon, authenticated;

-- Whether the signed-in account may write to Cloud: billing isn't enforced yet, it's comped, its trial runs, or its
-- subscription is paid or being retried (past_due: the provider tries the card again for a while).
create function private.cloud_writable() returns boolean
language sql stable security definer set search_path = '' as $$
  select not coalesce((select s.enforce from private.billing_switch s), false)
      or exists (
        select 1 from public.billing b
        where b.user_id = auth.uid()
          and (b.comped or b.trial_ends_at > now() or b.status in ('active', 'trialing', 'past_due'))
      )
$$;

/* ---------- 3. read-only once Cloud has ended ---------- */

-- Only statements a session sends itself: auth.uid() is null for the service role and the sign-up trigger, and
-- writes nested in other triggers (a delete that sets a reference to null, say) follow a statement already allowed.
create function private.require_cloud() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() = 1 and auth.uid() is not null and not private.cloud_writable() then
    raise exception 'PacedMind Cloud is read-only: subscribe to keep working in it, or move your data to this computer.'
      using errcode = 'PT402';
  end if;
  return null;
end $$;

create trigger areas_require_cloud before insert or update on public.areas
  for each statement execute function private.require_cloud();
create trigger projects_require_cloud before insert or update on public.projects
  for each statement execute function private.require_cloud();
create trigger tasks_require_cloud before insert or update on public.tasks
  for each statement execute function private.require_cloud();
create trigger subtasks_require_cloud before insert or update on public.subtasks
  for each statement execute function private.require_cloud();
create trigger events_require_cloud before insert or update on public.events
  for each statement execute function private.require_cloud();
create trigger sessions_require_cloud before insert or update on public.sessions
  for each statement execute function private.require_cloud();
create trigger session_events_require_cloud before insert or update on public.session_events
  for each statement execute function private.require_cloud();
create trigger edges_require_cloud before insert or update on public.edges
  for each statement execute function private.require_cloud();
create trigger settings_require_cloud before insert or update on public.settings
  for each statement execute function private.require_cloud();
create trigger reports_require_cloud before insert or update on public.reports
  for each statement execute function private.require_cloud();
create trigger attachments_require_cloud before insert or update on public.attachments
  for each statement execute function private.require_cloud();
-- What only starts something new: settling what's already there (a request's outcome, an answer) still works.
create trigger launch_requests_require_cloud before insert on public.launch_requests
  for each statement execute function private.require_cloud();
create trigger session_asks_require_cloud before insert on public.session_asks
  for each statement execute function private.require_cloud();
create trigger push_keys_require_cloud before insert on public.push_keys
  for each statement execute function private.require_cloud();
create trigger push_subscriptions_require_cloud before insert on public.push_subscriptions
  for each statement execute function private.require_cloud();

/* ---------- 4. deleting the account ---------- */

create or replace function public.delete_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.session_ok() or not private.recent_mfa(300) then
    raise exception 'Enter a current two-factor code first.' using errcode = '42501';
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

revoke execute on function private.cloud_writable(), private.require_cloud() from public, anon, authenticated;
