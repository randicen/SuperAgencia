alter table public.profiles
  drop constraint if exists profiles_id_fkey;

alter table public.profiles
  alter column id set default gen_random_uuid();

alter table public.profiles
  add column if not exists clerk_user_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_clerk_user_id_key'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_clerk_user_id_key unique (clerk_user_id);
  end if;
end;
$$;
