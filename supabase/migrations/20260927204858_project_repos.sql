-- The git repository a project's folder holds, as the desktop app reads it from git's own files
-- (src/server/git-remote.ts): the remote as host/path, lowercase, without scheme, user, password, port or ".git",
-- and after "#" the project's folder inside the repository when that isn't its root. Each computer keeps its own
-- folder for a project; this lets a second computer recognize the project in its copy of the repository instead of
-- making another one. It never decides where anything runs. Held to that plain shape, so no URL with credentials,
-- no path of a computer and no markup can be stored.
alter table public.projects
  add column repo text check (
    char_length(repo) <= 300
    and repo ~ '^[a-z0-9][a-z0-9.-]*(/[a-z0-9._~-]+)+(#[a-z0-9._ ~-]+(/[a-z0-9._ ~-]+)*)?$'
  );
