-- A project a task is about without being part of it (the task lives in its area), and how a done task comes back.
-- The reference includes user_id, so a task can only point at a project of its own account, and a deleted project
-- only clears it.
alter table public.tasks
  add column related_project_id uuid,
  add column repeat text check (repeat in ('day', 'weekday', 'week', 'month')),
  add constraint tasks_related_project_fkey foreign key (user_id, related_project_id)
    references public.projects (user_id, id) on delete set null (related_project_id);

create index tasks_related_project_idx on public.tasks (user_id, related_project_id) where related_project_id is not null;
