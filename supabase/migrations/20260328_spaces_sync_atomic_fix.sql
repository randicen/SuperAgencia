-- ==============================================================================
-- Atomic row-sync repair for Espacios / Tareas
-- - Fixes position overflow by moving integer -> bigint
-- - Adds authoritative sync metadata table
-- - Exposes atomic RPCs for snapshot read + batch apply
-- ==============================================================================

alter table if exists public.space_workspaces
    alter column position type bigint using position::bigint;

alter table if exists public.space_spaces
    alter column position type bigint using position::bigint;

alter table if exists public.space_folders
    alter column position type bigint using position::bigint;

alter table if exists public.space_lists
    alter column position type bigint using position::bigint;

alter table if exists public.space_tasks
    alter column position type bigint using position::bigint;

alter table if exists public.space_events
    alter column position type bigint using position::bigint;

create table if not exists public.spaces_sync_meta (
    user_id uuid primary key references auth.users(id) on delete cascade,
    schema_version integer not null default 2,
    snapshot_version bigint not null default 0,
    status text not null default 'needs_repair',
    updated_at timestamp with time zone not null default now(),
    last_error text,
    constraint spaces_sync_meta_status_check check (status in ('needs_repair', 'repairing', 'ready', 'error'))
);

alter table public.spaces_sync_meta enable row level security;

drop policy if exists "Users can only access their own spaces sync meta" on public.spaces_sync_meta;
create policy "Users can only access their own spaces sync meta"
on public.spaces_sync_meta for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

do $$
begin
    if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'spaces_sync_meta'
    ) then
        alter publication supabase_realtime add table public.spaces_sync_meta;
    end if;
end $$;

create index if not exists idx_spaces_sync_meta_updated_at on public.spaces_sync_meta(updated_at);

create or replace function public.spaces_sync_get_snapshot()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_meta jsonb;
begin
    if v_user_id is null then
        raise exception 'Not authenticated';
    end if;

    select jsonb_build_object(
        'schema_version', m.schema_version,
        'snapshot_version', m.snapshot_version,
        'status', m.status,
        'updated_at', m.updated_at,
        'last_error', m.last_error
    )
    into v_meta
    from public.spaces_sync_meta m
    where m.user_id = v_user_id;

    if v_meta is null then
        v_meta := jsonb_build_object(
            'schema_version', 2,
            'snapshot_version', 0,
            'status', 'needs_repair',
            'updated_at', null,
            'last_error', null
        );
    end if;

    return jsonb_build_object(
        'meta', v_meta,
        'workspaces', coalesce((
            select jsonb_agg(to_jsonb(t) order by t.position, t.updated_at, t.id)
            from public.space_workspaces t
            where t.user_id = v_user_id
        ), '[]'::jsonb),
        'spaces', coalesce((
            select jsonb_agg(to_jsonb(t) order by t.position, t.updated_at, t.id)
            from public.space_spaces t
            where t.user_id = v_user_id
        ), '[]'::jsonb),
        'folders', coalesce((
            select jsonb_agg(to_jsonb(t) order by t.position, t.updated_at, t.id)
            from public.space_folders t
            where t.user_id = v_user_id
        ), '[]'::jsonb),
        'lists', coalesce((
            select jsonb_agg(to_jsonb(t) order by t.position, t.updated_at, t.id)
            from public.space_lists t
            where t.user_id = v_user_id
        ), '[]'::jsonb),
        'tasks', coalesce((
            select jsonb_agg(to_jsonb(t) order by t.position, t.updated_at, t.id)
            from public.space_tasks t
            where t.user_id = v_user_id
        ), '[]'::jsonb),
        'events', coalesce((
            select jsonb_agg(to_jsonb(t) order by t.position, t.updated_at, t.id)
            from public.space_events t
            where t.user_id = v_user_id
        ), '[]'::jsonb)
    );
end;
$$;

create or replace function public.spaces_sync_apply_batch(
    p_payload jsonb,
    p_replace_all boolean default false,
    p_status text default 'ready'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_now timestamp with time zone := clock_timestamp();
    v_snapshot_version bigint;
begin
    if v_user_id is null then
        raise exception 'Not authenticated';
    end if;

    if p_status not in ('needs_repair', 'repairing', 'ready', 'error') then
        raise exception 'Invalid sync status: %', p_status;
    end if;

    insert into public.spaces_sync_meta (user_id, schema_version, snapshot_version, status, updated_at, last_error)
    values (v_user_id, 2, 0, 'repairing', v_now, null)
    on conflict (user_id) do nothing;

    select snapshot_version
    into v_snapshot_version
    from public.spaces_sync_meta
    where user_id = v_user_id
    for update;

    if p_replace_all then
        delete from public.space_events where user_id = v_user_id;
        delete from public.space_tasks where user_id = v_user_id;
        delete from public.space_lists where user_id = v_user_id;
        delete from public.space_folders where user_id = v_user_id;
        delete from public.space_spaces where user_id = v_user_id;
        delete from public.space_workspaces where user_id = v_user_id;
    end if;

    insert into public.space_workspaces (id, user_id, name, position, updated_at, deleted_at)
    select
        row.id,
        v_user_id,
        row.name,
        coalesce(row.position, 0),
        v_now,
        case when row.deleted_at is not null then v_now else null end
    from jsonb_to_recordset(coalesce(p_payload->'workspaces', '[]'::jsonb)) as row(
        id text,
        name text,
        position bigint,
        deleted_at timestamp with time zone
    )
    on conflict (id) do update
    set
        user_id = excluded.user_id,
        name = excluded.name,
        position = excluded.position,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at;

    insert into public.space_spaces (id, user_id, workspace_id, name, color, position, updated_at, deleted_at)
    select
        row.id,
        v_user_id,
        row.workspace_id,
        row.name,
        row.color,
        coalesce(row.position, 0),
        v_now,
        case when row.deleted_at is not null then v_now else null end
    from jsonb_to_recordset(coalesce(p_payload->'spaces', '[]'::jsonb)) as row(
        id text,
        workspace_id text,
        name text,
        color text,
        position bigint,
        deleted_at timestamp with time zone
    )
    on conflict (id) do update
    set
        user_id = excluded.user_id,
        workspace_id = excluded.workspace_id,
        name = excluded.name,
        color = excluded.color,
        position = excluded.position,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at;

    insert into public.space_folders (id, user_id, workspace_id, space_id, name, position, updated_at, deleted_at)
    select
        row.id,
        v_user_id,
        row.workspace_id,
        row.space_id,
        row.name,
        coalesce(row.position, 0),
        v_now,
        case when row.deleted_at is not null then v_now else null end
    from jsonb_to_recordset(coalesce(p_payload->'folders', '[]'::jsonb)) as row(
        id text,
        workspace_id text,
        space_id text,
        name text,
        position bigint,
        deleted_at timestamp with time zone
    )
    on conflict (id) do update
    set
        user_id = excluded.user_id,
        workspace_id = excluded.workspace_id,
        space_id = excluded.space_id,
        name = excluded.name,
        position = excluded.position,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at;

    insert into public.space_lists (id, user_id, workspace_id, space_id, folder_id, name, position, updated_at, deleted_at)
    select
        row.id,
        v_user_id,
        row.workspace_id,
        row.space_id,
        row.folder_id,
        row.name,
        coalesce(row.position, 0),
        v_now,
        case when row.deleted_at is not null then v_now else null end
    from jsonb_to_recordset(coalesce(p_payload->'lists', '[]'::jsonb)) as row(
        id text,
        workspace_id text,
        space_id text,
        folder_id text,
        name text,
        position bigint,
        deleted_at timestamp with time zone
    )
    on conflict (id) do update
    set
        user_id = excluded.user_id,
        workspace_id = excluded.workspace_id,
        space_id = excluded.space_id,
        folder_id = excluded.folder_id,
        name = excluded.name,
        position = excluded.position,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at;

    insert into public.space_tasks (id, user_id, workspace_id, space_id, folder_id, list_id, parent_task_id, position, payload, updated_at, deleted_at)
    select
        row.id,
        v_user_id,
        row.workspace_id,
        row.space_id,
        row.folder_id,
        row.list_id,
        row.parent_task_id,
        coalesce(row.position, 0),
        coalesce(row.payload, '{}'::jsonb),
        v_now,
        case when row.deleted_at is not null then v_now else null end
    from jsonb_to_recordset(coalesce(p_payload->'tasks', '[]'::jsonb)) as row(
        id text,
        workspace_id text,
        space_id text,
        folder_id text,
        list_id text,
        parent_task_id text,
        position bigint,
        payload jsonb,
        deleted_at timestamp with time zone
    )
    on conflict (id) do update
    set
        user_id = excluded.user_id,
        workspace_id = excluded.workspace_id,
        space_id = excluded.space_id,
        folder_id = excluded.folder_id,
        list_id = excluded.list_id,
        parent_task_id = excluded.parent_task_id,
        position = excluded.position,
        payload = excluded.payload,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at;

    insert into public.space_events (id, user_id, workspace_id, space_id, folder_id, list_id, kind, position, payload, updated_at, deleted_at)
    select
        row.id,
        v_user_id,
        row.workspace_id,
        row.space_id,
        row.folder_id,
        row.list_id,
        row.kind,
        coalesce(row.position, 0),
        coalesce(row.payload, '{}'::jsonb),
        v_now,
        case when row.deleted_at is not null then v_now else null end
    from jsonb_to_recordset(coalesce(p_payload->'events', '[]'::jsonb)) as row(
        id text,
        workspace_id text,
        space_id text,
        folder_id text,
        list_id text,
        kind text,
        position bigint,
        payload jsonb,
        deleted_at timestamp with time zone
    )
    on conflict (id) do update
    set
        user_id = excluded.user_id,
        workspace_id = excluded.workspace_id,
        space_id = excluded.space_id,
        folder_id = excluded.folder_id,
        list_id = excluded.list_id,
        kind = excluded.kind,
        position = excluded.position,
        payload = excluded.payload,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at;

    v_snapshot_version := coalesce(v_snapshot_version, 0) + 1;

    update public.spaces_sync_meta
    set
        schema_version = 2,
        snapshot_version = v_snapshot_version,
        status = p_status,
        updated_at = v_now,
        last_error = null
    where user_id = v_user_id;

    return jsonb_build_object(
        'schema_version', 2,
        'snapshot_version', v_snapshot_version,
        'status', p_status,
        'updated_at', v_now,
        'last_error', null
    );
exception
    when others then
        insert into public.spaces_sync_meta (user_id, schema_version, snapshot_version, status, updated_at, last_error)
        values (v_user_id, 2, 0, 'error', clock_timestamp(), sqlerrm)
        on conflict (user_id) do update
        set
            status = 'error',
            updated_at = excluded.updated_at,
            last_error = excluded.last_error;
        raise;
end;
$$;

grant execute on function public.spaces_sync_get_snapshot() to authenticated;
grant execute on function public.spaces_sync_apply_batch(jsonb, boolean, text) to authenticated;
