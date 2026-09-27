-- A session's link: https only, at most 1000 characters. Postgres regexes repeat at most 255 times, so
-- the '{1,1000}' of reports_and_surfaces made every link fail; the length is checked on its own.
alter table public.sessions
  drop constraint sessions_url_check,
  add constraint sessions_url_check check (char_length(url) <= 1000 and url ~ '^https://[^\s<>"'']+$');
