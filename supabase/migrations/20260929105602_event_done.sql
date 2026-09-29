-- The days whose occurrence of an activity you marked done: one for a one-off activity, any number for a weekly one
-- (each week's is its own). Only dates, so a row can't carry anything else; the app keeps the last 2000.
alter table public.events
  add column done_on date[] not null default '{}' check (cardinality(done_on) <= 2000);
