-- An area can show an icon in its color instead of its dot. The app draws a fixed set of Lucide icons
-- (src/lib/area-icons.ts) and keeps only the icon's name here, held to the form of those names so no other text
-- can pass for one.
alter table public.areas
  add column icon text check (icon ~ '^[a-z][a-z0-9-]{0,39}$');

-- The palette is a little stronger (src/lib/colors.ts): colors saved from its earlier values move to the ones
-- they became. Any other color stays as it is.
with palette (earlier, now) as (values
  ('#7D93B5', '#6A8DC3'), ('#7AA3AD', '#68AAB9'), ('#7FA894', '#70B192'), ('#9AA37A', '#9EAC6B'), ('#B8A27A', '#C8A565'),
  ('#B88F7A', '#C88765'), ('#B08A9B', '#B97C97'), ('#9C93B8', '#9485C0'), ('#A08FB0', '#9E83B7'))
update public.areas a set color = p.now from palette p where upper(a.color) = p.earlier;

with palette (earlier, now) as (values
  ('#7D93B5', '#6A8DC3'), ('#7AA3AD', '#68AAB9'), ('#7FA894', '#70B192'), ('#9AA37A', '#9EAC6B'), ('#B8A27A', '#C8A565'),
  ('#B88F7A', '#C88765'), ('#B08A9B', '#B97C97'), ('#9C93B8', '#9485C0'), ('#A08FB0', '#9E83B7'))
update public.projects pr set color = p.now from palette p where upper(pr.color) = p.earlier;

-- A new account starts with the five default areas in the new colors (src/server/account.ts has the same list).
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.areas (user_id, name, key, color, sort) values
    (new.id, 'Work', 'WRK', '#6A8DC3', 0),
    (new.id, 'Personal', 'PER', '#70B192', 1),
    (new.id, 'Health', 'HLT', '#B97C97', 2),
    (new.id, 'Learning', 'LRN', '#9485C0', 3),
    (new.id, 'Dev', 'DEV', '#68AAB9', 4);
  insert into public.user_state (user_id, version) values (new.id, 0) on conflict do nothing;
  return new;
end $$;
