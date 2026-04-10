alter table public.profiles
  add column if not exists replanning_mode text not null default 'semi_automatic'
    check (replanning_mode in ('suggest_only', 'semi_automatic', 'automatic')),
  add column if not exists google_calendar_enabled boolean not null default false,
  add column if not exists outlook_calendar_enabled boolean not null default false,
  add column if not exists internal_risk_detection_enabled boolean not null default true,
  add column if not exists email_notifications_enabled boolean not null default true;

alter table public.calendar_events
  add column if not exists source_provider text
    check (source_provider in ('google', 'outlook', 'manual')),
  add column if not exists external_event_id text;

create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null check (provider in ('google', 'outlook')),
  status text not null default 'disconnected' check (status in ('disconnected', 'connected', 'error')),
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  external_email text,
  external_calendar_id text not null default 'primary',
  sync_cursor text,
  sync_window_start timestamptz,
  sync_window_end timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.replanning_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  trigger_type text not null,
  trigger_source text not null,
  trigger_hash text not null,
  decision text not null check (decision in ('ignored', 'suggested', 'applied', 'failed')),
  status text not null check (status in ('open', 'accepted', 'rejected', 'applied', 'ignored', 'failed')),
  outcome_reason text,
  impact_summary jsonb,
  trigger_payload jsonb not null default '{}'::jsonb,
  suggested_snapshot jsonb,
  before_revision_id uuid,
  after_revision_id uuid,
  notification_delivery_id text,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger touch_calendar_connections_updated_at
before update on public.calendar_connections
for each row execute function public.touch_updated_at();

create trigger touch_replanning_events_updated_at
before update on public.replanning_events
for each row execute function public.touch_updated_at();

create index if not exists idx_calendar_events_user_provider on public.calendar_events (user_id, source_provider, start_minute);
create index if not exists idx_calendar_connections_user_provider on public.calendar_connections (user_id, provider);
create index if not exists idx_replanning_events_user_created_at on public.replanning_events (user_id, created_at desc);
create index if not exists idx_replanning_events_user_hash on public.replanning_events (user_id, trigger_hash, created_at desc);

alter table public.calendar_connections enable row level security;
alter table public.replanning_events enable row level security;

create policy "calendar_connections_own"
on public.calendar_connections for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "replanning_events_own"
on public.replanning_events for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
