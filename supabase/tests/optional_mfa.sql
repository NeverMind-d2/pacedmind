-- Optional MFA regression checks. Run as postgres after all migrations, with security.sql.
-- Assertions fail the transaction on a regression; all fixtures are rolled back on success.
-- This exercises PostgreSQL policies/RPCs; Auth's HTTP enrollment/OAuth flow needs a separate smoke test.
begin;
do $test$
declare
  account uuid := gen_random_uuid(); other_account uuid := gen_random_uuid();
  human uuid := gen_random_uuid(); later_human uuid := gen_random_uuid();
  revoked uuid := gen_random_uuid(); expired uuid := gen_random_uuid();
  factor uuid := gen_random_uuid(); device uuid := gen_random_uuid();
  client uuid := gen_random_uuid(); agent uuid := gen_random_uuid(); approval uuid;
  own_area uuid; task bigint; n integer; op text;
  basic_claims text; agent_claims text; elevated_claims text; established_claims text;
  epoch bigint := extract(epoch from now())::bigint;
  checks integer := 0;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', account, 'authenticated', 'authenticated',
    'optional-mfa@example.invalid', '', now(), '{}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', other_account, 'authenticated', 'authenticated',
    'optional-mfa-other@example.invalid', '', now(), '{}', '{}', now(), now());
  insert into auth.sessions(id, user_id, created_at, updated_at, aal, not_after)
  values (human, account, now() - interval '1 hour', now(), 'aal1', null),
    (revoked, account, now() - interval '1 hour', now(), 'aal1', null),
    (expired, account, now() - interval '1 hour', now(), 'aal1', now() - interval '1 second');
  select id into own_area from public.areas where user_id = account and key = 'WRK';
  -- A computer left from an earlier sign-in, with fresh codes waived, must not create a bypass.
  insert into public.devices(id, user_id, name, platform, auth_session_id, remote_code)
  values(device, account, 'Existing computer', 'windows', human, false);
  basic_claims := jsonb_build_object('sub', account, 'role', 'authenticated', 'session_id', human,
    'aal', 'aal1', 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', epoch)))::text;
  -- Capability functions are authenticated-only, even though they return only a boolean.
  set local role anon;
  begin
    perform public.can_control_computers();
    raise exception 'Anonymous client could call computer capability RPC';
  exception when insufficient_privilege then checks := checks + 1; end;
  reset role;
  perform set_config('request.jwt.claims', basic_claims, true);
  set local role authenticated;
  if not private.planner_session_ok() or private.session_ok() or public.can_control_computers() then
    raise exception 'Basic human capability boundary failed';
  end if;
  checks := checks + 1;
  select count(*) into n from public.areas;
  if n <> 5 then raise exception 'Basic account should read its five areas, got %', n; end if;
  select count(*) into n from public.areas where user_id = other_account;
  if n <> 0 then raise exception 'Basic account read another account'; end if;
  checks := checks + 2;
  insert into public.tasks(key, area_id, title, created_at, updated_at)
    values('', own_area, 'Basic planning', '2026-09-30T10:00:00', '2026-09-30T10:00:00') returning id into task;
  update public.tasks set title = 'Updated basic planning' where id = task;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Basic task write failed'; end if;
  insert into public.preferences(topic, text, source, updated_at)
    values('Planning', 'Keep mornings free', 'you', '2026-09-30T10:00:00');
  if public.cloud_plan() is null then raise exception 'Basic account cannot read its plan'; end if;
  checks := checks + 3;
  update public.devices set remote_code = true where id = device;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Basic account changed computer'; end if;
  checks := checks + 1;
  foreach op in array array[
    'select public.register_device(''Bad computer'', ''windows'')',
    format('select public.claim_device(%L)', device),
    format('select public.revoke_device(%L)', device),
    format('insert into public.launch_requests(device_id, task_id, agent) values(%L,%s,''claude'')', device, task),
    format('insert into public.folder_requests(device_id, area_id, folder) values(%L,%L,''/tmp/work'')', device, own_area)
  ] loop
    begin
      execute op;
      raise exception 'Basic account unexpectedly allowed: %', op;
    exception when insufficient_privilege then checks := checks + 1;
    end;
  end loop;
  reset role;

  -- An unfinished enrollment is still optional. Once verified, existing aal1 JWTs lose access immediately.
  insert into auth.mfa_factors(id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
    values(factor, account, 'Unfinished', 'totp', 'unverified', now() - interval '10 minutes', now(), 'x');
  set local role authenticated;
  if not private.planner_session_ok() then raise exception 'Unverified factor blocked planner'; end if;
  checks := checks + 1;
  reset role;

  -- Revoked/expired sessions are denied even when the account has no verified factor.
  delete from auth.sessions where id = revoked;
  foreach op in array array[revoked::text, expired::text, gen_random_uuid()::text] loop
    perform set_config('request.jwt.claims', (basic_claims::jsonb || jsonb_build_object('session_id',op))::text, true);
    set local role authenticated;
    if private.planner_session_ok() then raise exception 'Ended/unknown basic session accepted'; end if;
    select count(*) into n from public.tasks;
    if n <> 0 then raise exception 'Ended/unknown basic session read data'; end if;
    reset role;
    checks := checks + 2;
  end loop;

  insert into auth.oauth_clients(id, registration_type, redirect_uris, grant_types, client_name, client_type, token_endpoint_auth_method)
    values(client, 'dynamic', 'http://localhost:1/callback', 'authorization_code,refresh_token', 'Basic MCP', 'public', 'none');
  insert into auth.oauth_authorizations(id, authorization_id, client_id, user_id, redirect_uri, scope, status, created_at, expires_at)
    values(gen_random_uuid(), 'optional-mfa-consent', client, account, 'http://localhost:1/callback', 'email', 'pending', now(), now() + interval '3 minutes');
  perform set_config('request.jwt.claims', basic_claims, true);
  set local role authenticated;
  approval := (public.approve_agent_login('optional-mfa-consent')->>'login')::uuid;
  if (select mfa_approved from public.agent_logins where id = approval) then raise exception 'Basic consent acquired MFA assurance'; end if;
  select count(*) into n from public.connected_agents();
  if n <> 1 then raise exception 'Basic account cannot list connected agents'; end if;
  checks := checks + 2;
  begin
    update public.agent_logins set mfa_approved = true where id = approval;
    raise exception 'Approval assurance is client writable';
  exception when insufficient_privilege then checks := checks + 1; end;
  reset role;
  insert into auth.sessions(id, user_id, created_at, updated_at, aal, oauth_client_id)
    values(agent, account, now() + interval '1 second', now(), 'aal1', client);
  delete from auth.oauth_authorizations where authorization_id = 'optional-mfa-consent';
  agent_claims := jsonb_build_object('sub', account, 'role', 'authenticated', 'session_id', agent, 'client_id', client, 'aal', 'aal1')::text;
  perform set_config('request.jwt.claims', agent_claims, true);
  set local role authenticated;
  if not public.claim_agent_login() or public.can_control_computers() or private.planner_session_ok() then
    raise exception 'Basic agent approval boundary failed';
  end if;
  insert into public.tasks(key, area_id, title, created_at, updated_at)
    values('', own_area, 'MCP task without MFA', '2026-09-30T10:00:00', '2026-09-30T10:00:00');
  select count(*) into n from public.tasks;
  if n <> 2 then raise exception 'Basic agent cannot plan'; end if;
  checks := checks + 2;
  foreach op in array array[
    format('insert into public.launch_requests(device_id, task_id, agent) values(%L,%s,''claude'')', device, task),
    format('insert into public.folder_requests(device_id, area_id, folder) values(%L,%L,''/tmp/work'')', device, own_area),
    'select public.approve_agent_login(''optional-mfa-consent'')',
    'select public.delete_account()'
  ] loop
    begin
      execute op;
      raise exception 'Basic agent unexpectedly allowed: %', op;
    exception when insufficient_privilege then checks := checks + 1;
    end;
  end loop;
  -- Even a token missing client_id is rejected as a human by the auth session's client id.
  perform set_config('request.jwt.claims', (agent_claims::jsonb - 'client_id')::text, true);
  if private.planner_session_ok() then raise exception 'OAuth session posed as human'; end if;
  checks := checks + 1;
  reset role;

  update auth.mfa_factors set status = 'verified' where id = factor;
  perform set_config('request.jwt.claims', basic_claims, true);
  set local role authenticated;
  if private.planner_session_ok() then raise exception 'Old aal1 token bypassed newly enabled MFA'; end if;
  select count(*) into n from public.tasks;
  if n <> 0 then raise exception 'Enrolled aal1 account can read planner'; end if;
  begin
    perform public.approve_agent_login('optional-mfa-consent');
    raise exception 'Enrolled aal1 account can approve MCP';
  exception when insufficient_privilege then checks := checks + 1; end;
  begin
    perform public.delete_account();
    raise exception 'Enrolled aal1 account used fresh password to bypass MFA for deletion';
  exception when insufficient_privilege then checks := checks + 1; end;
  checks := checks + 2;
  reset role;

  -- A factor added after the sign-in allows planner aal2, but cannot unlock a computer or
  -- satisfy the old recent_mfa rule, even with a fresh TOTP timestamp.
  update auth.sessions set aal = 'aal2', factor_id = factor where id = human;
  elevated_claims := (basic_claims::jsonb || jsonb_build_object('aal','aal2', 'amr',
    jsonb_build_array(jsonb_build_object('method','totp','timestamp',epoch))))::text;
  perform set_config('request.jwt.claims', elevated_claims, true);
  set local role authenticated;
  if not private.planner_session_ok() or public.can_control_computers() or private.recent_mfa(300) then
    raise exception 'Mid-session factor unlocked computer control';
  end if;
  checks := checks + 1;
  foreach op in array array[
    'select public.register_device(''Bad computer'', ''windows'')',
    format('insert into public.launch_requests(device_id, task_id, agent) values(%L,%s,''claude'')', device, task),
    format('insert into public.folder_requests(device_id, area_id, folder) values(%L,%L,''/tmp/work'')', device, own_area),
    'select public.delete_account()'
  ] loop
    begin
      execute op;
      raise exception 'Mid-session factor unexpectedly allowed: %', op;
    exception when insufficient_privilege then checks := checks + 1;
    end;
  end loop;
  reset role;
  insert into auth.sessions(id, user_id, created_at, updated_at, aal, factor_id)
    values(later_human, account, now() - interval '1 minute', now(), 'aal2', factor);
  established_claims := (elevated_claims::jsonb || jsonb_build_object('session_id',later_human))::text;
  perform set_config('request.jwt.claims', established_claims, true);
  insert into auth.oauth_authorizations(id, authorization_id, client_id, user_id, redirect_uri, scope, status, created_at, expires_at)
    values(gen_random_uuid(), 'optional-mfa-consent', client, account, 'http://localhost:1/callback', 'email', 'approved', now(), now() + interval '3 minutes');
  set local role authenticated;
  if not public.can_control_computers() then raise exception 'Established MFA account lost computer control'; end if;
  checks := checks + 1;
  if (public.approve_agent_login('optional-mfa-consent')->>'login')::uuid <> approval
    or (select mfa_approved from public.agent_logins where id = approval) then
    raise exception 'Replaying consent upgraded basic approval';
  end if;
  checks := checks + 1;
  reset role;
  delete from auth.oauth_authorizations where authorization_id = 'optional-mfa-consent';

  -- A new human sign-in and MFA do not upgrade an earlier basic agent approval, nor can the
  -- agent upgrade itself by verifying a factor. Reconnect is required for computer capability.
  update auth.sessions set aal = 'aal2', factor_id = factor where id = agent;
  perform set_config('request.jwt.claims', (agent_claims::jsonb || jsonb_build_object('aal','aal2', 'amr',
    jsonb_build_array(jsonb_build_object('method','totp','timestamp',epoch))))::text, true);
  set local role authenticated;
  if public.can_control_computers() or private.session_ok() or private.planner_session_ok() then
    raise exception 'Basic agent approval upgraded after enrollment';
  end if;
  checks := checks + 1;
  begin
    insert into public.launch_requests(device_id, task_id, agent) values(device,task,'claude');
    raise exception 'Basic agent launched after account enrollment';
  exception when insufficient_privilege then checks := checks + 1; end;
  reset role;

  -- Disconnect works without MFA again after an account removes its factors. Revocation is
  -- immediate for the agent even while it still has an unexpired access token.
  delete from auth.mfa_factors where user_id = account;
  update auth.sessions set aal = 'aal1', factor_id = null where id = human;
  perform set_config('request.jwt.claims', basic_claims, true);
  set local role authenticated;
  perform public.revoke_agent_login(approval);
  perform set_config('request.jwt.claims', agent_claims, true);
  if public.claim_agent_login() then raise exception 'Disconnected basic MCP remains approved'; end if;
  select count(*) into n from public.tasks;
  if n <> 0 then raise exception 'Disconnected basic MCP still reads data'; end if;
  checks := checks + 2;
  reset role;

  -- Stale primary authentication, OAuth-like methods and a live subscription cannot delete
  -- an unenrolled account. A fresh password can; changing claims here models Auth-issued JWTs.
  foreach op in array array['password', 'oauth', 'otp'] loop
    perform set_config('request.jwt.claims', (basic_claims::jsonb || jsonb_build_object('amr',
      jsonb_build_array(jsonb_build_object('method',op,'timestamp',case when op = 'password' then epoch - 301 else epoch end))))::text, true);
    set local role authenticated;
    begin
      perform public.delete_account();
      raise exception 'Unsafe primary authentication deleted account: %', op;
    exception when insufficient_privilege then checks := checks + 1; end;
    reset role;
  end loop;
  update public.billing set subscription_id = 'sub_OptionalMfaTest', status = 'active' where user_id = account;
  perform set_config('request.jwt.claims', basic_claims, true);
  set local role authenticated;
  begin
    perform public.delete_account();
    raise exception 'Deleted account with subscription still renewing';
  exception when insufficient_privilege then checks := checks + 1; end;
  reset role;
  update public.billing set cancel_at_period_end = true where user_id = account;
  set local role authenticated;
  perform public.delete_account();
  reset role;
  if exists(select 1 from auth.users where id = account) then raise exception 'Fresh password could not delete unenrolled account'; end if;
  checks := checks + 1;

  -- Recovery sign-in is the email path for accounts originally created with Google.
  insert into auth.sessions(id,user_id,created_at,updated_at,aal) values(revoked,other_account,now(),now(),'aal1');
  perform set_config('request.jwt.claims', jsonb_build_object('sub',other_account,'session_id',revoked,'aal','aal1',
    'amr',jsonb_build_array(jsonb_build_object('method','recovery','timestamp',epoch)))::text,true);
  set local role authenticated;
  perform public.delete_account();
  reset role;
  if exists(select 1 from auth.users where id = other_account) then raise exception 'Fresh recovery could not delete unenrolled account'; end if;
  checks := checks + 1;
  raise notice 'Optional MFA: % assertions passed (fixtures rolled back).', checks;
end $test$;
rollback;
