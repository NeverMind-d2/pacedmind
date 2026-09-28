-- Settings are inert data. The destination computer checks its current account's catalog again before launch.
alter table public.tasks add column model_settings jsonb;
alter table public.tasks add constraint tasks_model_settings_check check (
  model_settings is null or coalesce(
    jsonb_typeof(model_settings) = 'object'
    and octet_length(model_settings::text) <= 600
    and model_settings - array['agent', 'model', 'effort', 'speed'] = '{}'::jsonb
    and model_settings->>'agent' in ('claude', 'codex')
    and jsonb_typeof(model_settings->'model') = 'string'
    and model_settings->>'model' ~ '^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$'
    and (model_settings->>'effort' is null or (jsonb_typeof(model_settings->'effort') = 'string' and model_settings->>'effort' ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,29}$'))
    and (model_settings->>'speed' is null or (jsonb_typeof(model_settings->'speed') = 'string' and model_settings->>'speed' ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,29}$')),
    false
  )
);

-- Model capabilities join the existing, device-owned metadata. No identity, token, command or path is included.
alter table public.devices drop constraint devices_agents_check;
alter table public.devices add constraint devices_agents_check check (
  jsonb_typeof(agents) = 'object' and octet_length(agents::text) <= 65536
);
