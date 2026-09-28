-- What changed in git in a session's folder since the session started, as its computer saw it when the agent handed
-- the task back (src/server/diff.ts): the commits, the files with their lines added and removed. The full diff stays on
-- that computer. Plain JSON, small; the app checks its shape when it reads it (diffOf).
alter table public.reports
  add column diff jsonb
    check (diff is null or (jsonb_typeof(diff) = 'object' and octet_length(diff::text) <= 100000));
