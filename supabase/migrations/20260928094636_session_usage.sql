-- What a session's agent used, as Claude Code's usage metrics reported it to the computer it runs on
-- (src/server/usage-metrics.ts): tokens per conversation, their cost at API prices, the seconds it worked and the
-- models it ran. Plain JSON, small; the app checks its shape when it reads it (usageOf).
alter table public.sessions
  add column usage jsonb
    check (usage is null or (jsonb_typeof(usage) = 'object' and octet_length(usage::text) <= 8000));
