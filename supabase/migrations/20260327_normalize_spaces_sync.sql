-- ==============================================================================
-- Normalized sync tables for Espacios / Tareas
-- Source of truth replaces the legacy blob in public.spaces_store.
-- ==============================================================================

create table if not exists public.space_workspaces (
    id text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    position integer not null default 0,
    updated_at timestamp with time zone not null default now(),
    deleted_at timestamp with time zone
);

create table if not exists public.space_spaces (
    id text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    workspace_id text not null,
    name text not null,
    color text not null,
    position integer not null default 0,
    updated_at timestamp with time zone not null default now(),
    deleted_at timestamp with time zone
);

create table if not exists public.space_folders (
    id text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    workspace_id text not null,
    space_id text not null,
    name text not null,
    position integer not null default 0,
    updated_at timestamp with time zone not null default now(),
    deleted_at timestamp with time zone
);

create table if not exists public.space_lists (
    id text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    workspace_id text not null,
    space_id text not null,
    folder_id text,
    name text not null,
    position integer not null default 0,
    updated_at timestamp with time zone not null default now(),
    deleted_at timestamp with time zone
);

create table if not exists public.space_tasks (
    id text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    workspace_id text not null,
    space_id text not null,
    folder_id text,
    list_id text not null,
    parent_task_id text,
    position integer not null default 0,
    payload jsonb not null default '{}'::jsonb,
    updated_at timestamp with time zone not null default now(),
    deleted_at timestamp with time zone
);

create table if not exists public.space_events (
    id text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    workspace_id text not null,
    space_id text,
    folder_id text,
    list_id text,
    kind text not null,
    position integer not null default 0,
    payload jsonb not null default '{}'::jsonb,
    updated_at timestamp with time zone not null default now(),
    deleted_at timestamp with time zone,
    constraint space_events_kind_check check (kind in ('workspace_agenda', 'list_event', 'global_gcal'))
);

create index if not exists idx_space_workspaces_user_id on public.space_workspaces(user_id);
create index if not exists idx_space_spaces_user_id on public.space_spaces(user_id);
create index if not exists idx_space_spaces_workspace_id on public.space_spaces(workspace_id);
create index if not exists idx_space_folders_user_id on public.space_folders(user_id);
create index if not exists idx_space_folders_space_id on public.space_folders(space_id);
create index if not exists idx_space_lists_user_id on public.space_lists(user_id);
create index if not exists idx_space_lists_space_id on public.space_lists(space_id);
create index if not exists idx_space_lists_folder_id on public.space_lists(folder_id);
create index if not exists idx_space_tasks_user_id on public.space_tasks(user_id);
create index if not exists idx_space_tasks_list_id on public.space_tasks(list_id);
create index if not exists idx_space_tasks_parent_task_id on public.space_tasks(parent_task_id);
create index if not exists idx_space_tasks_deleted_at on public.space_tasks(deleted_at);
create index if not exists idx_space_events_user_id on public.space_events(user_id);
create index if not exists idx_space_events_workspace_id on public.space_events(workspace_id);
create index if not exists idx_space_events_list_id on public.space_events(list_id);

alter table public.space_workspaces enable row level security;
alter table public.space_spaces enable row level security;
alter table public.space_folders enable row level security;
alter table public.space_lists enable row level security;
alter table public.space_tasks enable row level security;
alter table public.space_events enable row level security;

drop policy if exists "Users can only access their own space workspaces" on public.space_workspaces;
create policy "Users can only access their own space workspaces"
on public.space_workspaces for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own spaces rows" on public.space_spaces;
create policy "Users can only access their own spaces rows"
on public.space_spaces for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own folders rows" on public.space_folders;
create policy "Users can only access their own folders rows"
on public.space_folders for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own lists rows" on public.space_lists;
create policy "Users can only access their own lists rows"
on public.space_lists for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own tasks rows" on public.space_tasks;
create policy "Users can only access their own tasks rows"
on public.space_tasks for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can only access their own events rows" on public.space_events;
create policy "Users can only access their own events rows"
on public.space_events for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'space_workspaces'
    ) then
        alter publication supabase_realtime add table public.space_workspaces;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'space_spaces'
    ) then
        alter publication supabase_realtime add table public.space_spaces;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'space_folders'
    ) then
        alter publication supabase_realtime add table public.space_folders;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'space_lists'
    ) then
        alter publication supabase_realtime add table public.space_lists;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'space_tasks'
    ) then
        alter publication supabase_realtime add table public.space_tasks;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'space_events'
    ) then
        alter publication supabase_realtime add table public.space_events;
    end if;
end $$;
