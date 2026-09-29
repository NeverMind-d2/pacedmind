-- When on its planned day you mean to work on a task ("HH:mm", for its estimate): the week calendar's block you
-- dragged it to. The app reads it only with a planned day, and clears it with the day; older apps that clear only
-- the day leave it behind, which is why there is no check tying the two together.
alter table public.tasks
  add column planned_time text check (planned_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
