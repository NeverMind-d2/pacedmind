-- Checks the database's security rules with two made-up accounts, then rolls everything back: the block
-- always ends with an exception whose message lists the results, so nothing it creates is kept.
-- Run it in the SQL editor (or through the Supabase MCP execute_sql) after changing policies or grants.
-- Every line should match its "(want …)" or say "refused"/"rejected"/"blocked"; a line starting with FAIL
-- or ERROR is a problem.
do $test$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  -- sa and sb: sessions an hour old that verified an authenticator from yesterday. sa_new: a session that
  -- verified an authenticator added after it started (what a stolen session could do). sa2: another sign-in of
  -- account a (the web app, or a second computer).
  sa uuid := gen_random_uuid(); sb uuid := gen_random_uuid(); sa_new uuid := gen_random_uuid(); sb2 uuid := gen_random_uuid();
  sa2 uuid := gen_random_uuid();
  fa uuid := gen_random_uuid(); fa_new uuid := gen_random_uuid(); fb uuid := gen_random_uuid();
  area_a uuid; area_b uuid; dev uuid; dev2 uuid; dev_b uuid; tid bigint; tid2 bigint; tkey text; req uuid; rid bigint;
  sid text := '0123456789abcdef';
  n int; out text := '';
  now_s bigint := extract(epoch from now())::bigint;
  claims_aal1 text; claims_aal2_old text; claims_aal2_fresh text; claims_bad_session text; claims_new_factor text;
  claims_a2_old text; claims_a2_fresh text; claims_b_old text; claims_b_fresh text;
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
         (sb2, b, now() - interval '1 hour', now(), 'aal2', fb),
         (sa2, a, now() - interval '1 hour', now(), 'aal2', fa);
  select id into area_a from public.areas where user_id = a and key = 'WRK';
  select id into area_b from public.areas where user_id = b and key = 'WRK';
  select count(*) into n from public.areas where user_id = a; out := out || '[setup] default areas for new user=' || n || E'\n';

  claims_aal1 := json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal1', 'session_id', sa, 'amr', json_build_array(json_build_object('method', 'password', 'timestamp', now_s)))::text;
  claims_aal2_old := json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sa, 'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s - 3600)))::text;
  claims_aal2_fresh := json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sa, 'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s - 30)))::text;
  claims_bad_session := json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2', 'session_id', gen_random_uuid(), 'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s)))::text;
  claims_new_factor := json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sa_new, 'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s - 30)))::text;
  claims_a2_old := json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sa2, 'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s - 3600)))::text;
  claims_a2_fresh := json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sa2, 'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s - 30)))::text;
  claims_b_old := json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sb, 'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s - 3600)))::text;
  claims_b_fresh := json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sb, 'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s - 30)))::text;

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

  -- 2c. an area's icon is the name of one the app draws, never markup or other text
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.areas set icon = 'briefcase' where id = area_a;
    select count(*) into n from public.areas where id = area_a and icon = 'briefcase'; out := out || '2c icon saved=' || n || ' (want 1)' || E'\n';
    reset role;
  exception when others then out := out || '2c ERROR ' || sqlerrm || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.areas set icon = '<svg onload=alert(1)>' where id = area_a;
    out := out || '2d FAIL an icon that is not a name accepted' || E'\n';
    reset role;
  exception when others then out := out || '2d icon that is not a name rejected: ' || left(sqlerrm, 60) || E'\n'; end;

  -- 2e. an area's picture is base64 of a small PNG (a 1 by 1 one here), never markup, other data or anything big
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.areas set picture = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' where id = area_a;
    select count(*) into n from public.areas where id = area_a and picture is not null; out := out || '2e picture saved=' || n || ' (want 1)' || E'\n';
    reset role;
  exception when others then out := out || '2e ERROR ' || sqlerrm || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.areas set picture = 'PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+' where id = area_a;
    out := out || '2f FAIL a picture that is not a PNG accepted' || E'\n';
    reset role;
  exception when others then out := out || '2f picture that is not a PNG rejected: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.areas set picture = 'iVBORw0KGgo' || repeat('A', 40000) where id = area_a;
    out := out || '2g FAIL a picture over the size accepted' || E'\n';
    reset role;
  exception when others then out := out || '2g picture over the size rejected: ' || left(sqlerrm, 60) || E'\n'; end;

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

  -- 17. reports and images: kept for your own sessions, checked shapes, invisible to other accounts
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    insert into public.sessions (id, task_id, agent, device_id, status, started_at) values ('0123456789abcdef', tid, 'claude', dev, 'finished', '2026-09-25T10:00:00');
    insert into public.reports (session_id, task_id, outcome, summary, created_at) values ('0123456789abcdef', tid, 'partial', 'Half done', '2026-09-25T11:00:00') returning id into rid;
    insert into public.attachments (id, task_id, session_id, report_id, device_id, file, mime, bytes, created_at)
      values ('00112233445566ff', tid, '0123456789abcdef', rid, dev, '00112233445566ff.png', 'image/png', 100, '2026-09-25T11:00:00');
    select count(*) into n from public.reports; out := out || '17 own report stored, reports=' || n || ' (want 1)' || E'\n';
    select count(*) into n from public.attachments; out := out || '17a own image stored, images=' || n || ' (want 1)' || E'\n';
    reset role;
  exception when others then out := out || '17 ERROR ' || sqlerrm || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal1, true); set local role authenticated;
    select count(*) into n from public.reports; out := out || '17b aal1 sees reports=' || n || ' (want 0)' || E'\n';
    select count(*) into n from public.attachments; out := out || '17c aal1 sees images=' || n || ' (want 0)' || E'\n';
    reset role;
  exception when others then out := out || '17b ERROR ' || sqlerrm || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sb,
      'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s - 3600)))::text, true);
    set local role authenticated;
    select count(*) into n from public.reports; out := out || '17d other account sees reports=' || n || ' (want 0)' || E'\n';
    select count(*) into n from public.attachments; out := out || '17e other account sees images=' || n || ' (want 0)' || E'\n';
    reset role;
  exception when others then out := out || '17d ERROR ' || sqlerrm || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sb,
      'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', now_s - 3600)))::text, true);
    set local role authenticated;
    insert into public.reports (session_id, task_id, summary, created_at) values ('0123456789abcdef', tid, 'Not mine', '2026-09-25T11:00:00');
    out := out || '17f FAIL report on another account''s session accepted' || E'\n';
    reset role;
  exception when others then out := out || '17f report on another account''s session blocked: ' || left(sqlerrm, 70) || E'\n'; end;

  -- 18. what reaches a computer is held to safe shapes
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    insert into public.attachments (id, task_id, file, mime, bytes, created_at) values ('00112233445566fe', tid, '../../evil.png', 'image/png', 100, '2026-09-25T11:00:00');
    out := out || '18 FAIL image file outside its folder accepted' || E'\n';
    reset role;
  exception when others then out := out || '18 image path rejected: ' || left(sqlerrm, 70) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.sessions set url = 'javascript:alert(1)' where id = '0123456789abcdef';
    out := out || '18a FAIL non-https session link accepted' || E'\n';
    reset role;
  exception when others then out := out || '18a session link rejected: ' || left(sqlerrm, 70) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    insert into public.projects (area_id, name, codex_env) values (area_a, 'Cloud', 'env" & calc & "');
    out := out || '18b FAIL shell characters in a Codex environment accepted' || E'\n';
    reset role;
  exception when others then out := out || '18b Codex environment rejected: ' || left(sqlerrm, 70) || E'\n'; end;
  -- A project's repository is host/path only: never a URL that could carry a token, a computer's path or markup.
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    insert into public.projects (area_id, name, repo) values (area_a, 'Repo', 'github.com/owner/repo#packages/web');
    select count(*) into n from public.projects where repo = 'github.com/owner/repo#packages/web'; out := out || '18g repository saved=' || n || ' (want 1)' || E'\n';
    reset role;
  exception when others then out := out || '18g ERROR ' || sqlerrm || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    insert into public.projects (area_id, name, repo) values (area_a, 'Repo', 'https://ghp_secret@github.com/owner/repo.git');
    out := out || '18h FAIL a repository URL with a token accepted' || E'\n';
    reset role;
  exception when others then out := out || '18h repository URL rejected: ' || left(sqlerrm, 70) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    insert into public.projects (area_id, name, repo) values (area_a, 'Repo', 'C:/Users/me/code/app');
    out := out || '18i FAIL a folder as a repository accepted' || E'\n';
    reset role;
  exception when others then out := out || '18i folder as a repository rejected: ' || left(sqlerrm, 70) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.tasks set run_in = 'shell' where id = tid;
    out := out || '18c FAIL unknown run-in accepted' || E'\n';
    reset role;
  exception when others then out := out || '18c run-in rejected: ' || left(sqlerrm, 70) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.devices set agents = '{"claude": {"cli": true}}', checked_at = now() where id = dev;
    get diagnostics n = row_count; out := out || '18d computer''s agents updated=' || n || ' (want 1)' || E'\n';
    reset role;
  exception when others then out := out || '18d ERROR ' || sqlerrm || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.devices set user_id = b where id = dev;
    out := out || '18e FAIL a computer moved to another account' || E'\n';
    reset role;
  exception when others then out := out || '18e computer''s owner refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.sessions set url = 'https://chatgpt.com/codex/tasks/task_e_0123' where id = '0123456789abcdef';
    get diagnostics n = row_count; out := out || '18f https session link saved=' || n || ' (want 1)' || E'\n';
    reset role;
  exception when others then out := out || '18f ERROR ' || sqlerrm || E'\n'; end;

  -- 19. anon reads no reports or images
  begin
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); set local role anon;
    select count(*) into n from public.reports;
    out := out || '19 FAIL anon read reports=' || n || E'\n';
    reset role;
  exception when others then out := out || '19 anon refused: ' || left(sqlerrm, 60) || E'\n'; end;

  -- 20. the account's first computer is its default, and there is only ever one
  begin
    perform set_config('request.jwt.claims', claims_a2_old, true); set local role authenticated;
    dev2 := public.register_device('Second PC', 'macos');
    select count(*) into n from public.devices where is_default; out := out || '20 defaults after a second computer=' || n || ' (want 1)' || E'\n';
    select count(*) into n from public.devices where id = dev and is_default; out := out || '20a the first computer is the default=' || n || ' (want 1)' || E'\n';
    update public.devices set is_default = true where id = dev2;
    select count(*) into n from public.devices where is_default; out := out || '20b defaults after picking another=' || n || ' (want 1)' || E'\n';
    select count(*) into n from public.devices where id = dev2 and is_default; out := out || '20c the one picked is the default=' || n || ' (want 1)' || E'\n';
    reset role;
  exception when others then out := out || '20 ERROR ' || sqlerrm || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_old, true); set local role authenticated;
    begin
      update public.devices set is_default = true;
    exception when others then null;
    end;
    select count(*) into n from public.devices where is_default; out := out || '20d defaults after asking for every computer=' || n || ' (want 1)' || E'\n';
    reset role;
  exception when others then out := out || '20d ERROR ' || sqlerrm || E'\n'; end;

  -- 21. another sign-in of the account (the web app, another computer) may rename a computer and pick the default,
  --     but only the computer itself reports when it was seen, what it found, its version, its flows and its setting
  begin
    perform set_config('request.jwt.claims', claims_a2_old, true); set local role authenticated;
    update public.devices set name = 'Renamed PC' where id = dev;
    get diagnostics n = row_count; out := out || '21 another sign-in renamed the computer=' || n || ' (want 1)' || E'\n';
    reset role;
  exception when others then out := out || '21 ERROR ' || sqlerrm || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_old, true); set local role authenticated;
    update public.devices set agents = '{"claude": {"cli": {"version": "9.9.9"}}}' where id = dev;
    out := out || '21a FAIL another sign-in changed what the computer found' || E'\n';
    reset role;
  exception when others then out := out || '21a another sign-in''s agents refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_old, true); set local role authenticated;
    -- clock_timestamp: now() is the same all through this one transaction.
    update public.devices set last_seen_at = clock_timestamp() + interval '1 minute' where id = dev;
    out := out || '21b FAIL another sign-in made the computer look online' || E'\n';
    reset role;
  exception when others then out := out || '21b another sign-in''s last seen refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_old, true); set local role authenticated;
    update public.devices set app_version = '9.9.9' where id = dev;
    out := out || '21c FAIL another sign-in changed the computer''s version' || E'\n';
    reset role;
  exception when others then out := out || '21c another sign-in''s version refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_old, true); set local role authenticated;
    update public.devices set flows_on = array[gen_random_uuid()] where id = dev;
    out := out || '21d FAIL another sign-in changed the computer''s flows' || E'\n';
    reset role;
  exception when others then out := out || '21d another sign-in''s flows refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_old, true); set local role authenticated;
    update public.devices set remote_start = 'auto' where id = dev;
    out := out || '21e FAIL another sign-in changed the computer''s setting for requests' || E'\n';
    reset role;
  exception when others then out := out || '21e another sign-in''s setting refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_old, true); set local role authenticated;
    update public.devices set other_sessions = '[{"harness": "claude-cli", "ref": "x", "title": "Not yours"}]' where id = dev;
    out := out || '21k FAIL another sign-in changed the computer''s sessions' || E'\n';
    reset role;
  exception when others then out := out || '21k another sign-in''s sessions refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.devices set other_sessions = '{"not": "a list"}' where id = dev;
    out := out || '21l FAIL sessions that aren''t a list accepted' || E'\n';
    reset role;
  exception when others then out := out || '21l sessions that aren''t a list rejected: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.devices set other_sessions = (select jsonb_agg(jsonb_build_object('ref', i)) from generate_series(1, 31) i) where id = dev;
    out := out || '21m FAIL more than 30 sessions accepted' || E'\n';
    reset role;
  exception when others then out := out || '21m more than 30 sessions rejected: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.devices set app_version = '0.2.0', flows_on = array[gen_random_uuid()], last_seen_at = now(), remote_start = 'ask', checked_at = now(),
      other_sessions = '[{"harness": "codex-cli", "ref": "abc", "title": "Mine", "state": "idle"}]'
      where id = dev;
    get diagnostics n = row_count; out := out || '21f the computer reported on itself=' || n || ' (want 1)' || E'\n';
    reset role;
  exception when others then out := out || '21f ERROR ' || sqlerrm || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.devices set platform = 'linux' where id = dev;
    out := out || '21g FAIL a computer''s platform changed' || E'\n';
    reset role;
  exception when others then out := out || '21g platform refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_old, true); set local role authenticated;
    update public.devices set auth_session_id = sa2 where id = dev;
    out := out || '21h FAIL a computer''s sign-in taken over by an update' || E'\n';
    reset role;
  exception when others then out := out || '21h sign-in refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_old, true); set local role authenticated;
    update public.devices set revoked_at = null where id = dev2;
    out := out || '21i FAIL a computer''s sign-out changed by an update' || E'\n';
    reset role;
  exception when others then out := out || '21i sign-out refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_b_old, true); set local role authenticated;
    update public.devices set name = 'Not yours', is_default = true where id = dev;
    get diagnostics n = row_count; out := out || '21j other account renamed the computer=' || n || ' (want 0)' || E'\n';
    reset role;
  exception when others then out := out || '21j ERROR ' || sqlerrm || E'\n'; end;

  -- 22. what a computer reports is held to plain shapes
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.devices set app_version = '1.0.0 && calc' where id = dev;
    out := out || '22 FAIL a version with shell characters accepted' || E'\n';
    reset role;
  exception when others then out := out || '22 version rejected: ' || left(sqlerrm, 70) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.devices set flows_on = (select array_agg(gen_random_uuid()) from generate_series(1, 201)) where id = dev;
    out := out || '22a FAIL 201 flows accepted' || E'\n';
    reset role;
  exception when others then out := out || '22a 201 flows rejected: ' || left(sqlerrm, 70) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_old, true); set local role authenticated;
    update public.devices set name = E'PC\r\ncalc' where id = dev;
    out := out || '22b FAIL a name with a line break accepted' || E'\n';
    reset role;
  exception when others then out := out || '22b name rejected: ' || left(sqlerrm, 70) || E'\n'; end;

  -- 23. resuming a session or sending it back with changes goes only to the computer it ran on, for its own task and
  --     agent, with a fresh code, and each kind has its own shape
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    insert into public.tasks (key, area_id, title, created_at, updated_at) values ('', area_a, 'Second', '2026-09-25T10:00:00', '2026-09-25T10:00:00') returning id into tid2;
    reset role;
  exception when others then out := out || '23 ERROR ' || sqlerrm || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind, surface) values (dev, tid, 'claude', 'start', 'desktop');
    get diagnostics n = row_count; out := out || '23a start in the app accepted=' || n || ' (want 1)' || E'\n';
    insert into public.launch_requests (device_id, task_id, agent, kind, target_session_id) values (dev, tid, 'claude', 'resume', sid);
    get diagnostics n = row_count; out := out || '23b resume on the computer it ran on accepted=' || n || ' (want 1)' || E'\n';
    insert into public.launch_requests (device_id, task_id, agent, kind, target_session_id, changes) values (dev, tid, 'claude', 'changes', sid, E'  Make the button blue.\n');
    select count(*) into n from public.launch_requests where kind = 'changes' and changes = 'Make the button blue.' and status = 'pending';
    out := out || '23c changes accepted and trimmed=' || n || ' (want 1)' || E'\n';
    reset role;
  exception when others then out := out || '23a ERROR ' || sqlerrm || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind, target_session_id) values (dev2, tid, 'claude', 'resume', sid);
    out := out || '23d FAIL resume sent to a computer the session didn''t run on' || E'\n';
    reset role;
  exception when others then out := out || '23d resume on another computer refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind, target_session_id, changes) values (dev2, tid, 'claude', 'changes', sid, 'Blue');
    out := out || '23e FAIL changes sent to a computer the session didn''t run on' || E'\n';
    reset role;
  exception when others then out := out || '23e changes on another computer refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind, target_session_id) values (dev, tid2, 'claude', 'resume', sid);
    out := out || '23f FAIL a session resumed under another task' || E'\n';
    reset role;
  exception when others then out := out || '23f another task refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind, target_session_id) values (dev, tid, 'codex', 'resume', sid);
    out := out || '23g FAIL a Claude session resumed as Codex' || E'\n';
    reset role;
  exception when others then out := out || '23g another agent refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind, target_session_id) values (dev, tid, 'claude', 'start', sid);
    out := out || '23h FAIL a start naming a session accepted' || E'\n';
    reset role;
  exception when others then out := out || '23h start with a session refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind, changes) values (dev, tid, 'claude', 'start', 'Blue');
    out := out || '23i FAIL a start with changes accepted' || E'\n';
    reset role;
  exception when others then out := out || '23i start with changes refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind, target_session_id, changes) values (dev, tid, 'claude', 'resume', sid, 'Blue');
    out := out || '23j FAIL a resume with changes accepted' || E'\n';
    reset role;
  exception when others then out := out || '23j resume with changes refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind) values (dev, tid, 'claude', 'resume');
    out := out || '23k FAIL a resume without a session accepted' || E'\n';
    reset role;
  exception when others then out := out || '23k resume without a session refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind, target_session_id, changes) values (dev, tid, 'claude', 'changes', sid, E' \n ');
    out := out || '23l FAIL blank changes accepted' || E'\n';
    reset role;
  exception when others then out := out || '23l blank changes refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind, target_session_id, changes) values (dev, tid, 'claude', 'changes', sid, repeat('x', 20001));
    out := out || '23m FAIL 20001 characters of changes accepted' || E'\n';
    reset role;
  exception when others then out := out || '23m long changes refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind) values (dev, tid, 'claude', 'shell');
    out := out || '23n FAIL an unknown kind accepted' || E'\n';
    reset role;
  exception when others then out := out || '23n unknown kind refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, surface) values (dev, tid, 'claude', 'shell');
    out := out || '23o FAIL an unknown surface accepted' || E'\n';
    reset role;
  exception when others then out := out || '23o unknown surface refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_old, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind, target_session_id) values (dev, tid, 'claude', 'resume', sid);
    out := out || '23p FAIL resume without a fresh code accepted' || E'\n';
    reset role;
  exception when others then out := out || '23p resume with a stale code refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_new_factor, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind, target_session_id, changes) values (dev, tid, 'claude', 'changes', sid, 'Blue');
    out := out || '23q FAIL changes with an authenticator added in this session accepted' || E'\n';
    reset role;
  exception when others then out := out || '23q changes with a new authenticator refused: ' || left(sqlerrm, 50) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind, target_session_id, status) values (dev, tid, 'claude', 'resume', sid, 'launched');
    out := out || '23r FAIL client-set status on a resume accepted' || E'\n';
    reset role;
  exception when others then out := out || '23r client-set status refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_a2_fresh, true); set local role authenticated;
    update public.launch_requests set status = 'launched', decided_at = now() where kind = 'resume';
    update public.launch_requests set status = 'pending' where kind = 'resume';
    out := out || '23s FAIL a decided resume set back to pending' || E'\n';
    reset role;
  exception when others then out := out || '23s re-pending a resume refused: ' || left(sqlerrm, 60) || E'\n'; end;

  -- 24. another account can't aim a request at this account's sessions or computers (test 16's computer of b went
  --     with its block, so b signs one in here)
  begin
    perform set_config('request.jwt.claims', claims_b_old, true); set local role authenticated;
    dev_b := public.register_device('B PC', 'windows');
    reset role;
  exception when others then out := out || '24 ERROR ' || sqlerrm || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_b_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind, target_session_id) values (dev_b, tid, 'claude', 'resume', sid);
    out := out || '24 FAIL another account''s session resumed on its own computer' || E'\n';
    reset role;
  exception when others then out := out || '24 other account''s session refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_b_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent, kind, target_session_id, changes) values (dev, tid, 'claude', 'changes', sid, 'Blue');
    out := out || '24a FAIL changes sent to another account''s computer' || E'\n';
    reset role;
  exception when others then out := out || '24a other account''s computer refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_b_old, true); set local role authenticated;
    select count(*) into n from public.launch_requests; out := out || '24b other account sees requests=' || n || ' (want 0)' || E'\n';
    reset role;
  exception when others then out := out || '24b ERROR ' || sqlerrm || E'\n'; end;

  -- 25. a computer that signs out stops being the default, can't become it again, and takes no requests
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.devices set is_default = true where id = dev2;
    perform public.revoke_device(dev2);
    select count(*) into n from public.devices where is_default; out := out || '25 defaults after signing the default out=' || n || ' (want 0)' || E'\n';
    reset role;
  exception when others then out := out || '25 ERROR ' || sqlerrm || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_old, true); set local role authenticated;
    update public.devices set is_default = true where id = dev2;
    out := out || '25a FAIL a signed-out computer became the default' || E'\n';
    reset role;
  exception when others then out := out || '25a signed-out default refused: ' || left(sqlerrm, 60) || E'\n'; end;
  begin
    perform set_config('request.jwt.claims', claims_aal2_fresh, true); set local role authenticated;
    insert into public.launch_requests (device_id, task_id, agent) values (dev2, tid, 'claude');
    out := out || '25b FAIL a request for a signed-out computer accepted' || E'\n';
    reset role;
  exception when others then out := out || '25b signed-out computer refused: ' || left(sqlerrm, 60) || E'\n'; end;

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
