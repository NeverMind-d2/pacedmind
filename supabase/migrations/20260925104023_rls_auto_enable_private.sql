-- rls_auto_enable is Supabase's own event trigger function that turns row level security on for new tables
-- in public (the ensure_rls event trigger). It is also callable through the API by anyone, signed in or
-- not (the security advisor flags it). Calling it does nothing outside a CREATE TABLE, but nobody needs to
-- call it: the event trigger runs it without that grant. Projects made without automatic RLS don't have it.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
