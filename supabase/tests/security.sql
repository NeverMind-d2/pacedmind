-- Checks the database's security rules with two made-up accounts, then rolls everything back: the block
-- always ends with an exception whose message lists the results, so nothing it creates is kept.
-- Run it in the SQL editor (or through the Supabase MCP execute_sql) after changing policies or grants.
-- Every line should match its "(want …)" or say "refused"/"rejected"/"blocked"; a line starting with FAIL
-- or ERROR is a problem.
do $test$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  -- sa and sb: sessions an hour old that verified an authenticator from yesterday. sa_new: a session that
  -- verified an authenticator added after it started (what a stolen session could do).
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid(); sa_new uuid := gen_random_uuid(); sb2 uuid := gen_random_uuid();
  fa uuid := gen_random_uuid(); fa_new uuid := gen_random_uuid(); fb uuid := gen_random_uuid();
  area_a uuid; area_b uuid; dev uuid; dev_b uuid; tid bigint; tkey text; req uuid;
  n int; out text := '';
  now_s bigint := extract(epoch from now())::bigint;
  claims_aal1 text; claims_aal2_old text; claims_aal2_fresh text; claims_bad_session text; claims_new_factor text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', a, 'authenticated', 'authenticated', 'rls-test-a@example.invalid', '', now(), '{}', '{}', now() - interval '2 days', now()),
         ('00000000-0000-0000-0000-000000000000', b, 'authenticated', 'authenticated', 'rls-test-b@example.invalid', '', now(), '{}', '{}', now() - interval '2 days', now());
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
  values (fa, a, 'test a old', 'totp', 'verified', now() - interval '1 day', now(), 'x'),
         (fa_new, a, 'test a new', 'totp', 'verified', now() - interval '10 minutes', now(), 'x'),
         (fb, b, 'test b old', 'totp', 'verified', now() - interval '1 day', now(), 'x');
  insert into auth.sessions (id, user_id, created_at, updated_at, aal, factor_id)
  values (sa, a, now() - interval '1 hour', now(), 'aal2', fa),
         (sa_new, a, now() - interval '1 hour', now(), 'aal2', fa_new),
         (sb, b, now() - interval '1 hour', now(), 'aal2', fb),
         (sb2, b, now() - interval '1 hour', now(), 'aal2', fb);
  select id into area_a from public.areas where user_id = a and key = 'WRK';
  select id into area_b from public.areas where user_id = b and key = 'WRK';
  select count(*) into n from public.areas where user_id = a; out := out || '[setup] default areas for new user=' || n || E'\n';

  claims_aal1 := json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal1', 'session_id', sa, 'amr', json_build_array(json_build_object('method', 'password', 'timestamp', now_s)))::text;
  claims_aal2_old := json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sa, 'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s - 3600)))::text;
  claims_aal2_fresh := json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sa, 'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s - 30)))::text;
  claims_bad_session := json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2', 'session_id', gen_random_uuid(), 'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s)))::text;
  claims_new_factor := json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sa_new, 'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s - 30)))::text;

  -- 1. password only (aal1) reads nothing
  begin
    perform set_config('request.jwt.claims', claims_aal1, true); set local role authenticated;
    select count(*) into n from public.areas; out := out || '1 aal1 sees areas=' || n || ' (want 0)' || E'\n';
    reset role;
  exception when others then out := out || '1 ERROR ' || sqlerrm || E'\n'; end;

  -- 2. aal2 sees own rows only
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    select count(*) into n from public.areas; out := out || '2 aal2 sees areas=' || n || ' (want 5)' || E'\n';
    select count(*) into n from public.areas where user_id = b; out := out || '2b aal2 sees other account areas=' || n || ' (want 0)' || E'\n';
    reset role;
  exception when others then out := out || '2 ERROR ' || sqlerrm || E'\n'; end;

  -- 3. unknown/revoked session id reads nothing
  begin
    perform set_config('request.jwt.claims', claims_bad_session, true); set local role authenticated;
    select count(*) into n from public.areas; out := out || '3 revoked session sees areas=' || n || ' (want 0)' || E'\n';
    reset role;
  exception when others then out := out || '3 ERROR ' || sqlerrm || E'\n'; end;

  -- 4. a task can't point at another account's area
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    insert into public.tasks (key, area_id, title, created_at, updated_at) values ('', area_b, 'x', '2026-09-25T10:00:00', '2026-09-25T10:00:00');
    out := out || '4 FAIL cross-account reference allowed' || E'\n';
    reset role;
  exception when others then out := out || '4 cross-account area blocked: ' || left(sqlerrm, 90) || E'\n'; end;

  -- 5. own task gets a key
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    insert into public.tasks (key, area_id, title, created_at, updated_at) values ('', area_a, 'First', '2026-09-25T10:00:00', '2026-09-25T10:00:00') returning id, key into tid, tkey;
    out := out || '5 own task key=' || tkey || ' (want WRK-1)' || E'\n';
    reset role;
  exception when others then out := out || '5 ERROR ' || sqlerrm || E'\n'; end;

  -- 6. injection-shaped key rejected
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    insert into public.tasks (key, area_id, title, created_at, updated_at) values ('X" & calc & "-1', area_a, 'x', '2026-09-25T10:00:00', '2026-09-25T10:00:00');
    out := out || '6 FAIL bad key accepted' || E'\n';
    reset role;
  exception when others then out := out || '6 bad key rejected: ' || left(sqlerrm, 80) || E'\n'; end;

  -- 7. settings only take planning keys
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    insert into public.settings (key, value) values ('claudeCommand', '"calc.exe"');
    out := out || '7 FAIL command setting accepted' || E'\n';
    reset role;
  exception when others then out := out || '7 command setting rejected: ' || left(sqlerrm, 80) || E'\n'; end;

  -- 8. writes to bookkeeping and devices are refused
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    insert into public.devices (name, platform) values ('evil', 'windows');
    out := out || '8 FAIL direct device insert allowed' || E'\n';
    reset role;
  exception when others then out := out || '8 direct device insert refused: ' || left(sqlerrm, 70) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.user_state set version = 0;
    out := out || '8b FAIL user_state writable' || E'\n';
    reset role;
  exception when others then out := out || '8b user_state write refused: ' || left(sqlerrm, 70) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    truncate public.tasks;
    out := out || '8c FAIL truncate allowed' || E'\n';
    reset role;
  exception when others then out := out || '8c truncate refused: ' || left(sqlerrm, 70) || E'\n'; end;

  -- 9. register a device, then a launch request needs a fresh second factor
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    dev := public.register_device('Test PC', 'windows');
    out := out || '9 device registered' || E'\n';
    if public.register_device('Test PC', 'windows') = dev then out := out || '9a registering again from the same session returns the same computer' || E'\n';
    else out := out || '9a FAIL second registration made another computer' || E'\n'; end if;
    reset role;
  exception when others then out := out || '9 ERROR ' || sqlerrm || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent) values (dev, tid, 'claude');
    out := out || '9b FAIL launch request without fresh 2FA accepted' || E'\n';
    reset role;
  exception when others then out := out || '9b stale 2FA refused: ' || left(sqlerrm, 80) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent) values (dev, tid, 'claude') returning id into req;
    select count(*) into n from public.launch_requests where status = 'pending' and expires_at between now() + interval '9 minutes' and now() + interval '11 minutes';
    out := out || '9c fresh 2FA request pending=' || n || ' (want 1)' || E'\n';
    reset role;
  exception when others then out := out || '9c ERROR ' || sqlerrm || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, status) values (dev, tid, 'claude', 'launched');
    out := out || '9d FAIL client-set status accepted' || E'\n';
    reset role;
  exception when others then out := out || '9d client-set status refused: ' || left(sqlerrm, 70) || E'\n'; end;

  -- 14. a code from an authenticator added after the session started doesn't count as fresh
  begin
    perform set_config('request.jwt.claims', claims_new_factor, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent) values (dev, tid, 'claude');
    out := out || '14 FAIL request accepted with an authenticator added in this session' || E'\n';
    reset role;
  exception when others then out := out || '14 new authenticator refused: ' || left(sqlerrm, 80) || E'\n'; end;

  -- 15. a decided request can't be set back to waiting
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.launch_requests set status = 'denied', decided_at = now() where id = req;
    update public.launch_requests set status = 'pending' where id = req;
    out := out || '15 FAIL request set back to pending' || E'\n';
    reset role;
  exception when others then out := out || '15 re-pending refused: ' || left(sqlerrm, 70) || E'\n'; end;

  -- 10. anon reads nothing
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); set local role anon;
    select count(*) into n from public.tasks;
    out := out || '10 FAIL anon read tasks=' || n || E'\n';
    reset role;
  exception when others then out := out || '10 anon refused: ' || left(sqlerrm, 60) || E'\n'; end;

  -- 11. delete_account needs a fresh code
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    perform public.delete_account();
    out := out || '11 FAIL delete_account without fresh 2FA' || E'\n';
    reset role;
  exception when others then out := out || '11 delete_account refused: ' || left(sqlerrm, 60) || E'\n'; end;

  -- 16. another live session of the same account can't take over a computer's entry
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sb,
      'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s - 3600)))::text, true);
    set local role authenticated;
    dev_b := public.register_device('B PC', 'windows');
    reset role;
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sb2,
      'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s - 3600)))::text, true);
    set local role authenticated;
    perform public.claim_device(dev_b);
    out := out || '16 FAIL a live computer was claimed by another session' || E'\n';
    reset role;
  exception when others then out := out || '16 takeover refused: ' || left(sqlerrm, 70) || E'\n'; end;

  -- 12. revoking the device ends its session at once
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    perform public.revoke_device(dev);
    select count(*) into n from public.areas;
    out := out || '12 after revoking own device, areas visible=' || n || ' (want 0)' || E'\n';
    reset role;
  exception when others then out := out || '12 ERROR ' || sqlerrm || E'\n'; end;
  select count(*) into n from auth.sessions where id = sa; out := out || '12b auth session rows left=' || n || ' (want 0)' || E'\n';

  -- 13. delete_account with a fresh code removes the account and everything in it
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sb,
      'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s - 10)))::text, true);
    set local role authenticated;
    perform public.delete_account();
    reset role;
    select count(*) into n from public.areas where user_id = b; out := out || '13 after delete_account, areas left=' || n || ' (want 0)' || E'\n';
    select count(*) into n from auth.users where id = b; out := out || '13b account rows left=' || n || ' (want 0)' || E'\n';
  exception when others then out := out || '13 ERROR ' || sqlerrm || E'\n'; end;

  raise exception E'RESULTS (rolled back)\n%', out;
end
$test$;
