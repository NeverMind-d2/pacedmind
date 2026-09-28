-- The git repository an area's workspace holds, as the desktop app reads it from git's own files
-- (src/server/git-remote.ts), in the same plain shape as projects.repo: host/path, lowercase, and after "#" the folder
-- inside the repository. Each computer keeps its own workspace for an area; this lets another computer offer its copy
-- of the repository when you pick the area's workspace there. It never decides where anything runs.
alter table public.areas
  add column repo text check (
    char_length(repo) <= 300
    and repo ~ '^[a-z0-9][a-z0-9.-]*(/[a-z0-9._~-]+)+(#[a-z0-9._ ~-]+(/[a-z0-9._ ~-]+)*)?$'
  );
