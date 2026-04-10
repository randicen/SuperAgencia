create extension if not exists pgcrypto;
drop function if exists public.touch_updated_at() cascade;

drop table if exists public.usage_events cascade;
drop table if exists public.usage_counters cascade;
drop table if exists public.model_routes cascade;
drop table if exists public.user_entitlements cascade;
drop table if exists public.plan_definitions cascade;
drop table if exists public.state_revisions cascade;
drop table if exists public.schedule_runs cascade;
drop table if exists public.work_blocks cascade;
drop table if exists public.task_dependencies cascade;
drop table if exists public.calendar_events cascade;
drop table if exists public.chat_messages cascade;
drop table if exists public.tasks cascade;
drop table if exists public.planner_states cascade;
drop table if exists public.profiles cascade;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null default 'Agena User',
  avatar_url text,
  timezone text not null default 'America/Bogota',
  locale text not null default 'es-CO',
  tier text not null default 'free' check (tier in ('free', 'premium')),
  account_status text not null default 'active' check (account_status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.planner_states (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  work_window jsonb not null default '{"startHour":8,"endHour":18,"workDays":[1,2,3,4,5]}'::jsonb,
  strategy text not null default 'intelligent' check (strategy in ('balanced', 'survival', 'intelligent')),
  schedule_base_date timestamptz not null default now(),
  diagnostics jsonb,
  current_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('user', 'model')),
  text text not null,
  metadata jsonb,
  position integer not null,
  created_at timestamptz not null default now(),
  unique (user_id, position)
);

create table public.tasks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  id text not null,
  name text not null,
  duration integer not null check (duration > 0),
  fixed_start integer,
  min_start integer,
  deadline integer,
  priority text not null default 'medium' check (priority in ('ASAP', 'high', 'medium', 'low')),
  elastic boolean not null default false,
  min_chunk_size integer check (min_chunk_size is null or min_chunk_size > 0),
  progress integer not null default 0 check (progress between 0 and 100),
  deadline_type text check (deadline_type in ('Hard Deadline', 'Soft Deadline')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  from_task_id text not null,
  to_task_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, from_task_id, to_task_id),
  check (from_task_id <> to_task_id),
  foreign key (user_id, from_task_id) references public.tasks (user_id, id) on delete cascade,
  foreign key (user_id, to_task_id) references public.tasks (user_id, id) on delete cascade
);

create table public.work_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  task_id text not null,
  start_minute integer not null,
  end_minute integer not null check (end_minute > start_minute),
  created_at timestamptz not null default now(),
  foreign key (user_id, task_id) references public.tasks (user_id, id) on delete cascade
);

create table public.calendar_events (
  user_id uuid not null references public.profiles (id) on delete cascade,
  id text not null,
  title text not null,
  start_minute integer not null,
  end_minute integer not null check (end_minute > start_minute),
  kind text not null default 'blocked' check (kind in ('meeting', 'personal', 'focus', 'blocked')),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.schedule_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  strategy text not null check (strategy in ('balanced', 'survival', 'intelligent')),
  task_count integer not null default 0,
  score numeric not null default 0,
  status text not null check (status in ('OPTIMAL', 'FEASIBLE', 'INFEASIBLE', 'TIMEOUT', 'INVALID_INPUT')),
  diagnostics jsonb,
  schedule jsonb,
  config_used jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.state_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  revision_number bigint generated always as identity,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, revision_number)
);

create table public.plan_definitions (
  code text primary key check (code in ('free', 'premium')),
  text_ai_enabled boolean not null,
  voice_ai_enabled boolean not null,
  web_search_enabled boolean not null default true,
  lifetime_text_limit integer,
  period_text_limit integer,
  period_voice_minutes_limit integer,
  manual_planning_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_entitlements (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  plan_code text not null references public.plan_definitions (code),
  status text not null default 'active' check (status in ('active', 'inactive')),
  granted_by text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  auto_renew boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
  ,
  check (
    current_period_start is null
    or current_period_end is null
    or current_period_end > current_period_start
  )
);

create table public.model_routes (
  plan_code text not null references public.plan_definitions (code) on delete cascade,
  channel text not null check (channel in ('text', 'voice')),
  primary_provider text not null,
  primary_model text not null,
  fallback_provider text,
  fallback_model text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (plan_code, channel)
);

create table public.usage_counters (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  period_start timestamptz,
  period_end timestamptz,
  text_requests_used_period integer not null default 0,
  voice_seconds_used_period integer not null default 0,
  text_requests_used_lifetime integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    period_start is null
    or period_end is null
    or period_end > period_start
  )
);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel text not null check (channel in ('text', 'voice', 'web_search')),
  provider text not null,
  model text not null,
  success boolean not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  voice_seconds integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  error_code text,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_profiles_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger touch_planner_states_updated_at
before update on public.planner_states
for each row execute function public.touch_updated_at();

create trigger touch_tasks_updated_at
before update on public.tasks
for each row execute function public.touch_updated_at();

create trigger touch_user_entitlements_updated_at
before update on public.user_entitlements
for each row execute function public.touch_updated_at();

create trigger touch_usage_counters_updated_at
before update on public.usage_counters
for each row execute function public.touch_updated_at();

create index idx_chat_messages_user_position on public.chat_messages (user_id, position);
create index idx_tasks_user_created_at on public.tasks (user_id, created_at);
create index idx_work_blocks_user_start on public.work_blocks (user_id, start_minute);
create index idx_calendar_events_user_start on public.calendar_events (user_id, start_minute);
create index idx_schedule_runs_user_created_at on public.schedule_runs (user_id, created_at desc);
create index idx_state_revisions_user_revision on public.state_revisions (user_id, revision_number desc);
create index idx_usage_events_user_created_at on public.usage_events (user_id, created_at desc);
create index idx_usage_counters_period_end on public.usage_counters (period_end);

alter table public.profiles enable row level security;
alter table public.planner_states enable row level security;
alter table public.chat_messages enable row level security;
alter table public.tasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.work_blocks enable row level security;
alter table public.calendar_events enable row level security;
alter table public.schedule_runs enable row level security;
alter table public.state_revisions enable row level security;
alter table public.plan_definitions enable row level security;
alter table public.user_entitlements enable row level security;
alter table public.model_routes enable row level security;
alter table public.usage_counters enable row level security;
alter table public.usage_events enable row level security;

create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (id = auth.uid());

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

create policy "planner_states_own"
on public.planner_states for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "chat_messages_own"
on public.chat_messages for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "tasks_own"
on public.tasks for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "task_dependencies_own"
on public.task_dependencies for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "work_blocks_own"
on public.work_blocks for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "calendar_events_own"
on public.calendar_events for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "schedule_runs_own"
on public.schedule_runs for select
to authenticated
using (user_id = auth.uid());

create policy "state_revisions_own"
on public.state_revisions for select
to authenticated
using (user_id = auth.uid());

create policy "user_entitlements_own"
on public.user_entitlements for select
to authenticated
using (user_id = auth.uid());

create policy "usage_counters_own"
on public.usage_counters for select
to authenticated
using (user_id = auth.uid());

create policy "usage_events_own"
on public.usage_events for select
to authenticated
using (user_id = auth.uid());

create policy "plan_definitions_read_authenticated"
on public.plan_definitions for select
to authenticated
using (true);

create policy "model_routes_read_authenticated"
on public.model_routes for select
to authenticated
using (true);

insert into public.plan_definitions (
  code,
  text_ai_enabled,
  voice_ai_enabled,
  web_search_enabled,
  lifetime_text_limit,
  period_text_limit,
  period_voice_minutes_limit,
  manual_planning_enabled
)
values
  ('free', true, false, true, 25, null, null, true),
  ('premium', true, true, true, null, 300, 30, true);

insert into public.model_routes (
  plan_code,
  channel,
  primary_provider,
  primary_model,
  fallback_provider,
  fallback_model,
  enabled
)
values
  ('free', 'text', 'openrouter', 'google/gemma-3-12b-it:free', 'google', 'gemini-3.1-flash-lite-preview', true),
  ('premium', 'text', 'openrouter', 'google/gemma-3-12b-it:free', 'google', 'gemini-3.1-flash-lite-preview', true),
  ('premium', 'voice', 'google', 'gemini-2.5-flash-native-audio-preview-12-2025', null, null, true);
