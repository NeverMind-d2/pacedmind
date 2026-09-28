-- What a task needs from the computer its session runs on (src/lib/needs.ts): MCP servers or claude.ai connectors by
-- name, such as supabase or Gmail. The app offers a computer whose agent has them, and a flow asks before it starts
-- a task without them; nothing runs because of it. Names only: at most ten, plain characters.
alter table public.tasks
  add column needs text[] not null default '{}'
    check (
      cardinality(needs) <= 10
      and char_length(array_to_string(needs, '')) <= 480
      and array_to_string(needs, '|') !~ '[^A-Za-z0-9_.@:+ |-]'
    );
