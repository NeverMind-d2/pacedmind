-- Deleting an account (delete_account) deletes its rows through the foreign keys, and each of those deletes
-- fired bump_version, which tried to count a version for the account being deleted and failed on the
-- missing user, so the whole deletion was rolled back. There's nothing to refresh for an account that no
-- longer exists: skip it.
create or replace function private.bump_version() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  if tg_op = 'DELETE' then v_user := old.user_id; else v_user := new.user_id; end if;
  if not exists (select 1 from auth.users u where u.id = v_user) then return null; end if;
  insert into public.user_state as s (user_id, version) values (v_user, 1)
    on conflict (user_id) do update set version = s.version + 1;
  return null;
end $$;
